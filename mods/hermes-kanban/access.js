// Access to a gated Hermes in the panel: the empty state of each access state (lib/setup.js ACCESS_TEXT) and the flow
// of "Set up access" (spec "Setup und Entfernen"). The button first shows the steps and asks for "Confirm"; then a
// fresh probe, the gateway unit, SETUP_SCRIPT on the machine, and "waiting for restart". Only a click on "Restart
// gateway" runs `hermes gateway restart`; after it the panel waits for /api/status to say running, checks /stats with
// the key, and asks the watcher for a new poll. An open instance (no auth gate) gets no setup and no restart.
// Each flow belongs to the machine of its first click and stays there, also when the panel follows another pane
// meanwhile (R18). The runners below are also the settings' (settings.js, "Remove access").
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, shared, setShared } from "herdr";
import { glyphOf, button, buttonFace } from "./ui.js";
import { ACCESS_TEXT, SETUP_STEPS, SETUP_SCRIPT, PROBE_SCRIPT, accessOffer, setupUnit, parseProbe, scriptSpec, scriptError, restartSpec, restartRunning, markRestart } from "./lib/setup.js";
import { BASE, KANBAN, parseResponse, redactSecrets, requestSpec, withBoard } from "./lib/request.js";
import { normalizeStatus } from "./lib/board.js";

const message = (e) => String(e?.message ?? e);
const tail = (text) => String(text ?? "").trim().split("\n").slice(-3).join(" ");
// The steps in a few words, for the empty state before the click.
const SHORT = ["a key, only if missing", "a systemd drop-in for the gateway", "systemctl --user daemon-reload", "you restart the gateway", "a check with the key"];

// ---- the runners: each one goes to the machine it is given, and nothing it shows carries a key ----

const spec = (s) => [s.cmd, s.args, s.opts];

export async function probeMachine(machine) {
  const r = await exec(...spec(scriptSpec(machine, PROBE_SCRIPT, [], 15000)));
  return parseProbe(r?.stdout);
}

// One of the scripts of lib/setup.js with the unit as $1; its exit code in words, or null.
export async function runScript(machine, name, script, unit) {
  const r = await exec(...spec(scriptSpec(machine, script, [unit])));
  const why = scriptError(name, r.code);
  return why && r.stderr?.trim() ? `${why} ${redactSecrets(tail(r.stderr))}` : why;
}

// /api/status of the machine, normalized, or null when it does not answer.
async function gatewayStatus(machine) {
  try {
    const r = parseResponse(await exec(...spec(requestSpec(machine, { mode: "none", method: "GET", url: `${BASE}/api/status` }))));
    return r.code === 200 ? normalizeStatus(r.json) : null;
  } catch { return null; }
}

// Runs a restart spec (built by the click that asked for it), then waits about 100 s (45 checks 2 s apart) for the gateway to run again.
// One restart per machine at a time, for the panel and the settings alike: the shared mark says one is in flight.
export async function restartGateway(restart, sleep) {
  const machine = restart.opts.on;
  if (restartRunning(shared("hermes-kanban.restarting"), machine, Date.now())) return { error: `A restart of the gateway on ${machine} is already running.` };
  setShared("hermes-kanban.restarting", markRestart(shared("hermes-kanban.restarting"), machine, Date.now(), true));
  try {
    let r;
    try { r = await exec(...spec(restart)); } catch (e) { return { error: redactSecrets(`The restart failed: ${message(e)}`) }; }
    if (r.code !== 0) return { error: redactSecrets(`The restart failed (exit ${r.code}): ${tail(r.stderr || r.stdout)}`) };
    for (let i = 0; i < 45; i++) {
      if ((await gatewayStatus(machine))?.running) return { ok: true };
      await sleep(2000);
    }
    return { error: "The gateway did not come back within 100 s." };
  } finally {
    setShared("hermes-kanban.restarting", markRestart(shared("hermes-kanban.restarting"), machine, Date.now(), false));
  }
}

// GET /stats with the key: 200 means access works. The web app may need a moment after the gateway runs.
async function verifyAccess(machine, sleep) {
  let code = 0;
  for (let i = 0; i < 5; i++) {
    try {
      code = parseResponse(await exec(...spec(requestSpec(machine, { mode: "gated", method: "GET", url: `${BASE}${KANBAN}${withBoard("/stats")}` })))).code;
    } catch { code = 0; }
    if (code === 200) return { ok: true };
    await sleep(2000);
  }
  return { code };
}

const refresh = (machine) => setShared("hermes-kanban.refresh", { machine, at: Date.now() });

// One flow of one machine. phase: idle | confirm | setting_up | restart (waiting for the click) | restarting |
// verifying | done.
class Flow {
  constructor(machine) {
    this.machine = machine;
    this.phase = "idle"; this.error = null; this.doneAt = 0; this.restartAt = 0;
  }
  get busy() { return ["setting_up", "restarting", "verifying"].includes(this.phase); }
}

export class Access {
  constructor() { this.flows = new Map(); }

  flow(machine) {
    let f = this.flows.get(machine);
    if (!f) this.flows.set(machine, f = new Flow(machine));
    return f;
  }

  // Whether the panel shows this machine's flow instead of its board: while a flow runs (a restart takes the gateway
  // down, and the board would stay), and until the board is readable after it. A finished flow goes once access is ok.
  // A finished flow also goes when a poll after it still finds no access, and a flow waiting for its restart goes when
  // a poll after the setup finds the machine in another state (access removed in the settings meanwhile, say): the
  // board's own state tells from then on.
  showing(machine, snap) {
    const f = this.flows.get(machine), state = snap?.access?.state, at = snap?.at ?? 0;
    if (!f) return false;
    const stale = (f.phase === "done" && at > f.doneAt) || (f.phase === "restart" && at > f.restartAt && state !== "waiting_restart");
    if ((state === "ok" && !f.busy) || stale) { this.flows.delete(machine); return false; }
    return f.phase !== "idle";
  }

  setup(f, cx) {
    if (f.busy) return;
    f.phase = "setting_up"; f.error = null; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const u = setupUnit(await probeMachine(f.machine));
        if (u.error) throw new Error(u.error);
        // Asked again right before the write: an instance that no longer signs people in gets no setup.
        const status = await gatewayStatus(f.machine);
        if (!status) throw new Error(`The gateway on ${f.machine} does not answer; nothing was changed.`);
        if (accessOffer({ state: "needs_setup", mode: status.gated ? "gated" : "open" }) !== "setup") {
          throw new Error(`Hermes on ${f.machine} no longer signs people in, so it needs no setup; nothing was changed.`);
        }
        const why = await runScript(f.machine, "setup", SETUP_SCRIPT, u.unit);
        if (why) throw new Error(why);
        f.phase = "restart"; f.restartAt = Date.now();
        refresh(f.machine);
      } catch (e) {
        f.phase = "idle"; f.error = redactSecrets(message(e));
      }
      cx.notify();
    });
  }

  // `restart` comes from the click (restartSpec of the bound machine); nothing else starts one.
  restart(machine, restart, cx) {
    const f = this.flow(machine);
    if (f.busy) return;
    f.phase = "restarting"; f.error = null; cx.notify();
    cx.spawn(async (cx) => {
      const sleep = (ms) => cx.sleep(ms);
      try {
        const r = await restartGateway(restart, sleep);
        if (r.error) { f.phase = "restart"; f.restartAt = Date.now(); f.error = r.error; return; }
        f.phase = "verifying"; cx.notify();
        const v = await verifyAccess(f.machine, sleep);
        if (v.ok) { f.phase = "done"; f.doneAt = Date.now(); }
        else { f.phase = "idle"; f.error = v.code === 401 ? ACCESS_TEXT.token_rejected.body : `The check with the key got ${v.code ? `HTTP ${v.code}` : "no answer"}.`; }
      } catch (e) {
        f.phase = "restart"; f.restartAt = Date.now(); f.error = redactSecrets(message(e));
      } finally {
        refresh(f.machine);
        cx.notify();
      }
    });
  }

  // The empty state of the panel for `machine`: its flow, or the poller's access state.
  draw(t, c, machine, snap) {
    const state = snap?.access?.state ?? "unknown", f = this.flows.get(machine);
    const offer = accessOffer({ state, mode: snap?.mode ?? null });
    const phase = f && f.phase !== "idle" ? f.phase : offer === "restart" ? "restart" : "idle";
    const error = f?.error ? div().max_w(360).text_size(12).text_color(c.red).text_center().child(f.error) : null;
    const box = (icon, title, lines, tone = t.dim) => v_flex().id(`access-${machine}`).flex_1().min_h(0).w_full().overflow_y_scroll()
      .child(v_flex().w_full().items_center().px(24).py(28).gap(10)
        .child(glyphOf(icon, 22, tone))
        .child(div().font_semibold().text_color(t.foreground).text_center().child(title))
        .children(lines.filter(Boolean).map((l) => typeof l === "string" ? div().max_w(360).text_size(12).text_color(t.muted).text_center().child(l) : l)));
    const restartButton = () => buttonFace(`restart-${machine}`, "Restart gateway", t, { primary: true })
      .on_click((_e, cx) => this.restart(machine, restartSpec(machine), cx));

    if (phase === "confirm") {
      return box("settings", `Set up access on ${machine}`, [
        "These steps run on that machine, in this order:",
        v_flex().w_full().max_w(400).gap(8).children(SETUP_STEPS.map((s, i) => this.step(t, i + 1, s))),
        h_flex().gap(8).pt(4)
          .child(button(`setup-cancel-${machine}`, "Cancel", t, (_e, cx) => { f.phase = "idle"; cx.notify(); }))
          .child(button(`setup-confirm-${machine}`, "Confirm", t, (_e, cx) => this.setup(f, cx), { primary: true })),
        error]);
    }
    if (phase === "setting_up") return box("running", `Setting up access on ${machine}…`, ["Writing the key and the drop-in, then systemctl --user daemon-reload."]);
    if (phase === "restarting") return box("running", `Restarting the gateway on ${machine}…`, ["Running turns finish first; messaging pauses briefly."]);
    if (phase === "verifying") return box("running", "Checking access…", ["GET /api/plugins/kanban/stats with the key."]);
    if (phase === "done") return box("check-circle", "Access works", ["Reading the board…"], c.green);
    if (phase === "restart") {
      return box("refresh", ACCESS_TEXT.waiting_restart.title, [ACCESS_TEXT.waiting_restart.body, "waiting for restart", div().pt(4).child(restartButton()), error], c.yellow);
    }
    const text = ACCESS_TEXT[state] ?? { title: "No access to this board", body: `Access: ${state}` };
    if (offer === "setup") {
      return box("kanban", text.title, [text.body, `Setting it up adds ${SHORT.join(", ")}. It asks first.`,
        div().pt(4).child(button(`setup-${machine}`, "Set up access", t, (_e, cx) => { this.flow(machine).phase = "confirm"; this.flow(machine).error = null; cx.notify(); }, { primary: true })),
        error]);
    }
    return box("alert", text.title, [text.body, error]);
  }

  // One step of the confirmation: its number, its first line, and the rest (the drop-in's content) in mono.
  step(t, n, text) {
    const [first, ...rest] = text.split("\n");
    return h_flex().w_full().gap(8).items_start().text_size(12)
      .child(div().w(16).flex_none().text_color(t.muted).child(`${n}.`))
      .child(v_flex().flex_1().min_w(0).gap(4)
        .child(div().text_color(t.foreground).child(first))
        .when(rest.length > 0, (e) => e.child(v_flex().px(8).py(6).rounded(6).bg(t.background).border_1().border_color(t.border)
          .font_family("JetBrains Mono").text_size(11).text_color(t.muted).children(rest.map((l) => div().child(l))))));
  }
}
