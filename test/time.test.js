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
