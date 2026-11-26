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

// ---- comment and unblock (two requests, no atomicity) ----
import { commentAndUnblock, mergePatched, failureOf } from "../mods/hermes-kanban/lib/moves.js";
import { createApi } from "../mods/hermes-kanban/lib/api.js";

const DETAIL = "Cannot move to 'ready': blocked by parent(s) not done — t_p1";

// A fake api of the shape createApi returns (act only), recording each call.
function fakeApi(replies) {
  const calls = [];
  return {
    calls,
    act(t, verb, payload) {
      calls.push({ machine: t.machine, id: t.id, verb, payload });
      return Promise.resolve(replies[verb]);
    },
  };
}
const blocked = task({ status: "blocked", assignee: "writer" });

test("commentAndUnblock keeps the comment when the PATCH is refused", async () => {
  const api = fakeApi({ comment: { code: 200, json: { ok: true }, error: null }, patch: { code: 409, json: { detail: DETAIL }, error: null, task: null } });
  const r = await commentAndUnblock(api, blocked, "Only v2.3 to v2.4");
  assert.deepEqual(r, { commented: true, moved: null, error: DETAIL });
  assert.deepEqual(api.calls.map((c) => c.verb), ["comment", "patch"], "the comment goes first");
  assert.deepEqual(api.calls[0].payload, { body: "Only v2.3 to v2.4" });
  assert.deepEqual(api.calls[1].payload, { status: "ready" });
});

test("commentAndUnblock: a failed comment sends no PATCH", async () => {
  const api = fakeApi({ comment: { code: 0, json: null, error: "curl exited with 7" } });
  const r = await commentAndUnblock(api, blocked, "hi");
  assert.deepEqual(r, { commented: false, moved: null, error: "curl exited with 7" });
  assert.deepEqual(api.calls.map((c) => c.verb), ["comment"]);
});

test("commentAndUnblock: a throwing call is an error, not a crash", async () => {
  const api = { act: () => { throw new Error("no access mode for devbox"); } };
  assert.deepEqual(await commentAndUnblock(api, blocked, "hi"), { commented: false, moved: null, error: "no access mode for devbox" });
});

test("commentAndUnblock returns the task as Hermes answered the PATCH", async () => {
  const moved = task({ status: "todo", assignee: "writer" });
  const api = fakeApi({ comment: { code: 200, json: {}, error: null }, patch: { code: 200, json: { task: {} }, error: null, task: moved } });
  assert.deepEqual(await commentAndUnblock(api, blocked, "go"), { commented: true, moved, error: null });
});

// With the real createApi: both requests go to the task's machine, whatever else exists.
test("commentAndUnblock sends both requests to the task's machine", async () => {
  const calls = [];
  const exec = async (cmd, args, opts) => {
    calls.push({ args, opts });
    const reply = args[4] === "PATCH" ? { task: { id: "t_a1", title: "x", status: "ready", assignee: "writer", priority: 0 } } : { ok: true };
    return { code: 0, stdout: `${JSON.stringify(reply)}\n200`, stderr: "" };
  };
  const api = createApi(exec, (m) => ({ devbox: "gated", labbox: "open" })[m]);
  const r = await commentAndUnblock(api, { ...blocked, machine: "labbox" }, "go");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => c.opts.on), ["labbox", "labbox"]);
  assert.deepEqual(calls.map((c) => [c.args[4], new URL(c.args[5]).pathname.split("/").slice(-2).join("/")]), [["POST", "t_a1/comments"], ["PATCH", "tasks/t_a1"]]);
  assert.equal(JSON.parse(calls[0].args[6]).author, "herdr");
  assert.equal(r.moved.machine, "labbox");
  assert.equal(r.moved.status, "ready");
});

test("mergePatched keeps the known comment count and body (PATCH has no comment_count)", () => {
  const known = { ...blocked, comments: 3, body: "the text" };
  const patched = { ...blocked, status: "ready", comments: 0 };
  assert.deepEqual(mergePatched(known, patched), { ...patched, comments: 3, body: "the text" });
  assert.equal(mergePatched(known, null), null);
  assert.deepEqual(mergePatched(null, patched), { ...patched, body: null });
});

test("failureOf: Hermes' detail, else the transport error, else the HTTP code", () => {
  assert.equal(failureOf({ code: 409, json: { detail: DETAIL }, error: null }), DETAIL);
  assert.equal(failureOf({ code: 422, json: { detail: [{ msg: "field required" }, { msg: "too long" }] }, error: null }), "field required; too long");
  assert.equal(failureOf({ code: 0, json: null, error: "timeout" }), "timeout");
  assert.equal(failureOf({ code: 500, json: null, error: null }), "HTTP 500");
});
