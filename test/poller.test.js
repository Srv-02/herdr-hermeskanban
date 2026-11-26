import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FULL_EVERY, META_EVERY, createPoller } from "../mods/hermes-kanban/lib/poller.js";
import { createApi } from "../mods/hermes-kanban/lib/api.js";
import { REQUEST_SCRIPT } from "../mods/hermes-kanban/lib/request.js";
import { STAMP_SCRIPT } from "../mods/hermes-kanban/lib/changes.js";
import { PROBE_SCRIPT } from "../mods/hermes-kanban/lib/setup.js";
import { defaults } from "../mods/hermes-kanban/lib/settings.js";

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures", `${name}.json`), "utf8"));

// A /board answer with the smallest task dicts checkBoard accepts.
const board = (...tasks) => ({
  columns: [...new Set(tasks.map((t) => t.status))].map((name) => ({
    name, tasks: tasks.filter((t) => t.status === name).map((t) => ({ title: `Task ${t.id}`, priority: 0, assignee: "writer", ...t })),
  })),
  assignees: ["writer"],
  now: 1795000000,
});

const PROBE_NEEDS_SETUP = "home=yes\nunit=hermes-gateway.service\ncurl=8.18.0\npython3=yes\ntoken=no\nenv=hermes-gateway.service:no\n";

// A fake set of machines behind exec: every answer depends only on opts.on, so a request sent to the wrong machine
// gets the other machine's data. `calls` records { on, what, mode } for every exec.
function world(machines) {
  const calls = [];
  const exec = async (cmd, args, opts) => {
    const m = machines[opts.on];
    if (args[1] === STAMP_SCRIPT) {
      calls.push({ on: opts.on, what: "stamp" });
      if (m.unreachable) throw new Error("machine unreachable");
      if (!m.stamp) return { code: 1, stdout: "", stderr: "find: no such file" };
      return { code: 0, stdout: `kanban.db ${m.stamp} 4096\n`, stderr: "" };
    }
    if (args[1] === PROBE_SCRIPT) {
      calls.push({ on: opts.on, what: "probe" });
      return { code: 0, stdout: m.probe ?? PROBE_NEEDS_SETUP, stderr: "" };
    }
    assert.equal(args[1], REQUEST_SCRIPT);
    const route = new URL(args[5]).pathname.replace("/api/plugins/kanban", "");
    calls.push({ on: opts.on, what: route, mode: args[3] });
    const answer = (json, code = 200) => ({ code: 0, stdout: `${typeof json === "string" ? json : JSON.stringify(json)}\n${code}`, stderr: "" });
    if (m.unreachable) throw new Error("machine unreachable");
    if (route === "/api/status") return m.status ? answer(m.status) : { code: 7, stdout: "", stderr: "curl: (7) Failed to connect" };
    if (route === "/board") return answer(m.board, m.boardCode ?? 200);
    if (route === "/workflow") return answer(fixture("workflow"));
    if (route === "/orchestration") return answer({ ...fixture("orchestration"), default_assignee: m.defaultAssignee ?? "writer" });
    if (route === "/diagnostics") return answer(fixture("diagnostics"));
    throw new Error(`unexpected ${route}`);
  };
  return { exec, calls, machines };
}

function setup(machines, { settings = defaults() } = {}) {
  const w = world(machines);
  let t = 1000000;
  let poller = null;
  const api = createApi(w.exec, (m) => poller.mode(m));
  poller = createPoller({ api, run: (spec) => w.exec(spec.cmd, spec.args, spec.opts), now: () => t, settings: () => settings });
  const count = (what, on) => w.calls.filter((c) => c.what === what && (!on || c.on === on)).length;
  return { poller, calls: w.calls, count, machines, advance: (ms) => { t += ms; }, at: () => t };
}

const gated = (over = {}) => ({ ...fixture("status"), ...over });
const open = (over = {}) => ({ ...fixture("status"), auth_required: false, auth_providers: [], ...over });
const ids = (snap) => snap.board.tasks.map((x) => `${x.id}:${x.status}`);

test("the first poll fetches everything and sets only the baseline", async () => {
  const s = setup({ devbox: { stamp: "1.0", status: gated(), board: board({ id: "t_a1b2", status: "blocked" }) } });
  const r = await s.poller.tick(["devbox"]);
  assert.deepEqual(r.changes, [], "the baseline never toasts, even for a blocked task");
  const snap = r.snapshots.devbox;
  assert.equal(snap.machine, "devbox");
  assert.equal(snap.at, s.at());
  assert.equal(snap.hermes, true);
  assert.equal(snap.error, null);
  assert.equal(snap.unsupported, null);
  assert.deepEqual(snap.access, { state: "ok", removalPending: false });
  assert.deepEqual(snap.status, { version: "0.23.4", running: true, state: "running", gated: true });
  assert.equal(snap.mode, "gated");
  assert.equal(snap.defaultAssignee, "writer");
  assert.equal(snap.workflow.order[0], fixture("workflow").columns[0].key);
  assert.equal(snap.problems, 2, "tasks with a diagnostic, not entries");
  assert.deepEqual(ids(snap), ["t_a1b2:blocked"]);
  assert.equal(snap.board.tasks[0].machine, "devbox");
  assert.equal(s.count("probe"), 0, "no probe in normal operation");
  assert.equal(s.poller.mode("devbox"), "gated");
});

test("unchanged stamp: no board request", async () => {
  const s = setup({ devbox: { stamp: "1.0", status: gated(), board: board({ id: "t_a1b2", status: "ready" }) } });
  await s.poller.tick(["devbox"]);
  assert.equal(s.count("/board"), 1);
  s.advance(10000);
  await s.poller.tick(["devbox"]);
  assert.equal(s.count("stamp"), 1, "not due before poll_seconds");
  s.advance(20000);
  const r = await s.poller.tick(["devbox"]);
  assert.equal(s.count("stamp"), 2);
  assert.equal(s.count("/board"), 1);
  assert.equal(s.count("/api/status"), 1);
  assert.deepEqual(ids(r.snapshots.devbox), ["t_a1b2:ready"]);
  assert.deepEqual(r.changes, []);
});

test("poll_seconds sets the pace", async () => {
  const s = setup({ devbox: { stamp: "1.0", status: gated(), board: board() } }, { settings: { ...defaults(), poll_seconds: 60 } });
  await s.poller.tick(["devbox"]);
  s.advance(30000);
  await s.poller.tick(["devbox"]);
  assert.equal(s.count("stamp"), 1);
  s.advance(30000);
  await s.poller.tick(["devbox"]);
  assert.equal(s.count("stamp"), 2);
});

test("changed stamp: board request, then changes against the last snapshot", async () => {
  const s = setup({ devbox: { stamp: "1.0", status: gated(), board: board({ id: "t_a1b2", status: "ready" }, { id: "t_c3d4", status: "running" }) } });
  await s.poller.tick(["devbox"]);
  s.machines.devbox.board = board({ id: "t_a1b2", status: "blocked" }, { id: "t_c3d4", status: "done" });
  s.machines.devbox.stamp = "2.0";
  s.advance(30000);
  const r = await s.poller.tick(["devbox"]);
  assert.equal(s.count("/board"), 2);
  assert.equal(s.count("/diagnostics"), 2, "problems come with every board");
  assert.deepEqual(r.changes.map((c) => [c.machine, c.id, c.kind]), [["devbox", "t_a1b2", "needs_you"], ["devbox", "t_c3d4", "done"]]);
  s.advance(30000);
  s.machines.devbox.stamp = "3.0";
  assert.deepEqual((await s.poller.tick(["devbox"])).changes, [], "the same board again reports nothing");
});

test("full refresh after FULL_EVERY even with the same stamp", async () => {
  const s = setup({ devbox: { stamp: "1.0", status: gated(), board: board({ id: "t_a1b2", status: "ready" }) } });
  await s.poller.tick(["devbox"]);
  s.machines.devbox.board = board({ id: "t_a1b2", status: "done" });
  for (let t = 30000; t < FULL_EVERY; t += 30000) {
    s.advance(30000);
    await s.poller.tick(["devbox"]);
  }
  assert.equal(s.count("/board"), 1);
  s.advance(30000);
  const r = await s.poller.tick(["devbox"]);
  assert.equal(s.count("/board"), 2);
  assert.deepEqual(r.changes.map((c) => c.kind), ["done"]);
  assert.equal(s.count("/api/status"), 2, "status, workflow and orchestration every META_EVERY");
  assert.equal(s.count("/workflow"), 2);
  assert.equal(s.count("/orchestration"), 2);
  assert.equal(META_EVERY, 300000);
  assert.equal(FULL_EVERY, 300000);
});

test("refresh fetches the machine fully on the next tick", async () => {
  const s = setup({ devbox: { stamp: "1.0", status: gated(), board: board({ id: "t_a1b2", status: "ready" }) } });
  await s.poller.tick(["devbox"]);
  s.machines.devbox.board = board({ id: "t_a1b2", status: "blocked" });
  s.poller.refresh("devbox");
  s.advance(1000);
  const r = await s.poller.tick(["devbox"]);
  assert.equal(s.count("/board"), 2);
  assert.deepEqual(ids(r.snapshots.devbox), ["t_a1b2:blocked"], "the board comes from /board, never from a merged PATCH answer");
  assert.equal(r.snapshots.devbox.board.tasks[0].comments, 0);
  s.advance(1000);
  await s.poller.tick(["devbox"]);
  assert.equal(s.count("/board"), 2, "one refresh, one fetch");
});

test("a failed poll keeps the last snapshot and posts nothing", async () => {
  const s = setup({ devbox: { stamp: "1.0", status: gated(), board: board({ id: "t_a1b2", status: "ready" }) } });
  await s.poller.tick(["devbox"]);
  s.machines.devbox.board = "<html>502 Bad Gateway</html>";
  s.machines.devbox.boardCode = 502;
  s.machines.devbox.stamp = "2.0";
  s.advance(30000);
  let r = await s.poller.tick(["devbox"]);
  assert.deepEqual(r.changes, []);
  assert.deepEqual(ids(r.snapshots.devbox), ["t_a1b2:ready"]);
  assert.match(r.snapshots.devbox.error, /502/);

  s.machines.devbox.unreachable = true;
  s.advance(30000);
  r = await s.poller.tick(["devbox"]);
  assert.deepEqual(r.changes, []);
  assert.deepEqual(ids(r.snapshots.devbox), ["t_a1b2:ready"]);
  assert.match(r.snapshots.devbox.error, /unreachable/);

  // Back: one change against the last good board, no storm, and the status is asked again after the error.
  delete s.machines.devbox.unreachable;
  s.machines.devbox.board = board({ id: "t_a1b2", status: "blocked" });
  s.machines.devbox.boardCode = 200;
  const statusBefore = s.count("/api/status");
  s.advance(30000);
  r = await s.poller.tick(["devbox"]);
  assert.equal(r.snapshots.devbox.error, null);
  assert.deepEqual(r.changes.map((c) => [c.id, c.kind]), [["t_a1b2", "needs_you"]]);
  assert.equal(s.count("/api/status"), statusBefore + 1);
});

test("a gateway that is down reports gateway_down and probes", async () => {
  const s = setup({ devbox: { stamp: "1.0", status: null, board: board() } });
  const r = await s.poller.tick(["devbox"]);
  const snap = r.snapshots.devbox;
  assert.equal(snap.hermes, true);
  assert.deepEqual(snap.access, { state: "gateway_down", removalPending: false });
  assert.equal(snap.status, null);
  assert.equal(snap.board, null);
  assert.ok(snap.error);
  assert.equal(s.count("probe"), 1);
  assert.equal(s.count("/board"), 0, "no kanban call without a mode");
  assert.equal(s.poller.mode("devbox"), null);
});

test("a machine without kanban.db is no Hermes and is asked again after META_EVERY", async () => {
  const s = setup({ labbox: { stamp: null, status: open(), board: board() } });
  let r = await s.poller.tick(["labbox"]);
  assert.equal(r.snapshots.labbox.hermes, false);
  assert.equal(r.snapshots.labbox.board, null);
  assert.equal(r.snapshots.labbox.error, null);
  assert.deepEqual(s.calls.map((c) => c.what), ["stamp"], "nothing but the stamp");
  s.advance(META_EVERY - 1);
  await s.poller.tick(["labbox"]);
  assert.equal(s.count("stamp"), 1);
  s.machines.labbox.stamp = "1.0";
  s.advance(1);
  r = await s.poller.tick(["labbox"]);
  assert.equal(s.count("stamp"), 2);
  assert.equal(r.snapshots.labbox.hermes, true);
  assert.equal(r.snapshots.labbox.mode, "open");
  assert.deepEqual(r.changes, [], "the first board is the baseline");
});

test("401 runs the probe and reports needs_setup", async () => {
  const s = setup({ devbox: { stamp: "1.0", status: gated(), board: { detail: "Unauthorized" }, boardCode: 401 } });
  const r = await s.poller.tick(["devbox"]);
  assert.equal(s.count("probe"), 1);
  assert.deepEqual(r.snapshots.devbox.access, { state: "needs_setup", removalPending: false });
  assert.equal(r.snapshots.devbox.board, null);
  assert.equal(r.snapshots.devbox.hermes, true);
  assert.deepEqual(r.changes, []);
  assert.equal(s.calls.find((c) => c.what === "probe").on, "devbox");
});

test("a key that works again clears needs_setup and sets the baseline", async () => {
  const s = setup({ devbox: { stamp: "1.0", status: gated(), board: { detail: "Unauthorized" }, boardCode: 401 } });
  await s.poller.tick(["devbox"]);
  s.machines.devbox.board = board({ id: "t_a1b2", status: "blocked" });
  s.machines.devbox.boardCode = 200;
  s.advance(30000);
  const r = await s.poller.tick(["devbox"]);
  assert.deepEqual(r.snapshots.devbox.access, { state: "ok", removalPending: false });
  assert.deepEqual(r.changes, []);
});

test("a board of another shape reports unsupported with the version", async () => {
  const s = setup({ devbox: { stamp: "1.0", status: gated({ version: "0.99.0" }), board: { lanes: [] } } });
  const r = await s.poller.tick(["devbox"]);
  assert.equal(r.snapshots.devbox.unsupported, "Hermes 0.99.0 not supported yet");
  assert.equal(r.snapshots.devbox.board, null);
  assert.equal(r.snapshots.devbox.error, null);
  assert.deepEqual(r.changes, []);
});

test("a machine that left and came back sets a new baseline", async () => {
  const s = setup({ devbox: { stamp: "1.0", status: gated(), board: board({ id: "t_a1b2", status: "ready" }) } });
  await s.poller.tick(["devbox"]);
  s.advance(30000);
  let r = await s.poller.tick([]);
  assert.deepEqual(r.snapshots, {});
  s.machines.devbox.board = board({ id: "t_a1b2", status: "blocked" }, { id: "t_c3d4", status: "done" });
  s.machines.devbox.stamp = "2.0";
  s.advance(30000);
  r = await s.poller.tick(["devbox"]);
  assert.deepEqual(r.changes, [], "the old board is gone: the return is a new first fetch");
  assert.deepEqual(ids(r.snapshots.devbox), ["t_a1b2:blocked", "t_c3d4:done"]);
});

test("every request of a tick goes to its own machine", async () => {
  const s = setup({
    devbox: { stamp: "1.0", status: gated(), board: board({ id: "t_a1b2", status: "ready" }), defaultAssignee: "writer" },
    labbox: { stamp: "1.0", status: open(), board: board({ id: "t_a1b2", status: "review" }, { id: "t_e5f6", status: "ready" }), defaultAssignee: "" },
  });
  const r = await s.poller.tick(["devbox", "labbox"]);
  assert.deepEqual(ids(r.snapshots.devbox), ["t_a1b2:ready"]);
  assert.deepEqual(ids(r.snapshots.labbox), ["t_a1b2:review", "t_e5f6:ready"]);
  assert.ok(r.snapshots.labbox.board.tasks.every((x) => x.machine === "labbox"));
  assert.equal(r.snapshots.devbox.defaultAssignee, "writer");
  assert.equal(r.snapshots.labbox.defaultAssignee, "");
  for (const on of ["devbox", "labbox"]) {
    for (const what of ["stamp", "/api/status", "/board", "/workflow", "/orchestration", "/diagnostics"]) assert.equal(s.count(what, on), 1, `${on} ${what}`);
  }
  const expected = { devbox: "gated", labbox: "open" };
  for (const c of s.calls.filter((x) => x.what.startsWith("/") && x.what !== "/api/status")) assert.equal(c.mode, expected[c.on], `${c.on} ${c.what}`);

  // A change on one machine reports only that machine.
  s.machines.labbox.board = board({ id: "t_a1b2", status: "done" }, { id: "t_e5f6", status: "ready" });
  s.machines.labbox.stamp = "2.0";
  s.advance(30000);
  const next = await s.poller.tick(["devbox", "labbox"]);
  assert.deepEqual(next.changes.map((c) => [c.machine, c.id, c.kind]), [["labbox", "t_a1b2", "done"]]);
  assert.equal(s.count("/board", "devbox"), 1);
});

test("a machine still being polled is not polled twice", async () => {
  const s = setup({ devbox: { stamp: "1.0", status: gated(), board: board({ id: "t_a1b2", status: "ready" }) } });
  const first = s.poller.tick(["devbox"]);
  const second = await s.poller.tick(["devbox"]);
  assert.equal(second.snapshots.devbox, undefined, "no snapshot before the first poll ends");
  await first;
  assert.equal(s.count("stamp"), 1);
});

test("a machine that leaves during its poll is dropped", async () => {
  const s = setup({ devbox: { stamp: "1.0", status: gated(), board: board({ id: "t_a1b2", status: "ready" }) } });
  const first = s.poller.tick(["devbox"]);
  await s.poller.tick([]);
  const r = await first;
  assert.equal(r.snapshots.devbox, undefined);
  s.machines.devbox.board = board({ id: "t_a1b2", status: "blocked" });
  s.advance(30000);
  assert.deepEqual((await s.poller.tick(["devbox"])).changes, [], "its board never became a baseline");
});
