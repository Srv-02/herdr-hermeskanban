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
