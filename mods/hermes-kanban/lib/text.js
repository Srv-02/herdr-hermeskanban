// Text from Hermes for the overlay. It comes from anyone who can reach an instance, so it is never read as Markdown
// or HTML: plainHtml escapes every character, keeps line breaks and spaces, and makes only bare https URLs links
// (no image, no other scheme). A click on a link opens it only when safeLink passes it (ui.js openUrl).

export const safeLink = (url) => (typeof url === "string" && /^https:\/\/\S+$/i.test(url) ? url : null);

const URL = /https:\/\/[^\s<>"'`\\]+/gi;
const TRAILING = /[.,;:!?)\]}]+$/;

// Text and https URLs in order: [{ text } | { url }]. Trailing punctuation belongs to the text.
export function linkify(text) {
  const s = String(text ?? ""), out = [];
  let from = 0;
  for (const m of s.matchAll(URL)) {
    const url = m[0].replace(TRAILING, "");
    if (m.index > from) out.push({ text: s.slice(from, m.index) });
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
  return String(text ?? "").split(/\r?\n/).map((line) => linkify(line).map((p) => (p.url
    ? `<a href="${escape(p.url)}">${escape(p.url)}</a>`
    : spaces(escape(p.text)))).join("")).join("<br>");
}
