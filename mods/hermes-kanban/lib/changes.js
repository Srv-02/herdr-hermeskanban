// Change detection: the stamp that tells when a board may have changed, the diff of two boards, the title bar dot and
// the toast texts. Pure functions.
import { taskKey } from "./board.js";
import { NEEDS_YOU } from "./view.js";

// Modification time (nanoseconds) and size of the Hermes database and its WAL. Cheap to read, and the content is never
// opened. Needs GNU find (-printf); a missing WAL is normal.
export const STAMP_SCRIPT = `find "$HOME/.hermes" -maxdepth 1 \\( -name kanban.db -o -name kanban.db-wal \\) -printf '%f %T@ %s\\n'`;

// Sorted, normalized lines as one string, so two stamps compare with ===. Null when kanban.db is missing: no Hermes here.
export function parseStamp(stdout) {
  const lines = String(stdout).split("\n").map((l) => l.trim().split(/\s+/)).filter((p) => p.length === 3 && ["kanban.db", "kanban.db-wal"].includes(p[0]));
  if (!lines.some((p) => p[0] === "kanban.db")) return null;
  return lines.map((p) => p.join(" ")).sort().join("\n");
}

const CYCLING = "block_unblock_cycling";

// What happened between two snapshots. No previous snapshot sets the baseline: nothing is reported. Tasks are matched
// by machine and ID together. A task missing from the previous snapshot counts as a change from nothing, so one created
// already blocked, or created and finished within one poll, still reports. One change per task: failed (it carries the
// reason) before needs_you before done.
export function diffBoards(prev, next) {
  if (!prev) return [];
  const before = new Map(prev.tasks.map((t) => [taskKey(t), t]));
  const out = [];
  for (const t of next.tasks) {
    const old = before.get(taskKey(t)) ?? { status: null, failures: 0, warnings: [] };
    const change = (kind, text) => out.push({ machine: t.machine, id: t.id, title: t.title, agent: t.assignee, kind, text, failure: t.failure });
    if (t.failures > old.failures) change("failed", "failed");
    else if (t.status !== old.status && NEEDS_YOU.includes(t.status)) change("needs_you", t.status);
    else if (t.warnings.includes(CYCLING) && !old.warnings.includes(CYCLING)) change("needs_you", "keeps cycling between blocked and unblocked");
    else if (t.status !== old.status && t.status === "done") change("done", "done");
  }
  return out;
}

const TOAST = {
  needs_you: { verb: "needs input", level: "warning" },
  done: { verb: "finished", level: "success" },
  failed: { verb: "failed", level: "error" },
};

// In single agent mode the instance is the subject and no agent is named: "devbox needs you", "devbox: task finished".
const SINGLE = { needs_you: (m) => `${m} needs you`, done: (m) => `${m}: task finished`, failed: (m) => `${m}: task failed` };
export function toastOf(change, { single = false } = {}) {
  const { verb, level } = TOAST[change.kind];
  const body = change.kind === "failed" && change.failure ? `${change.title}: ${change.failure}` : change.title;
  const title = single ? SINGLE[change.kind](change.machine) : `${change.machine}: ${change.agent || "a task"} ${verb}`;
  return { title, body, level };
}

// The dot over all visible instances, from what is new and not seen yet (countUnseen): red for a needs-you event
// (blocked, review, a block loop, a failure), else green for a finished task, else none. No count, nothing for running
// agents, nothing for a task that just stays blocked.
export function dotOf(unseen) {
  const all = Object.values(unseen ?? {});
  if (all.some((u) => u?.needs > 0)) return { tone: "red" };
  if (all.some((u) => u?.done > 0)) return { tone: "green" };
  return { tone: null };
}

// What one watcher pass tells the person: the toasts their switches allow (failed follows "needs you") and at most one
// sound, herdr's "blocked" before its "done". Sounds have their own switches, independent of the toasts.
export function alertsOf(changes, settings) {
  const urgent = (c) => c.kind !== "done";
  const toasts = changes.filter((c) => settings?.[urgent(c) ? "toast.needs_you" : "toast.done"] === true);
  let sound = null;
  if (settings?.["sound.needs_you"] === true && changes.some(urgent)) sound = "blocked";
  else if (settings?.["sound.done"] === true && changes.some((c) => !urgent(c))) sound = "done";
  return { toasts, sound };
}

// What happened per machine since its panel was last opened: needs-you events (needs_you and failed) and finished
// tasks. Only visible machines keep counts, so a machine whose last space closed loses its dot too. The panel's mark
// "seen" zeroes a machine (watcher.js).
const count = (n) => (Number.isInteger(n) && n >= 0 ? n : null);
export function countUnseen(unseen, changes, machines) {
  const out = {};
  for (const m of machines) {
    const u = unseen?.[m], needs = count(u?.needs), done = count(u?.done);
    if (needs !== null && done !== null) out[m] = { needs, done };
  }
  for (const c of changes) {
    if (!machines.includes(c.machine)) continue;
    const u = out[c.machine] ??= { needs: 0, done: 0 };
    if (c.kind === "done") u.done += 1; else u.needs += 1;
  }
  return out;
}

// One pass of the counts: a machine whose mark "seen" (Record<machine, at>, one per machine, written by the panel)
// is new since the last pass starts from zero; the instances a panel shows now (`shown`, shownMachines) collect
// nothing, so their dot never flashes. Returns the counts and the marks handled.
export function nextUnseen({ unseen, seen, seenAt, shown, changes, machines }) {
  let out = { ...(unseen ?? {}) };
  const marks = seen && typeof seen === "object" && !Array.isArray(seen) ? seen : {};
  for (const [m, at] of Object.entries(marks)) if (at !== seenAt?.[m]) out[m] = { needs: 0, done: 0 };
  out = countUnseen(out, changes.filter((c) => !(shown ?? []).includes(c.machine)), machines);
  return { unseen: out, seenAt: { ...marks } };
}

// hermes-kanban.shown: Record<copy, { machine, at }>, one entry per panel copy (a panel can show in several windows
// and layouts). A copy writes only when its machine changes, and renews its time at most every SHOWN_RENEW_MS; an
// entry older than SHOWN_TTL_MS belongs to a copy that is gone. shownNext gives the record to write, or null for none.
const SHOWN_RENEW_MS = 30000, SHOWN_TTL_MS = 120000;
const fresh = (e, now) => e && typeof e === "object" && typeof e.machine === "string" && typeof e.at === "number" && now - e.at <= SHOWN_TTL_MS;
export function shownNext(record, copy, machine, now) {
  const mine = record?.[copy];
  if (machine == null) {
    if (!mine) return null;
    const { [copy]: _gone, ...rest } = record;
    return rest;
  }
  if (mine?.machine === machine && now - mine.at < SHOWN_RENEW_MS) return null;
  const others = Object.fromEntries(Object.entries(record ?? {}).filter(([k, e]) => k !== copy && fresh(e, now)));
  return { ...others, [copy]: { machine, at: now } };
}
// The machines a panel copy shows now: those of the fresh entries.
export const shownMachines = (record, now) => [...new Set(Object.values(record ?? {}).filter((e) => fresh(e, now)).map((e) => e.machine))];

// An unseen needs-you event on that machine: its red strip in the panel of another instance.
export const needsYou = (unseen, machine) => unseen?.[machine]?.needs > 0;

// The Dock badge: the number of unseen needs-you events, else none.
export function badgeOf(unseen) {
  const n = Object.values(unseen ?? {}).reduce((sum, u) => sum + (u?.needs > 0 ? u.needs : 0), 0);
  return n > 0 ? String(n) : null;
}
