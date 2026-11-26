// What the board and the task overlay show: filter, group and sort tasks, the one-line hint of a row, and a task's
// activity, runs and priorities. Pure functions.
import { duration } from "./time.js";

// Statuses where Hermes waits for a person.
export const NEEDS_YOU = ["blocked", "review"];

export const OPEN_DONE = { open: (t) => t.status !== "done", done: (t) => t.status === "done", all: () => true };

const PRIO = { all: () => true, p1: (p) => p === 1, p2: (p) => p === 2, "p3+": (p) => p >= 3 };

export function filterTasks(tasks, { state, query, agent, prio }) {
  const q = query.trim().toLowerCase();
  return tasks.filter((t) => (OPEN_DONE[state] ?? OPEN_DONE.all)(t)
    && (PRIO[prio] ?? PRIO.all)(t.priority)
    && (agent === "all" || (agent === "none" ? !t.assignee : t.assignee === agent))
    && (q === "" || [t.id, t.title, t.assignee ?? ""].some((s) => s.toLowerCase().includes(q))));
}

// Hermes dispatches higher priority first, the oldest first among equals.
const byUrgency = (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.createdAt ?? Infinity) - (b.createdAt ?? Infinity);

// Groups without tasks are left out. `labels` (normalizeWorkflow().labels) is optional: the key shows without one.
export function groupTasks(tasks, by, order, labels = {}) {
  const sorted = [...tasks].sort(byUrgency);
  const make = (key, label, list) => ({ key, label, count: list.length, needsYou: by === "status" && NEEDS_YOU.includes(key), tasks: list });
  if (by === "none") return sorted.length ? [make("all", "All", sorted)] : [];
  if (by === "agent") {
    const names = [...new Set(sorted.map((t) => t.assignee).filter(Boolean))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const groups = names.map((n) => make(n, n, sorted.filter((t) => t.assignee === n)));
    const none = sorted.filter((t) => !t.assignee);
    return none.length ? [...groups, make("none", "no agent", none)] : groups;
  }
  const seen = [...new Set(sorted.map((t) => t.status))];
  const keys = [...order.filter((k) => seen.includes(k)), ...seen.filter((k) => !order.includes(k))];
  return keys.map((k) => make(k, labels[k] ?? k, sorted.filter((t) => t.status === k)));
}

export function hintOf(task, defaultAssignee) {
  if (task.status === "blocked") return { text: task.summary || task.failure || "blocked", tone: "red" };
  if (task.status !== "ready") return null;
  if (task.assignee) return { text: "starts with next dispatch", tone: "blue" };
  if (!defaultAssignee) return { text: "no agent, will not start", tone: "orange" };
  return { text: `goes to ${defaultAssignee}`, tone: "blue" };
}

export const prioLabel = (n) => (n > 0 ? `P${n}` : null);

// ---- the task overlay ----

// Hermes' event kinds (kanban_db.py): crashed, timed_out, gave_up, reclaimed, blocked, claimed, spawned, status,
// unblocked, completed, assigned, reprioritized, promoted, heartbeat, commented. Others show as their kind.
const RED_EVENTS = new Set(["blocked", "crashed", "timed_out", "gave_up", "reclaimed"]);
const YELLOW_EVENTS = new Set(["claimed", "spawned"]);
const sentence = (kind) => { const s = kind.replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };
// The reason an event carries, if it carries one.
const reasonOf = (p) => [p?.reason, p?.summary, p?.error].find((x) => typeof x === "string" && x.trim()) ?? null;

// The activity of a task (normalizeDetail): its events and comments in one list, newest first. Heartbeats stay out;
// a "commented" event only when the comments themselves are not listed (else it would show twice).
export function activityOf(detail) {
  const comments = detail.comments ?? [];
  const events = (detail.events ?? []).filter((e) => e.kind !== "heartbeat" && !(e.kind === "commented" && comments.length)).map((e) => {
    if (e.kind === "status" && typeof e.payload?.status === "string") return { at: e.at, text: `Status: ${e.payload.status}`, tone: null };
    const why = reasonOf(e.payload);
    return { at: e.at, text: why ? `${sentence(e.kind)}: ${why}` : sentence(e.kind), tone: RED_EVENTS.has(e.kind) ? "red" : YELLOW_EVENTS.has(e.kind) ? "yellow" : null };
  });
  const said = comments.map((c) => ({ at: c.at, text: `${c.author || "someone"} commented: ${c.body}`, tone: "blue" }));
  return [...events, ...said].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

// Why a task is blocked: the reason of its newest "blocked" event, else latest_summary, else last_failure_error
// (a task parked by the breaker has no event). Null when none says.
export function blockReason(detail, task) {
  const last = (detail?.events ?? []).filter((e) => e.kind === "blocked").sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0];
  const reason = typeof last?.payload?.reason === "string" && last.payload.reason.trim() ? last.payload.reason : null;
  return reason || task?.summary || task?.failure || null;
}

// One run of the overlay's list: "#7 blocked · 4m 12s"; a run still going counts to now.
export function runLine(run, nowSeconds) {
  const took = duration(run.startedAt, run.endedAt ?? (run.startedAt != null ? nowSeconds : null));
  return [`#${run.id} ${run.outcome || run.status}`, took].filter(Boolean).join(" · ");
}

// The priorities to pick from: none and P1-P4 as Hermes' raw values (higher starts first), and a present value above 4.
export function prioChoices(current) {
  const list = [[0, "none"], [1, "P1"], [2, "P2"], [3, "P3"], [4, "P4"]];
  return current > 4 ? [...list, [current, `P${current}`]] : list;
}
