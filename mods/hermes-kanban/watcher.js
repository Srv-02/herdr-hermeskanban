// The watcher: the glue of the poller (lib/poller.js) to herdr. One pass polls every visible instance that is due,
// shares the snapshots, counts what is new and unseen (needs you, finished), posts the toasts and sounds of the changes and sets the Dock
// badge. The button role in main.js runs it from its timer, only in the copy that holds the lease, and never during
// herdr-app check; this file registers no timer.
//
// Shared keys: hermes-kanban.boards (Record<machine, Snapshot>), hermes-kanban.unseen (Record<machine, { needs, done }>),
// hermes-kanban.lastPanes (Record<machine, paneId>), hermes-kanban.osName (the comment author from the OS), written here; hermes-kanban.seen (Record<machine, at>, the panel), hermes-kanban.shown (Record<panel copy, { machine, at }>, the panels),
// hermes-kanban.refresh ({ machine, at }, panel or overlay after an action), hermes-kanban.config ({ at }, after
// Save in the settings), read here.
import { spaces, panes, focused, exec, notify, playSound, setBadge, shared, setShared, readTextFile, appHome } from "herdr";
import { createApi } from "./lib/api.js";
import { createPoller } from "./lib/poller.js";
import { loadSettings, isSingleAgent } from "./lib/settings.js";
import { visibleMachines, focusedInstance, rememberPane, toastCommand } from "./lib/instances.js";
import { toastOf, alertsOf, nextUnseen, badgeOf, shownMachines } from "./lib/changes.js";
import { readOsName } from "./lib/author.js";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The poller and its API, made at the first pass. A copy that newly holds the lease (after a Herdr restart, a mod
// update or a takeover) continues from the boards the previous copy shared, when they are fresh (lib/poller.js
// SEED_MAX_AGE_MS): what changed in the gap reports once. Without a fresh board, a machine's first poll only sets the
// baseline: no toasts for what happened before.
function start(w) {
  let poller = null;
  const api = createApi(exec, (machine) => poller.mode(machine));
  poller = createPoller({ api, run: (s) => exec(s.cmd, s.args, s.opts), now: Date.now, settings: () => w.settings, seed: shared("hermes-kanban.boards") });
  w.poller = poller;
  // Marks set before this copy watched are old news.
  w.seenAt = { ...(shared("hermes-kanban.seen") ?? {}) };
  w.refreshAt = shared("hermes-kanban.refresh")?.at;
}

async function once(w) {
  if (!w.poller) start(w);
  // The comment author's default, once per start: the Mac user's full name (lib/author.js). The task overlay and
  // the settings read it from there.
  if (w.osName === undefined) {
    w.osName = await readOsName(exec);
    if (shared("hermes-kanban.osName") !== w.osName) setShared("hermes-kanban.osName", w.osName);
  }
  const config = shared("hermes-kanban.config");
  if (!w.settings || (config?.at && config.at !== w.configAt)) {
    w.configAt = config?.at;
    w.settings = (await loadSettings(readTextFile, appHome)).values;
  }
  const refresh = shared("hermes-kanban.refresh");
  if (refresh?.at && refresh.at !== w.refreshAt) {
    w.refreshAt = refresh.at;
    if (typeof refresh.machine === "string") w.poller.refresh(refresh.machine);
  }

  // Where a toast's click goes: the terminal pane last focused on its machine (a shell pane there as well).
  const view = { spaces: spaces(), panes: panes() };
  const before = shared("hermes-kanban.lastPanes") ?? {};
  const lastPanes = rememberPane(before, focusedInstance({ ...view, focused: focused(), boards: shared("hermes-kanban.boards") }), view.panes);
  if (lastPanes !== before) setShared("hermes-kanban.lastPanes", lastPanes);

  const machines = visibleMachines(view.spaces);
  const { snapshots, changes } = await w.poller.tick(machines);

  // Opening the panel of an instance clears its dot: the panel marks it seen, and that zeroes its counts. The instance
  // the panel shows collects nothing meanwhile.
  const next = nextUnseen({ unseen: shared("hermes-kanban.unseen"), seen: shared("hermes-kanban.seen"), seenAt: w.seenAt,
    shown: shownMachines(shared("hermes-kanban.shown"), Date.now()), changes, machines });
  const unseen = next.unseen;
  w.seenAt = next.seenAt;
  // Each write re-renders every mod: only what changed.
  if (!same(unseen, shared("hermes-kanban.unseen"))) setShared("hermes-kanban.unseen", unseen);
  if (!same(snapshots, shared("hermes-kanban.boards"))) setShared("hermes-kanban.boards", snapshots);

  const { toasts, sound } = alertsOf(changes, w.settings);
  for (const c of toasts) {
    // The click goes to the button (main.js listen): it jumps to the machine and opens the task in its overlay.
    notify({ ...toastOf(c, { single: isSingleAgent(w.settings, c.machine) }), timeout: 8000, action: { name: toastCommand(c.machine, c.id) } });
  }
  if (sound) playSound(sound);

  // The badge is the app's, shared by every mod: cleared only when this copy set it.
  const badge = w.settings.badge ? badgeOf(unseen) : null;
  if ((w.settings.badge || w.badge != null) && badge !== w.badge) {
    setBadge(badge);
    w.badge = badge;
  }
}

// One pass over the visible instances. `w` is the watcher's state, kept by the button between passes. While a pass
// runs, the timer's next one is skipped; one asked for with `queue` (a refresh after an action) runs right after it.
export async function watchPass(w, queue = false) {
  if (w.busy) {
    if (queue) w.again = true;
    return;
  }
  w.busy = true;
  try {
    do {
      w.again = false;
      await once(w);
    } while (w.again);
  } finally {
    w.busy = false;
  }
}
