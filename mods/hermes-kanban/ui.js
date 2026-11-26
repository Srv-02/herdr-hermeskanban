// Shared pieces of the panel, its button and its overlays: theme colors for the states, alpha tints, icons, the
// segmented control, the priority chip and the blankslate.
// Adapted from ghchecker by Michael Mayer (MIT), mods/ghchecker/ui.js; segmented control and blankslate there come
// from herdr-github by alarboulletmarin (MIT), mods/github/ui.js at 75a2b40. Only what this mod draws so far.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";

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
