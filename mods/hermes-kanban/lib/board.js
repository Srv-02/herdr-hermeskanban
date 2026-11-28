// Shape checks and normalization of the Hermes Kanban API answers (plugins/kanban/dashboard/plugin_api.py).
// Every task carries the machine it came from: task IDs are unique per board only, so two instances can both have
// a t_a1b2. Pure functions, no API calls.

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" ? v : null);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// GET /board: { columns: [{ name, tasks: [...] }], assignees: [...], now }. A different shape means a Hermes version
// this mod does not know ("Hermes <version> not supported yet").
export function checkBoard(json) {
  if (!isObj(json) || !Array.isArray(json.columns) || !Array.isArray(json.assignees) || num(json.now) === null) return false;
  return json.columns.every((c) => isObj(c) && typeof c.name === "string" && Array.isArray(c.tasks) && c.tasks.every((t) =>
    isObj(t) && typeof t.id === "string" && typeof t.title === "string" && typeof t.status === "string"
    && num(t.priority) !== null && "assignee" in t));
}

// One task dict of /board, /tasks/{id}, PATCH or POST, stamped with the machine the request went to.
// Null when there is no task (PATCH and POST answer { task: null } when the task vanished).
export function normalizeTask(t, machine) {
  if (!isObj(t) || typeof t.id !== "string") return null;
  return {
    machine,
    id: t.id,
    title: str(t.title) ?? "",
    status: str(t.status) ?? "",
    assignee: str(t.assignee) || null,
    priority: num(t.priority) ?? 0,
    createdAt: num(t.created_at),
    completedAt: num(t.completed_at),
    comments: num(t.comment_count) ?? 0,
    summary: str(t.latest_summary),
    failure: str(t.last_failure_error),
    failures: num(t.consecutive_failures) ?? 0,
    warnings: isObj(t.warnings) && isObj(t.warnings.kinds) ? Object.keys(t.warnings.kinds) : [],
  };
}

// Expects checkBoard(json) to have passed.
export function normalizeBoard(json, machine) {
  return {
    machine,
    now: json.now,
    assignees: json.assignees.filter((a) => typeof a === "string"),
    tasks: json.columns.flatMap((c) => c.tasks.map((t) => normalizeTask(t, machine))).filter(Boolean),
  };
}

// The cache, diff and "seen" key of a task: machine and ID together.
export const taskKey = (task) => JSON.stringify([task.machine, task.id]);

// GET /workflow (kanban_workflow.Workflow.to_dict): columns in board order and the manual moves a person may request.
export function checkWorkflow(json) {
  return isObj(json) && Array.isArray(json.columns)
    && json.columns.every((c) => isObj(c) && typeof c.key === "string" && typeof c.label === "string")
    && isObj(json.manual)
    && Object.values(json.manual).every((d) => Array.isArray(d) && d.every((s) => typeof s === "string"));
}

export function normalizeWorkflow(json) {
  return {
    order: json.columns.map((c) => c.key),
    labels: Object.fromEntries(json.columns.map((c) => [c.key, c.label])),
    manual: Object.fromEntries(Object.entries(json.manual).map(([src, dsts]) => [src, [...dsts]])),
  };
}

// GET /tasks/{id}: the task with its full body, comments, events and runs.
export function normalizeDetail(json, machine) {
  const list = (v) => (Array.isArray(v) ? v.filter(isObj) : []);
  const comments = list(json?.comments).map((c) => ({ id: num(c.id), author: str(c.author) ?? "", body: str(c.body) ?? "", at: num(c.created_at) }));
  const task = normalizeTask(json?.task, machine);
  return {
    task: task && { ...task, comments: comments.length, body: str(json.task.body) },
    comments,
    events: list(json?.events).map((e) => ({ kind: str(e.kind) ?? "", at: num(e.created_at), payload: e.payload ?? null })),
    runs: list(json?.runs).map((r) => ({
      id: r.id, status: str(r.status) ?? "", outcome: str(r.outcome), startedAt: num(r.started_at), endedAt: num(r.ended_at),
    })),
  };
}

// GET /api/status (public): version, gateway state and whether the sign-in gate is on.
export function normalizeStatus(json) {
  const s = isObj(json) ? json : {};
  return { version: str(s.version), running: s.gateway_running === true, state: str(s.gateway_state), gated: s.auth_required === true };
}

// GET /diagnostics?severity=warning: the number of tasks (not entries) with an active diagnostic of severity warning
// or worse. Null when the answer has another shape; the status bar then leaves the number out.
const SEVERE = new Set(["warning", "error", "critical"]);
export function problemCount(json) {
  if (!isObj(json) || !Array.isArray(json.diagnostics)) return null;
  const ids = json.diagnostics
    .filter((d) => isObj(d) && typeof d.task_id === "string" && Array.isArray(d.diagnostics) && d.diagnostics.some((x) => SEVERE.has(x?.severity)))
    .map((d) => d.task_id);
  return new Set(ids).size;
}
