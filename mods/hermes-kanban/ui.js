// Shared pieces of the panel, its button and its overlays: theme colors for the states, alpha tints, icons, the
// segmented control, buttons, the status pill, the priority chip and the blankslate.
// Adapted from ghchecker by Michael Mayer (MIT), mods/ghchecker/ui.js; segmented control and blankslate there come
// from herdr-github by alarboulletmarin (MIT), mods/github/ui.js at 75a2b40. Only what this mod draws so far.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec } from "herdr";
import { NEEDS_YOU } from "./lib/view.js";
import { safeLink } from "./lib/text.js";

const CLEAR = "#00000000";
// The one color not taken from the theme: the gold of an available update (the Settings button and the dialog's box).
export const GOLD = "#f0c85a";

// Tone (lib/changes.js dotOf, lib/view.js hintOf, the status colors) to a color of the theme: ANSI red, green,
// yellow, blue and magenta, so every theme, light or dark, draws the states in its own palette. ANSI has no orange:
// bright yellow stands in.
export function tones(t) {
  const red = t.ansi1 ?? t.blocked, green = t.ansi2 ?? t.done, yellow = t.ansi3 ?? t.working;
  return { red, green, yellow, blue: t.ansi4 ?? t.accent, magenta: t.ansi5 ?? t.accent, orange: t.ansi11 ?? yellow };
}

// A status's icon and color: blocked and review the red alert ("needs you", red also in Mono), running turns, done
// checked, the others a dot. Mono draws everything else in the theme's muted color. `c` is tones(t).
export function look(status, t, c, mono) {
  if (NEEDS_YOU.includes(status)) return { icon: "alert", color: c.red };
  // Triage in the dim grey, as Hermes' own board (its tertiary text color).
  const color = mono ? t.muted : ({ triage: t.dim, ready: c.blue, running: c.yellow, done: c.magenta }[status] ?? t.muted);
  return { icon: status === "running" ? "running" : status === "done" ? "check-circle" : "circle-dot", color };
}

// Opens a link in the browser of this computer, only an https one (lib/text.js safeLink) and only on a click.
// From ghchecker (MIT), mods/ghchecker/ui.js openUrl.
export function openUrl(url) {
  if (!safeLink(url)) return;
  exec("open", [url]).catch(() => exec("xdg-open", [url]).catch(() => null));
}

// A theme color with an alpha, for tinted layers. Only #rrggbb gets one.
export const alpha = (color, a) => /^#[0-9a-f]{6}$/i.test(color ?? "") ? `${color}${a}` : color;

const icon = (name) => `mods/hermes-kanban/icons/${name}.svg`;
export const glyph = (name, size, color) => svg(icon(name)).size(size).flex_none().text_color(color);
// "running" turns: the icon of a running task and of a loading state.
export const glyphOf = (name, size, color) => name === "running" ? glyph(name, size, color).spin(900) : glyph(name, size, color);

// A segmented control: items [[key, label]], the one equal to `value` selected.
export function segmented(id, items, value, t, onPick) {
  return h_flex().id(id).flex_none().gap(1)
    .children(items.map(([key, label]) => {
      const on = key === value;
      return h_flex().id(`${id}-${key}`).h(22).px(8).items_center().rounded(6).text_size(12).cursor_pointer()
        .bg(on ? t.selected : CLEAR).text_color(on ? t.foreground : t.muted)
        .hover((s) => s.bg(on ? t.selected : t.hover))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => onPick(key, cx)).child(label);
    }));
}

// Buttons as ghchecker's: default (bordered), primary (the theme's accent), filled with a tone color (Comment &
// unblock, Confirm archive), outlined in a tone (Archive). buttonFace is the button without its handler, for a click
// that must be written out where it is drawn (the gateway restart, rows.test.js).
export function buttonFace(id, label, t, { primary = false, tone = null, outline = null, enabled = true, icon: name = null, small = false, tooltip = null } = {}) {
  const fill = enabled ? (tone ?? (primary ? t.accent : null)) : null, h = small ? 26 : 30;
  const ink = fill ? (tone ? t.background : t.accent_foreground ?? t.background) : enabled ? (outline ?? t.foreground) : t.dim;
  return h_flex().id(id).h(h).px(label === "" ? (small ? 6 : 8) : (small ? 10 : 12)).gap(6).flex_none().items_center().justify_center().rounded(7)
    .text_size(12).font_medium()
    .bg(fill ?? CLEAR).border_1().border_color(fill ?? t.border)
    .text_color(ink)
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .when(enabled, (e) => e.cursor_pointer().hover((s) => s.bg(fill ? alpha(fill, "dd") : t.hover)))
    .when(Boolean(tooltip), (e) => e.tooltip(tooltip))
    .when(Boolean(name), (e) => e.child(glyph(name, 14, ink)))
    .when(label !== "", (e) => e.child(label));
}
export function button(id, label, t, onClick, opts = {}) {
  return buttonFace(id, label, t, opts).when(opts.enabled !== false, (e) => e.on_click(onClick));
}

// A pill filled with a tint of the color: the status in the overlay's head.
export const pill = (label, color) => h_flex().flex_none().h(24).px(10).items_center().rounded(12).bg(alpha(color, "2e"))
  .text_size(12).font_medium().text_color(color).child(label);

// The priority chip of a row: a quiet outline, as in the mockup.
export const chip = (label, t) => h_flex().h(18).px(6).flex_none().items_center().rounded(9).border_1().border_color(t.border)
  .text_size(11).text_color(t.muted).child(label);

// An empty or failed state: an icon, a heading and one or more lines.
export function blankslate(t, { icon: name = null, title, body = [], tone = null }) {
  const lines = (Array.isArray(body) ? body : [body]).filter(Boolean);
  return v_flex().flex_1().w_full().items_center().justify_center().px(32).gap(10)
    .when(Boolean(name), (e) => e.child(glyphOf(name, 22, tone ?? t.dim)))
    .child(div().font_semibold().text_color(t.foreground).text_center().child(title))
    .children(lines.map((line) => div().max_w(320).text_size(12).text_color(t.muted).text_center().child(line)));
}
