import { test } from "node:test";
import assert from "node:assert/strict";
import { STAMP_SCRIPT, parseStamp, diffBoards, toastOf, dotOf } from "../mods/hermes-kanban/lib/changes.js";

const t = (id, o = {}) => ({
  machine: "devbox", id, title: `title ${id}`, status: "todo", assignee: "writer", failure: null, failures: 0, warnings: [], ...o,
});
const board = (machine, tasks) => ({ machine, now: 1, assignees: [], tasks: tasks.map((x) => ({ ...x, machine })) });

test("STAMP_SCRIPT lists db and wal with name, mtime and size", () => {
  assert.match(STAMP_SCRIPT, /kanban\.db -o -name kanban\.db-wal/);
  assert.match(STAMP_SCRIPT, /-printf '%f %T@ %s\\n'/);
});

test("parseStamp: db plus wal, order-independent", () => {
  const a = parseStamp("kanban.db 1700000000.123456789 4096\nkanban.db-wal 1700000001.5 32768\n");
  const b = parseStamp("kanban.db-wal 1700000001.5 32768\nkanban.db 1700000000.123456789 4096\n");
  assert.equal(typeof a, "string");
  assert.equal(a, b);
  assert.notEqual(a, parseStamp("kanban.db-wal 1700000001.5 32769\nkanban.db 1700000000.123456789 4096\n"));
});

test("parseStamp: missing wal is fine, missing db means no Hermes", () => {
  assert.notEqual(parseStamp("kanban.db 1700000000.1 4096\n"), null);
  assert.equal(parseStamp("kanban.db-wal 1700000000.1 4096\n"), null);
  assert.equal(parseStamp(""), null);
  assert.equal(parseStamp("garbage\n"), null);
});

test("diffBoards: first poll sets the baseline only", () => {
  assert.deepEqual(diffBoards(null, board("devbox", [t("t_a1b2", { status: "blocked" })])), []);
});

test("diffBoards: blocked, review, done and failures", () => {
  const prev = board("devbox", [t("t_1", { status: "running" }), t("t_2", { status: "running" }), t("t_3", { status: "running" }), t("t_4", { status: "running" })]);
  const next = board("devbox", [
    t("t_1", { status: "blocked" }),
    t("t_2", { status: "review" }),
    t("t_3", { status: "done" }),
    t("t_4", { status: "running", failures: 1, failure: "crashed: oom" }),
  ]);
  const c = diffBoards(prev, next);
  assert.deepEqual(c.map((x) => [x.id, x.kind]), [["t_1", "needs_you"], ["t_2", "needs_you"], ["t_3", "done"], ["t_4", "failed"]]);
  assert.equal(c[3].failure, "crashed: oom");
  assert.deepEqual([c[0].machine, c[0].agent, c[0].title], ["devbox", "writer", "title t_1"]);
});

test("diffBoards: a new block_unblock_cycling warning needs you, an old one does not", () => {
  const was = board("devbox", [t("t_1", { status: "todo" }), t("t_2", { warnings: ["block_unblock_cycling"] })]);
  const now = board("devbox", [t("t_1", { status: "todo", warnings: ["block_unblock_cycling"] }), t("t_2", { warnings: ["block_unblock_cycling"] })]);
  assert.deepEqual(diffBoards(was, now).map((x) => [x.id, x.kind]), [["t_1", "needs_you"]]);
});

test("diffBoards keeps machines apart", () => {
  const prev = { devbox: board("devbox", [t("t_a1b2", { status: "todo" })]), labbox: board("labbox", [t("t_a1b2", { status: "todo" })]) };
  const merge = (a, b) => ({ ...a, tasks: [...a.tasks, ...b.tasks] });
  const next = { devbox: board("devbox", [t("t_a1b2", { status: "blocked" })]), labbox: board("labbox", [t("t_a1b2", { status: "todo" })]) };
  const c = diffBoards(merge(prev.devbox, prev.labbox), merge(next.devbox, next.labbox));
  assert.deepEqual(c.map((x) => [x.machine, x.id]), [["devbox", "t_a1b2"]]);
  assert.deepEqual(diffBoards(prev.labbox, next.devbox), []);
});

test("diffBoards ignores a task that was already blocked", () => {
  const b = board("devbox", [t("t_1", { status: "blocked", failures: 2 })]);
  assert.deepEqual(diffBoards(b, b), []);
});

test("toastOf names the instance", () => {
  assert.equal(toastOf({ machine: "devbox", agent: "writer", kind: "needs_you", title: "Draft notes" }).title, "devbox: writer needs input");
});

test("toastOf: levels, bodies and a missing agent", () => {
  assert.deepEqual(toastOf({ machine: "devbox", agent: "writer", kind: "done", title: "Draft notes" }), { title: "devbox: writer finished", body: "Draft notes", level: "success" });
  assert.deepEqual(toastOf({ machine: "labbox", agent: null, kind: "needs_you", title: "X" }), { title: "labbox: a task needs input", body: "X", level: "warning" });
  assert.deepEqual(toastOf({ machine: "devbox", agent: "writer", kind: "failed", title: "Draft notes", failure: "crashed: oom" }),
    { title: "devbox: writer failed", body: "Draft notes: crashed: oom", level: "error" });
  assert.equal(toastOf({ machine: "devbox", agent: "writer", kind: "failed", title: "Draft notes", failure: null }).body, "Draft notes");
});

test("dotOf: red over green over yellow, count of blocked and review", () => {
  const boards = {
    devbox: board("devbox", [t("a", { status: "blocked" }), t("b", { status: "running" })]),
    labbox: board("labbox", [t("a", { status: "review" }), t("c", { status: "done" })]),
  };
  assert.deepEqual(dotOf(boards, { devbox: 3 }), { tone: "red", count: 2 });
  const calm = { devbox: board("devbox", [t("b", { status: "running" })]) };
  assert.deepEqual(dotOf(calm, { devbox: 1 }), { tone: "green", count: 0 });
  assert.deepEqual(dotOf(calm, { devbox: 0 }), { tone: "yellow", count: 0 });
  assert.deepEqual(dotOf({ devbox: board("devbox", [t("d", { status: "done" })]) }, {}), { tone: null, count: 0 });
});

test("dotOf: nothing -> no dot", () => assert.deepEqual(dotOf({}, {}), { tone: null, count: 0 }));
