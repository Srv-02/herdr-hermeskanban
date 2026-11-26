// Source checks of the UI files (as ghchecker's test/rows.test.js): herdr runs them only inside the app, so what can
// go wrong there in a way node --test cannot see is pinned here by reading the source.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hoverWithoutId, blank } from "../scripts/hoverids.mjs";

const dir = new URL("../mods/hermes-kanban/", import.meta.url).pathname;
const source = (f) => fs.readFileSync(path.join(dir, f), "utf8");
// The code without comments and string contents, so a comment never satisfies a check.
const code = (f) => blank(source(f));

test("hoverWithoutId: finds a hover without id, also through .when() and helpers", () => {
  const lines = (src) => hoverWithoutId(src).map((h) => h.line);
  assert.deepEqual(lines("div().px(4).hover((s) => s.bg(x)).child(\"a\")"), [1]);
  assert.deepEqual(lines("h_flex().id(\"a\").px(4).hover((s) => s.bg(x))"), []);
  assert.deepEqual(lines("div()\n  .when(on, (e) => e.hover((s) => s.bg(x)))"), [2]);
  assert.deepEqual(lines("// div().hover((s) => s.bg(x))\nconst t = \".hover(\";"), [], "comments and strings are not code");
});

test("no element in the mod has .hover() without .id()", () => {
  const files = fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith(".js"));
  assert.ok(files.includes("main.js"), "main.js exists");
  const found = files.flatMap((f) => hoverWithoutId(source(f)).map((h) => `${f}:${h.line} ${h.chain}`));
  assert.deepEqual(found, []);
});

// herdr-app check runs init of every role: no exec, no notify, no shared writes from a timer there.
test("the watcher does nothing while herdr-app check runs", () => {
  const src = code("main.js"), guard = src.indexOf("if (checking()) return"), timer = src.indexOf("cx.timer.every");
  assert.ok(guard >= 0, "main.js has the checking() guard");
  assert.ok(timer >= 0, "main.js starts the watcher's timer");
  assert.ok(guard < timer, "the guard comes before the first timer");
});

// The timer lives in main.js (the button role); watcher.js only runs one pass when asked.
test("watcher.js registers no timer and exports only its pass", () => {
  const src = code("watcher.js");
  assert.doesNotMatch(src, /cx\.timer|setTimeout|setInterval/);
  assert.deepEqual([...source("watcher.js").matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map((m) => m[1]), ["watchPass"]);
  assert.equal([...source("watcher.js").matchAll(/^export\b/gm)].length, 1);
  assert.match(code("main.js"), /cx\.timer\.every\(WATCH,/);
});

test("the button and the watcher use the shared keys of the mod exactly", () => {
  const all = source("main.js") + source("watcher.js");
  const keys = new Set([...all.matchAll(/"(hermes-kanban\.[\w.]+)"/g)].map((m) => m[1]));
  for (const k of ["hermes-kanban.lease", "hermes-kanban.update", "hermes-kanban.boards", "hermes-kanban.unseen", "hermes-kanban.seen",
    "hermes-kanban.refresh", "hermes-kanban.lastPanes", "hermes-kanban.config"]) assert.ok(keys.has(k), `${k} is used`);
  for (const k of keys) assert.match(k, /^hermes-kanban\.(lease|update|boards|unseen|seen|refresh|lastPanes|config)$/, `unknown key ${k}`);
  assert.match(source("main.js"), /mods\/hermes-kanban\/mod\.json/);
});

// A toast's click jumps like "Go to pane"; without a target it has no action (no pane.focus with args null).
test("toasts carry a jump only with a target, and time out after 8 s", () => {
  const src = source("watcher.js");
  assert.match(src, /timeout: 8000/);
  assert.match(src, /jumpTarget\(/);
  assert.match(src, /target \? \{ action: \{ name: "pane\.focus", args: target \} \} : \{\}/);
});

test("sounds are herdr's attention sounds, the badge only through its switch", () => {
  const src = source("watcher.js");
  assert.match(src, /playSound\(sound\)/);
  assert.match(source("lib/changes.js"), /"blocked"/);
  assert.match(src, /settings\.badge/);
});

test("only the lease holder polls and checks for updates", () => {
  const src = code("main.js"), mine = src.indexOf("if (!next.mine)"), pass = src.indexOf("watchPass(");
  assert.ok(mine >= 0 && pass > mine, "the pass runs after the lease check");
});

test("the button is a 92px block's pill as ghchecker's", () => {
  const src = source("main.js");
  assert.match(src, /h_flex\(\)\.size_full\(\)\.pr\(10\)\.items_center\(\)\.justify_end\(\)\.bg\(t\.chrome\)\.border_b\(1\)/);
  assert.match(src, /\.h\(26\)\.px\(8\)\.gap\(5\)/);
  assert.match(src, /\.rounded\(6\)/);
  assert.match(src, /\.text_size\(12\)/);
  assert.match(src, /glyph\("kanban", 14,/);
  assert.match(src, /\.child\("Hermes"\)/);
  assert.match(src, /setShared\("workspace\.panels"/);
});

// A copy that lost the lease keeps no boards: on taking it back, its first poll is a new baseline, not a diff
// against boards from before (the other copy toasted those changes already).
test("losing the lease drops the watcher's state", () => {
  assert.match(code("main.js"), /if \(!next\.mine\) \{\s*if \(this\.mine\) this\.watch = \{\};/);
});
