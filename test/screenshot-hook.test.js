// The screenshot hook (scripts/screenshots/demo-hook.mjs) patches a COPY of the mod for the demo instance. Its anchors are exact
// text of the mod, so a change of the mod can break it silently: this test applies it to a fresh copy of mods/hermes-kanban and
// fails when an anchor is gone. It also checks that the shipped mod itself carries no trace of the hook or the demo data, and
// that the fake Hermes of the demo answers every call the mod makes. Pattern: ghchecker test/screenshot-hook.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { mkTmpSync } from "./tmp-helper.js";
import { answer } from "../scripts/screenshots/demo/hermes.mjs";
import { createApi } from "../mods/hermes-kanban/lib/api.js";
import { createPoller } from "../mods/hermes-kanban/lib/poller.js";
import { defaults } from "../mods/hermes-kanban/lib/settings.js";
import { PROBE_SCRIPT, SETUP_SCRIPT, parseProbe, pickUnit, restartSpec, scriptSpec } from "../mods/hermes-kanban/lib/setup.js";
import { normalizeDetail } from "../mods/hermes-kanban/lib/board.js";
import { groupTasks } from "../mods/hermes-kanban/lib/view.js";

const ORDER_OF_HERMES = ["triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done"];

const root = path.resolve(import.meta.dirname, "..");
const mod = path.join(root, "mods/hermes-kanban");
const hook = path.join(root, "scripts/screenshots/demo-hook.mjs");

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : [p];
  });
}

// A fresh copy of the mod, patched by the hook with `env` (DEMO_SCENE, DEMO_UPDATE, DEMO_STATE).
function hooked(env = {}) {
  const dir = mkTmpSync("hk-hook-"), copy = path.join(dir, "hermes-kanban");
  fs.cpSync(mod, copy, { recursive: true });
  const r = spawnSync("node", [hook, copy], { encoding: "utf8", env: { ...process.env, DEMO_STATE: dir, ...env } });
  return { dir, copy, r };
}

test("the shipped mod carries no trace of the hook or the demo data", () => {
  assert.ok(!fs.existsSync(path.join(mod, "demo")), "no demo/ in the mod");
  assert.ok(!fs.existsSync(path.join(mod, "demo-exec.js")), "no demo-exec.js in the mod");
  for (const f of files(mod)) {
    const text = fs.readFileSync(f, "utf8");
    for (const trace of ["HK_DEMO", "demo-hook", "demo-exec", "screenshots/demo"]) {
      assert.ok(!text.includes(trace), `${path.relative(root, f)} must not contain "${trace}"`);
    }
  }
});

test("the hook applies to the current mod", () => {
  const { copy, r } = hooked();
  assert.equal(r.status, 0, r.stderr);
  // Every call to Hermes goes through the fake: no file of the copy imports exec from herdr any more, except the
  // fake's own module and ui.js (it opens links on a click only).
  for (const f of ["watcher.js", "viewer.js", "create.js", "access.js"]) {
    const text = fs.readFileSync(path.join(copy, f), "utf8");
    assert.match(text, /import \{ exec \} from "\.\/demo-exec\.js";/, f);
    assert.doesNotMatch(text.match(/^import \{[^}]*\} from "herdr";$/m)[0], /\bexec\b/, f);
  }
  const demoExec = fs.readFileSync(path.join(copy, "demo-exec.js"), "utf8");
  assert.ok(demoExec.includes(JSON.stringify(path.join(root, "scripts/screenshots/demo/hermes.mjs"))));
  for (const f of files(copy).filter((x) => x.endsWith(".js"))) {
    const c = spawnSync("node", ["--check", "--input-type=module"], { input: fs.readFileSync(f, "utf8"), encoding: "utf8" });
    assert.equal(c.status, 0, `${f}: ${c.stderr}`);
  }
  assert.ok(!fs.readFileSync(path.join(mod, "watcher.js"), "utf8").includes("demo-exec"), "the repo's mod is untouched");
});

test("the hooked copy sees the demo spaces as the machines devbox and labbox", async () => {
  const { copy, r } = hooked();
  assert.equal(r.status, 0, r.stderr);
  const { focusedInstance, visibleMachines, jumpTarget } = await import(pathToFileURL(path.join(copy, "lib/instances.js")));
  const spaces = [
    { id: "s1", name: "devbox", machine: null, tabs: [{ id: "t1" }] },
    { id: "s2", name: "labbox", machine: null, tabs: [{ id: "t2" }] },
    { id: "s3", name: "~", machine: null, tabs: [{ id: "t3" }] },
  ];
  const panes = [{ pane: "p1", tab: "t1", terminal: "term1" }, { pane: "p2", tab: "t2", terminal: "term2" }, { pane: "p3", tab: "t3", terminal: "term3" }];
  assert.deepEqual(visibleMachines(spaces), ["devbox", "labbox"]);
  assert.deepEqual(focusedInstance({ spaces, panes, focused: { space: "s1", pane: "p1" } }), { machine: "devbox", pane: "p1", hermes: true });
  assert.deepEqual(focusedInstance({ spaces, panes, focused: { space: "s3", pane: "p3" } }), { machine: null, pane: null, hermes: false });
  assert.deepEqual(jumpTarget("labbox", { spaces, panes }, {}), { pane: "p2" });
});

test("the hooked update check asks no one: up to date, or 1.1.0 with DEMO_UPDATE=1", async () => {
  for (const [env, tag] of [[{}, "v1.0.0"], [{ DEMO_UPDATE: "1" }, "v1.1.0"]]) {
    const { copy, r } = hooked(env);
    assert.equal(r.status, 0, r.stderr);
    const { fetchRelease } = await import(pathToFileURL(path.join(copy, "lib/update.js")));
    assert.deepEqual(await fetchRelease(() => { throw new Error("no network in the demo"); }, () => new Promise(() => {})), { tag });
  }
});

test("the hook fails loudly when an anchor is missing", () => {
  const dir = mkTmpSync("hk-hook-"), copy = path.join(dir, "hermes-kanban");
  fs.cpSync(mod, copy, { recursive: true });
  const file = path.join(copy, "lib/instances.js");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("export const visibleMachines = (spaces) =>", "export const visibleMachinesMoved = (spaces) =>"));
  const r = spawnSync("node", [hook, copy], { encoding: "utf8", env: { ...process.env, DEMO_STATE: dir } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /anchor not found/);
});

// The fake as the hooked exec calls it, in process.
const fakeExec = (ctx) => async (cmd, args = [], opts = {}) => answer({ cmd, args, on: opts?.on ?? null }, ctx);

async function poll(ctx, machines = ["devbox", "labbox"]) {
  let poller = null;
  const exec = fakeExec(ctx);
  const api = createApi(exec, (m) => poller.mode(m));
  poller = createPoller({ api, run: (s) => exec(s.cmd, s.args, s.opts), now: Date.now, settings: () => defaults() });
  return { api, poller, first: await poller.tick(machines) };
}

test("the fake Hermes answers every call the panel makes", async () => {
  const { api, first } = await poll({ scene: "board" });
  const dev = first.snapshots.devbox, lab = first.snapshots.labbox;
  for (const s of [dev, lab]) {
    assert.equal(s.hermes, true);
    assert.equal(s.access.state, "ok");
    assert.equal(s.mode, "gated");
    assert.equal(s.error, null);
    assert.equal(s.unsupported, null);
    assert.ok(s.workflow?.order.includes("blocked"));
  }
  assert.equal(dev.status.version, "0.23.4");
  assert.equal(dev.problems, 1);
  assert.deepEqual(dev.board.assignees, ["coder", "research", "writer"]);
  assert.ok(dev.board.tasks.some((t) => t.title === "Draft release notes for v2.4" && t.status === "blocked" && t.assignee === "writer"));
  assert.ok(dev.board.tasks.every((t) => t.machine === "devbox"));
  assert.equal(dev.board.tasks.filter((t) => t.status === "running").length, 2);
  assert.ok(dev.board.tasks.some((t) => t.status === "ready" && !t.assignee), "a task without an agent");
  assert.equal(dev.defaultAssignee, "", "no default agent: an unassigned ready task will not start");
  assert.deepEqual(first.changes, [], "the first poll only sets the baseline");

  // Every task opens in the overlay.
  for (const t of dev.board.tasks) {
    const r = await api.task("devbox", t.id);
    assert.equal(r.code, 200, t.id);
    const d = normalizeDetail(r.json, "devbox");
    assert.equal(d.task.id, t.id);
    assert.equal(d.task.title, t.title);
  }
  const notes = normalizeDetail((await api.task("devbox", "t_a1b2")).json, "devbox");
  assert.ok(notes.comments.length > 0 && notes.events.some((e) => e.kind === "blocked") && notes.runs.length > 0);

  // Writes answer as Hermes does and change nothing.
  const moved = await api.patch("devbox", "t_a1b2", { status: "ready" });
  assert.equal(moved.code, 200);
  assert.equal(moved.task.status, "ready");
  assert.equal((await api.comment("devbox", "t_a1b2", "From v2.3.0, please.")).code, 200);
  const made = await api.create("devbox", { title: "Write the changelog", priority: 1 });
  assert.equal(made.code, 200);
  assert.equal(made.task.title, "Write the changelog");
  assert.equal((await api.task("devbox", "t_a1b2")).json.task.status, "blocked", "writes change nothing");

  // The settings and "Set up access": access is set up, every step succeeds, the restart too.
  const exec = fakeExec({ scene: "board" });
  const probe = parseProbe((await exec(...Object.values(scriptSpec("devbox", PROBE_SCRIPT, [], 15000)))).stdout);
  assert.equal(pickUnit(probe.units).unit, "hermes-gateway.service");
  assert.ok(probe.home && probe.token && probe.python3 && probe.dropins.includes("hermes-gateway.service"));
  assert.equal((await exec(...Object.values(scriptSpec("devbox", SETUP_SCRIPT, ["hermes-gateway.service"])))).code, 0);
  assert.equal((await exec(...Object.values(restartSpec("devbox")))).code, 0);
  assert.notEqual((await exec("uname", ["-a"], { on: "devbox" })).code, 0, "anything else fails");
});

test("the overlay scene opens the blocked release notes first", async () => {
  const { first } = await poll({ scene: "overlay" }, ["devbox"]);
  const open = first.snapshots.devbox.board.tasks.filter((t) => t.status !== "done");
  assert.ok(open.every((t) => !["triage", "todo", "scheduled", "ready", "running"].includes(t.status)));
  // As the panel orders it: the first group's first row, newest first.
  const top = groupTasks(open, "status", ORDER_OF_HERMES)[0].tasks[0];
  assert.equal(top.title, "Draft release notes for v2.4");
});

test("the notifications scene: after the turn a labbox task needs input, and the fake says so", async () => {
  const state = mkTmpSync("hk-turn-");
  const ctx = { scene: "notifications", state };
  const { poller } = await poll(ctx);
  fs.writeFileSync(path.join(state, "demo-turn"), "");
  poller.refresh("labbox");
  const second = await poller.tick(["devbox", "labbox"]);
  const change = second.changes.find((c) => c.machine === "labbox");
  assert.equal(change?.kind, "needs_you");
  assert.equal(change.agent, "research");
  assert.ok(!second.changes.some((c) => c.machine === "devbox"));
  assert.ok(fs.existsSync(path.join(state, "demo-turned")), "the fake marks that it served the turned board");
});

test("the fake runs as a command, the way the hooked exec calls it", () => {
  const fake = path.join(root, "scripts/screenshots/demo/hermes.mjs");
  const call = { cmd: "sh", args: ["-c", "x", "sh"], on: "devbox" };
  const unknown = spawnSync("node", [fake, JSON.stringify(call), JSON.stringify({ scene: "board" })], { encoding: "utf8" });
  assert.notEqual(unknown.status, 0, "an unknown script fails");
  const status = spawnSync("node", [fake, JSON.stringify({ cmd: "hermes", args: ["gateway", "restart"], on: "devbox" }), "{}"], { encoding: "utf8" });
  assert.equal(status.status, 0, status.stderr);
});

test("demo-instance.sh deletes only its own paths below tmp/ and the core state of hkshots", () => {
  const script = path.join(root, "scripts/screenshots/demo-instance.sh");
  const guard = (p) => spawnSync("sh", [script, "guard", p], { encoding: "utf8" }).status;
  const home = process.env.HOME;
  for (const p of [path.join(root, "tmp/shots-home"), path.join(root, "tmp/shots-spaces"), `${home}/.local/state/herdr-core/hkshots`]) assert.equal(guard(p), 0, p);
  for (const p of [root, path.join(root, "tmp"), `${root}/tmp/`, path.join(root, "tmp/../mods"), `${root}/tmp/shots-home/../../mods`, home, "/",
    `${home}/.local/state/herdr-core/hktest`, `${home}/.local/state/herdr-core/default`, path.join(root, "tmp-other")]) assert.equal(guard(p), 1, p);
  // No deleted path comes from the environment, and every deletion goes through the guard; shoot.sh deletes only files.
  const text = fs.readFileSync(script, "utf8");
  for (const v of ["DEMO_DIR", "XDG_STATE_HOME"]) assert.ok(!text.includes(v), v);
  assert.deepEqual(text.split("\n").filter((l) => /\brm\s/.test(l) && !/^\s*#/.test(l)).map((l) => l.trim()), ['rm -rf -- "$@"']);
  const shoot = fs.readFileSync(path.join(root, "scripts/screenshots/shoot.sh"), "utf8");
  assert.ok(!/\brm\s+-[a-z]*r/.test(shoot), "shoot.sh removes no folder");
});

test("shoot.sh rejects an unknown card before it starts anything", () => {
  const r = spawnSync("bash", [path.join(root, "scripts/screenshots/shoot.sh"), "board", "boards"], { encoding: "utf8", env: { ...process.env, CROP_ONLY: "1" } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown card: boards/);
});
