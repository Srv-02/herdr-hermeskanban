import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SAFE_ID, createApi } from "../mods/hermes-kanban/lib/api.js";
import { BASE, KANBAN } from "../mods/hermes-kanban/lib/request.js";

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures", `${name}.json`), "utf8"));

// A fake exec: records every call as { cmd, args, opts } and answers with `reply` (JSON body plus HTTP code).
function fake({ reply = { ok: true }, code = 200, modes = { devbox: "gated", labbox: "open" } } = {}) {
  const calls = [];
  const modeCalls = [];
  const exec = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { code: 0, stdout: `${JSON.stringify(typeof reply === "function" ? reply(args) : reply)}\n${code}`, stderr: "" };
  };
  const mode = (machine) => { modeCalls.push(machine); return modes[machine]; };
  return { api: createApi(exec, mode), calls, modeCalls };
}
const url = (c) => c.args[5];
const method = (c) => c.args[4];
const body = (c) => JSON.parse(c.args[6]);
const kanbanUrl = (p) => `${BASE}${KANBAN}${p}`;

test("SAFE_ID", () => {
  assert.equal(String(SAFE_ID), String(/^[A-Za-z0-9_-]{1,64}$/));
});

test("every call goes to the given machine and carries board=default", async () => {
  const { api, calls } = fake();
  await api.board("labbox");
  await api.workflow("labbox");
  await api.orchestration("labbox");
  await api.diagnostics("labbox");
  await api.task("labbox", "t_a1b2");
  await api.patch("labbox", "t_a1b2", { status: "ready" });
  await api.comment("labbox", "t_a1b2", "hi");
  await api.create("labbox", { title: "New" });
  assert.equal(calls.length, 8);
  for (const c of calls) {
    assert.equal(c.cmd, "sh");
    assert.equal(c.opts.on, "labbox");
    assert.ok(url(c).startsWith(kanbanUrl("/")), url(c));
    assert.equal(new URL(url(c)).searchParams.getAll("board").join(), "default", url(c));
  }
  assert.deepEqual(calls.map((c) => [method(c), new URL(url(c)).pathname]), [
    ["GET", `${KANBAN}/board`], ["GET", `${KANBAN}/workflow`], ["GET", `${KANBAN}/orchestration`], ["GET", `${KANBAN}/diagnostics`],
    ["GET", `${KANBAN}/tasks/t_a1b2`], ["PATCH", `${KANBAN}/tasks/t_a1b2`], ["POST", `${KANBAN}/tasks/t_a1b2/comments`], ["POST", `${KANBAN}/tasks`],
  ]);
  assert.equal(new URL(url(calls[3])).searchParams.get("severity"), "warning");
});

test("status goes to /api/status without board", async () => {
  const { api, calls } = fake({ reply: fixture("status") });
  const r = await api.status("devbox");
  assert.equal(calls[0].opts.on, "devbox");
  assert.equal(url(calls[0]), `${BASE}/api/status`);
  assert.equal(r.code, 200);
  assert.equal(r.json.version, "0.23.4");
});

test("status uses mode none, kanban calls use the instance's mode", async () => {
  const { api, calls, modeCalls } = fake();
  await api.status("devbox");
  await api.board("devbox");
  await api.board("labbox");
  assert.deepEqual(calls.map((c) => c.args[3]), ["none", "gated", "open"]);
  assert.deepEqual(modeCalls, ["devbox", "labbox"]);
});

test("a machine without a known mode is refused before any request", () => {
  const { api, calls } = fake({ modes: {} });
  assert.throws(() => api.board("devbox"), /mode/);
  assert.equal(calls.length, 0);
});

test("a call without machine is refused, never run on this computer", () => {
  const { api, calls } = fake();
  for (const m of [null, undefined, ""]) {
    assert.throws(() => api.board(m), /machine/);
    assert.throws(() => api.status(m), /machine/);
    assert.throws(() => api.patch(m, "t_a1b2", { status: "ready" }), /machine/);
  }
  assert.equal(calls.length, 0);
});

test("actions ignore the focused machine", async () => {
  const { api, calls, modeCalls } = fake({ reply: { task: { ...fixture("task").task, status: "ready" } } });
  // The panel showed labbox when the overlay opened; the focus moves to devbox while the PATCH runs.
  let focused = "labbox";
  const task = { machine: focused, id: "t_a1b2" };
  const pending = api.act(task, "patch", { status: "ready" });
  focused = "devbox";
  const r = await pending;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.on, "labbox");
  assert.deepEqual(modeCalls, ["labbox"]);
  assert.equal(r.task.machine, "labbox");
  await api.act(task, "comment", { body: "ok" });
  assert.equal(calls[1].opts.on, "labbox");
});

test("actions on tasks of two machines never cross over", async () => {
  const { api, calls } = fake({ reply: (args) => ({ task: { ...fixture("task").task, id: new URL(args[5]).pathname.split("/")[5] } }) });
  const a = { machine: "devbox", id: "t_a1b2" };
  const b = { machine: "labbox", id: "t_a1b2" };
  const results = await Promise.all([
    api.act(a, "patch", { status: "ready" }), api.act(b, "patch", { priority: 3 }),
    api.act(b, "comment", { body: "b" }), api.act(a, "comment", { body: "a" }),
    api.patch("labbox", "t_a1b2", { status: "archived" }),
  ]);
  assert.deepEqual(calls.map((c) => c.opts.on), ["devbox", "labbox", "labbox", "devbox", "labbox"]);
  assert.deepEqual(calls.map((c) => c.args[3]), ["gated", "open", "open", "gated", "open"]);
  assert.equal(results[0].task.machine, "devbox");
  assert.equal(results[1].task.machine, "labbox");
  assert.equal(results[4].task.machine, "labbox");
  assert.equal(body(calls[2]).body, "b");
  assert.equal(body(calls[3]).body, "a");
});

test("act refuses a task without machine", () => {
  const { api, calls } = fake();
  assert.throws(() => api.act({ id: "t_a1b2" }, "patch", { status: "ready" }), /machine/);
  assert.throws(() => api.act({ id: "t_a1b2", machine: "" }, "comment", { body: "x" }), /machine/);
  assert.throws(() => api.act(null, "patch", {}), /machine/);
  assert.equal(calls.length, 0);
});

test("act refuses unknown verbs, never DELETE", () => {
  const { api, calls } = fake();
  assert.throws(() => api.act({ machine: "devbox", id: "t_a1b2" }, "delete", {}), /verb/);
  assert.throws(() => api.act({ machine: "devbox", id: "t_a1b2" }, "create", {}), /verb/);
  assert.equal(calls.length, 0);
  assert.equal(api.delete, undefined);
});

test("rejects unsafe task ids", () => {
  const { api, calls } = fake();
  for (const id of ["t/../x", "t?a=1", "", "t&board=other", "..", "t a", "x".repeat(65), null, 7]) {
    assert.throws(() => api.task("devbox", id), /id/);
    assert.throws(() => api.patch("devbox", id, { status: "ready" }), /id/);
    assert.throws(() => api.comment("devbox", id, "x"), /id/);
    assert.throws(() => api.act({ machine: "devbox", id }, "patch", { status: "ready" }), /id/);
  }
  assert.equal(calls.length, 0);
});

test("comment sends the passed author and the text unchanged", async () => {
  const { api, calls } = fake();
  const text = "it's \"done\" $(rm -rf ~) `id`\nline two 🎉 & ?board=x";
  await api.comment("devbox", "t_a1b2", text, "Jane Doe");
  assert.deepEqual(body(calls[0]), { body: text, author: "Jane Doe" });
});

test("comment: the author is trimmed and cut to 64 characters, and herdr without one", async () => {
  const { api, calls } = fake();
  await api.comment("devbox", "t_a1b2", "a", "  Jane Doe  ");
  await api.comment("devbox", "t_a1b2", "b", "q".repeat(80));
  await api.comment("devbox", "t_a1b2", "c", "  ");
  await api.comment("devbox", "t_a1b2", "d");
  await api.act({ machine: "devbox", id: "t_a1b2" }, "comment", { body: "e", author: "ACME Ops" });
  assert.deepEqual(calls.map((c) => body(c).author), ["Jane Doe", "q".repeat(64), "herdr", "herdr", "ACME Ops"]);
});

test("patch sends only status, assignee and priority and returns the normalized task", async () => {
  const { api, calls } = fake({ reply: { task: { ...fixture("task").task, status: "todo" } } });
  const r = await api.patch("devbox", "t_a1b2", { status: "todo", assignee: "coder", priority: 4, title: "no", body: "no" });
  assert.deepEqual(body(calls[0]), { status: "todo", assignee: "coder", priority: 4 });
  assert.equal(r.code, 200);
  assert.equal(r.error, null);
  assert.equal(r.task.status, "todo");
  assert.equal(r.task.machine, "devbox");
});

test("unassign sends an empty assignee, not null", async () => {
  const { api, calls } = fake({ reply: { task: fixture("task").task } });
  await api.patch("devbox", "t_a1b2", { assignee: null });
  await api.act({ machine: "devbox", id: "t_a1b2" }, "patch", { assignee: "" });
  assert.deepEqual(body(calls[0]), { assignee: "" });
  assert.deepEqual(body(calls[1]), { assignee: "" });
});

test("a patch without status, assignee or priority is refused before any request", () => {
  const { api, calls } = fake();
  for (const f of [{}, { title: "x" }, undefined, { status: undefined }]) {
    assert.throws(() => api.patch("devbox", "t_a1b2", f), /patch/);
  }
  assert.throws(() => api.act({ machine: "devbox", id: "t_a1b2" }, "patch", {}), /patch/);
  assert.equal(calls.length, 0);
});

test("an empty comment is refused before any request", () => {
  const { api, calls } = fake();
  for (const t of ["", "   ", "\n\t", null, undefined]) {
    assert.throws(() => api.comment("devbox", "t_a1b2", t), /comment/);
  }
  assert.throws(() => api.act({ machine: "devbox", id: "t_a1b2" }, "comment", { body: " " }), /comment/);
  assert.equal(calls.length, 0);
});

test("archive is a PATCH to status archived", async () => {
  const { api, calls } = fake({ reply: { task: { ...fixture("task").task, status: "archived" } } });
  const r = await api.act({ machine: "devbox", id: "t_a1b2" }, "patch", { status: "archived" });
  assert.equal(method(calls[0]), "PATCH");
  assert.deepEqual(body(calls[0]), { status: "archived" });
  assert.equal(r.task.status, "archived");
});

test("a refused patch keeps code and gives no task", async () => {
  const { api } = fake({ reply: { detail: "status transition to 'ready' not valid from current state" }, code: 409 });
  const r = await api.patch("devbox", "t_a1b2", { status: "ready" });
  assert.equal(r.code, 409);
  assert.equal(r.task, null);
  assert.match(r.json.detail, /not valid/);
});

test("create posts title, body, priority and assignee", async () => {
  const { api, calls } = fake({ reply: { task: { ...fixture("task").task, id: "t_n3w0", status: "ready" } } });
  const r = await api.create("devbox", { title: "New", body: "Text", priority: 2, assignee: "writer", tenant: "no" });
  assert.deepEqual(body(calls[0]), { title: "New", body: "Text", priority: 2, assignee: "writer" });
  assert.equal(r.task.id, "t_n3w0");
  assert.equal(r.task.machine, "devbox");
  await api.create("devbox", { title: "Only title" });
  assert.deepEqual(body(calls[1]), { title: "Only title" });
});

test("diagnostics counts problem tasks", async () => {
  const { api } = fake({ reply: fixture("diagnostics") });
  const r = await api.diagnostics("devbox");
  assert.equal(r.problems, 2);
  const broken = fake({ reply: "<html>", code: 502 });
  assert.equal((await broken.api.diagnostics("devbox")).problems, null);
});

test("an exec that throws becomes code 0", async () => {
  const api = createApi(async () => { throw new Error("no such machine"); }, () => "gated");
  const r = await api.board("devbox");
  assert.deepEqual(r, { code: 0, json: null, error: "no such machine" });
  const p = await api.patch("devbox", "t_a1b2", { status: "ready" });
  assert.equal(p.code, 0);
  assert.equal(p.task, null);
});
