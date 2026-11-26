// Manual moves and the message after one. The moves come from GET /workflow, never from a table in this mod.

// The states a person may request from `status`, without `status` itself.
export function allowedMoves(workflow, status) {
  return (workflow.manual[status] ?? []).filter((s) => s !== status);
}

// What to tell after a PATCH, from the task Hermes answered with (not from what was sent): Hermes may redirect a move.
// `labels` is normalizeWorkflow().labels; without a label the raw status shows.
export function outcomeText(sent, task, labels = {}) {
  const label = labels[task.status] ?? task.status;
  if (task.status === "ready" && task.assignee) return `${label}. starts with next dispatch`;
  if (task.status !== sent) return `Hermes moved it to ${label}`;
  return label;
}

// Why a request failed, in Hermes' words when it gave some: its `detail` (a text, or FastAPI's list of problems),
// else the transport error, else the HTTP code.
export function failureOf(r) {
  const d = r?.json?.detail;
  if (typeof d === "string" && d) return d;
  if (Array.isArray(d) && d.length) return d.map((x) => (typeof x === "string" ? x : x?.msg ?? JSON.stringify(x))).join("; ");
  return r?.error || `HTTP ${r?.code ?? 0}`;
}

const ok = (r) => r?.code >= 200 && r?.code < 300;
const message = (e) => String(e?.message ?? e);

// "Comment & unblock": two requests without atomicity, both through act() and so to the task's own machine. The
// comment goes first; a refused PATCH (409: blocked by parents not done) leaves it standing, and `error` says why.
export async function commentAndUnblock(api, task, text) {
  try {
    const c = await api.act(task, "comment", { body: text });
    if (!ok(c)) return { commented: false, moved: null, error: failureOf(c) };
  } catch (e) {
    return { commented: false, moved: null, error: message(e) };
  }
  try {
    const p = await api.act(task, "patch", { status: "ready" });
    if (!ok(p)) return { commented: true, moved: null, error: failureOf(p) };
    if (!p.task) return { commented: true, moved: null, error: "the task is gone" };
    return { commented: true, moved: p.task, error: null };
  } catch (e) {
    return { commented: true, moved: null, error: message(e) };
  }
}

// The task after a PATCH: Hermes' answer, but the PATCH task dict has no comment_count, body or latest_summary, so
// a known count, body and summary stay.
export function mergePatched(known, patched) {
  if (!patched) return null;
  return { ...patched, comments: known?.comments ?? patched.comments, body: known?.body ?? null, summary: patched.summary ?? known?.summary ?? null };
}
