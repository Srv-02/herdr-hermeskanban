import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTHOR_MAX, cleanAuthor, readOsName, authorOf } from "../mods/hermes-kanban/lib/author.js";

// A fake exec for `id`: answers by its flag, records the calls.
const idExec = (answers) => {
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push([cmd, ...args]);
    const a = answers[args[0]];
    if (a instanceof Error) throw a;
    return a ?? { code: 1, stdout: "", stderr: "id: illegal option" };
  };
  return { exec, calls };
};

test("readOsName: the full name from id -F, trimmed", async () => {
  const { exec, calls } = idExec({ "-F": { code: 0, stdout: "  Jane Doe\n", stderr: "" } });
  assert.equal(await readOsName(exec), "Jane Doe");
  assert.deepEqual(calls, [["id", "-F"]]);
});

test("readOsName: falls to id -un on a failed or empty id -F, then to herdr", async () => {
  for (const first of [{ code: 1, stdout: "Jane Doe\n", stderr: "" }, { code: 0, stdout: " \n", stderr: "" }, new Error("no id")]) {
    const { exec, calls } = idExec({ "-F": first, "-un": { code: 0, stdout: "jdoe\n", stderr: "" } });
    assert.equal(await readOsName(exec), "jdoe");
    assert.deepEqual(calls, [["id", "-F"], ["id", "-un"]]);
  }
  for (const second of [{ code: 2, stdout: "jdoe", stderr: "" }, { code: 0, stdout: "", stderr: "" }, new Error("no id")]) {
    const { exec } = idExec({ "-un": second });
    assert.equal(await readOsName(exec), "herdr");
  }
});

test("readOsName: a very long name is cut to the limit", async () => {
  const { exec } = idExec({ "-F": { code: 0, stdout: `${"x".repeat(100)}\n`, stderr: "" } });
  assert.equal((await readOsName(exec)).length, AUTHOR_MAX);
});

test("cleanAuthor: trimmed, at most 64 characters, null when empty or not a text", () => {
  assert.equal(AUTHOR_MAX, 64);
  assert.equal(cleanAuthor("  Jane Doe "), "Jane Doe");
  assert.equal(cleanAuthor("y".repeat(70)), "y".repeat(64));
  // Counted in characters, so an emoji is never cut in half.
  assert.equal(cleanAuthor("🎉".repeat(70)), "🎉".repeat(64));
  for (const v of ["", "   ", null, undefined, 7, ["Jane"]]) assert.equal(cleanAuthor(v), null);
});

test("authorOf: the custom name only with the switch on, else the OS name, else herdr", () => {
  assert.equal(authorOf({ "author.custom": true, "author.name": "ACME Ops" }, "Jane Doe"), "ACME Ops");
  assert.equal(authorOf({ "author.custom": false, "author.name": "ACME Ops" }, "Jane Doe"), "Jane Doe");
  assert.equal(authorOf({ "author.custom": true, "author.name": null }, "Jane Doe"), "Jane Doe");
  assert.equal(authorOf(null, "Jane Doe"), "Jane Doe");
  assert.equal(authorOf(null, undefined), "herdr");
  assert.equal(authorOf({ "author.custom": true, "author.name": "  " }, " "), "herdr");
});
