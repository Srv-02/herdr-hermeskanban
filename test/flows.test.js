// The flows of access.js (panel: Set up access, Restart gateway) and settings.js (Remove access), driven end to end
// through their click handlers against a fake machine. herdr, gpui-kit and gpui-base are replaced by test/fake/ (a
// resolve hook), so the real UI files run in node. What is pinned: nothing writes before Confirm, no restart without
// its click, the key goes only after the gateway runs without the variable, one restart per machine at a time.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const FAKES = {
  herdr: new URL("./fake/herdr.js", import.meta.url).href,
  "gpui-kit": new URL("./fake/ui.js", import.meta.url).href,
  "gpui-base": new URL("./fake/ui.js", import.meta.url).href,
};
registerHooks({ resolve: (spec, ctx, next) => (FAKES[spec] ? { url: FAKES[spec], shortCircuit: true } : next(spec, ctx)) });

const { Access } = await import("../mods/hermes-kanban/access.js");
const { SettingsDialog } = await import("../mods/hermes-kanban/settings.js");
const { textOf } = await import("./fake/ui.js");
const { PROBE_SCRIPT, SETUP_SCRIPT, REMOVE_SCRIPT, DELETE_TOKEN_SCRIPT, ACCESS_TEXT, ENV_HIDDEN_TEXT } = await import("../mods/hermes-kanban/lib/setup.js");
const { REQUEST_SCRIPT } = await import("../mods/hermes-kanban/lib/request.js");

const UNIT = "hermes-gateway.service";
const herdr = globalThis.__hkHerdr, ui = globalThis.__hkUI;

// A fake machine: the drop-in, whether the running gateway has the variable, the key, and whether it signs people in.
// Every call is logged with the state at that moment.
function machine(state) {
  const log = [];
  herdr.exec = async (cmd, args, opts) => {
    assert.equal(opts.on, "devbox", "every call goes to the bound machine");
    const at = (step) => { log.push({ step, ...state }); };
    if (cmd === "hermes") {
      assert.deepEqual(args, ["gateway", "restart"]);
      at("restart");
      state.env = state.dropin; // the new gateway reads the unit with or without the drop-in
      return { code: 0, stdout: "restarted\n", stderr: "" };
    }
    assert.equal(cmd, "sh");
    const script = args[1];
    if (script === PROBE_SCRIPT) {
      at("probe");
      const lines = ["home=yes", `unit=${UNIT}`, "curl=8.18.0", "python3=yes", `token=${state.token ? "yes" : "no"}`];
      if (state.dropin) lines.push(`dropin=${UNIT}`);
      lines.push(`env=${UNIT}:${state.env ? "yes" : "no"}`);
      if (state.hidden) lines.push(`envhidden=${UNIT}`);
      return { code: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
    }
    if (script === SETUP_SCRIPT) { at("setup"); state.dropin = true; state.token = true; return { code: 0, stdout: "", stderr: "" }; }
    if (script === REMOVE_SCRIPT) { at("remove"); state.dropin = false; return { code: 0, stdout: "", stderr: "" }; }
    if (script === DELETE_TOKEN_SCRIPT) {
      at("delete");
      if (state.dropin) return { code: 3, stdout: "", stderr: "" };
      if (state.env) return { code: 4, stdout: "", stderr: "" };
      state.token = false;
      return { code: 0, stdout: "", stderr: "" };
    }
    if (script === REQUEST_SCRIPT) {
      const [mode, , url] = args.slice(3);
      if (url.endsWith("/api/status")) {
        at("status");
        return { code: 0, stdout: `${JSON.stringify({ version: "0.23.4", gateway_running: true, auth_required: state.gated })}\n200`, stderr: "" };
      }
      if (url.includes("/stats")) { at("stats"); return { code: 0, stdout: `{}\n${mode === "gated" && state.env ? 200 : 401}`, stderr: "" }; }
    }
    throw new Error(`unexpected call ${cmd} ${args.slice(0, 2).join(" ")}`);
  };
  return log;
}

function fakeCx() {
  const tasks = [];
  const cx = {
    notify() {}, stop_propagation() {}, write_to_clipboard() {},
    spawn(fn) { tasks.push(Promise.resolve().then(() => fn(cx))); },
    sleep: async () => {},
    focus_handle: () => ({ focus() {} }),
    async settle() { while (tasks.length) await tasks.shift(); },
  };
  return cx;
}

const T = new Proxy({}, { get: () => "#808080" });
const C = { red: "#ff0000", green: "#00ff00", yellow: "#ffff00" };
// Draws, and hands back the clickable ids and the text.
function draw(view) {
  ui.clicks.clear();
  const tree = view();
  return { ids: [...ui.clicks.keys()], text: textOf(tree).join("\n") };
}
const click = (id, cx) => {
  const fn = ui.clicks.get(id);
  assert.ok(fn, `no element ${id} to click`);
  fn({}, cx);
};
const steps = (log) => log.map((x) => x.step);

beforeEach(() => { herdr.store = {}; ui.clicks.clear(); });

test("panel: Set up access asks first, writes after Confirm, restarts only on its click", async () => {
  const state = { dropin: false, env: false, token: false, gated: true };
  const log = machine(state), cx = fakeCx(), a = new Access();
  let snap = { machine: "devbox", at: 1, mode: "gated", access: { state: "needs_setup" } };
  assert.equal(a.showing("devbox", snap), false);

  let v = draw(() => a.draw(T, C, "devbox", snap));
  assert.ok(v.ids.includes("setup-devbox"));
  assert.ok(!v.ids.includes("restart-devbox"));
  click("setup-devbox", cx);
  await cx.settle();
  assert.deepEqual(log, [], "nothing runs before Confirm");
  assert.equal(a.showing("devbox", snap), true);

  v = draw(() => a.draw(T, C, "devbox", snap));
  assert.match(v.text, /These steps run on that machine/);
  assert.match(v.text, /No automatic restart/);
  click("setup-confirm-devbox", cx);
  await cx.settle();
  assert.deepEqual(steps(log), ["probe", "status", "setup"]);
  assert.equal(state.dropin, true);

  v = draw(() => a.draw(T, C, "devbox", snap));
  assert.match(v.text, /waiting for restart/);
  assert.ok(v.ids.includes("restart-devbox"));
  assert.ok(!steps(log).includes("restart"), "no restart without its click");

  click("restart-devbox", cx);
  await cx.settle();
  const s = steps(log);
  assert.deepEqual(s.slice(3, 4), ["restart"]);
  assert.ok(s.indexOf("stats") > s.indexOf("restart"), "the check with the key comes after the restart");
  assert.equal(state.env, true);
  assert.deepEqual(herdr.store["hermes-kanban.restarting"], {}, "the restart mark is cleared");
  assert.equal(herdr.store["hermes-kanban.refresh"].machine, "devbox");
  assert.match(draw(() => a.draw(T, C, "devbox", snap)).text, /Access works/);

  snap = { ...snap, at: Date.now() + 1, access: { state: "ok" } };
  assert.equal(a.showing("devbox", snap), false);
  assert.equal(a.flows.size, 0);
});

test("panel: an instance that stopped signing people in gets no setup", async () => {
  const state = { dropin: false, env: false, token: false, gated: false };
  const log = machine(state), cx = fakeCx(), a = new Access();
  const snap = { machine: "devbox", at: 1, mode: "gated", access: { state: "needs_setup" } };
  draw(() => a.draw(T, C, "devbox", snap));
  click("setup-devbox", cx);
  draw(() => a.draw(T, C, "devbox", snap));
  click("setup-confirm-devbox", cx);
  await cx.settle();
  assert.deepEqual(steps(log), ["probe", "status"]);
  assert.equal(state.dropin, false);
  assert.match(a.flows.get("devbox").error, /no longer signs people in/);
});

test("panel: an open instance offers neither setup nor restart", () => {
  const a = new Access();
  for (const state of ["open_rejected", "needs_setup", "waiting_restart"]) {
    const v = draw(() => a.draw(T, C, "devbox", { machine: "devbox", at: 1, mode: "open", access: { state } }));
    assert.deepEqual(v.ids.filter((id) => /^(setup|restart)-/.test(id)), [], state);
  }
});

test("panel: a flow waiting for its restart goes when a later poll finds another state", async () => {
  const state = { dropin: false, env: false, token: false, gated: true };
  machine(state);
  const cx = fakeCx(), a = new Access();
  const snap = { machine: "devbox", at: 1, mode: "gated", access: { state: "needs_setup" } };
  draw(() => a.draw(T, C, "devbox", snap));
  click("setup-devbox", cx);
  draw(() => a.draw(T, C, "devbox", snap));
  click("setup-confirm-devbox", cx);
  await cx.settle();
  assert.equal(a.flows.get("devbox").phase, "restart");
  // An older snapshot (before the setup) does not count; the next poll's does.
  assert.equal(a.showing("devbox", snap), true);
  assert.equal(a.showing("devbox", { ...snap, at: Date.now() + 1, access: { state: "waiting_restart" } }), true);
  assert.equal(a.showing("devbox", { ...snap, at: Date.now() + 1, access: { state: "needs_setup" } }), false);
  assert.equal(a.flows.size, 0);
});

test("one restart per machine: a second click while one runs does nothing", async () => {
  const state = { dropin: true, env: false, token: true, gated: true };
  const log = machine(state), cx = fakeCx(), a = new Access();
  herdr.store["hermes-kanban.restarting"] = { devbox: { at: Date.now() } };
  const snap = { machine: "devbox", at: 1, mode: "gated", access: { state: "waiting_restart" } };
  draw(() => a.draw(T, C, "devbox", snap));
  click("restart-devbox", cx);
  await cx.settle();
  assert.ok(!steps(log).includes("restart"));
  assert.match(a.flows.get("devbox").error, /already running/);
  // An old mark (a view that died mid-restart) does not block.
  herdr.store["hermes-kanban.restarting"] = { devbox: { at: Date.now() - 13 * 60 * 1000 } };
  draw(() => a.draw(T, C, "devbox", snap));
  click("restart-devbox", cx);
  await cx.settle();
  assert.equal(steps(log).filter((x) => x === "restart").length, 1);
});

test("settings: Remove access goes drop-in, restart on its click, key last", async () => {
  const state = { dropin: true, env: true, token: true, gated: true };
  const log = machine(state), cx = fakeCx();
  herdr.store["hermes-kanban.boards"] = { devbox: { machine: "devbox", mode: "gated", hermes: true, defaultAssignee: "" } };
  const d = new SettingsDialog({ settings: true, machine: "devbox" }, "overlay", cx);
  await cx.settle();
  assert.deepEqual(steps(log), ["probe"]);
  assert.equal(d.removal.step, "remove_dropin");

  let v = draw(() => d.render(cx));
  assert.ok(!v.ids.includes("settings-access-delete") && !v.ids.includes("settings-access-restart"));
  click("settings-access-remove", cx);
  await cx.settle();
  assert.deepEqual(steps(log), ["probe"], "nothing runs before Confirm");
  draw(() => d.render(cx));
  click("settings-access-confirm", cx);
  await cx.settle();
  assert.deepEqual(steps(log), ["probe", "remove", "probe"]);
  assert.equal(d.removal.step, "offer_restart");

  v = draw(() => d.render(cx));
  assert.ok(!v.ids.includes("settings-access-delete"), "no key deletion while the gateway may still read it");
  assert.match(v.text, /Restart the gateway to finish/);
  assert.ok(!steps(log).includes("restart"));
  click("settings-access-restart", cx);
  await cx.settle();
  assert.equal(d.removal.phase, "idle");
  assert.equal(d.removal.step, "delete_token");

  draw(() => d.render(cx));
  click("settings-access-delete", cx);
  await cx.settle();
  assert.equal(d.removal.step, "done");
  assert.equal(state.token, false);
  const s = steps(log), del = log.find((x) => x.step === "delete");
  assert.ok(s.indexOf("remove") < s.indexOf("restart") && s.indexOf("restart") < s.indexOf("delete"), s.join(","));
  assert.equal(del.dropin, false, "the key goes after the drop-in");
  assert.equal(del.env, false, "the key goes after the gateway runs without the variable");
  assert.match(draw(() => d.render(cx)).text, /No access of Hermes Kanban is set up on devbox/);
});

test("settings: an unreadable gateway environment explains why removal stays at the restart", async () => {
  const state = { dropin: false, env: true, token: true, gated: true, hidden: true };
  machine(state);
  const cx = fakeCx();
  herdr.store["hermes-kanban.boards"] = { devbox: { machine: "devbox", mode: "gated", hermes: true, defaultAssignee: "writer" } };
  const d = new SettingsDialog({ settings: true, machine: "devbox" }, "overlay", cx);
  await cx.settle();
  assert.equal(d.removal.step, "offer_restart");
  const v = draw(() => d.render(cx));
  assert.ok(v.text.includes(ENV_HIDDEN_TEXT));
  assert.ok(!v.text.includes(ACCESS_TEXT.waiting_restart.body));
});

test("settings: a failing restart resets the row", async () => {
  const state = { dropin: false, env: true, token: true, gated: true };
  machine(state);
  const real = herdr.exec;
  herdr.exec = async (cmd, args, opts) => { if (cmd === "hermes") throw new Error("connection lost"); return real(cmd, args, opts); };
  const cx = fakeCx();
  herdr.store["hermes-kanban.boards"] = { devbox: { machine: "devbox", mode: "gated", hermes: true, defaultAssignee: "" } };
  const d = new SettingsDialog({ settings: true, machine: "devbox" }, "overlay", cx);
  await cx.settle();
  draw(() => d.render(cx));
  click("settings-access-restart", cx);
  await cx.settle();
  assert.equal(d.removal.phase, "idle");
  assert.equal(d.removal.restarting, false);
  assert.match(d.removal.error, /The restart failed: connection lost/);
  assert.deepEqual(herdr.store["hermes-kanban.restarting"], {});
});

// kanban.default_assignee unset: Hermes still has a default agent (its active profile), shown as such, no warning.
test("settings: the default agent is Hermes' resolved one", async () => {
  machine({ dropin: true, env: true, token: true, gated: true });
  const cx = fakeCx();
  herdr.store["hermes-kanban.boards"] = { devbox: { machine: "devbox", mode: "gated", hermes: true, defaultAssignee: "", resolvedAssignee: "default" } };
  const d = new SettingsDialog({ settings: true, machine: "devbox" }, "overlay", cx);
  await cx.settle();
  const v = draw(() => d.render(cx));
  assert.ok(!v.text.includes("Without a default agent"), "no warning while Hermes has a default agent");
  assert.ok(!/\bnone\b/.test(v.text), "the value is not none");
  assert.match(v.text, /Default agent\n[^]*\bdefault\b/);
});

// Hermes' own board never leaves a new task unassigned: without a pick it takes the resolved default agent, so the task
// starts also where kanban.default_assignee is unset (the dispatcher fills only that one in).
test("new task: without a picked agent it goes to Hermes' default agent", async () => {
  const { CreateDialog } = await import("../mods/hermes-kanban/create.js");
  const sent = [];
  herdr.exec = async (cmd, args, opts) => {
    assert.equal(opts.on, "devbox");
    sent.push(JSON.parse(args[6]));
    return { code: 0, stdout: `${JSON.stringify({ task: { id: "t_a1b2", title: "x", status: "ready", assignee: "default" } })}\n200`, stderr: "" };
  };
  herdr.store["hermes-kanban.boards"] = { devbox: { machine: "devbox", mode: "gated", hermes: true, defaultAssignee: "", resolvedAssignee: "default", board: { assignees: ["default"] } } };
  const cx = fakeCx();
  const d = new CreateDialog({ machine: "devbox" }, "overlay", cx);
  await cx.settle();
  d.title.set_value("hk test");
  d.create(cx);
  await cx.settle();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].assignee, "default");
});

// Hermes' own board (apps/desktop/src/plugins/kanban/types.ts COLUMN_META) draws triage in its tertiary text grey,
// todo in the secondary one: here the theme's dim and muted.
test("status colors: triage grey as in Hermes", async () => {
  const { look } = await import("../mods/hermes-kanban/ui.js");
  const t = { muted: "#999999", dim: "#666666" }, c = { red: "#ff0000", orange: "#ff8800", blue: "#0000ff", yellow: "#ffff00", magenta: "#ff00ff" };
  assert.equal(look("triage", t, c, false).color, t.dim);
  assert.equal(look("todo", t, c, false).color, t.muted);
});

// The rest as Hermes' board too: scheduled violet, ready blue, running green, done grey; review stays red with blocked
// (red means needs you); mono unchanged.
test("status colors: as Hermes' board, review red", async () => {
  const { look } = await import("../mods/hermes-kanban/ui.js");
  const t = { muted: "#999999", dim: "#666666" }, c = { red: "#ff0000", green: "#00ff00", blue: "#0000ff", yellow: "#ffff00", magenta: "#ff00ff", orange: "#ff8800" };
  const color = (s, mono = false) => look(s, t, c, mono).color;
  assert.deepEqual(["scheduled", "ready", "running", "done", "blocked", "review"].map((s) => color(s)), [c.magenta, c.blue, c.green, t.dim, c.red, c.red]);
  assert.deepEqual(["scheduled", "running", "done", "review"].map((s) => color(s, true)), [t.muted, t.muted, t.muted, c.red]);
});
