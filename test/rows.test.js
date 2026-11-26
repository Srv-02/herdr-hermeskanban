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
  for (const k of ["hermes-kanban.lease", "hermes-kanban.update", "hermes-kanban.boards", "hermes-kanban.unseen", "hermes-kanban.seen", "hermes-kanban.shown",
    "hermes-kanban.refresh", "hermes-kanban.lastPanes", "hermes-kanban.config", "hermes-kanban.pick"]) assert.ok(keys.has(k), `${k} is used`);
  for (const k of keys) assert.match(k, /^hermes-kanban\.(lease|update|boards|unseen|seen|shown|refresh|lastPanes|config|pick)$/, `unknown key ${k}`);
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
  assert.match(src, /dotOf\(shared\("hermes-kanban\.unseen"\)\)/, "the dot reads only what is unseen");
  assert.doesNotMatch(src, /dot\.count|c\.yellow\)\.loop/, "no count, no yellow dot");
});

// A copy that lost the lease keeps no boards: on taking it back, its first poll is a new baseline, not a diff
// against boards from before (the other copy toasted those changes already).
test("losing the lease drops the watcher's state", () => {
  assert.match(code("main.js"), /if \(!next\.mine\) \{\s*if \(this\.mine\) this\.watch = \{\};/);
});

// ---- the panel ----

// GPUI repaints a hover change only for an element with an identity (ghchecker test/rows.test.js): each row of the
// virtual list carries its task key (machine and ID) as element id.
test("the list rows carry their task key as element id", () => {
  const src = source("main.js");
  assert.match(src, /row\(key, size, t\) \{\s*return h_flex\(\)\.id\(key\)/);
  assert.match(src, /draw: \(sz\) => draw\(sz, key\)/);
  assert.match(src, /entry\(taskKey\(task\),/);
});

// The panel never mixes two boards: the list takes only the focused machine's snapshot.
test("the panel reads only the focused machine's board", () => {
  const src = code("main.js");
  assert.match(src, /const snap = boards\?\.\[focus\.machine\]/);
  assert.match(src, /filterTasks\(snap\.board\.tasks,/);
  assert.equal([...src.matchAll(/filterTasks\(/g)].length, 1, "one place filters tasks");
  assert.doesNotMatch(src, /Object\.values\([^)]*\)\.flatMap\([^)]*tasks/, "no list of tasks over several boards");
  assert.doesNotMatch(src, /\.\.\.\w+\.board\.tasks/, "no spreading of one board's tasks into another list");
});

// R14: the panel follows the focus on its own 3 s beat, never during herdr-app check.
test("the panel's follow-me timer runs after a checking() guard", () => {
  const src = code("main.js"), timer = src.indexOf("cx.timer.every(TICK,");
  assert.ok(timer >= 0, "the panel starts its 3 s timer");
  const guard = src.lastIndexOf("if (checking()) return", timer);
  assert.ok(guard >= 0 && guard > src.indexOf("cx.timer.every(WATCH,"), "a guard of its own comes before the panel's timer");
  assert.match(src, /const TICK = 3000;/);
});

// Overlays carry only machine and ID: the overlay fetches the task itself and acts on that machine only.
test("the panel opens its overlays with the source machine", () => {
  const src = source("main.js");
  assert.match(src, /kind: "dialog", width: 0\.88, height: 0\.9, props: \{ task: \{ machine: task\.machine, id: task\.id \} \}/);
  assert.match(src, /props: \{ create: \{ machine \} \}/);
  assert.match(src, /props: \{ settings: true, machine \}/);
});

test("the panel answers its key commands", () => {
  const src = source("main.js");
  for (const c of ["refresh", "filter", "settings", "new", "open"]) assert.match(src, new RegExp(`c === "${c}"`), c);
  assert.match(src, /await nextCommand\(\)/);
});

// "Go to pane" reads spaces and panes when clicked, not the view of the last render.
test("the needs-you strip jumps with fresh spaces and panes", () => {
  assert.match(source("main.js"), /jumpTarget\(m, \{ spaces: spaces\(\), panes: panes\(\) \}, shared\("hermes-kanban\.lastPanes"\)\)/);
  assert.match(source("main.js"), /\$\{m\} needs you`/);
  assert.match(source("main.js"), /needsYou\(unseen, m\)/, "only for an unseen needs-you event");
  assert.doesNotMatch(source("main.js"), /\d+ blocked|n\} blocked/, "no count of old blocked tasks");
  assert.match(source("main.js"), /"Go to pane →"/);
});

test("the panel never falls back to the last board outside of Hermes", () => {
  const src = source("main.js");
  assert.match(src, /"No Hermes in this pane"/);
  assert.match(src, /if \(!focus\.hermes\)/);
});

test("the header is ghchecker's", () => {
  const src = source("main.js");
  assert.match(src, /h_flex\(\)\.h\(42\)\.flex_none\(\)\.px\(14\)\.gap\(8\)\.items_center\(\)\.border_b\(1\)/);
  const order = ["\"new\"", "\"refresh\"", "\"filter\"", "\"settings\""].map((id) => src.indexOf(`this.headButton(${id}`));
  assert.ok(order.every((i) => i >= 0), "all four header buttons");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "in the order +, refresh, filter, settings");
  assert.match(src, /gearState\(shared\("hermes-kanban\.update"\), this\.version\)/);
  assert.match(src, /h_flex\(\)\.id\("status-bar"\)\.h\(30\)/);
});

// ---- the task overlay and the new task dialog ----

// R24: both overlays write to one machine, the one in their props. They never look at the focus.
test("the overlay takes its machine from props, never from focus", () => {
  for (const f of ["viewer.js", "create.js"]) {
    const src = code(f);
    assert.doesNotMatch(src, /\bfocused\(/, `${f} reads no focus`);
    assert.doesNotMatch(src, /\bspaces\(/, `${f} reads no spaces`);
    assert.doesNotMatch(src, /\bpanes\(/, `${f} reads no panes`);
    assert.match(src, /this\.machine = machine;/, `${f} binds the machine of its props`);
  }
  const viewer = source("viewer.js");
  // Every write goes through act() on the task (its machine) or the helper that does.
  assert.doesNotMatch(code("viewer.js"), /api\.(patch|comment|create)\(/, "no write by machine name in the viewer");
  assert.match(viewer, /this\.api\.act\(this\.task, "patch"/);
  assert.match(viewer, /this\.api\.act\(this\.task, "comment"/);
  assert.match(viewer, /commentAndUnblock\(this\.api, this\.task,/);
  assert.match(code("create.js"), /this\.api\.create\(this\.machine,/);
});

test("main.js opens the overlay roles", () => {
  const src = code("main.js");
  assert.match(src, /if \(p\.task\) \{ this\.viewer = new TaskViewer\(p\.task, p\.overlay, cx\); return; \}/);
  assert.match(src, /if \(p\.create\) \{ this\.creator = new CreateDialog\(p\.create, p\.overlay, cx\); return; \}/);
});

test("the overlays read nothing during herdr-app check", () => {
  for (const f of ["viewer.js", "create.js"]) assert.match(code(f), /if \(checking\(\)\) return;/, f);
});

test("the overlay: no session button, no hard delete, archive in two clicks", () => {
  const all = source("viewer.js") + source("create.js");
  assert.doesNotMatch(all, /Open session/i);
  assert.doesNotMatch(all, /"DELETE"/);
  const src = source("viewer.js");
  assert.match(src, /"Confirm archive"/);
  assert.match(src, /status: "archived"/);
  assert.match(src, /allowedMoves\(/);
  assert.match(src, /outcomeText\(/);
  assert.match(src, /mergePatched\(/);
  assert.match(src, /setShared\("hermes-kanban\.refresh", \{ machine, at: Date\.now\(\) \}\)/);
  assert.match(source("create.js"), /setShared\("hermes-kanban\.refresh", \{ machine, at: Date\.now\(\) \}\)/);
});

test("the overlay: Comment & unblock only while blocked, Ctrl+Enter comments", () => {
  const src = source("viewer.js");
  assert.match(src, /"Comment & unblock"/);
  assert.match(src, /\.when\(blocked, /);
  assert.match(src, /on\("submit", \(e, cx\) => \{ if \(e\.secondary\) this\.comment\(cx\); \}\)/);
  assert.match(src, /"Ctrl\+Enter to comment"/);
});

// buttonFace defaults `enabled` to true, so an undefined value (a flag not set yet) draws an enabled button: every
// `enabled:` passed must be a boolean already.
test("buttons get enabled as a boolean, never a flag that may be undefined", () => {
  const files = fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith(".js") && f !== "ui.js");
  const loose = files.flatMap((f) => [...source(f).matchAll(/\benabled: ([^,}]+)/g)]
    .map((m) => m[1].trim()).filter((v) => !/^(!|Boolean\(|true\b|false\b)/.test(v)).map((v) => `${f}: ${v}`));
  assert.deepEqual(loose, []);
});

test("single agent mode hides the agent choice in both overlays", () => {
  for (const f of ["viewer.js", "create.js"]) assert.match(code(f), /isSingleAgent\(this\.settings, this\.machine\)/, f);
});

// Untrusted task text: never Markdown. The description is plain text (plainHtml escapes everything, links only bare
// https URLs), and a link opens only through safeLink.
test("the overlay draws the description as plain text", () => {
  const all = fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith(".js")).map((f) => source(f)).join("\n");
  assert.doesNotMatch(all, /TextView\.markdown\(/, "no Markdown view of Hermes content");
  const src = source("viewer.js");
  assert.match(src, /TextView\.html\(`body-\$\{this\.id\}`, this\.bodyHtml\(body\)\)\.selectable\(true\)\.on_link_click\(\(url\) => openUrl\(safeLink\(url\)\)\)/);
  // Memoized: plainHtml runs once per body, not on every render.
  assert.match(src, /if \(this\.html\?\.body !== body\) this\.html = \{ body, html: plainHtml\(body\) \};/);
  assert.equal([...code("viewer.js").matchAll(/plainHtml\(/g)].length, 1, "plainHtml is called in one place");
  assert.equal([...all.matchAll(/TextView\.html\(/g)].length, 1, "one text view, fed by plainHtml");
  assert.match(source("ui.js"), /export function openUrl\(url\) \{\s*if \(!safeLink\(url\)\) return;/);
});

// ---- access and the settings dialog ----

// R25: the settings footer as ghchecker's.
test("the settings footer links GitHub and Buy me a coffee", () => {
  const src = source("settings.js");
  assert.match(src, /import \{[^}]*\bGITHUB_URL\b[^}]*\} from "\.\/lib\/update\.js"/);
  assert.match(src, /import \{[^}]*\bCOFFEE_URL\b[^}]*\} from "\.\/lib\/update\.js"/);
  assert.match(src, /"Hermes Kanban is free and open source\."/);
  assert.match(src, /link\(t, "settings-github", "GitHub", glyph\("github", 14, t\.muted\), GITHUB_URL\)/);
  assert.match(src, /link\(t, "settings-coffee", "Buy me a coffee", glyph\("coffee", 14, t\.muted\), COFFEE_URL\)/);
});

// Where each .on_click( handler of `src` (blanked code) opens and closes.
function clickHandlers(src) {
  const spans = [];
  for (const m of src.matchAll(/\.on_click\(/g)) {
    let depth = 1, i = m.index + m[0].length;
    for (; i < src.length && depth > 0; i++) if (src[i] === "(") depth++; else if (src[i] === ")") depth--;
    spans.push([m.index, i]);
  }
  return spans;
}

test("clickHandlers finds the span of each handler", () => {
  const src = "a.on_click(() => f(g(1))).x(restartSpec(m)); b.on_click((e) => { restartSpec(m); })";
  const spans = clickHandlers(src), at = [...src.matchAll(/restartSpec\(/g)].map((m) => m.index);
  const inside = at.map((i) => spans.some(([a, b]) => i > a && i < b));
  assert.deepEqual(inside, [false, true]);
});

// Spec: no automatic restart. The restart's spec is built only inside a click handler, and only in the two files that
// offer the button.
test("the mod never restarts without a click", () => {
  const files = fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith(".js") && f !== path.join("lib", "setup.js"));
  const users = files.filter((f) => /\brestartSpec\b/.test(code(f))).sort();
  assert.deepEqual(users, ["access.js", "settings.js"]);
  for (const f of users) {
    const src = code(f), spans = clickHandlers(src), at = [...src.matchAll(/\brestartSpec\(/g)].map((m) => m.index);
    assert.ok(at.length > 0, `${f} builds the restart`);
    for (const i of at) assert.ok(spans.some(([a, b]) => i > a && i < b), `${f}: restartSpec( outside a click handler at ${i}`);
  }
  // Nothing else names the hermes CLI.
  for (const f of files) assert.doesNotMatch(source(f), /"gateway", "restart"/, f);
});

// R18: setup, restart and removal stay on the machine of the first click; they never read the focus.
test("access and settings bind their machine and never read the focus", () => {
  for (const f of ["access.js", "settings.js"]) {
    const src = code(f);
    assert.doesNotMatch(src, /\bfocused\(/, `${f} reads no focus`);
    assert.doesNotMatch(src, /\bspaces\(/, `${f} reads no spaces`);
    assert.doesNotMatch(src, /\bpanes\(/, `${f} reads no panes`);
    assert.match(src, /this\.machine = machine;/, `${f} binds its machine`);
  }
  // The panel keeps one flow per machine, made at the first click with the machine it showed then.
  assert.match(source("access.js"), /flow\(machine\) \{/);
  assert.match(code("main.js"), /this\.access\.draw\(t, c, focus\.machine, snap\)/);
});

test("setup asks first, then runs; removal keeps the order", () => {
  const access = source("access.js"), settings = source("settings.js");
  assert.match(access, /"Set up access"/);
  assert.match(access, /"Confirm"/);
  assert.match(access, /"Restart gateway"/);
  assert.match(access, /SETUP_STEPS/);
  assert.match(access, /accessOffer\(/);
  assert.match(access, /setupUnit\(/);
  assert.match(access, /SETUP_SCRIPT/);
  assert.match(settings, /nextRemovalStep\(/);
  assert.match(settings, /REMOVE_SCRIPT/);
  assert.match(settings, /DELETE_TOKEN_SCRIPT/);
  assert.match(settings, /"Remove access"/);
  // Output from the machine is shown only through redactSecrets.
  for (const src of [access, settings]) assert.match(src, /redactSecrets\(/);
});

test("main.js opens the settings dialog with its props", () => {
  const src = code("main.js");
  assert.match(src, /if \(p\.settings\) \{ this\.dialog = new SettingsDialog\(p, p\.overlay, cx\); return; \}/);
  assert.doesNotMatch(source("main.js"), /Not available yet/);
});

// The wait after a restart: 45 status checks 2 s apart, each about 0.25 s, measured live at about 100 s.
test("the restart wait names the time it takes", () => {
  const src = source("access.js");
  assert.match(src, /for \(let i = 0; i < 45; i\+\+\)/);
  assert.match(src, /"The gateway did not come back within 100 s\."/);
});

test("the settings dialog is ghchecker's", () => {
  const src = source("settings.js");
  assert.match(src, /"Hermes Kanban Settings"/);
  assert.match(src, /child\("Esc"\)/);
  assert.match(src, /\.bg\(t\.popover\)/);
  assert.match(src, /text_size\(17\)/);
  assert.match(src, /w\(42\)\.h\(24\)/);
  assert.match(src, /py\(13\)/);
  for (const h of ["Updates", "Agents", "Display", "Notifications", "Connection"]) assert.match(src, new RegExp(`heading\\(t, "${h}"`), h);
  assert.match(src, /tasks from Telegram or the CLI without an agent do not start/);
  assert.match(src, /setShared\("hermes-kanban\.config", \{ at: Date\.now\(\) \}\)/);
  assert.match(src, /changedSettings\(/);
  assert.match(src, /UPDATE_PROMPT/);
  assert.match(src, /releaseUrl|status\.url/);
  assert.match(code("settings.js"), /if \(checking\(\)\) return;/);
});

// Spec Nachträge 3: one row always shown (state, the agents menu, the search over the rest with a clear button while
// it has text); the filter button adds a second row below a divider line with priority and grouping.
test("the filter bar: one row always, priority and grouping behind the filter button", () => {
  const src = source("main.js"), bar = src.slice(src.indexOf("filterBar(t, agents"), src.indexOf("// ---- drawing: the list"));
  const rows = bar.split(".child(h_flex().gap(");
  assert.equal(rows.length - 1, 2, "two rows");
  const first = rows[1], second = rows[2];
  for (const x of ['segmented("state"', 'dropButton("agent"', 'id("search").flex_1().min_w(0).h(24)', 'glyph("search"', 'id("search-clear")']) assert.ok(first.includes(x), x);
  assert.match(first, /\.when\(typed, /, "clear only with text");
  assert.match(first, /this\.input\.set_value\(""\); this\.query = "";/);
  assert.match(first, /\.when\(this\.filtering, \(e\) => e\.border_b\(1\)\.border_color\(t\.border\)\)/, "divider above the second row");
  assert.match(bar, /\.when\(this\.filtering, \(e\) => e\.child\(h_flex\(\)\.gap\(/, "the second row only with the filter button");
  for (const x of ['segmented("prio"', 'segmented("group"']) assert.ok(second.includes(x), x);
  assert.match(src, /\.child\(this\.filterBar\(t, agents, picked, single\)\)/, "the bar is always shown");
  assert.match(src, /remembered\("filtering", false\)/, "closed by default, remembered");
});

test("the agent menu picks several and stays open", () => {
  const src = source("main.js"), menu = src.slice(src.indexOf("renderMenu(t) {"), src.indexOf("// Opening the panel on an instance"));
  assert.match(menu, /m\.value = toggleAgent\(picked, value\)/);
  assert.doesNotMatch(menu, /closeOverlay/);
  assert.match(src, /pick\.kind === "agents" && Array\.isArray\(pick\.value\)/);
  assert.match(src, /\["none", "no agent"\]/);
});

// Single agent mode hides agent names for that instance: row meta, grouping by agent, the overlay's top and blocked box,
// the toasts.
test("single agent mode shows no agent names", () => {
  const main = source("main.js"), viewer = source("viewer.js"), watcher = source("watcher.js");
  assert.match(main, /x\.single \? null : task\.assignee/, "row meta without the agent");
  assert.match(main, /hintOf\(task, x\.defaultAssignee, \{ single: x\.single \}\)/);
  assert.match(main, /single && this\.f\.group === "agent" \? "status" : this\.f\.group/, "no grouping by agent");
  assert.match(viewer, /single \? null : task\.assignee \?\? "unassigned"/, "overlay top without the agent");
  assert.match(viewer, /!single && task\.assignee \? `\$\{task\.assignee\} is blocked` : "Blocked"/);
  assert.match(viewer, /activityOf\(this\.detail, \{ agents, instance: this\.machine \}\)/);
  assert.match(watcher, /toastOf\(c, \{ single: isSingleAgent\(w\.settings, c\.machine\) \}\)/);
});

// As ghchecker's: while the priority and grouping row is closed and one of them is not its default, the filter icon
// carries the grey 6 px dot.
test("the filter button marks hidden filters with ghchecker's dot", () => {
  const src = source("main.js");
  assert.match(src, /const hiddenSet = !this\.filtering && \(this\.f\.prio !== "all" \|\| this\.f\.group !== "status"\)/);
  assert.match(src, /\{ marked: hiddenSet \}/);
  assert.match(src, /\.when\(marked \|\| alarm \|\| gold, \(e\) => e\.child\(div\(\)\.absolute\(\)\.top\(2\)\.right\(2\)\.size\(6\)\.rounded\(3\)\.bg\(gold \? GOLD : alarm \? c\.red : t\.muted\)\)\)/);
});
