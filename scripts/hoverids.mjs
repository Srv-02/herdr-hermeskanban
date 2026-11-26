// Every element with .hover() needs an .id(). In gpui-pre 0.3.8 (div.rs) a hover change notifies the view only
// through the element's hover state, and only an element with an identity has one; without an id the hover style
// shows only on the next unrelated repaint. This finds .hover() calls whose element chain has no .id().
//
// Static and therefore approximate: the chain is followed back from .hover() through .method(...) calls, and out of
// an arrow given to .when(), to the call that made the element. A chain that starts at a helper (row(), item()) counts
// as having no id, so the id belongs at the call site.

// Comments and string contents blanked, offsets kept.
export function blank(src) {
  let out = "", i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === "/" && n === "/") { const e = src.indexOf("\n", i), end = e < 0 ? src.length : e; out += " ".repeat(end - i); i = end; continue; }
    if (c === "/" && n === "*") { const e = src.indexOf("*/", i + 2) + 2; out += src.slice(i, e).replace(/[^\n]/g, " "); i = e; continue; }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === "\\") j++; j++; }
      out += c + src.slice(i + 1, j).replace(/[^\n]/g, " ") + c; i = j + 1; continue;
    }
    out += c; i++;
  }
  return out;
}

const back = (s, i) => { while (i >= 0 && /\s/.test(s[i])) i--; return i; };
const ident = (s, i) => { let j = i; while (j >= 0 && /[\w$]/.test(s[j])) j--; return [s.slice(j + 1, i + 1), j]; };
// The "(" that matches the ")" at i; the ")" that matches the "(" at i; the unmatched "(" around i.
const opening = (s, i) => { for (let d = 0; i >= 0; i--) { if (s[i] === ")") d++; else if (s[i] === "(" && --d === 0) return i; } return -1; };
const closing = (s, i) => { for (let d = 0; i < s.length; i++) { if (s[i] === "(") d++; else if (s[i] === ")" && --d === 0) return i; } return -1; };
const around = (s, i) => { for (let d = 0; i >= 0; i--) { if (s[i] === ")") d++; else if (s[i] === "(") { if (d === 0) return i; d--; } } return -1; };

// The method names of the element chain through the call whose "." is at `dot`, in source order.
export function chain(s, dot) {
  const names = [];
  for (let i = dot; ;) {
    const k = back(s, i - 1);
    if (s[k] === ")") {
      const [name, j] = ident(s, back(s, opening(s, k) - 1)), p = back(s, j);
      if (s[p] === "." && s[p - 1] !== "?") { names.unshift(name); i = p; continue; }
      names.unshift(`${name}()`); break;
    }
    const [name, j] = ident(s, k);
    if (/=>\s*$/.test(s.slice(0, j + 1))) {
      const o = around(s, j), [outer, oj] = ident(s, back(s, o - 1)), p = back(s, oj);
      if (outer === "when" && s[p] === ".") { names.unshift("when"); i = p; continue; }
    }
    names.unshift(name); break;
  }
  for (let e = closing(s, s.indexOf("(", dot)); ;) {
    const m = /^\s*\.(\w+)\s*\(/.exec(s.slice(e + 1));
    if (!m) break;
    names.push(m[1]); e = closing(s, e + m[0].length);
  }
  return names;
}

// [{ line, chain }] for every .hover() without an .id() in its chain.
export function hoverWithoutId(src) {
  const s = blank(src), found = [];
  for (const m of s.matchAll(/\.hover\s*\(/g)) {
    const names = chain(s, m.index);
    if (!names.includes("id")) found.push({ line: s.slice(0, m.index).split("\n").length, chain: names.join(".") });
  }
  return found;
}
