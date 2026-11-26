import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  checkBoard, checkWorkflow, normalizeBoard, normalizeDetail, normalizeStatus, normalizeTask, normalizeWorkflow, problemCount, taskKey,
} from "../mods/hermes-kanban/lib/board.js";

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures", `${name}.json`), "utf8"));
const board = fixture("board");
const clone = (v) => JSON.parse(JSON.stringify(v));

test("checkBoard accepts the fixture and rejects other shapes", () => {
  assert.ok(checkBoard(board));
  assert.ok(!checkBoard({ tasks: [] }));
  assert.ok(!checkBoard(null));
  assert.ok(!checkBoard({ ...board, columns: [{ name: "todo", tasks: [{ id: "t_x", title: "x" }] }] }));
});

test("checkBoard rejects missing parts one by one", () => {
  const t = board.columns.find((c) => c.tasks.length).tasks[0];
  const withTask = (o) => ({ ...board, columns: [{ name: "todo", tasks: [{ ...t, ...o }] }] });
  assert.ok(checkBoard(withTask({})));
  assert.ok(!checkBoard(withTask({ priority: "2" })));
  assert.ok(!checkBoard(withTask({ id: 7 })));
  const { assignee, ...noAssignee } = t;
  assert.ok(!checkBoard({ ...board, columns: [{ name: "todo", tasks: [noAssignee] }] }));
  assert.ok(!checkBoard({ ...board, assignees: undefined }));
  assert.ok(!checkBoard({ ...board, now: "now" }));
  assert.ok(!checkBoard({ ...board, columns: [{ name: 1, tasks: [] }] }));
  assert.ok(!checkBoard({ ...board, columns: [{ name: "todo" }] }));
  assert.ok(!checkBoard([]));
});

test("normalizeBoard stamps the machine on every task", () => {
  assert.ok(normalizeBoard(board, "devbox").tasks.every((t) => t.machine === "devbox"));
});

test("normalizeBoard maps the Hermes fields", () => {
  const b = normalizeBoard(board, "devbox");
  assert.equal(b.machine, "devbox");
  assert.equal(b.now, board.now);
  assert.deepEqual(b.assignees, ["coder", "research", "writer"]);
  assert.deepEqual(b.tasks.map((t) => t.id).sort(), ["t_a1b2", "t_c3d4", "t_e5f6", "t_g7h8", "t_i9j0", "t_k1l2"]);
  const a = b.tasks.find((t) => t.id === "t_a1b2");
  assert.deepEqual(a, {
    machine: "devbox", id: "t_a1b2", title: "Draft release notes for example.com", status: "blocked", assignee: "writer",
    priority: 2, createdAt: board.now - 7200, completedAt: null, comments: 1, summary: "needs input: which version range?",
    failure: null, failures: 0, warnings: ["stuck_in_blocked"],
  });
  const k = b.tasks.find((t) => t.id === "t_k1l2");
  assert.equal(k.summary, null);
  assert.equal(k.failure, "spawn failed: workspace not writable");
  assert.equal(k.failures, 3);
  assert.equal(b.tasks.find((t) => t.id === "t_c3d4").assignee, null);
  assert.equal(b.tasks.find((t) => t.id === "t_i9j0").completedAt, board.now - 600);
});

test("taskKey differs per machine", () => {
  assert.notEqual(taskKey({ machine: "devbox", id: "t_a1b2" }), taskKey({ machine: "labbox", id: "t_a1b2" }));
  assert.equal(taskKey({ machine: "devbox", id: "t_a1b2" }), JSON.stringify(["devbox", "t_a1b2"]));
});

test("normalizeBoard tolerates null fields", () => {
  const b = clone(board);
  const t = b.columns.find((c) => c.name === "blocked").tasks.find((x) => x.id === "t_a1b2");
  t.created_at = null;
  t.assignee = null;
  delete t.warnings;
  delete t.comment_count;
  const n = normalizeBoard(b, "devbox").tasks.find((x) => x.id === "t_a1b2");
  assert.equal(n.createdAt, null);
  assert.equal(n.assignee, null);
  assert.deepEqual(n.warnings, []);
  assert.equal(n.comments, 0);
  t.warnings = null;
  assert.deepEqual(normalizeBoard(b, "devbox").tasks.find((x) => x.id === "t_a1b2").warnings, []);
});

test("normalizeTask takes the machine from its parameter", () => {
  const raw = board.columns.find((c) => c.name === "ready").tasks[0];
  assert.equal(normalizeTask(raw, "labbox").machine, "labbox");
  assert.equal(normalizeTask(null, "labbox"), null);
  assert.equal(normalizeTask({ title: "no id" }, "labbox"), null);
});

test("normalizeWorkflow keeps Hermes order and manual moves", () => {
  const wf = fixture("workflow");
  assert.ok(checkWorkflow(wf));
  assert.ok(!checkWorkflow(null));
  assert.ok(!checkWorkflow({ ...wf, columns: [{ key: "todo" }] }));
  assert.ok(!checkWorkflow({ ...wf, manual: { todo: "ready" } }));
  const w = normalizeWorkflow(wf);
  assert.equal(w.order[0], "triage");
  assert.deepEqual(w.order, ["triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done"]);
  assert.equal(w.labels.ready, "Ready");
  assert.ok(w.manual.review.includes("todo"));
  assert.deepEqual(w.manual.archived, ["ready", "todo", "triage"]);
});

test("normalizeDetail maps task, comments, events and runs", () => {
  const d = normalizeDetail(fixture("task"), "labbox");
  assert.equal(d.task.machine, "labbox");
  assert.equal(d.task.id, "t_a1b2");
  assert.equal(d.task.body, "Collect the changes since the last tag and write short notes.");
  assert.equal(d.task.comments, 1);
  assert.deepEqual(d.comments, [{ author: "writer", body: "Which version range should the notes cover?", at: 1794997000 }]);
  assert.deepEqual(d.events[2], { kind: "blocked", at: 1794997000, payload: { reason: "needs input: which version range?" } });
  assert.deepEqual(d.runs, [{ id: 7, status: "blocked", outcome: "blocked", startedAt: 1794994600, endedAt: 1794997000 }]);
  const bare = normalizeDetail({ task: { ...fixture("task").task, body: null } }, "labbox");
  assert.equal(bare.task.body, null);
  assert.deepEqual([bare.comments, bare.events, bare.runs], [[], [], []]);
});

test("normalizeStatus", () => {
  assert.deepEqual(normalizeStatus(fixture("status")), { version: "0.23.4", running: true, state: "running", gated: true });
  assert.deepEqual(normalizeStatus({ auth_required: false }), { version: null, running: false, state: null, gated: false });
  assert.deepEqual(normalizeStatus(null), { version: null, running: false, state: null, gated: false });
});

test("problemCount counts tasks with a warning or worse, not entries", () => {
  const diag = fixture("diagnostics");
  assert.equal(diag.count, 3);
  assert.equal(problemCount(diag), 2);
  assert.equal(problemCount({ diagnostics: [], count: 0 }), 0);
  const info = { diagnostics: [{ task_id: "t_x", diagnostics: [{ kind: "k", severity: "info" }] }] };
  assert.equal(problemCount(info), 0);
  assert.equal(problemCount({ diagnostics: [...diag.diagnostics, diag.diagnostics[0]] }), 2);
  assert.equal(problemCount(null), null);
  assert.equal(problemCount({ count: 3 }), null);
});
