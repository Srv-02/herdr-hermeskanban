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

export function toastOf(change) {
  const { verb, level } = TOAST[change.kind];
  const body = change.kind === "failed" && change.failure ? `${change.title}: ${change.failure}` : change.title;
  return { title: `${change.machine}: ${change.agent || "a task"} ${verb}`, body, level };
}

// Red (count of blocked and review tasks over all instances) before green (something unseen finished) before yellow
// (something runs).
export function dotOf(boards, unseen) {
  const tasks = Object.values(boards).flatMap((b) => b.tasks);
  const count = tasks.filter((t) => NEEDS_YOU.includes(t.status)).length;
  if (count > 0) return { tone: "red", count };
  if (Object.values(unseen).some((n) => n > 0)) return { tone: "green", count: 0 };
  if (tasks.some((t) => t.status === "running")) return { tone: "yellow", count: 0 };
  return { tone: null, count: 0 };
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

// Finished tasks not looked at yet, per machine: each done change adds one. Only visible machines keep a count, so a
// machine whose last space closed loses its green too.
export function countUnseen(unseen, changes, machines) {
  const out = {};
  for (const m of machines) {
    const n = unseen?.[m];
    if (Number.isInteger(n) && n >= 0) out[m] = n;
  }
  for (const c of changes) if (c.kind === "done" && machines.includes(c.machine)) out[c.machine] = (out[c.machine] ?? 0) + 1;
  return out;
}

// The boards of the poller's snapshots (Record<machine, Snapshot>), for dotOf: a snapshot without a board drops out.
export const boardsOf = (snapshots) => Object.fromEntries(Object.entries(snapshots ?? {}).filter(([, s]) => s?.board).map(([m, s]) => [m, s.board]));

// The Dock badge: the count of the red dot, else none.
export const badgeOf = (dot) => dot.count > 0 ? String(dot.count) : null;
