import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { mkTmpSync } from "./tmp-helper.js";
import { BASE, BOARD, KANBAN, PORT, REQUEST_SCRIPT, TOKEN_FILES, parseResponse, redactSecrets, requestSpec, withBoard } from "../mods/hermes-kanban/lib/request.js";

// A fake machine: HOME with token files, and a curl on PATH that logs its argv (NUL-separated) and its stdin.
function fakeMachine() {
  const home = mkTmpSync("request-");
  fs.mkdirSync(path.join(home, ".hermes/webapp"), { recursive: true });
  fs.writeFileSync(path.join(home, ".hermes/dashboard.token"), "tok-FAKE-123\n");
  fs.writeFileSync(path.join(home, ".hermes/webapp/session-token"), "tok-OPEN-789\n");
  const bin = path.join(home, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "curl"), '#!/bin/sh\nprintf \'%s\\0\' "$@" > "$LOGDIR/argv.log"\ncat > "$LOGDIR/stdin.log"\nprintf \'{"ok":true}\\n200\'\n', { mode: 0o755 });
  return { home, bin };
}

function run(m, args) {
  const r = spawnSync("sh", ["-c", REQUEST_SCRIPT, "sh", ...args], {
    cwd: m.home, input: "", encoding: "utf8",
    env: { HOME: m.home, PATH: `${m.bin}:/usr/bin:/bin`, LOGDIR: m.home },
  });
  const argv = fs.readFileSync(path.join(m.home, "argv.log"), "utf8").split("\0").slice(0, -1);
  const stdin = fs.readFileSync(path.join(m.home, "stdin.log"), "utf8");
  return { r, argv, stdin };
}

test("constants", () => {
  assert.equal(PORT, 9120);
  assert.equal(BASE, "http://127.0.0.1:9120");
  assert.equal(KANBAN, "/api/plugins/kanban");
  assert.equal(BOARD, "default");
  assert.deepEqual(TOKEN_FILES, { gated: ".hermes/dashboard.token", open: ".hermes/webapp/session-token" });
});

test("withBoard adds board=default", () => {
  assert.equal(withBoard("/board"), "/board?board=default");
  assert.equal(withBoard("/tasks/t_a1b2?x=1"), "/tasks/t_a1b2?x=1&board=default");
});

test("requestSpec binds to the given machine and keeps the token out of argv", () => {
  const s = requestSpec("devbox", { mode: "gated", method: "GET", url: BASE + KANBAN + "/stats?board=default" });
  assert.equal(s.opts.on, "devbox"); assert.equal(s.cmd, "sh"); assert.equal(s.args[1], REQUEST_SCRIPT);
  assert.equal(s.opts.timeout, 20000);
  assert.deepEqual(s.args, ["-c", REQUEST_SCRIPT, "sh", "gated", "GET", BASE + KANBAN + "/stats?board=default"]);
  assert.ok(!s.args.some((a) => /Bearer|dashboard\.token/.test(a) && a !== REQUEST_SCRIPT));
  assert.doesNotMatch(REQUEST_SCRIPT, /\$\(\s*cat|`cat/); // keine Kommandosubstitution des Schlüssels
});

test("requestSpec stringifies the body into argument 6", () => {
  const s = requestSpec("labbox", { mode: "gated", method: "POST", url: BASE + KANBAN + "/tasks?board=default", body: { title: "x" } });
  assert.equal(s.opts.on, "labbox");
  assert.equal(s.args[6], '{"title":"x"}');
});

test("request script sends the token on stdin, never in curl's argv", () => {
  const m = fakeMachine();
  const { r, argv, stdin } = run(m, ["gated", "GET", BASE + KANBAN + "/stats?board=default"]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!argv.join(" ").includes("tok-FAKE-123"));
  assert.equal(stdin, "Authorization: Bearer tok-FAKE-123\n");
  assert.ok(argv.includes("-H") && argv[argv.indexOf("@-") - 1] === "-H");
  assert.equal(argv[argv.indexOf("-X") + 1], "GET");
  assert.ok(argv.includes(BASE + KANBAN + "/stats?board=default"));
  assert.ok(!argv.includes("--data-binary"));
  assert.equal(r.stdout, '{"ok":true}\n200');
});

test("request script uses the browser token in open mode", () => {
  const m = fakeMachine();
  const { stdin, argv } = run(m, ["open", "GET", BASE + KANBAN + "/board?board=default"]);
  assert.equal(stdin, "Authorization: Bearer tok-OPEN-789\n");
  assert.ok(!argv.join(" ").includes("tok-OPEN-789"));
});

test("request script passes a hostile body through unchanged", () => {
  const m = fakeMachine();
  const body = { body: "it's \"$(touch pwned)\" `id`\nline2 😀" };
  const s = requestSpec("devbox", { mode: "gated", method: "POST", url: BASE + KANBAN + "/tasks/t_a1b2/comments?board=default", body });
  const { r, argv } = run(m, s.args.slice(3));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(argv[argv.indexOf("--data-binary") + 1], JSON.stringify(body));
  assert.ok(argv.includes("Content-Type: application/json"));
  assert.equal(argv[argv.indexOf("-X") + 1], "POST");
  assert.ok(!fs.existsSync(path.join(m.home, "pwned")));
});

test("mode none sends no Authorization header", () => {
  const m = fakeMachine();
  const { r, argv, stdin } = run(m, ["none", "GET", BASE + "/api/status"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(stdin, "");
  assert.ok(!argv.includes("@-"));
  assert.ok(!argv.some((a) => /Authorization/i.test(a)));
});

test("request script rejects an unknown mode", () => {
  const m = fakeMachine();
  const r = spawnSync("sh", ["-c", REQUEST_SCRIPT, "sh", "bogus", "GET", BASE + "/api/status"], {
    cwd: m.home, input: "", encoding: "utf8", env: { HOME: m.home, PATH: `${m.bin}:/usr/bin:/bin`, LOGDIR: m.home },
  });
  assert.equal(r.status, 2);
  assert.ok(!fs.existsSync(path.join(m.home, "argv.log")));
});

test("parseResponse: JSON, HTTP code in the last line", () => {
  assert.deepEqual(parseResponse({ code: 0, stdout: '{"a":1}\n200', stderr: "" }), { code: 200, json: { a: 1 }, error: null });
});

test("parseResponse handles non-JSON, empty output and curl failure", () => {
  assert.equal(parseResponse({ code: 0, stdout: "<html>Bad Gateway</html>\n502", stderr: "" }).json, null);
  assert.equal(parseResponse({ code: 0, stdout: "<html>Bad Gateway</html>\n502", stderr: "" }).code, 502);
  assert.deepEqual(parseResponse({ code: 0, stdout: "\n401", stderr: "" }), { code: 401, json: null, error: null });
  assert.equal(parseResponse({ code: 0, stdout: "", stderr: "" }).code, 0);
  assert.equal(parseResponse({ code: 7, stdout: "", stderr: "curl: (7) Failed to connect" }).code, 0);
  assert.match(parseResponse({ code: 7, stdout: "", stderr: "curl: (7) Failed to connect" }).error, /connect/);
  assert.equal(parseResponse({ code: 7, stdout: "\n000", stderr: "curl: (7) Failed to connect" }).code, 0);
});

test("redactSecrets masks key-like strings and known values", () => {
  const key = "Ab3_-".repeat(8) + "xyz"; // 43 characters, like token_urlsafe(32)
  assert.equal(redactSecrets(`token=${key} done`), "token=[redacted] done");
  assert.equal(redactSecrets(`url ?t=${key}&x=1`), "url ?t=[redacted]&x=1");
  assert.equal(redactSecrets("short tok-FAKE-123 stays", ["tok-FAKE-123"]), "short [redacted] stays");
  assert.equal(redactSecrets("Restarting hermes-gateway.service ... done (pid 4242)"), "Restarting hermes-gateway.service ... done (pid 4242)");
  assert.equal(redactSecrets(null), "");
});
