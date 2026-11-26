// Task text for the overlay's Markdown view. It comes from anyone who can reach an instance, so before drawing:
// images become their alt text (nothing is fetched), raw HTML goes (its text stays), and only https links stay links.
// Code spans and fenced code stay as written: the view draws them as text. A click on a link opens it only when
// safeLink passes it (ui.js openUrl).

const CODE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/;
// A link target: no spaces, one level of parentheses, an optional "title", spaces around.
const TARGET = String.raw`\(\s*((?:[^()\s]|\([^()]*\))*)(?:\s+"[^"]*")?\s*\)`;
const TEXT = String.raw`\[((?:[^\[\]]|\[[^\]]*\])*)\]`;
const DEFINITION = /^ {0,3}\[([^\]]+)\]:\s*(\S+).*$/gm;

export const safeLink = (url) => (typeof url === "string" && /^https:\/\/\S+$/i.test(url) ? url : null);

const imageText = (alt) => (alt.trim() ? `[image: ${alt.trim()}]` : "[image]");

function clean(part, refs) {
  return part
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(new RegExp(String.raw`!\[([^\]]*)\]` + TARGET, "g"), (_m, alt) => imageText(alt))
    .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, (_m, alt) => imageText(alt))
    .replace(/<(https?:[^>\s]+)>/gi, "$1")
    .replace(/<\/?[A-Za-z][^<>]*>/g, "")
    .replace(new RegExp(TEXT + TARGET, "g"), (m, text, url) => (safeLink(url) ? m : text))
    .replace(new RegExp(TEXT + String.raw`\[([^\]]*)\]`, "g"), (m, text, ref) => (safeLink(refs.get((ref || text).toLowerCase())) ? m : text))
    .replace(DEFINITION, (m, _ref, url) => (safeLink(url) ? m : ""));
}

export function safeMarkdown(markdown) {
  const parts = String(markdown ?? "").split(CODE);
  const refs = new Map();
  parts.forEach((p, n) => { if (n % 2 === 0) for (const m of p.matchAll(DEFINITION)) refs.set(m[1].toLowerCase(), m[2]); });
  return parts.map((p, n) => (n % 2 ? p : clean(p, refs))).join("");
}
