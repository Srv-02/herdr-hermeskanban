import { test } from "node:test";
import assert from "node:assert/strict";
import { STAMP_SCRIPT, parseStamp, diffBoards, toastOf, dotOf, alertsOf, countUnseen, needsYou, badgeOf } from "../mods/hermes-kanban/lib/changes.js";

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

// The dot tells only what is new and not seen: no count, no yellow, a task that stays blocked tells nothing.
test("dotOf: red for unseen needs-you events over green for unseen done, nothing else", () => {
  assert.deepEqual(dotOf({ devbox: { needs: 1, done: 2 }, labbox: { needs: 0, done: 0 } }), { tone: "red" });
  assert.deepEqual(dotOf({ devbox: { needs: 0, done: 1 } }), { tone: "green" });
  assert.deepEqual(dotOf({ devbox: { needs: 0, done: 0 } }), { tone: null });
  assert.deepEqual(dotOf({}), { tone: null });
  assert.deepEqual(dotOf(null), { tone: null });
});

test("diffBoards: a task new since the baseline reports its current state", () => {
  const prev = board("devbox", [t("t_old", { status: "todo" })]);
  const next = board("devbox", [t("t_old", { status: "todo" }), t("t_b", { status: "blocked" }), t("t_d", { status: "done" }), t("t_t", { status: "todo" })]);
  assert.deepEqual(diffBoards(prev, next).map((x) => [x.id, x.kind]), [["t_b", "needs_you"], ["t_d", "done"]]);
  assert.deepEqual(diffBoards(null, next), []);
});

test("diffBoards: at most one change per task, failed wins", () => {
  const prev = board("devbox", [t("t_1", { status: "running" })]);
  const next = board("devbox", [t("t_1", { status: "blocked", failures: 1, failure: "crashed", warnings: ["block_unblock_cycling"] })]);
  assert.deepEqual(diffBoards(prev, next).map((x) => [x.id, x.kind, x.failure]), [["t_1", "failed", "crashed"]]);
});

const ch = (kind, o = {}) => ({ machine: "devbox", id: `t_${kind}`, title: kind, agent: "writer", kind, text: kind, failure: null, ...o });
const on = { "toast.needs_you": true, "toast.done": true, "sound.needs_you": true, "sound.done": true };

test("alertsOf: toasts follow their switch, failed follows needs_you", () => {
  const all = [ch("needs_you"), ch("failed"), ch("done")];
  assert.deepEqual(alertsOf(all, on).toasts.map((c) => c.kind), ["needs_you", "failed", "done"]);
  assert.deepEqual(alertsOf(all, { ...on, "toast.done": false }).toasts.map((c) => c.kind), ["needs_you", "failed"]);
  assert.deepEqual(alertsOf(all, { ...on, "toast.needs_you": false }).toasts.map((c) => c.kind), ["done"]);
  assert.deepEqual(alertsOf([], on), { toasts: [], sound: null });
});

test("alertsOf: one sound per pass, blocked before done, each on its own switch", () => {
  assert.equal(alertsOf([ch("done"), ch("needs_you")], on).sound, "blocked");
  assert.equal(alertsOf([ch("failed")], on).sound, "blocked");
  assert.equal(alertsOf([ch("done")], on).sound, "done");
  assert.equal(alertsOf([ch("done"), ch("needs_you")], { ...on, "sound.needs_you": false }).sound, "done");
  assert.equal(alertsOf([ch("needs_you")], { ...on, "sound.needs_you": false }).sound, null);
  assert.equal(alertsOf([ch("done")], { ...on, "sound.done": false }).sound, null);
  // the sound does not depend on the toast switch
  assert.equal(alertsOf([ch("done")], { ...on, "toast.done": false }).sound, "done");
});

test("countUnseen: needs-you and failed add to needs, done to done, per machine; machines out of view drop out", () => {
  const changes = [ch("done"), ch("done", { id: "t_2" }), ch("needs_you"), ch("failed"), ch("done", { machine: "labbox" })];
  assert.deepEqual(countUnseen({ devbox: { needs: 1, done: 1 }, gone: { needs: 4, done: 0 } }, changes, ["devbox", "labbox"]),
    { devbox: { needs: 3, done: 3 }, labbox: { needs: 0, done: 1 } });
  assert.deepEqual(countUnseen({ devbox: { needs: 0, done: 2 } }, [], ["devbox"]), { devbox: { needs: 0, done: 2 } });
  assert.deepEqual(countUnseen(null, [ch("done", { machine: "nobox" })], ["devbox"]), {});
  assert.deepEqual(countUnseen({ devbox: 3 }, [], ["devbox"]), {}, "an old or broken count is dropped");
});

test("needsYou: only an unseen needs-you event of that machine", () => {
  assert.equal(needsYou({ devbox: { needs: 2, done: 0 } }, "devbox"), true);
  assert.equal(needsYou({ devbox: { needs: 0, done: 3 } }, "devbox"), false);
  assert.equal(needsYou({}, "devbox"), false);
});

test("badgeOf: the number of unseen needs-you events, else nothing", () => {
  assert.equal(badgeOf({ devbox: { needs: 2, done: 1 }, labbox: { needs: 1, done: 0 } }), "3");
  assert.equal(badgeOf({ devbox: { needs: 0, done: 4 } }), null);
  assert.equal(badgeOf({}), null);
});
