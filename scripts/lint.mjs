// npm run lint: every script parses, the mod avoids what herdr's QuickJS lacks, and nothing in the mod is dead:
// no unused import, no export no other file of the mod imports, no icon nobody draws and no drawn icon missing, and
// no .hover() on an element without an .id(). No tracked file refers to the internal documents of the mod's making
// (ruling ids, addenda, design sections, drafts). With a local tmp/denylist.txt (gitignored, one word per line), no
// tracked file may contain one of its words (whole word, any case).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { hoverWithoutId } from "./hoverids.mjs";

const root = path.resolve(import.meta.dirname, "..");
const mod = path.join(root, "mods/hermes-kanban");
const rel = (f) => path.relative(root, f);

function files(dir, pattern) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return files(p, pattern);
    return e.isFile() && pattern.test(e.name) ? [p] : [];
  });
}

const problems = [];
const js = [mod, path.join(root, "test"), path.join(root, "scripts")].flatMap((d) => files(d, /\.m?js$/));
const shells = files(path.join(root, "scripts"), /\.sh$/);
for (const f of js) {
  const r = spawnSync("node", ["--check", f], { encoding: "utf8" });
  if (r.status !== 0) problems.push(`${rel(f)}: does not parse\n${r.stderr}`);
}
for (const f of shells) {
  const r = spawnSync(/shoot\.sh$/.test(f) ? "bash" : "sh", ["-n", f], { encoding: "utf8" });
  if (r.status !== 0) problems.push(`${rel(f)}: does not parse\n${r.stderr}`);
}

const modFiles = files(mod, /\.js$/);
const text = Object.fromEntries(modFiles.map((f) => [f, fs.readFileSync(f, "utf8")]));
const code = (src) => src.replace(/\/\/.*$/gm, "").replace(/`(?:\\.|[^`])*`|"(?:\\.|[^"\n])*"|'(?:\\.|[^'\n])*'/g, (s) => s.startsWith("`") ? s.replace(/[^${}\w]/g, " ") : '""');

for (const [f, src] of Object.entries(text)) {
  // herdr runs mods on QuickJS without Intl.
  src.split("\n").forEach((line, n) => {
    if (!/^\s*\/\//.test(line) && /\b(toLocaleString|toLocaleDateString|Intl\.)/.test(line)) problems.push(`${rel(f)}:${n + 1}: Intl is missing in herdr (toLocale*/Intl)`);
    if (/\bconsole\.(log|debug)\b|\bdebugger\b/.test(line)) problems.push(`${rel(f)}:${n + 1}: debug output`);
  });
  // Every imported name is used.
  const body = code(src.replace(/^import[\s\S]*?from\s+"[^"]+";$/gm, ""));
  for (const m of src.matchAll(/^import\s+(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\}|\*\s+as\s+(\w+))?\s*from\s+"[^"]+";$/gm)) {
    const names = [m[1], m[3], ...(m[2] ?? "").split(",").map((s) => s.trim().split(/\s+as\s+/).pop())].filter(Boolean);
    for (const name of names) if (!new RegExp(`\\b${name}\\b`).test(body)) problems.push(`${rel(f)}: unused import ${name}`);
  }
}

// Every export is imported by another file of the mod or by a test (the default export of main.js is herdr's).
const importers = { ...text, ...Object.fromEntries(files(path.join(root, "test"), /\.m?js$/).map((f) => [f, fs.readFileSync(f, "utf8")])) };
const importedFrom = (file) => Object.entries(importers).flatMap(([g, src]) => [...src.matchAll(/^import\s+[\s\S]*?\{([^}]*)\}\s*from\s+"([^"]+)";$/gm)]
  .filter((m) => path.resolve(path.dirname(g), m[2]) === file)
  .flatMap((m) => m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)));
for (const [f, src] of Object.entries(text)) {
  const used = new Set(importedFrom(f));
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:const|function|class|let)\s+(\w+)/gm)) {
    if (!used.has(m[1])) problems.push(`${rel(f)}: export ${m[1]} is imported nowhere (mod or tests)`);
  }
}

// Icons (once icons/ exists): each svg in icons/ is drawn somewhere, each drawn name has its svg.
if (fs.existsSync(path.join(mod, "icons"))) {
  const icons = new Set(fs.readdirSync(path.join(mod, "icons")).filter((n) => n.endsWith(".svg")).map((n) => n.slice(0, -4)));
  const all = Object.values(text).join("\n");
  const quoted = new Set([...all.matchAll(/"([a-z][a-z-]*)"/g)].map((m) => m[1]));
  for (const name of icons) if (!quoted.has(name)) problems.push(`${rel(path.join(mod, "icons", name))}.svg: never drawn`);
  for (const m of all.matchAll(/\b(?:glyph|glyphOf|icon)\(\s*"([a-z-]+)"/g)) if (!icons.has(m[1]) && m[1] !== "spin") problems.push(`icon ${m[1]}: no icons/${m[1]}.svg`);
  for (const m of all.matchAll(/\bicon:\s*"([a-z-]+)"/g)) if (!icons.has(m[1]) && m[1] !== "spin") problems.push(`icon ${m[1]}: no icons/${m[1]}.svg`);
}

// Every .hover() has an .id() in its element chain (scripts/hoverids.mjs says why).
for (const [f, src] of Object.entries(text)) {
  for (const h of hoverWithoutId(src)) problems.push(`${rel(f)}:${h.line}: .hover() without .id() (${h.chain})`);
}

// Tracked files and new files git would track (docs/superpowers/ is local only), with their content.
const tracked = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" }).stdout.split("\0").filter(Boolean)
  .filter((t) => !t.startsWith("docs/superpowers/"))
  .flatMap((t) => {
    const p = path.join(root, t);
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return [];
    return [[t, fs.readFileSync(p, "utf8")]];
  });

// No internal process references: the repo is public, the documents of its making are not. Ruling ids (a capital R
// and one or two digits), the German name of the design's addenda, a quoted design section and the word for a design
// draft must not appear; explain the reason in plain words instead.
const internal = [/\bR\d{1,2}\b/, /Nachtr(?:ag|äge|aege)/i, /\bspec\s+"/i, /\bmock-?ups?\b/i];
for (const [t, content] of tracked) {
  if (content.includes("\0")) continue; // binary (the PNGs)
  content.split("\n").forEach((line, n) => {
    if (internal.some((re) => re.test(line))) problems.push(`${t}:${n + 1}: internal process reference (ruling id, addenda, design section or draft)`);
  });
}

// Denylist: words that must never reach the repo (machine names, user names, ...). The list itself stays local.
// Checks the tracked files above; reports the line, never the word.
const denyFile = path.join(root, "tmp/denylist.txt");
if (fs.existsSync(denyFile)) {
  const escape = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const words = fs.readFileSync(denyFile, "utf8").split("\n").map((w) => w.trim()).filter(Boolean);
  for (const [t, content] of tracked) {
    const res = words.map((w) => new RegExp(`(?<![\\w])${escape(w)}(?![\\w])`, "i"));
    content.split("\n").forEach((line, n) => {
      if (res.some((re) => re.test(line))) problems.push(`${t}:${n + 1}: contains a denylisted word`);
    });
  }
}

for (const p of problems) console.error(`FAIL ${p}`);
console.log(`lint: ${js.length + shells.length} files parse, ${modFiles.length} mod files checked, ${problems.length} problem${problems.length === 1 ? "" : "s"}`);
process.exit(problems.length ? 1 : 0);
