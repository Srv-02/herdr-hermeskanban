import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedMoves, outcomeText } from "../mods/hermes-kanban/lib/moves.js";

const labels = { todo: "Todo", ready: "Ready", review: "Review", done: "Done" };
const task = (o) => ({ machine: "devbox", id: "t_a1", status: "todo", assignee: null, ...o });

test("allowedMoves comes from the workflow, not a table", () => {
  const wf = { order: ["todo", "done"], labels: {}, manual: { todo: ["done", "todo"] } };
  assert.deepEqual(allowedMoves(wf, "todo"), ["done"]);
  assert.deepEqual(allowedMoves(wf, "done"), []);
});

test("outcomeText reports Hermes' redirect: review -> todo lands in ready", () => {
  assert.equal(outcomeText("todo", task({ status: "ready" }), labels), "Hermes moved it to Ready");
});

test("outcomeText: ready with an agent starts with the next dispatch", () => {
  assert.equal(outcomeText("ready", task({ status: "ready", assignee: "coder" }), labels), "Ready. starts with next dispatch");
});

test("outcomeText: plain result and raw status without a label", () => {
  assert.equal(outcomeText("done", task({ status: "done" }), labels), "Done");
  assert.equal(outcomeText("a", task({ status: "weird" })), "Hermes moved it to weird");
});
