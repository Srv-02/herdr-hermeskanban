// Access to a gated Hermes instance: a key in ~/.hermes/dashboard.token and a systemd
// drop-in that hands it to the gateway as HERMES_DASHBOARD_SESSION_TOKEN=file:…. The scripts run on the machine with
// sh -c and get the unit name only as $1, checked against UNIT_RE there. They never print the key. HK_PROC (default
// /proc) is a hook for the tests only.
import { TOKEN_FILES } from "./request.js";

export const DROPIN_NAME = "herdr-kanban-token.conf";
export const DROPIN_TEXT = `# Written by the Herdr hermes-kanban mod. "Remove access" in its settings deletes this file.
[Service]
Environment="HERMES_DASHBOARD_SESSION_TOKEN=file:%h/${TOKEN_FILES.gated}"
`;
export const UNIT_RE = /^hermes-gateway[\w.@-]*\.service$/;

// The same check as UNIT_RE, in sh: prefix, suffix, and nothing outside [A-Za-z0-9_.@-].
const CHECK_UNIT = `unit=$1
case "$unit" in
  *[!A-Za-z0-9_.@-]*) exit 2 ;;
  hermes-gateway*.service) ;;
  *) exit 2 ;;
esac
key="$HOME/${TOKEN_FILES.gated}"
dir="$HOME/.config/systemd/user/$unit.d"
dropin="$dir/${DROPIN_NAME}"
`;

// The gateway's MainPID still carries the variable: exit code 0 when yes. Unreadable environ counts as yes.
const HAS_ENV = `has_env() {
  pid=$(systemctl --user show -p MainPID --value "$1" 2>/dev/null)
  case "$pid" in ''|0|*[!0-9]*) return 1 ;; esac
  environ="\${HK_PROC:-/proc}/$pid/environ"
  [ -r "$environ" ] || return 0
  tr '\\000' '\\n' < "$environ" | grep -q '^HERMES_DASHBOARD_SESSION_TOKEN='
}
`;

// The gateway runs, and its environ is not readable: has_env then says yes, and the probe says why (envhidden).
const ENV_HIDDEN = `env_hidden() {
  pid=$(systemctl --user show -p MainPID --value "$1" 2>/dev/null)
  case "$pid" in ''|0|*[!0-9]*) return 1 ;; esac
  [ ! -r "\${HK_PROC:-/proc}/$pid/environ" ]
}
`;

export const PROBE_SCRIPT = `${HAS_ENV}${ENV_HIDDEN}
if [ -d "$HOME/.hermes" ] && [ -r "$HOME/.hermes" ]; then echo home=yes; else echo home=no; fi
units=
for u in $(systemctl --user list-unit-files 'hermes-gateway*.service' --no-legend 2>/dev/null | awk '{ print $1 }'); do
  case "$u" in *[!A-Za-z0-9_.@-]*) continue ;; hermes-gateway*.service) units="$units $u"; echo "unit=$u" ;; esac
done
v=$(curl --version 2>/dev/null | awk 'NR == 1 { print $2 }')
[ -n "$v" ] && echo "curl=$v"
if command -v python3 >/dev/null 2>&1; then echo python3=yes; else echo python3=no; fi
if [ -s "$HOME/${TOKEN_FILES.gated}" ]; then echo token=yes; else echo token=no; fi
for u in $units; do
  [ -e "$HOME/.config/systemd/user/$u.d/${DROPIN_NAME}" ] && echo "dropin=$u"
  if has_env "$u"; then echo "env=$u:yes"; else echo "env=$u:no"; fi
  if env_hidden "$u"; then echo "envhidden=$u"; fi
done
exit 0
`;

export function parseProbe(stdout) {
  const p = { home: false, units: [], curl: null, python3: false, token: false, dropins: [], runningEnv: {}, envHidden: [] };
  for (const line of String(stdout ?? "").split("\n")) {
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq);
    const value = line.slice(eq + 1).trim();
    if (key === "home") p.home = value === "yes";
    else if (key === "unit" && UNIT_RE.test(value)) p.units.push(value);
    else if (key === "curl" && value) p.curl = value;
    else if (key === "python3") p.python3 = value === "yes";
    else if (key === "token") p.token = value === "yes";
    else if (key === "dropin" && UNIT_RE.test(value)) p.dropins.push(value);
    else if (key === "envhidden" && UNIT_RE.test(value)) p.envHidden.push(value);
    else if (key === "env") {
      const colon = value.lastIndexOf(":");
      const unit = value.slice(0, colon);
      if (colon > 0 && UNIT_RE.test(unit)) p.runningEnv[unit] = value.slice(colon + 1) === "yes";
    }
  }
  return p;
}

// -H @- needs curl 7.55.
export function curlOk(version) {
  const m = /^(\d+)\.(\d+)/.exec(version ?? "");
  if (!m) return false;
  const [major, minor] = [Number(m[1]), Number(m[2])];
  return major > 7 || (major === 7 && minor >= 55);
}

export function pickUnit(units) {
  if (units.includes("hermes-gateway.service")) return { unit: "hermes-gateway.service" };
  if (units.length === 1) return { unit: units[0] };
  return { error: units.length ? "several" : "none" };
}

// $1 unit. Creates the key only if missing (Hermes' own generator), writes the drop-in atomically, daemon-reload.
// Exit 2: bad unit name; 5: no ~/.hermes (exec runs as another user than the gateway); other: a step failed.
export const SETUP_SCRIPT = `set -eu
${CHECK_UNIT}umask 077
[ -d "$HOME/.hermes" ] || exit 5
if [ ! -s "$key" ]; then
  tmp=$(mktemp "$key.XXXXXX")
  if python3 -c "import secrets; print(secrets.token_urlsafe(32))" > "$tmp" && [ -s "$tmp" ]; then
    chmod 600 "$tmp"; mv "$tmp" "$key"
  else
    rm -f "$tmp"; exit 6
  fi
fi
mkdir -p "$dir"
tmp=$(mktemp "$dir/.${DROPIN_NAME}.XXXXXX")
cat > "$tmp" <<'HK_DROPIN'
${DROPIN_TEXT}HK_DROPIN
chmod 600 "$tmp"
mv "$tmp" "$dropin"
systemctl --user daemon-reload
`;

// $1 unit. Deletes the drop-in, daemon-reload. Never touches the key: the running gateway may still read it.
export const REMOVE_SCRIPT = `set -eu
${CHECK_UNIT}rm -f "$dropin"
rmdir "$dir" 2>/dev/null || true
systemctl --user daemon-reload
`;

// $1 unit. Deletes the key only when nothing points at it any more. Exit 3: the drop-in exists; 4: the running
// gateway still has the variable (it would exit when the file vanishes).
export const DELETE_TOKEN_SCRIPT = `${HAS_ENV}
${CHECK_UNIT}[ -e "$dropin" ] && exit 3
has_env "$unit" && exit 4
rm -f "$key"
`;

export function scriptSpec(machine, script, args, timeout = 30000) {
  return { cmd: "sh", args: ["-c", script, "sh", ...args], opts: { on: machine, timeout } };
}

// Drain-aware restart; only ever on an explicit click, the mod never restarts a gateway on its own.
export function restartSpec(machine) {
  return { cmd: "hermes", args: ["gateway", "restart"], opts: { on: machine, timeout: 600000 } };
}

// status: parsed /api/status or null; probe: parseProbe() or null (normal polling probes only on trouble);
// statsCode: HTTP code of GET /stats with the key (0 when curl got no answer).
export function accessState({ status, probe, statsCode }) {
  const picked = probe ? pickUnit(probe.units) : {};
  const unit = picked.unit;
  const removalPending = Boolean(unit && !probe.dropins.includes(unit) && probe.runningEnv[unit] === true);
  const out = (state) => ({ state, removalPending });
  if (!status) return out("gateway_down");
  if (statsCode === 200) return out("ok");
  if (probe && !probe.home) return out("wrong_user");
  if (probe && !curlOk(probe.curl)) return out("curl_old");
  if (status.auth_required !== true) return out("open_rejected");
  if (!probe) return out("needs_setup");
  if (!unit) return out("wrong_user");
  if (probe.dropins.includes(unit)) return out(probe.runningEnv[unit] ? "token_rejected" : "waiting_restart");
  if (!probe.token && !probe.python3) return out("no_python");
  return out("needs_setup");
}

// ---- the flow in the panel (access.js) and in the settings (settings.js) ----

// What "Set up access" does, shown before it runs, one line per step.
export const SETUP_STEPS = [
  `Create a key, only if it is missing: umask 077 and Hermes' own generator, python3 -c "import secrets; print(secrets.token_urlsafe(32))", into ~/${TOKEN_FILES.gated}.`,
  `Add a drop-in for the gateway's systemd unit, mode 0600, at ~/.config/systemd/user/<gateway unit>.d/${DROPIN_NAME} (the unit is found on the machine):\n${DROPIN_TEXT.trim()}`,
  "Run systemctl --user daemon-reload.",
  "No automatic restart: the gateway picks the key up only after you click \"Restart gateway\".",
  "Check that GET /api/plugins/kanban/stats with the key answers 200.",
];

// The state of access (accessState) in words, for the panel's empty state and the settings.
export const ACCESS_TEXT = {
  gateway_down: { title: "Gateway down", body: "The Hermes gateway on this machine does not answer. The board comes back when it runs again." },
  needs_setup: { title: "Access not set up", body: "This Hermes signs people in. Hermes Kanban needs a key of its own on this machine; the key never leaves it." },
  waiting_restart: { title: "Waiting for restart", body: "Restart the gateway to finish. Messaging pauses briefly, running turns finish first." },
  token_rejected: { title: "The gateway refuses the key", body: "The gateway runs with the key of Hermes Kanban and still answers 401. Remove access in the settings, then set it up again." },
  // Two causes end here: ~/.hermes not readable (exec runs as another user), or no single gateway unit.
  wrong_user: { title: "Can't set up access here", body: "Either herdr runs on this machine as another user than the Hermes gateway, or systemd lists no single gateway unit (none, or several hermes-gateway units). Hermes Kanban sets up access only for one gateway of its own user." },
  curl_old: { title: "curl is too old", body: "Hermes Kanban needs curl 7.55 or newer on this machine." },
  no_python: { title: "No python3 for the key", body: "Hermes Kanban makes its key with python3, and this machine has none. Install python3, then try again." },
  open_rejected: { title: "Hermes refused access", body: "This Hermes runs without sign-in. Hermes Kanban uses the web app's own token there, and the gateway refused it. There is nothing to set up for such an instance." },
};

// The button the panel offers for a state: "setup", "restart" or none. Only a gated instance gets either; an open
// one (no auth gate) needs no setup and no restart.
export function accessOffer({ state, mode }) {
  if (mode !== "gated") return null;
  return { needs_setup: "setup", waiting_restart: "restart" }[state] ?? null;
}

// The unit to set up, or why not: checked on a fresh probe before anything is written.
export function setupUnit(probe) {
  if (!probe) return { error: "Could not read the machine." };
  if (!probe.home) return { error: ACCESS_TEXT.wrong_user.body };
  if (!curlOk(probe.curl)) return { error: ACCESS_TEXT.curl_old.body };
  if (!probe.token && !probe.python3) return { error: ACCESS_TEXT.no_python.body };
  const picked = pickUnit(probe.units);
  return picked.unit ? { unit: picked.unit } : { error: ACCESS_TEXT.wrong_user.body };
}

// The next step of "Remove access", always in this order: the drop-in goes first, then the gateway restarts, and the
// key goes only once the running gateway has no variable and no drop-in points at it.
export function nextRemovalStep({ probe, unit }) {
  if (!probe || !unit) return "done";
  if (probe.dropins.includes(unit)) return "remove_dropin";
  if (probe.runningEnv[unit] !== false) return probe.token || probe.runningEnv[unit] === true ? "offer_restart" : "done";
  return probe.token ? "delete_token" : "done";
}

// The exit code of SETUP_SCRIPT, REMOVE_SCRIPT ("remove") or DELETE_TOKEN_SCRIPT ("delete_token") in words; null for 0.
export function scriptError(name, code) {
  if (code === 0) return null;
  if (code === 2) return "The gateway's unit name looks wrong; nothing was changed.";
  if (name === "setup" && code === 5) return "~/.hermes is not readable: herdr runs on this machine as another user than the gateway.";
  if (name === "setup" && code === 6) return "Could not make the key with python3.";
  if (name === "delete_token" && code === 3) return "The key stays: the drop-in still points at it.";
  if (name === "delete_token" && code === 4) return "The key stays: the running gateway still reads it. Restart the gateway first.";
  return `The step failed (exit ${code}).`;
}

// The restart of a gateway in flight, shared by the panel and the settings (shared "hermes-kanban.restarting",
// Record<machine, { at }>), so two clicks never run two restarts of one machine. A mark older than RESTART_MARK_MS
// (the restart's timeout plus the wait for the gateway) counts as gone: a view that died mid-restart cannot block it.
export const RESTART_MARK_MS = 12 * 60 * 1000;
export function restartRunning(marks, machine, now) {
  const at = marks?.[machine]?.at;
  return typeof at === "number" && now - at < RESTART_MARK_MS;
}
export function markRestart(marks, machine, now, on) {
  const out = { ...(marks && typeof marks === "object" ? marks : {}) };
  if (on) out[machine] = { at: now }; else delete out[machine];
  return out;
}

// Why "Remove access" stays at the restart: the probe cannot read the running gateway's environment.
export const ENV_HIDDEN_TEXT = "Hermes Kanban cannot read the running gateway's environment (/proc/<pid>/environ), so it cannot tell whether the gateway still uses the key. The key stays; once the gateway runs without the drop-in, delete ~/.hermes/dashboard.token by hand.";
