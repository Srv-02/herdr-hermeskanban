// Every call to a Hermes instance: curl on that machine, through exec(..., { on: machine }). The key never leaves the
// machine and never appears in a command line: the remote sh pipes the Authorization header from the key file into
// curl's stdin (`-H @-`), printf being a shell builtin and cat reading the file itself. Every variable value reaches
// the script as a positional parameter; no text from here is spliced into shell code.

export const PORT = 9120;
export const BASE = `http://127.0.0.1:${PORT}`;
export const KANBAN = "/api/plugins/kanban";
export const BOARD = "default";

// Relative to $HOME on the machine. gated: the key the gateway reads through the systemd drop-in (lib/setup.js);
// open: the browser token the web app writes itself when no auth gate is configured.
export const TOKEN_FILES = { gated: ".hermes/dashboard.token", open: ".hermes/webapp/session-token" };

export function withBoard(p) {
  return `${p}${p.includes("?") ? "&" : "?"}board=${BOARD}`;
}

// $1 mode (gated | open | none), $2 method, $3 URL, $4 JSON body (optional). Prints the body and, as the last line,
// the HTTP code.
export const REQUEST_SCRIPT = `mode=$1 method=$2 url=$3
case "$mode" in
  gated) key="$HOME/${TOKEN_FILES.gated}" ;;
  open) key="$HOME/${TOKEN_FILES.open}" ;;
  none) key= ;;
  *) echo "unknown mode" >&2; exit 2 ;;
esac
if [ "$#" -ge 4 ]; then
  body=$4
  set -- curl -sS --max-time 15 -X "$method" -w '\\n%{http_code}' -H 'Content-Type: application/json' --data-binary "$body"
else
  set -- curl -sS --max-time 15 -X "$method" -w '\\n%{http_code}'
fi
if [ -n "$key" ]; then
  { printf 'Authorization: Bearer '; cat "$key"; } | "$@" -H @- "$url"
else
  "$@" "$url" </dev/null
fi
`;

export function requestSpec(machine, { mode, method, url, body }) {
  const args = ["-c", REQUEST_SCRIPT, "sh", mode, method, url];
  if (body !== undefined) args.push(JSON.stringify(body));
  return { cmd: "sh", args, opts: { on: machine, timeout: 20000 } };
}

// code 0: curl did not get an HTTP answer (connection refused, timeout). json null: the body is not JSON.
export function parseResponse(result) {
  const out = result.stdout ?? "";
  const cut = out.lastIndexOf("\n");
  const code = Number(out.slice(cut + 1).trim());
  if (result.code !== 0 || !Number.isInteger(code) || code <= 0) {
    return { code: 0, json: null, error: (result.stderr ?? "").trim() || `curl exited with ${result.code}` };
  }
  const text = cut < 0 ? "" : out.slice(0, cut);
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { code, json, error: null };
}

// Output of commands run on the machine (stderr, the restart's log) may be shown to people; anything that looks like
// a key (token_urlsafe(32) gives 43 characters) is masked first, and a known key value always.
export function redactSecrets(text, known = []) {
  let out = String(text ?? "");
  for (const k of known) if (k) out = out.split(k).join("[redacted]");
  return out.replace(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/g, "[redacted]");
}
