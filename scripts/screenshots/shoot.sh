#!/bin/bash
# Re-creates every README image end to end with one command: for each card, prepare the demo instance (demo-instance.sh, with
# the fake Hermes of demo/ patched into the instance's copy of the mod only) at the window size of that card, launch it, set each
# state through the mod's own commands (herdr-app do hermes-kanban.<command>, the ones keys.json can bind), take the shots with
# `herdr-app shot`, quit and clean the instance, then crop and render the cards with headless Edge. No mouse, no keyboard, no
# focus change: the one focus a new window takes on launch is macOS's own. Needs: macOS, Herdr.app, Microsoft Edge, node, sips.
# Pattern: ghchecker scripts/screenshots/shoot.sh.
# Usage: shoot.sh [card ...]   (hero board overlay notifications settings; none = all)
# CROP_ONLY=1 skips the instance and re-crops and renders from the raw shots in tmp/shots-raw.
#
# Sizes: every window is W = 860 points wide (1720 pixels at 2x, panel 446 points, app zoom 1). Its height H sets the panel
# height (2H - 176 pixels): H is chosen per card so the panel shows its rows down to the status bar (one row is 46 points, a
# group heading 32). Every card is 2044 px wide (1022 CSS pixels at 2x) like the hero (2044 x 1144), its panel, overlay or
# dialog centered at its own size. Change the fixtures in
# demo/hermes.mjs and the rows move: adjust H_* and look at every card again.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
S="$ROOT/scripts/screenshots"
RAW="$ROOT/tmp/shots-raw"
export HERDR_APP_HOME="$ROOT/tmp/shots-home" HC_SESSION=hkshots
W=860
# The board: header 42, filter bar 39, 4 headings and 7 rows (458 with the list's padding), status bar 30, plus 88 around
# the panel. The notifications add the 32 points of the "labbox needs you" strip.
H_HERO=600 H_BOARD=657 H_NOTIFY=689
# The overlay and the dialog get windows of their own: the task overlay is 0.9 H tall, the settings dialog 0.9 H.
H_OVERLAY=896 H_DIALOG=940
# Boxes in raw pixels "y x width height", measured on the raw shots: the Hermes button at the right end of the tab bar, the
# task overlay and the settings dialog. Check them on tmp/shots-raw/*.png after a new layout.
BUTTON_BOX="12 1542 160 58"
OVERLAY_BOX="90 104 1512 1612"
DIALOG_BOX="95 241 1238 1690"
CARDS="hero board overlay notifications settings"
ONLY="$*"
for w in $ONLY; do
  case " $CARDS " in *" $w "*) ;; *) echo "unknown card: $w (one of: $CARDS)" >&2; exit 2 ;; esac
done
want() { [ -z "$ONLY" ] && return 0; for w in $ONLY; do [ "$w" = "$1" ] && return 0; done; return 1; }
inst() { "$S/demo-instance.sh" "$@"; }
cleanup() { inst quit >/dev/null 2>&1 || true; inst clean >/dev/null 2>&1 || true; }
do_() { herdr-app do "$@" > /dev/null; }
shot() { herdr-app shot "$RAW/$1.png" > /dev/null; }
# scene <H> [board|overlay|notifications]: a fresh instance with a window of W x H points, the demo spaces open (devbox
# focused) and the panel shown.
scene() {
  cleanup
  WIN_W=$W WIN_H="$1" DEMO_SCENE="${2:-board}" inst prepare
  # A launch right after the last quit sometimes never opens its window: then launch once more.
  for try in 1 2; do
    inst start > /dev/null
    for _ in $(seq 1 40); do herdr-app status > /dev/null 2>&1 && break; sleep 1; done
    herdr-app status > /dev/null 2>&1 && break
    [ "$try" = 2 ] && { echo "the demo instance did not start" >&2; exit 1; }
    inst quit > /dev/null 2>&1 || true; sleep 3
  done
  sleep 4
  herdr-app shot "$RAW/probe.png" > /dev/null
  [ "$(sips -g pixelWidth "$RAW/probe.png" | awk '/pixelWidth/ {print $2}')" = $((2 * W)) ] || { echo "the window is not $((2 * W)) pixels wide: shoot on a Retina display" >&2; exit 1; }
  rm -f "$RAW/probe.png"
  inst space > /dev/null
  sleep 5
  do_ layout.show '{"id":"panel"}'
  # The watcher's first pass (5 s beat) reads both boards; the panel then draws devbox.
  sleep 8
}

if [ "${CROP_ONLY:-0}" != 1 ]; then
trap cleanup EXIT
mkdir -p "$RAW"
# Hero and board: the open tasks of devbox grouped by status, newest first.
if want hero; then scene $H_HERO; shot hero; fi
if want board; then scene $H_BOARD; shot board; fi
# Overlay: the first row, the blocked release notes, in its overlay (the scene leaves out the ready and running tasks).
if want overlay; then scene $H_OVERLAY overlay; do_ hermes-kanban.open; sleep 5; shot overlay; fi
# Notifications: after the baseline, a task on labbox needs input: the red strip in the panel of devbox and the red dot on
# the button. No toast in any image: the scene turns the toasts off (demo-instance.sh).
if want notifications; then
  scene $H_NOTIFY notifications
  rm -f "$HERDR_APP_HOME/demo-turned"
  inst turn
  for _ in $(seq 1 40); do [ -f "$HERDR_APP_HOME/demo-turned" ] && break; sleep 1; done
  [ -f "$HERDR_APP_HOME/demo-turned" ] || { echo "the watcher never read the turned board of labbox" >&2; exit 1; }
  sleep 2
  shot notifications
fi
# Settings: the dialog for devbox in a window tall enough for all of it.
if want settings; then scene $H_DIALOG; do_ hermes-kanban.settings; sleep 4; shot settings-dialog; fi
cleanup
trap - EXIT
echo "shots done, instance closed and cleaned"
fi

# Crop (raw pixels of a window 1720 pixels wide)
C="$S/cards"
# panel <raw> <H> <out>: the whole panel, from its top border to below its status bar.
panel() { sips -c $((2 * $2 - 176)) 888 --cropOffset 102 $((2 * W - 907)) "$RAW/$1.png" --out "$C/$3.png" > /dev/null; }
# box <raw> <y> <x> <width> <height> <out>
box() { sips -c "$5" "$4" --cropOffset "$2" "$3" "$RAW/$1.png" --out "$C/$6.png" > /dev/null; }
# render <card.html> <out.png> <width> <height>: one card at 2x.
render() { "$S/render.sh" "$C/$1.html" "$2" "$3" "$4" > /dev/null; }
mkdir -p "$ROOT/screenshots"
# The hero: 1022 x 572, as Filer Pro's and GitHub Checker's.
# The hero panel ends after its last whole row (Mirror the docs) and joins the status bar; the card stacks both. sips
# ignores a crop offset of 0 and one that reaches the last row, so a crop starts at row 1 and ends one row early.
if want hero && [ -f "$RAW/hero.png" ]; then
  panel hero $H_HERO hero-panel
  sips -c 920 888 --cropOffset 1 0 "$C/hero-panel.png" --out "$C/hero-panel-top.png" > /dev/null
  sips -c 60 888 --cropOffset $((2 * H_HERO - 237)) 0 "$C/hero-panel.png" --out "$C/hero-panel-foot.png" > /dev/null
  render hero "$ROOT/preview.png" 1022 572
fi
# The feature cards: as wide as the hero, each shot at its own size (2x) with 60 above and below; a panel card is H + 32 tall.
if want board && [ -f "$RAW/board.png" ]; then panel board $H_BOARD board-panel; render board "$ROOT/screenshots/board.png" 1022 $((H_BOARD + 32)); fi
if want overlay && [ -f "$RAW/overlay.png" ]; then
  # The whole task overlay, down to its comment box.
  # shellcheck disable=SC2086
  box overlay $OVERLAY_BOX overlay; render overlay "$ROOT/screenshots/overlay.png" 1022 926
fi
if want notifications && [ -f "$RAW/notifications.png" ]; then
  panel notifications $H_NOTIFY notifications-panel
  # shellcheck disable=SC2086
  box notifications $BUTTON_BOX notifications-button
  render notifications "$ROOT/screenshots/notifications.png" 1022 $((H_NOTIFY + 32))
fi
if want settings && [ -f "$RAW/settings-dialog.png" ]; then
  # shellcheck disable=SC2086
  box settings-dialog $DIALOG_BOX settings-dialog; render settings "$ROOT/screenshots/settings.png" 1022 965
fi
echo "rendered into screenshots/ and preview.png. Look at every image before you commit it: no user name, no real path, no real host."
