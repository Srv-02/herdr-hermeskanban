#!/bin/sh
# A separate Herdr instance for the README screenshots, so the demo never runs in your own Herdr: own HERDR_APP_HOME
# (below tmp/ of this checkout, gitignored) and own core session (HC_SESSION). shoot.sh drives it end to end; the steps
# are here for manual use. Pattern: ghchecker scripts/screenshots/demo-instance.sh.
# Usage: scripts/screenshots/demo-instance.sh prepare|start|space|turn|quit|clean
#   prepare: create the demo folders tmp/devbox and tmp/labbox; copy the mod of this checkout into the instance home,
#            patched by demo-hook.mjs (in that copy only) to answer every call from the fake Hermes of demo/ and to see
#            the spaces devbox and labbox as those machines; write a layout with the panel shown and its tab bar button
#   start:   launch the window (macOS gives a new instance the focus once; nothing here raises or focuses it afterwards)
#   space:   open the spaces labbox and devbox (devbox last, so it has the focus), each with a neutral prompt
#   turn:    the notifications scene's turn: a task on labbox needs input from now on (demo/hermes.mjs)
#   quit:    close the instance and stop its core session
#   clean:   delete the demo folders, the instance home and the core session state
# WIN_W and WIN_H at prepare: the window size in points (default 1280 x 940); shoot.sh prepares one size per card.
# DEMO_SCENE at prepare: board (default), overlay or notifications (demo/hermes.mjs). The notifications scene also
# checks every 15 s and plays no sound.
# DEMO_UPDATE=1 at prepare: a made-up release 1.1.0 is "available" (the gold gear and box); otherwise up to date.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export HERDR_APP_HOME="$ROOT/tmp/shots-home"
export HC_SESSION=hkshots
DEMO="${DEMO_DIR:-$ROOT/tmp/shots-spaces}"
APP="${HERDR_APP:-/Applications/Herdr.app/Contents/MacOS/Herdr}"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/herdr-core/$HC_SESSION"

prepare() {
  [ ! -e "$DEMO" ] || { echo "$DEMO exists: run clean first (or set DEMO_DIR)" >&2; exit 1; }
  rm -rf "$HERDR_APP_HOME" "$STATE"
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
    // The notifications scene: a quick beat, so the turn shows within seconds, and no sound while shooting.
    if (process.env.DEMO_SCENE === "notifications") fs.writeFileSync(home + "/hermes-kanban.json", JSON.stringify({ poll_seconds: 15, sound: { needs_you: false } }, null, 2) + "\n");
  ' "${DEFAULT_LAYOUT:-$HOME/.config/herdr-app/layouts/main.json}" "$("${HERDR_APP_CLI:-herdr-app}" --version | awk '{print $NF}')"
  # The window size in points, read by the app when it starts.
  printf '{"state":"windowed","bounds":[60,30,%s,%s]}' "${WIN_W:-1280}" "${WIN_H:-940}" > "$HERDR_APP_HOME/window.json"
}

# space <name>: a space named like the machine it stands for, its terminal with a neutral prompt.
space() {
  herdr-app do space.new '{"name":"'"$1"'","folder":"'"$DEMO/$1"'","tab":"hermes","argv":["env","BASH_SILENCE_DEPRECATION_WARNING=1","PS1='"$1"' $ ","/bin/bash","--norc","--noprofile"]}'
}

case "${1:-}" in
  prepare) prepare ;;
  start) nohup "$APP" > "$ROOT/tmp/shots-app.log" 2>&1 & echo "started; HERDR_APP_HOME=$HERDR_APP_HOME HC_SESSION=$HC_SESSION" ;;
  space) space labbox; sleep 2; space devbox ;;
  turn) : > "$HERDR_APP_HOME/demo-turn" ;;
  quit) herdr-app do app.quit || true; sleep 2; hc server stop || true ;;
  clean) rm -rf "$DEMO" "$HERDR_APP_HOME" "$STATE" ;;
  *) echo "usage: $0 prepare|start|space|turn|quit|clean" >&2; exit 2 ;;
esac
