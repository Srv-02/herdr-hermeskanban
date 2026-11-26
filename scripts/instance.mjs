// Runs the mod's setup steps against one Hermes instance from the command line, with the same scripts the mod uses:
//   node scripts/instance.mjs <probe|setup|status|verify|restart|remove|delete-token> <machine> [--confirm]
// Every step goes through `hc exec --on <machine>`. Nothing here prints the key: probe reports only yes/no, verify
// only the HTTP code and the top-level keys of the answer. restart refuses without --confirm.
import { spawnSync } from "node:child_process";
import { BASE, KANBAN, parseResponse, redactSecrets, requestSpec, withBoard } from "../mods/hermes-kanban/lib/request.js";
import { DELETE_TOKEN_SCRIPT, PROBE_SCRIPT, REMOVE_SCRIPT, SETUP_SCRIPT, curlOk, parseProbe, pickUnit, restartSpec, scriptSpec } from "../mods/hermes-kanban/lib/setup.js";

const [command, machine, ...flags] = process.argv.slice(2);
const COMMANDS = ["probe", "setup", "status", "verify", "restart", "remove", "delete-token"];
if (!COMMANDS.includes(command) || !machine) {
  console.error(`usage: node scripts/instance.mjs <${COMMANDS.join("|")}> <machine> [--confirm]`);
  process.exit(64);
}

// hc exec --json returns stdout and stderr base64-encoded; this hands back herdr's ExecResult shape.
function run({ cmd, args, opts }) {
  const seconds = String(Math.min(600, Math.ceil((opts.timeout ?? 30000) / 1000)));
  const r = spawnSync("hc", ["exec", "--json", "--on", opts.on, "--timeout", seconds, "--", cmd, ...args], { encoding: "utf8", maxBuffer: 16 << 20 });
  if (r.error) throw new Error(`could not run hc: ${r.error.code === "ENOENT" ? "hc is not installed or not on PATH" : r.error.message}`);
  if (r.status !== 0) throw new Error(`hc exec failed (${r.status}): ${redactSecrets(r.stderr.trim())}`);
  const j = JSON.parse(r.stdout);
  const text = (b) => Buffer.from(b ?? "", "base64").toString("utf8");
  if (j.timed_out) throw new Error("timed out");
  return { code: j.code, stdout: text(j.stdout), stderr: text(j.stderr) };
}

// Everything printed goes through redactSecrets: command output from the machine is never trusted to be key-free.
const print = (v) => console.log(redactSecrets(JSON.stringify(v, null, 2)));
const probe = () => parseProbe(run(scriptSpec(machine, PROBE_SCRIPT, [])).stdout);

function unitOf(p) {
  const picked = pickUnit(p.units);
  if (picked.error) throw new Error(`no single gateway unit (${picked.error}): ${p.units.join(", ") || "none"}`);
  return picked.unit;
}

function script(name, src, unit) {
  const r = run(scriptSpec(machine, src, [unit]));
  print({ step: name, unit, exit: r.code, stderr: r.stderr.trim() || undefined });
  return r.code;
}

const steps = {
  probe: () => print(probe()),
  setup: () => {
    const p = probe();
    if (!p.home) throw new Error("~/.hermes is not readable for the exec user");
    if (!curlOk(p.curl)) throw new Error(`curl ${p.curl ?? "missing"}, need 7.55 or newer`);
    if (!p.token && !p.python3) throw new Error("no key yet and no python3 to make one");
    return script("setup", SETUP_SCRIPT, unitOf(p));
  },
  status: () => {
    const r = parseResponse(run(requestSpec(machine, { mode: "none", method: "GET", url: BASE + "/api/status" })));
    const s = r.json ?? {};
    print({ http: r.code, error: r.error ?? undefined, version: s.version, gateway_running: s.gateway_running, gateway_state: s.gateway_state, auth_required: s.auth_required, auth_providers: s.auth_providers });
  },
  verify: () => {
    const r = parseResponse(run(requestSpec(machine, { mode: "gated", method: "GET", url: withBoard(BASE + KANBAN + "/stats") })));
    print({ http: r.code, error: r.error ?? undefined, keys: r.json && typeof r.json === "object" ? Object.keys(r.json) : null });
    return r.code === 200 ? 0 : 1;
  },
  restart: () => {
    if (!flags.includes("--confirm")) throw new Error("restart pauses the gateway; pass --confirm once that is agreed");
    const r = run(restartSpec(machine));
    print({ step: "restart", exit: r.code, stdout: r.stdout.trim().split("\n").slice(-10), stderr: r.stderr.trim().split("\n").slice(-10) });
    return r.code;
  },
  remove: () => script("remove", REMOVE_SCRIPT, unitOf(probe())),
  "delete-token": () => {
    const code = script("delete-token", DELETE_TOKEN_SCRIPT, unitOf(probe()));
    if (code === 3) console.error("refused: the drop-in still exists; run remove first");
    if (code === 4) console.error("refused: the running gateway still has the variable; restart it first");
    return code;
  },
};

try {
  process.exit(steps[command]() || 0);
} catch (e) {
  console.error(redactSecrets(`${command}: ${e.message}`));
  process.exit(1);
}
