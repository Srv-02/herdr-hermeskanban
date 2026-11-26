import { test } from "node:test";
import assert from "node:assert/strict";
import { ago } from "../mods/hermes-kanban/lib/time.js";

test("ago", () => {
  assert.equal(ago(1000, 1000), "now");
  assert.equal(ago(1000, 1000 + 59), "now");
  assert.equal(ago(1000, 1000 + 14 * 60), "14m");
  assert.equal(ago(1000, 1000 + 2 * 3600 + 5), "2h");
  assert.equal(ago(1000, 1000 + 3 * 86400), "3d");
  assert.equal(ago(null, 5), "");
  assert.equal(ago(2000, 1000), "now");
});

import { duration } from "../mods/hermes-kanban/lib/time.js";

test("duration: minutes and seconds, hours and minutes past an hour", () => {
  assert.equal(duration(100, 100 + 252), "4m 12s");
  assert.equal(duration(100, 140), "0m 40s");
  assert.equal(duration(100, 100 + 65), "1m 05s");
  assert.equal(duration(0, 3 * 3600 + 7 * 60 + 9), "3h 07m");
  assert.equal(duration(null, 5), "");
  assert.equal(duration(10, null), "");
  assert.equal(duration(10, 5), "0m 00s");
});
