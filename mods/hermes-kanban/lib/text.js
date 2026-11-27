// Text from Hermes for the overlay. It comes from anyone who can reach an instance, so it is never read as Markdown
// or HTML: plainHtml escapes every character, keeps line breaks and spaces, and makes only bare https URLs links
// (no image, no other scheme). A click on a link opens it only when safeLink passes it (ui.js openUrl).

export const safeLink = (url) => (typeof url === "string" && /^https:\/\/\S+$/i.test(url) ? url : null);

// One greedy character class, no nested quantifier: linear in the text.
const URL = /https:\/\/[^\s<>"'`\\]+/gi;
const TRAILING = new Set([".", ",", ";", ":", "!", "?", ")", "]", "}"]);
// Trailing punctuation off by a backward loop (a regex like /[.,]+$/ backtracks quadratically on long runs).
function trimEnd(url) {
  let end = url.length;
  while (end > 0 && TRAILING.has(url[end - 1])) end -= 1;
  return url.slice(0, end);
}

// Text and https URLs in order: [{ text } | { url }]. Trailing punctuation belongs to the text.
export function linkify(text) {
  const s = String(text ?? ""), out = [];
  let from = 0;
  for (const m of s.matchAll(URL)) {
    const url = trimEnd(m[0]);
    if (m.index > from) out.push({ text: s.slice(from, m.index) });
    if (url.length <= "https://".length) { out.push({ text: url }); from = m.index + url.length; continue; }
    out.push({ url });
    from = m.index + url.length;
  }
  if (from < s.length) out.push({ text: s.slice(from) });
  return out;
}

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escape = (s) => s.replace(/[&<>"']/g, (ch) => ESC[ch]);
// Spaces and tabs as written: a run keeps its width (HTML would fold it).
const spaces = (s) => s.replace(/\t/g, "  ").replace(/ {2,}/g, (run) => ` ${"&nbsp;".repeat(run.length - 1)}`);

// HTML for TextView.html: only <br> and <a href="https://…"> made here; everything else is escaped text.
export function plainHtml(text) {
  return String(text ?? "").split(/\r\n|\r|\n/).map((line) => linkify(line).map((p) => (p.url
    ? `<a href="${escape(p.url)}">${escape(p.url)}</a>`
    : spaces(escape(p.text)))).join("")).join("<br>");
}

// A task's ID as people see and copy it: Hermes' database prefix "t_" off ("t_f070b12c" → "f070b12c"). Requests and
// keys keep the full ID.
export const shownId = (id) => (typeof id === "string" && id.startsWith("t_") && id.length > 2 ? id.slice(2) : String(id ?? ""));
