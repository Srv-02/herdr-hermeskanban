#!/bin/sh
# A separate Herdr instance for the README screenshots, so the demo never runs in your own Herdr: own HERDR_APP_HOME
# (below tmp/ of this checkout, gitignored) and own core session (HC_SESSION). shoot.sh drives it end to end; the steps
# are here for manual use. Pattern: ghchecker scripts/screenshots/demo-instance.sh.
# Usage: scripts/screenshots/demo-instance.sh prepare|start|space|turn|quit|clean|guard <path>
#   prepare: create the demo folders tmp/devbox and tmp/labbox; copy the mod of this checkout into the instance home,
#            patched by demo-hook.mjs (in that copy only) to answer every call from the fake Hermes of demo/ and to see
#            the spaces devbox and labbox as those machines; write a layout with the panel shown and its tab bar button
#   start:   launch the window (macOS gives a new instance the focus once; nothing here raises or focuses it afterwards)
#   space:   open the spaces labbox and devbox (devbox last, so it has the focus), each with a neutral prompt
#   turn:    the notifications scene's turn: a task on labbox needs input from now on (demo/hermes.mjs)
#   quit:    close the instance and stop its core session
#   clean:   delete the demo folders, the instance home and the core session state
#   guard <path>: exit 0 when clean may delete <path>, else 1 (deletes nothing; for the tests)
# Every path this script deletes is fixed: below tmp/ of this checkout, or the core state of the session hkshots. No
# environment variable picks one, and remove() refuses anything else.
# WIN_W and WIN_H at prepare: the window size in points (default 1280 x 940); shoot.sh prepares one size per card.
# DEMO_SCENE at prepare: board (default), overlay or notifications (demo/hermes.mjs). The notifications scene also
# checks every 15 s and shows no toast and plays no sound (the strip and the dot stay).
# DEMO_UPDATE=1 at prepare: a made-up release 1.1.0 is "available" (the gold gear and box); otherwise up to date.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export HERDR_APP_HOME="$ROOT/tmp/shots-home"
export HC_SESSION=hkshots
DEMO="$ROOT/tmp/shots-spaces"
APP="${HERDR_APP:-/Applications/Herdr.app/Contents/MacOS/Herdr}"
# The core state of the session, where herdr-core keeps it (herdr-config docs/lokal-testen.md).
STATE="$HOME/.local/state/herdr-core/hkshots"

# allowed <path>: a path strictly below $ROOT/tmp/ without "..", or the core state of hkshots.
allowed() {
  case "$1" in *..*) return 1 ;; esac
  [ "$1" = "$STATE" ] && return 0
  case "$1" in "$ROOT/tmp/"?*) return 0 ;; esac
  return 1
}
# remove <path>...: rm -rf, only for allowed paths; anything else stops the script.
remove() {
  for p in "$@"; do
    allowed "$p" || { echo "demo-instance.sh: refusing to delete $p" >&2; exit 1; }
  done
  rm -rf -- "$@"
}

prepare() {
  [ ! -e "$DEMO" ] || { echo "$DEMO exists: run clean first" >&2; exit 1; }
  remove "$HERDR_APP_HOME" "$STATE"
  mkdir -p "$HERDR_APP_HOME/mods" "$HERDR_APP_HOME/layouts" "$ROOT/tmp/shots-raw" "$DEMO/devbox" "$DEMO/labbox"
  cp -R "$ROOT/mods/hermes-kanban" "$HERDR_APP_HOME/mods/hermes-kanban"
  DEMO_STATE="$HERDR_APP_HOME" node "$ROOT/scripts/screenshots/demo-hook.mjs" "$HERDR_APP_HOME/mods/hermes-kanban" > /dev/null
  # The default layout of your Herdr (read only) with the panel as the first child of panel-body, shown from the start,
  # and the Hermes button beside the tabs.
  node -e '
    const fs = require("fs"), home = process.env.HERDR_APP_HOME;
    const src = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const find = (n, id) => n.id === id ? n : (n.children || []).map((c) => find(c, id)).find(Boolean);
    const parent = (n, id) => (n.children || []).some((c) => c.id === id) ? n : (n.children || []).map((c) => parent(c, id)).find(Boolean);
    const panel = find(src, "panel"), body = find(src, "panel-body"), bar = parent(src, "tabs");
    delete panel.hidden;
    panel.size = { px: Number(process.env.PANEL_PX || 446) };
    body.active = "hermes-kanban";
    body.children.unshift({ id: "hermes-kanban", type: "block", content: { mod: "hermes-kanban" } });
    const tabs = bar.children.findIndex((c) => c.id === "tabs");
    bar.children[tabs] = { id: "tab-bar", type: "row", size: { px: 42 }, resizable: false, children: [
      { ...bar.children[tabs], size: undefined },
      { id: "hermes-kanban-button", type: "block", content: { mod: "hermes-kanban", props: { button: true } }, size: { px: 92 }, window_drag: true },
    ] };
    fs.writeFileSync(home + "/layouts/demo.json", JSON.stringify(src, null, 2));
    // A new instance opens the welcome screen and the what-is-new window: pre-seed both as done.
    // The update check counts as done today (the hooked copy asks GitHub nothing anyway): up to date, or with
    // DEMO_UPDATE=1 a made-up newer release (the gold gear and box).
    const local = JSON.parse(fs.readFileSync(home + "/mods/hermes-kanban/mod.json", "utf8")).version;
    const update = { at: Date.now(), local, latest: process.env.DEMO_UPDATE === "1" ? "v1.1.0" : "v" + local };
    fs.writeFileSync(home + "/shared.json", JSON.stringify({ layout: "demo", "frame.welcomed": "finished", "workspace.panels": ["files", "changes", "hermes-kanban"], "hermes-kanban.update": update }));
    fs.writeFileSync(home + "/update-notes.json", JSON.stringify({ last_run: process.argv[2], presented: [] }));
    // The notifications scene: a quick beat, so the turn shows within seconds; no toast (no image shows one) and no sound.
    if (process.env.DEMO_SCENE === "notifications") fs.writeFileSync(home + "/hermes-kanban.json", JSON.stringify({ poll_seconds: 15, toast: { needs_you: false }, sound: { needs_you: false } }, null, 2) + "\n");
  ' "${DEFAULT_LAYOUT:-$HOME/.config/herdr-app/layouts/main.json}" "$("${HERDR_APP_CLI:-herdr-app}" --version | awk '{print $NF}')"
  # The window size in points, read by the app when it starts.
  printf '{"state":"windowed","bounds":[60,30,%s,%s]}' "${WIN_W:-1280}" "${WIN_H:-940}" > "$HERDR_APP_HOME/window.json"
}

# space <name>: a space named like the machine it stands for, its terminal with a neutral prompt.
space() {
  herdr-app do space.new "$(node -e '
    const [name, folder] = process.argv.slice(1);
    process.stdout.write(JSON.stringify({ name, folder, tab: "hermes",
      argv: ["env", "BASH_SILENCE_DEPRECATION_WARNING=1", `PS1=${name} $ `, "/bin/bash", "--norc", "--noprofile"] }));
  ' "$1" "$DEMO/$1")"
}

# The PIDs of the Herdr app whose environment holds exactly HERDR_APP_HOME=<this instance's home>; no other instance.
ours() {
  for p in $(pgrep -f "Herdr.app/Contents/MacOS/Herdr" || true); do
    ps eww -o command= -p "$p" 2>/dev/null | tr ' ' '\n' | grep -qxF "HERDR_APP_HOME=$HERDR_APP_HOME" && echo "$p"
  done
  return 0
}
# quit: app.quit; if the instance still runs after that, kill it by its PID (with a warning), then stop its core.
quit() {
  herdr-app do app.quit > /dev/null 2>&1 || true
  for _ in 1 2 3 4 5; do [ -z "$(ours)" ] && break; sleep 1; done
  left="$(ours)"
  if [ -n "$left" ]; then
    echo "demo-instance.sh: the instance did not quit, killing PID $left" >&2
    # shellcheck disable=SC2086
    kill $left 2>/dev/null || true
    sleep 2
  fi
  hc server stop || true
}

case "${1:-}" in
  prepare) prepare ;;
  start) nohup "$APP" > "$ROOT/tmp/shots-app.log" 2>&1 & echo "started; HERDR_APP_HOME=$HERDR_APP_HOME HC_SESSION=$HC_SESSION" ;;
  space) space labbox; sleep 2; space devbox ;;
  turn) : > "$HERDR_APP_HOME/demo-turn" ;;
  quit) quit ;;
  clean) remove "$DEMO" "$HERDR_APP_HOME" "$STATE" ;;
  guard) allowed "${2:-}" ;;
  *) echo "usage: $0 prepare|start|space|turn|quit|clean|guard <path>" >&2; exit 2 ;;
esac
