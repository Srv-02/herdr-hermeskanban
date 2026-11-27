// Text from Hermes for the overlay. It comes from anyone who can reach an instance. The description renders as
// Markdown, as Hermes' own web app does, with three guards: raw HTML stays literal text (TextView .raw_html(false)),
// no picture is ever loaded (safeMarkdown breaks every image opener), and a click opens a link only when
// safeLink passes it (ui.js openUrl). Titles, comments and reasons stay plain text.

export const safeLink = (url) => (typeof url === "string" && /^https:\/\/\S+$/i.test(url) ? url : null);

// Markdown in which no image can start: a zero-width space between "!" and "[" (every "![", also inside code). Herdr's
// Markdown view would fetch an image's URL as soon as the overlay opens (mods may use the network freely), which tells
// a stranger's server your IP and that you opened the task. "![alt](url)" then shows as "!" and a link; in code the
// text looks unchanged. No parsing of fences or code spans: a guess that differs from the renderer's would let an
// image through.
export const safeMarkdown = (text) => String(text ?? "").replace(/!\[/g, "!\u200B[");

// A task's ID as people see and copy it: Hermes' database prefix "t_" off ("t_f070b12c" → "f070b12c"). Requests and
// keys keep the full ID.
export const shownId = (id) => (typeof id === "string" && id.startsWith("t_") && id.length > 2 ? id.slice(2) : String(id ?? ""));
