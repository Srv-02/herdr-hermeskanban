// Shared pieces of the panel, its button and its overlays: theme colors for the states, alpha tints, icons.
// Adapted from ghchecker by Michael Mayer (MIT), mods/ghchecker/ui.js; only what this mod draws so far.
import { svg } from "gpui-kit";

// Tone (lib/changes.js dotOf) to a color of the theme: ANSI red, green and yellow, so every theme, light or dark,
// draws the states in its own palette.
export function tones(t) {
  return { red: t.ansi1 ?? t.blocked, green: t.ansi2 ?? t.done, yellow: t.ansi3 ?? t.working };
}

// A theme color with an alpha, for tinted layers. Only #rrggbb gets one.
export const alpha = (color, a) => /^#[0-9a-f]{6}$/i.test(color ?? "") ? `${color}${a}` : color;

const icon = (name) => `mods/hermes-kanban/icons/${name}.svg`;
export const glyph = (name, size, color) => svg(icon(name)).size(size).flex_none().text_color(color);
