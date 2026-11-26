// Adapted from ghchecker by Michael Mayer (MIT), test/lease.test.js (renew every minute, take over after 3 minutes).
import { test } from "node:test";
import assert from "node:assert/strict";
import { leaseNext, LEASE_RENEW_MS, LEASE_TTL_MS } from "../mods/hermes-kanban/lib/lease.js";

test("no lease: take over and write", () => {
  assert.deepEqual(leaseNext(null, "me", 100), { owner: "me", at: 100, mine: true, write: true });
  assert.deepEqual(leaseNext({ owner: "x" }, "me", 100), { owner: "me", at: 100, mine: true, write: true }, "no time: no lease");
});
test("own lease: not rewritten before a minute, renewed from a minute", () => {
  assert.equal(LEASE_RENEW_MS, 60000);
  assert.deepEqual(leaseNext({ owner: "me", at: 1000 }, "me", 60999), { owner: "me", at: 1000, mine: true, write: false });
  assert.deepEqual(leaseNext({ owner: "me", at: 1000 }, "me", 61000), { owner: "me", at: 61000, mine: true, write: true });
});
test("foreign lease: kept up to 3 minutes, taken over after", () => {
  assert.equal(LEASE_TTL_MS, 180000);
  assert.deepEqual(leaseNext({ owner: "o", at: 1000 }, "me", 181000), { owner: "o", at: 1000, mine: false, write: false });
  assert.deepEqual(leaseNext({ owner: "o", at: 1000 }, "me", 181001), { owner: "me", at: 181001, mine: true, write: true });
});
