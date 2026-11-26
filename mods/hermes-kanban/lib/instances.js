// Which Hermes instances are visible, and which one the focus is on. Pure logic, no API calls.
// An instance is a machine (`hc machine ls`) with at least one open space; a Hermes on this computer is none.
import { needsYou } from "./changes.js";

const NONE = { machine: null, pane: null, hermes: false };

// Machines with at least one open space, sorted, without duplicates. This computer (machine null) never counts.
export const visibleMachines = (spaces) => [...new Set((spaces ?? []).map((s) => s.machine).filter((m) => m != null))].sort();

// A pane that runs Hermes: the app says so, or its program is Hermes.
export const isHermes = (pane) => pane?.app === "hermes" || pane?.program?.key === "hermes";

// A machine runs Hermes when the watcher's last poll found its board (hermes-kanban.boards: a snapshot with
// `hermes: true`). This computer (machine null) never counts.
export const hasHermes = (boards, machine) => machine != null && boards?.[machine]?.hermes === true;

// The focus as { machine, pane, hermes }. Detection is per machine: any pane on a machine that runs Hermes (a shell
// as well, a pane or a terminal block) is that machine's Hermes. Before the first poll knows the machine, a pane that
// runs Hermes itself counts too. A pane on this computer is "no Hermes". `pane` is the focused terminal pane's id (a
// terminal block without a pane: its address), for rememberPane; null without Hermes.
// A layout block of a mod has the keyboard (a click into this panel): no pane, no terminal, or a mod pane.
// Then the last focus stays, so the board does not vanish while its own panel is used.
// A terminal block has no pane: its address "<machine>/<id>" names the machine.
// Pattern: ghchecker lib/location.js.
export function focusedInstance({ spaces, panes, focused, boards }, last = null) {
  const f = focused;
  if (!f) return { ...NONE };
  const pane = f.pane ? (panes ?? []).find((p) => p.pane === f.pane) : null;
  if (last && ((!f.pane && !f.terminal) || (pane && !pane.terminal))) return last;
  let machine, terminal;
  if (f.pane === null) {
    machine = f.terminal?.includes("/") ? f.terminal.split("/")[0] : null;
    terminal = f.terminal ? (panes ?? []).find((p) => p.terminal === f.terminal) : null;
  } else {
    machine = (spaces ?? []).find((s) => s.id === f.space)?.machine ?? null;
    terminal = pane;
  }
  const hermes = machine != null &&
    (hasHermes(boards, machine) || isHermes(terminal) || (f.pane === null && f.agent === "hermes"));
  if (!hermes) return { machine, pane: null, hermes: false };
  return { machine, pane: terminal?.pane ?? f.pane ?? f.terminal ?? null, hermes: true };
}

// Where "go to this instance" lands: the terminal pane last focused there (if it is still in that machine's tabs),
// else its first pane that runs Hermes, else the first terminal pane, else the first pane (a mod pane) of any space
// on that machine. Null for a machine without open space or pane.
export function jumpTarget(machine, { spaces, panes }, lastPanes) {
  const tabs = new Set((spaces ?? []).filter((s) => s.machine === machine).flatMap((s) => (s.tabs ?? []).map((t) => t.id)));
  const here = (panes ?? []).filter((p) => tabs.has(p.tab));
  const remembered = here.find((p) => p.pane === lastPanes?.[machine] && p.terminal);
  const pick = remembered ?? here.find(isHermes) ?? here.find((p) => p.terminal) ?? here[0];
  return pick ? { pane: pick.pane } : null;
}

// A new map with the focused terminal pane remembered per machine that runs Hermes (a shell pane there as well).
// Anything but a Hermes focus changes nothing, and so does a focus whose id is no terminal pane in `panes`: a layout
// terminal block without a pane is named by its terminal address, which pane.focus {pane} would not find.
export function rememberPane(lastPanes, focus, panes) {
  if (!focus?.hermes || focus.machine == null || !focus.pane) return lastPanes;
  if (!(panes ?? []).some((p) => p.pane === focus.pane && p.terminal)) return lastPanes;
  if (lastPanes?.[focus.machine] === focus.pane) return lastPanes;
  return { ...lastPanes, [focus.machine]: focus.pane };
}

// What a click on the tab bar button does. Another visible instance with an unseen needs-you event (the first by name;
// as the strips: all but the one the panel shows): jump there. Else on a Hermes focus (a pane on a machine that runs
// Hermes): toggle the panel. Else only a
// shown panel closes; a hidden one stays hidden (the button is off).
export function buttonAction({ focus, machines, unseen, on }) {
  const shown = focus?.hermes ? focus.machine : null;
  const machine = (machines ?? []).find((m) => m !== shown && needsYou(unseen, m));
  if (machine) return { kind: "jump", machine };
  if (focus?.hermes) return { kind: "toggle" };
  return { kind: on ? "close" : "off" };
}
