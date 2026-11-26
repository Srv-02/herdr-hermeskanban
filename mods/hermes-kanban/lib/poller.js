// The poller: one state per visible machine, polled on its own beat (poll_seconds). Each poll first reads the cheap
// stamp of kanban.db; /board (then, after a 200, /diagnostics for the problems count) follows only when the stamp
// changed, when a refresh was asked, and every FULL_EVERY as a safety net. /api/status, /workflow and /orchestration
// come at the start, after an error and every META_EVERY. The probe runs only on trouble (401 or gateway down), never
// in normal operation. Boards are kept unfiltered, as Hermes returns them; filters belong to the view.
//
// Changes are reported against the last good board of the same machine. A machine's first board, also after it left
// the list and came back, only sets the baseline. A failed poll keeps the last snapshot and reports nothing.
// A new poller (a new button copy after a Herdr restart, a mod update or a lease takeover) may get `seed`: the
// snapshots the previous copy shared (hermes-kanban.boards). A seeded machine continues from that snapshot, so what
// changed in the gap between the two copies reports once, against the last board anyone reported. A seed counts only
// when it is at most SEED_MAX_AGE_MS old, only for a machine visible at the first tick, and only once.
// Dependencies are injected: api (createApi), run (exec of a { cmd, args, opts } spec), now, settings, seed.
import { checkBoard, checkWorkflow, normalizeBoard, normalizeStatus, normalizeWorkflow } from "./board.js";
import { STAMP_SCRIPT, diffBoards, parseStamp } from "./changes.js";
import { PROBE_SCRIPT, accessState, parseProbe, scriptSpec } from "./setup.js";
import { SETTINGS } from "./settings.js";

export const FULL_EVERY = 300000;
export const META_EVERY = 300000;
// 10 minutes: well past the lease's 3 minutes plus a Herdr restart, so a quick restart or a mod update loses nothing;
// short enough that a copy starting after a long pause (the Mac asleep, Herdr closed) does not toast old news.
export const SEED_MAX_AGE_MS = 600000;
// The panel's refresh waits this long for a poll before it says that none came.
export const REFRESH_WAIT_MS = 30000;

const PACES = SETTINGS.find((s) => s.key === "poll_seconds");
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const message = (e) => String(e?.message ?? e);

function blank(machine) {
  return {
    machine, at: 0, board: null, status: null, workflow: null, defaultAssignee: "", resolvedAssignee: "", mode: null, problems: null,
    access: { state: "unknown" }, error: null, unsupported: null, hermes: false,
  };
}

const paceOf = (values) => {
  const s = values?.poll_seconds;
  return (PACES.choices.includes(s) ? s : PACES.default) * 1000;
};

// How long ago the snapshot's last poll was, when that is longer than three of its paces (no poll came: the copy that
// polls stopped, or another one has not taken over yet), else null.
export function staleFor(snap, now, values) {
  if (!isObj(snap) || typeof snap.at !== "number") return null;
  const age = now - snap.at;
  return age > 3 * (snap.hermes ? paceOf(values) : META_EVERY) ? age : null;
}

// The refresh button for `machine`: "busy" while its refresh `r` ({ machine, at }) waits for a poll, "nopoll" when
// none came within REFRESH_WAIT_MS, null otherwise.
export function refreshState(r, machine, snap, now) {
  if (!r || !machine || r.machine !== machine || (snap?.at ?? 0) >= r.at) return null;
  return now - r.at < REFRESH_WAIT_MS ? "busy" : "nopoll";
}

// A shared snapshot of `machine` that a new poller may continue from: its own machine and tasks, a board of the
// poller's shape (or none), and at most SEED_MAX_AGE_MS old (a stamp in the future counts as too old).
function seedOf(snap, machine, t) {
  if (!isObj(snap) || snap.machine !== machine || typeof snap.at !== "number" || snap.at > t || t - snap.at > SEED_MAX_AGE_MS) return null;
  if (snap.board !== null && !(isObj(snap.board) && Array.isArray(snap.board.tasks) && snap.board.tasks.every((x) => isObj(x) && x.machine === machine && typeof x.id === "string" && Array.isArray(x.warnings)))) return null;
  return { ...blank(machine), ...snap };
}

export function createPoller({ api, run, now, settings, seed }) {
  const states = new Map();
  // Set only by a new /api/status or a gateway found down; never cleared when a machine leaves the list.
  const modes = new Map();
  // The previous copy's snapshots, until the first tick takes or drops them.
  let seeds = isObj(seed) ? seed : null;

  const pace = () => paceOf(settings());

  function due(st, t) {
    if (!st.snap || st.fullDue) return true;
    return t - st.lastPoll >= (st.snap.hermes ? pace() : META_EVERY);
  }

  async function probe(machine) {
    try {
      const r = await run(scriptSpec(machine, PROBE_SCRIPT, [], 15000));
      return parseProbe(r?.stdout);
    } catch {
      return null;
    }
  }

  // One poll of one machine: the next snapshot and the changes it brings. Never throws.
  async function poll(machine, st) {
    const t = now();
    const snap = { ...(st.snap ?? blank(machine)), at: t };
    const done = (changes = []) => ({ snap, changes });
    const failed = (error) => {
      snap.error = error;
      st.metaDue = true;
      return done();
    };
    try {
      const stamped = await run(scriptSpec(machine, STAMP_SCRIPT, [], 15000));
      const stamp = parseStamp(stamped?.stdout ?? "");
      if (stamp === null) {
        // No kanban.db: no Hermes here (now). Its old data goes, so a later Hermes starts with a new baseline.
        Object.assign(st, { stamp: null, rawStatus: null, metaDue: true, fullDue: false });
        return { snap: { ...blank(machine), at: t }, changes: [] };
      }
      snap.hermes = true;

      const meta = st.metaDue || !modes.get(machine) || t - st.lastMeta >= META_EVERY;
      if (meta) {
        const s = await api.status(machine);
        if (s.code !== 200 || !isObj(s.json)) {
          st.rawStatus = null;
          modes.set(machine, null);
          snap.status = null;
          snap.mode = null;
          snap.access = accessState({ status: null, probe: await probe(machine), statsCode: 0 });
          return failed(`gateway down${s.error ? `: ${s.error}` : ` (HTTP ${s.code})`}`);
        }
        st.rawStatus = s.json;
        snap.status = normalizeStatus(s.json);
        snap.mode = snap.status.gated ? "gated" : "open";
        modes.set(machine, snap.mode);
      }

      const full = meta || st.fullDue || stamp !== st.stamp || t - st.lastFull >= FULL_EVERY || snap.board === null;
      if (!full) {
        snap.error = null;
        return done();
      }
      st.fullDue = false;
      const b = await api.board(machine);
      if (b.code === 401) {
        snap.access = accessState({ status: st.rawStatus, probe: await probe(machine), statsCode: 401 });
        snap.error = null;
        st.metaDue = true;
        return done();
      }
      if (b.code !== 200) return failed(b.error || `HTTP ${b.code}`);
      snap.access = accessState({ status: st.rawStatus, probe: null, statsCode: 200 });
      snap.error = null;
      st.stamp = stamp;
      st.lastFull = t;
      let changes = [];
      if (checkBoard(b.json)) {
        const next = normalizeBoard(b.json, machine);
        changes = diffBoards(snap.board, next);
        snap.board = next;
        snap.unsupported = null;
      } else {
        snap.board = null;
        snap.unsupported = `Hermes ${snap.status?.version ?? "?"} not supported yet`;
      }
      const d = await api.diagnostics(machine);
      snap.problems = d.code === 200 ? d.problems : null;

      if (meta) {
        const [w, o] = await Promise.all([api.workflow(machine), api.orchestration(machine)]);
        if (w.code === 200 && checkWorkflow(w.json)) snap.workflow = normalizeWorkflow(w.json);
        // default_assignee: what the dispatcher gives unassigned ready tasks (kanban.default_assignee, often unset).
        // resolved_default_assignee: the instance's default agent as Hermes' own board shows and assigns it (the
        // configured one, else the active profile, which may itself be called "default").
        if (o.code === 200 && isObj(o.json)) {
          const str = (v) => (typeof v === "string" ? v.trim() : "");
          snap.defaultAssignee = str(o.json.default_assignee);
          snap.resolvedAssignee = str(o.json.resolved_default_assignee) || snap.defaultAssignee;
        }
        st.metaDue = false;
        st.lastMeta = t;
      }
      return done(changes);
    } catch (e) {
      return failed(message(e));
    }
  }

  return {
    async tick(machines) {
      const list = [...new Set(machines)];
      for (const m of [...states.keys()]) if (!list.includes(m)) states.delete(m);
      const t = now();
      const first = seeds;
      seeds = null;
      const results = await Promise.all(list.map(async (m) => {
        let st = states.get(m);
        if (!st) states.set(m, st = { snap: first && Object.hasOwn(first, m) ? seedOf(first[m], m, t) : null, stamp: null, rawStatus: null, lastPoll: 0, lastFull: 0, lastMeta: 0, metaDue: true, fullDue: false, busy: false });
        if (st.busy || !due(st, t)) return [];
        st.busy = true;
        st.lastPoll = t;
        try {
          const r = await poll(m, st);
          if (states.get(m) !== st) return []; // it left the list while being polled
          st.snap = r.snap;
          return r.changes;
        } finally {
          st.busy = false;
        }
      }));
      const snapshots = {};
      for (const m of list) {
        const snap = states.get(m)?.snap;
        if (snap) snapshots[m] = snap;
      }
      return { snapshots, changes: results.flat() };
    },
    refresh(machine) {
      const st = states.get(machine);
      if (st) st.fullDue = true;
    },
    // The access mode of a machine from its last /api/status, for createApi: "gated", "open" or null. It outlives the
    // machine leaving the list, so an open overlay can still act on its task.
    mode: (machine) => modes.get(machine) ?? null,
  };
}
