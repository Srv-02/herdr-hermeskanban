// What the board shows: filter, group and sort tasks, and the one-line hint of a row. Pure functions.

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
const byUrgency = (a, b) => b.priority - a.priority || (a.createdAt ?? Infinity) - (b.createdAt ?? Infinity);

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
  if (defaultAssignee === "") return { text: "no agent, will not start", tone: "orange" };
  return { text: `goes to ${defaultAssignee}`, tone: "blue" };
}

export const prioLabel = (n) => (n > 0 ? `P${n}` : null);
