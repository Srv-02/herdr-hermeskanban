import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { mkTmpSync } from "./tmp-helper.js";
import {
  DELETE_TOKEN_SCRIPT, DROPIN_NAME, DROPIN_TEXT, PROBE_SCRIPT, REMOVE_SCRIPT, SETUP_SCRIPT, UNIT_RE,
  accessState, curlOk, parseProbe, pickUnit, restartSpec, scriptSpec,
} from "../mods/hermes-kanban/lib/setup.js";

const UNIT = "hermes-gateway.service";

// A fake machine: HOME with ~/.hermes, a python3 that prints a fake token, a systemctl that logs its argv and answers
// list-unit-files and show -p MainPID from $FAKE_UNITS / $FAKE_PID, a curl --version, and a fake /proc (HK_PROC).
function fakeMachine({ units = UNIT, pid = "0", python = true } = {}) {
  const home = mkTmpSync("setup-");
  fs.mkdirSync(path.join(home, ".hermes"));
  const bin = path.join(home, "bin");
  fs.mkdirSync(bin);
  if (python) fs.writeFileSync(path.join(bin, "python3"), "#!/bin/sh\necho tok-FAKE-456\n", { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "systemctl"), [
    "#!/bin/sh",
    'echo "$*" >> "$HOME/systemctl.log"',
    'case "$*" in',
    '  *list-unit-files*) for u in $FAKE_UNITS; do echo "$u disabled enabled"; done ;;',
    '  *"show -p MainPID --value"*) echo "$FAKE_PID" ;;',
    "esac",
  ].join("\n") + "\n", { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "curl"), "#!/bin/sh\necho 'curl 8.18.0 (x86_64-pc-linux-gnu) libcurl/8.18.0'\n", { mode: 0o755 });
  // PATH holds only these fakes plus the few real tools the scripts use, so a missing python3 is really missing.
  for (const tool of ["sh", "awk", "cat", "chmod", "grep", "mkdir", "mktemp", "mv", "rm", "rmdir", "tr"]) {
    const real = ["/usr/bin", "/bin"].map((d) => path.join(d, tool)).find((f) => fs.existsSync(f));
    fs.symlinkSync(real, path.join(bin, tool));
  }
  const proc = path.join(home, "proc");
  fs.mkdirSync(proc);
  const env = { HOME: home, PATH: bin, HK_PROC: proc, FAKE_UNITS: units, FAKE_PID: pid };
  const run = (script, args = []) => spawnSync("sh", ["-c", script, "sh", ...args], { cwd: home, input: "", encoding: "utf8", env });
  const token = path.join(home, ".hermes/dashboard.token");
  const dropin = (u = UNIT) => path.join(home, ".config/systemd/user", `${u}.d`, DROPIN_NAME);
  const log = () => (fs.existsSync(path.join(home, "systemctl.log")) ? fs.readFileSync(path.join(home, "systemctl.log"), "utf8") : "");
  const environ = (p, text) => { fs.mkdirSync(path.join(proc, p)); fs.writeFileSync(path.join(proc, p, "environ"), text); };
  return { home, run, token, dropin, log, environ };
}
const mode = (f) => fs.statSync(f).mode & 0o777;

test("DROPIN_TEXT is the spec's text", () => assert.equal(DROPIN_TEXT,
  '# Written by the Herdr hermes-kanban mod. "Remove access" in its settings deletes this file.\n[Service]\nEnvironment="HERMES_DASHBOARD_SESSION_TOKEN=file:%h/.hermes/dashboard.token"\n'));

test("DROPIN_NAME and UNIT_RE", () => {
  assert.equal(DROPIN_NAME, "herdr-kanban-token.conf");
  assert.match(UNIT, UNIT_RE);
  assert.match("hermes-gateway-x@a.b.service", UNIT_RE);
  assert.doesNotMatch("x;rm -rf ~", UNIT_RE);
  assert.doesNotMatch("hermes-gateway.service/../x.service", UNIT_RE);
  assert.doesNotMatch("other.service", UNIT_RE);
});

test("setup creates token 0600 and drop-in 0600, then daemon-reload", () => {
  const m = fakeMachine();
  const r = m.run(SETUP_SCRIPT, [UNIT]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(m.token, "utf8"), "tok-FAKE-456\n");
  assert.equal(mode(m.token), 0o600);
  assert.equal(fs.readFileSync(m.dropin(), "utf8"), DROPIN_TEXT);
  assert.equal(mode(m.dropin()), 0o600);
  assert.equal(m.log(), "--user daemon-reload\n");
  assert.deepEqual(fs.readdirSync(path.dirname(m.dropin())), [DROPIN_NAME]); // no temp file left behind
  assert.deepEqual(fs.readdirSync(path.join(m.home, ".hermes")), ["dashboard.token"]);
});

test("setup keeps an existing token", () => {
  const m = fakeMachine();
  fs.writeFileSync(m.token, "old-token\n", { mode: 0o600 });
  const r = m.run(SETUP_SCRIPT, [UNIT]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(m.token, "utf8"), "old-token\n");
  assert.equal(fs.readFileSync(m.dropin(), "utf8"), DROPIN_TEXT);
});

test("setup leaves other drop-ins of the unit alone", () => {
  const m = fakeMachine();
  const other = path.join(path.dirname(m.dropin()), "override.conf");
  fs.mkdirSync(path.dirname(other), { recursive: true });
  fs.writeFileSync(other, "[Service]\nEnvironment=FOO=bar\n");
  assert.equal(m.run(SETUP_SCRIPT, [UNIT]).status, 0);
  assert.equal(fs.readFileSync(other, "utf8"), "[Service]\nEnvironment=FOO=bar\n");
});

test("setup refuses a unit name outside UNIT_RE", () => {
  const m = fakeMachine();
  for (const bad of ["x;rm -rf ~", "../hermes-gateway.service", "hermes-gateway.service/../x.service", ""]) {
    const r = m.run(SETUP_SCRIPT, [bad]);
    assert.equal(r.status, 2, bad);
  }
  assert.ok(!fs.existsSync(m.token));
  assert.ok(!fs.existsSync(path.join(m.home, ".config")));
  assert.equal(m.log(), "");
});

test("setup fails without a token when python3 is missing", () => {
  const m = fakeMachine({ python: false });
  const r = m.run(SETUP_SCRIPT, [UNIT]);
  assert.notEqual(r.status, 0);
  assert.ok(!fs.existsSync(m.token));
  assert.ok(!fs.existsSync(m.dropin()));
  assert.equal(m.log(), "");
});

test("remove deletes the drop-in, never the token", () => {
  const m = fakeMachine();
  assert.equal(m.run(SETUP_SCRIPT, [UNIT]).status, 0);
  const r = m.run(REMOVE_SCRIPT, [UNIT]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(m.dropin()));
  assert.equal(fs.readFileSync(m.token, "utf8"), "tok-FAKE-456\n");
  assert.equal(m.log(), "--user daemon-reload\n--user daemon-reload\n");
  assert.equal(m.run(REMOVE_SCRIPT, ["x;y"]).status, 2);
});

test("delete-token refuses while the drop-in exists (exit 3)", () => {
  const m = fakeMachine();
  assert.equal(m.run(SETUP_SCRIPT, [UNIT]).status, 0);
  assert.equal(m.run(DELETE_TOKEN_SCRIPT, [UNIT]).status, 3);
  assert.ok(fs.existsSync(m.token));
});

test("delete-token refuses while the gateway still has the variable (exit 4)", () => {
  const m = fakeMachine({ pid: "4242" });
  fs.writeFileSync(m.token, "tok\n");
  m.environ("4242", "PATH=/usr/bin\0HERMES_DASHBOARD_SESSION_TOKEN=file:x\0HOME=/h\0");
  assert.equal(m.run(DELETE_TOKEN_SCRIPT, [UNIT]).status, 4);
  assert.ok(fs.existsSync(m.token));
});

test("delete-token removes the token once the gateway runs without the variable", () => {
  const m = fakeMachine({ pid: "4243" });
  fs.writeFileSync(m.token, "tok\n");
  m.environ("4243", "PATH=/usr/bin\0HOME=/h\0");
  const r = m.run(DELETE_TOKEN_SCRIPT, [UNIT]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(m.token));
  const stopped = fakeMachine({ pid: "0" });
  fs.writeFileSync(stopped.token, "tok\n");
  assert.equal(stopped.run(DELETE_TOKEN_SCRIPT, [UNIT]).status, 0);
  assert.ok(!fs.existsSync(stopped.token));
  assert.equal(stopped.run(DELETE_TOKEN_SCRIPT, ["x;y"]).status, 2);
});

test("probe reports the machine without printing the token", () => {
  const m = fakeMachine({ units: `${UNIT} hermes-gateway-b.service`, pid: "77" });
  assert.equal(m.run(SETUP_SCRIPT, [UNIT]).status, 0);
  m.environ("77", "HERMES_DASHBOARD_SESSION_TOKEN=file:x\0");
  const r = m.run(PROBE_SCRIPT);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes("tok-FAKE-456"));
  assert.deepEqual(parseProbe(r.stdout), {
    home: true, units: [UNIT, "hermes-gateway-b.service"], curl: "8.18.0", python3: true, token: true,
    dropins: [UNIT], runningEnv: { [UNIT]: true, "hermes-gateway-b.service": true },
  });
});

test("probe on a bare machine", () => {
  const m = fakeMachine({ units: "", python: false });
  fs.rmdirSync(path.join(m.home, ".hermes"));
  const p = parseProbe(m.run(PROBE_SCRIPT).stdout);
  assert.deepEqual(p, { home: false, units: [], curl: "8.18.0", python3: false, token: false, dropins: [], runningEnv: {} });
});

test("parseProbe reads every key", () => assert.deepEqual(parseProbe(
  "home=yes\nunit=hermes-gateway.service\ncurl=8.18.0\npython3=yes\ntoken=no\ndropin=hermes-gateway.service\nenv=hermes-gateway.service:no\n"),
  { home: true, units: ["hermes-gateway.service"], curl: "8.18.0", python3: true, token: false,
    dropins: ["hermes-gateway.service"], runningEnv: { "hermes-gateway.service": false } }));

test("curlOk", () => {
  assert.ok(curlOk("7.55.0")); assert.ok(curlOk("8.18.0")); assert.ok(!curlOk("7.54.1")); assert.ok(!curlOk(null));
  assert.ok(curlOk("7.88.1-DEV")); assert.ok(curlOk("10.0.0")); assert.ok(!curlOk("garbage"));
});

test("pickUnit", () => {
  assert.deepEqual(pickUnit(["hermes-gateway-x.service", "hermes-gateway.service"]), { unit: "hermes-gateway.service" });
  assert.deepEqual(pickUnit(["hermes-gateway-x.service"]), { unit: "hermes-gateway-x.service" });
  assert.deepEqual(pickUnit([]), { error: "none" });
  assert.deepEqual(pickUnit(["hermes-gateway-a.service", "hermes-gateway-b.service"]), { error: "several" });
});

test("accessState covers each state", () => {
  const gated = { auth_required: true };
  const open = { auth_required: false };
  const probe = (over = {}) => ({ home: true, units: [UNIT], curl: "8.18.0", python3: true, token: true, dropins: [], runningEnv: { [UNIT]: false }, ...over });
  const s = (status, p, statsCode) => accessState({ status, probe: p, statsCode });
  assert.deepEqual(s(null, null, 0), { state: "gateway_down", removalPending: false });
  assert.deepEqual(s(gated, null, 200), { state: "ok", removalPending: false });
  assert.deepEqual(s(gated, probe(), 200), { state: "ok", removalPending: false });
  assert.deepEqual(s(gated, probe({ home: false }), 401), { state: "wrong_user", removalPending: false });
  assert.deepEqual(s(gated, probe({ units: [] }), 401), { state: "wrong_user", removalPending: false });
  assert.deepEqual(s(gated, probe({ curl: "7.50.0" }), 401), { state: "curl_old", removalPending: false });
  assert.deepEqual(s(gated, probe({ token: false, python3: false }), 401), { state: "no_python", removalPending: false });
  assert.deepEqual(s(gated, probe({ dropins: [UNIT] }), 401), { state: "waiting_restart", removalPending: false });
  assert.deepEqual(s(gated, probe({ dropins: [UNIT], runningEnv: { [UNIT]: true } }), 401), { state: "token_rejected", removalPending: false });
  assert.deepEqual(s(gated, probe(), 401), { state: "needs_setup", removalPending: false });
  assert.deepEqual(s(gated, probe({ token: false }), 401), { state: "needs_setup", removalPending: false });
  assert.deepEqual(s(gated, null, 401), { state: "needs_setup", removalPending: false });
  assert.deepEqual(s(open, null, 401), { state: "open_rejected", removalPending: false });
  assert.deepEqual(s(open, probe(), 401), { state: "open_rejected", removalPending: false });
  assert.deepEqual(s(gated, probe({ runningEnv: { [UNIT]: true } }), 200), { state: "ok", removalPending: true });
  assert.deepEqual(s(gated, probe({ runningEnv: { [UNIT]: true } }), 401), { state: "needs_setup", removalPending: true });
});

test("scriptSpec and restartSpec bind to the machine", () => {
  assert.equal(scriptSpec("devbox", SETUP_SCRIPT, ["hermes-gateway.service"]).opts.on, "devbox");
  assert.deepEqual(scriptSpec("devbox", SETUP_SCRIPT, [UNIT], 5000), { cmd: "sh", args: ["-c", SETUP_SCRIPT, "sh", UNIT], opts: { on: "devbox", timeout: 5000 } });
  assert.deepEqual(restartSpec("labbox"), { cmd: "hermes", args: ["gateway", "restart"], opts: { on: "labbox", timeout: 600000 } });
});
