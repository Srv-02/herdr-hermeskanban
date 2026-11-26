import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const readme = read("README.md");
const headings = (f) => read(f).split("\n").filter((l) => /^#{1,2} /.test(l));

// Markdown links and <img src>, without http(s), mailto and #anchors; a "#anchor" suffix is cut off.
function relativeLinks(src) {
  const targets = [...src.matchAll(/\]\(([^)\s]+)\)/g), ...src.matchAll(/<img[^>]*\ssrc="([^"]+)"/g), ...src.matchAll(/<a[^>]*\shref="([^"]+)"/g)].map((m) => m[1]);
  return targets.filter((t) => !/^(https?:|mailto:|#)/.test(t)).map((t) => t.split("#")[0]);
}

test("every relative link in README, GUIDE and RECIPE points to a file of the repo", () => {
  const bad = [];
  for (const f of ["README.md", "docs/GUIDE.md", "RECIPE.md"]) {
    for (const t of relativeLinks(read(f))) {
      if (!fs.existsSync(path.resolve(ROOT, path.dirname(f), t))) bad.push(`${f}: ${t}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("README has the sections of the published mods in their order", () => {
  assert.deepEqual(headings("README.md"), ["# Hermes Kanban", "## Install", "## Features", "## Documentation", "## Credits", "## License"]);
});

test("README carries the Buy me a coffee button", () => {
  assert.match(readme, /<a href="https:\/\/www\.buymeacoffee\.com\/michaelmayer"><img src="screenshots\/bmc-button\.png" alt="Buy me a coffee" height="64"><\/a>/);
});

test("the install line names this repository", () => {
  assert.match(readme, /add this mod: https:\/\/github\.com\/Srv-02\/herdr-hermeskanban\/tree\/main/);
});

test("GUIDE has the anchors the README and the mod link to", () => {
  const guide = read("docs/GUIDE.md");
  for (const a of ["requirements", "install", "manual-install", "keys", "settings", "updates", "what-it-runs-and-touches", "removing", "development"]) {
    assert.ok(new RegExp(`^#{2,3} ${a.replace(/-/g, "[ -]")}$`, "im").test(guide), `missing section for #${a}`);
  }
});

test("RECIPE has the sections of the published mods", () => {
  assert.deepEqual(headings("RECIPE.md").filter((h) => h.startsWith("## ")), ["## What you see", "## How it behaves", "## Built from", "## Watch out", "## Done when"]);
});

test("README has one subsection per feature area under Features", () => {
  const lines = readme.split("\n"), from = lines.indexOf("## Features"), to = lines.indexOf("## Documentation");
  assert.deepEqual(lines.slice(from, to).filter((l) => l.startsWith("### ")),
    ["### Board", "### Task overlay", "### Notifications", "### Set up access", "### Settings", "### And"]);
});

// The commands main.js answers from nextCommand(): every `c === "<command>"`.
const commands = () => [...read("mods/hermes-kanban/main.js").matchAll(/\bc === "([a-z-]+)"/g)].map((m) => m[1]);

test("GUIDE lists every key command of the mod", () => {
  const guide = read("docs/GUIDE.md"), list = commands();
  assert.ok(list.length >= 5, `found only ${list.length} commands in main.js`);
  assert.deepEqual(list.filter((c) => !guide.includes(`\`hermes-kanban:${c}\``)), []);
});

test("GUIDE names every setting of lib/settings.js", async () => {
  const { SETTINGS } = await import("../mods/hermes-kanban/lib/settings.js");
  const guide = read("docs/GUIDE.md");
  assert.deepEqual(SETTINGS.filter((s) => !guide.includes(`\`${s.key}\``) || !guide.includes(s.label)).map((s) => s.key), []);
});

test("GUIDE has no placeholder left", () => {
  assert.doesNotMatch(read("docs/GUIDE.md"), /Filled in with/);
  assert.doesNotMatch(read("RECIPE.md"), /scaffold/i);
});

test("no internal words in the docs", () => {
  const docs = ["README.md", "docs/GUIDE.md", "RECIPE.md", "THIRD_PARTY_NOTICES.md"];
  const deny = path.join(ROOT, "tmp/denylist.txt");
  // The password manager's name is split so this file does not trip the same check in lint.
  const words = [["1", "Password"].join(""), ...(fs.existsSync(deny) ? fs.readFileSync(deny, "utf8").split("\n").map((w) => w.trim()).filter(Boolean) : [])];
  const escape = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bad = [];
  for (const f of docs) {
    read(f).split("\n").forEach((line, n) => {
      // Reports the file and line only, never the word: the list stays local.
      if (words.some((w) => new RegExp(`(?<![\\w])${escape(w)}(?![\\w])`, "i").test(line))) bad.push(`${f}:${n + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});
