import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SETTINGS, CONFIG_FILE, parseSettings, defaults, loadSettings, withSettings, saveSettings, changedSettings, isSingleAgent,
} from "../mods/hermes-kanban/lib/settings.js";

test("defaults", () => assert.deepEqual(defaults(), { single_agent: [], "status.color": "color", "toast.needs_you": true,
  "toast.done": true, "sound.needs_you": true, "sound.done": false, badge: false, poll_seconds: 30, update_check: true, "author.custom": false, "author.name": null }));

test("every setting has a key, a type, a default and a description", () => {
  assert.equal(CONFIG_FILE, "hermes-kanban.json");
  for (const s of SETTINGS) {
    assert.match(s.key, /^[a-z_]+(\.[a-z_]+)?$/);
    assert.ok(["boolean", "machines", "choice", "text"].includes(s.type), s.key);
    assert.ok(s.label, s.key);
    assert.ok(s.about.length > 10, s.key);
    assert.ok("default" in s, s.key);
  }
  assert.match(SETTINGS.find((s) => s.key === "update_check").about, /Once a day, Hermes Kanban asks GitHub/);
});

test("a missing or empty file means the defaults, without problems", () => {
  for (const text of [null, undefined, "", "  \n"]) assert.deepEqual(parseSettings(text), { values: defaults(), problems: [] });
});

test("nested and dotted keys", () => {
  assert.deepEqual(parseSettings('{ "status": { "color": "mono" }, "toast": { "done": false }, "single_agent": [" devbox ", "devbox", ""] }').values,
    { ...defaults(), "status.color": "mono", "toast.done": false, single_agent: ["devbox"] });
  assert.equal(parseSettings('{ "sound.done": true }').values["sound.done"], true);
});

test("a wrong poll_seconds means the default", () => {
  for (const v of ["30", 45, 0, -15, null, true]) {
    const r = parseSettings(JSON.stringify({ poll_seconds: v }));
    assert.equal(r.values.poll_seconds, 30, String(v));
    assert.deepEqual(r.problems, ["poll_seconds"], String(v));
  }
  for (const v of [15, 30, 60, 120]) assert.equal(parseSettings(JSON.stringify({ poll_seconds: v })).values.poll_seconds, v);
});

test("broken values fall back to the default and are named", () => {
  const r = parseSettings('{ "single_agent": ["ok", 3], "status": { "color": "rainbow" }, "badge": "yes" }');
  assert.deepEqual(r.values, defaults());
  assert.deepEqual(r.problems, ["single_agent", "status.color", "badge"]);
  assert.deepEqual(parseSettings("{ not json").problems, ["hermes-kanban.json"]);
  assert.deepEqual(parseSettings("[1, 2]").values, defaults());
  assert.deepEqual(parseSettings('{ "other": 1 }'), { values: defaults(), problems: [] }, "unknown keys are left alone");
});

test("defaults are fresh copies", () => {
  const a = defaults(); a.single_agent.push("x");
  assert.deepEqual(defaults().single_agent, []);
});

test("isSingleAgent is per machine", () => {
  const s = { ...defaults(), single_agent: ["devbox"] };
  assert.equal(isSingleAgent(s, "devbox"), true);
  assert.equal(isSingleAgent(s, "labbox"), false);
  assert.equal(isSingleAgent(defaults(), "devbox"), false);
  assert.equal(isSingleAgent(null, "devbox"), false);
  assert.equal(isSingleAgent({ single_agent: "devbox" }, "devbox"), false, "only a list counts");
});

test("loadSettings reads hermes-kanban.json in the app folder; a failed read means the defaults", async () => {
  const asked = [];
  const r = await loadSettings(async (p) => { asked.push(p); return '{ "poll_seconds": 60 }'; }, () => "/app");
  assert.deepEqual(asked, ["/app/hermes-kanban.json"]);
  assert.equal(r.values.poll_seconds, 60);
  assert.deepEqual((await loadSettings(async () => null, () => "/app")).values, defaults());
  assert.deepEqual((await loadSettings(async () => { throw new Error("denied"); }, () => "/app")).values, defaults());
});

test("withSettings writes nested keys and keeps the rest", () => {
  const out = JSON.parse(withSettings('{ "other": 1, "toast.done": true }', { "toast.done": false, "status.color": "mono", single_agent: ["devbox"], poll_seconds: 60 }));
  assert.deepEqual(out, { other: 1, "toast.done": false, status: { color: "mono" }, single_agent: ["devbox"], poll_seconds: 60 });
  assert.deepEqual(JSON.parse(withSettings(null, { badge: true })), { badge: true });
  assert.throws(() => withSettings("{}", { poll_seconds: 45 }), /not a setting/);
  assert.throws(() => withSettings("{}", { nope: true }), /not a setting/);
});

test("withSettings never overwrites a broken file", async () => {
  assert.throws(() => withSettings("{ broken", { badge: true }));
  assert.throws(() => withSettings("[1]", { badge: true }), /not a JSON object/);
  const writes = [];
  await assert.rejects(saveSettings({ badge: true }, {
    readTextFile: async () => "{ broken", writeTextFile: async (...a) => { writes.push(a); }, appHome: () => "/app",
  }));
  assert.deepEqual(writes, []);
});

test("saveSettings reads, then writes only if the file is unchanged (expected text)", async () => {
  const calls = [];
  await saveSettings({ poll_seconds: 15 }, { readTextFile: async () => null, writeTextFile: async (...a) => { calls.push(a); }, appHome: () => "/app" });
  assert.deepEqual(calls, [["/app/hermes-kanban.json", '{\n  "poll_seconds": 15\n}\n', null]]);
});

test("changedSettings: only what differs goes to the file", () => {
  const before = defaults();
  assert.deepEqual(changedSettings(before, { ...before }), {});
  assert.deepEqual(changedSettings(before, { ...before, badge: true, single_agent: ["devbox"] }), { badge: true, single_agent: ["devbox"] });
});

// The comment author: a text of 1 to 64 characters, trimmed; anything else is invalid and means no custom name.
test("author.name: trimmed, 1 to 64 characters, else invalid", () => {
  assert.equal(parseSettings('{ "author": { "name": "  Jane Doe " } }').values["author.name"], "Jane Doe");
  assert.equal(parseSettings(JSON.stringify({ "author.name": "z".repeat(64) })).values["author.name"], "z".repeat(64));
  for (const bad of ["", "   ", "z".repeat(65), 7, null, ["Jane"]]) {
    const r = parseSettings(JSON.stringify({ "author.name": bad }));
    assert.equal(r.values["author.name"], null, JSON.stringify(bad));
    if (bad !== null) assert.deepEqual(r.problems, ["author.name"]);
  }
  assert.equal(parseSettings('{ "author": { "custom": true } }').values["author.custom"], true);
  assert.deepEqual(parseSettings('{ "author.custom": "yes" }').problems, ["author.custom"]);
});

test("withSettings: a custom name is written trimmed-checked, and null clears it", () => {
  const set = JSON.parse(withSettings('{ "badge": true }', { "author.custom": true, "author.name": "ACME Ops" }));
  assert.deepEqual(set, { badge: true, author: { custom: true, name: "ACME Ops" } });
  const cleared = JSON.parse(withSettings(JSON.stringify(set), { "author.custom": false, "author.name": null }));
  assert.deepEqual(cleared, { badge: true, author: { custom: false } });
  // A dotted key the person wrote goes too.
  assert.deepEqual(JSON.parse(withSettings('{ "author.name": "Jane Doe" }', { "author.name": null })), {});
  assert.throws(() => withSettings("{}", { "author.name": "" }), /not a setting/);
  assert.throws(() => withSettings("{}", { "author.name": "z".repeat(65) }), /not a setting/);
  assert.throws(() => withSettings("{}", { badge: null }), /not a setting/, "only a setting without a default clears");
});
