import { test } from "node:test";
import assert from "node:assert/strict";
import { focusedInstance, isHermes, jumpTarget, rememberPane, visibleMachines } from "../mods/hermes-kanban/lib/instances.js";

const spaces = [
  { id: "s1", machine: "devbox", tabs: [{ id: "t1" }, { id: "t2" }] },
  { id: "s2", machine: "labbox", tabs: [{ id: "t3" }] },
  { id: "s3", machine: null, tabs: [{ id: "t4" }] },
];
const shell = { key: "shell" };
const hermesProg = { key: "hermes" };
const panes = [
  { pane: "devbox/p1", terminal: "devbox/x1", tab: "t1", app: "hermes", program: hermesProg },
  { pane: "devbox/p2", terminal: "devbox/x2", tab: "t1", app: null, program: shell },
  { pane: "devbox/p3", terminal: "devbox/x3", tab: "t2", app: null, program: hermesProg },
  { pane: "labbox/p4", terminal: "labbox/x4", tab: "t3", app: null, program: shell },
  { pane: "p5", terminal: "x5", tab: "t4", app: "hermes", program: hermesProg },
];
const f = (o) => ({ space: "s1", tab: "t1", pane: null, terminal: null, shown: null, agent: null, cwd: null, ...o });
const last = { machine: "labbox", pane: "labbox/p9", hermes: true };

test("visibleMachines: machines with an open space only, never this Mac", () => {
  assert.deepEqual(visibleMachines([{ machine: "labbox" }, { machine: null }, { machine: "devbox" }, { machine: "devbox" }]), ["devbox", "labbox"]);
  assert.deepEqual(visibleMachines([]), []);
});

test("isHermes: by app or by program key", () => {
  assert.equal(isHermes({ app: "hermes", program: shell }), true);
  assert.equal(isHermes({ app: null, program: hermesProg }), true);
  assert.equal(isHermes({ app: null, program: shell }), false);
  assert.equal(isHermes({ app: null }), false);
});

test("focusedInstance: a Hermes pane in a space on a machine", () => {
  assert.deepEqual(focusedInstance({ spaces, panes, focused: f({ pane: "devbox/p1", terminal: "devbox/x1" }) }, last),
    { machine: "devbox", pane: "devbox/p1", hermes: true });
});

test("focusedInstance: a terminal block names its machine by prefix", () => {
  assert.deepEqual(focusedInstance({ spaces, panes, focused: f({ space: "s2", tab: "t3", terminal: "devbox/x3" }) }, last),
    { machine: "devbox", pane: "devbox/p3", hermes: true });
  assert.deepEqual(focusedInstance({ spaces, panes: [], focused: f({ terminal: "devbox/t7", agent: "hermes" }) }, last),
    { machine: "devbox", pane: "devbox/t7", hermes: true });
  assert.deepEqual(focusedInstance({ spaces, panes: [], focused: f({ terminal: "devbox/t7" }) }, last),
    { machine: "devbox", pane: null, hermes: false });
});

test("focusedInstance: a shell pane on a Hermes machine is no Hermes", () => {
  assert.deepEqual(focusedInstance({ spaces, panes, focused: f({ pane: "devbox/p2", terminal: "devbox/x2" }) }, last),
    { machine: "devbox", pane: null, hermes: false });
});

test("focusedInstance: a mod block with the keyboard keeps the last focus", () => {
  assert.deepEqual(focusedInstance({ spaces, panes, focused: f({}) }, last), last);
  assert.deepEqual(focusedInstance({ spaces, panes, focused: f({}) }, null), { machine: null, pane: null, hermes: false });
  const modPanes = [...panes, { pane: "devbox/m1", terminal: null, mod: "hermes-kanban", tab: "t1", app: null, program: null }];
  assert.deepEqual(focusedInstance({ spaces, panes: modPanes, focused: f({ pane: "devbox/m1" }) }, last), last);
});

test("focusedInstance: a local Hermes pane is not an instance", () => {
  assert.deepEqual(focusedInstance({ spaces, panes, focused: f({ space: "s3", tab: "t4", pane: "p5", terminal: "x5" }) }, last),
    { machine: null, pane: null, hermes: false });
});

test("focusedInstance: nothing focused is no Hermes", () => {
  assert.deepEqual(focusedInstance({ spaces, panes, focused: null }, last), { machine: null, pane: null, hermes: false });
});

test("jumpTarget: last focused Hermes pane, else first Hermes pane, else first pane of a space there", () => {
  assert.deepEqual(jumpTarget("devbox", { spaces, panes }, { devbox: "devbox/p3" }), { pane: "devbox/p3" });
  assert.deepEqual(jumpTarget("devbox", { spaces, panes }, { devbox: "devbox/gone" }), { pane: "devbox/p1" });
  assert.deepEqual(jumpTarget("devbox", { spaces, panes }, {}), { pane: "devbox/p1" });
  assert.deepEqual(jumpTarget("labbox", { spaces, panes }, {}), { pane: "labbox/p4" });
  // a remembered pane of another machine is ignored
  assert.deepEqual(jumpTarget("labbox", { spaces, panes }, { labbox: "devbox/p1" }), { pane: "labbox/p4" });
});

test("jumpTarget: null for a machine without open space", () => {
  assert.equal(jumpTarget("nobox", { spaces, panes }, {}), null);
  assert.equal(jumpTarget("devbox", { spaces: [{ id: "s1", machine: "devbox", tabs: [] }], panes }, {}), null);
});

test("jumpTarget: without a Hermes pane, a terminal pane before a mod pane", () => {
  const modFirst = [{ pane: "labbox/m1", terminal: null, mod: "hermes-kanban", tab: "t3" }, ...panes];
  assert.deepEqual(jumpTarget("labbox", { spaces, panes: modFirst }, {}), { pane: "labbox/p4" });
  const modOnly = [{ pane: "labbox/m1", terminal: null, mod: "hermes-kanban", tab: "t3" }];
  assert.deepEqual(jumpTarget("labbox", { spaces, panes: modOnly }, {}), { pane: "labbox/m1" });
});

test("rememberPane ignores non-Hermes focus", () => {
  const lp = { devbox: "devbox/p1" };
  const next = rememberPane(lp, { machine: "devbox", pane: "devbox/p3", hermes: true }, panes);
  assert.deepEqual(next, { devbox: "devbox/p3" });
  assert.notEqual(next, lp);
  assert.deepEqual(lp, { devbox: "devbox/p1" });
  assert.equal(rememberPane(next, { machine: "devbox", pane: "devbox/p3", hermes: true }, panes), next, "unchanged: the same map");
  assert.deepEqual(rememberPane(lp, { machine: "devbox", pane: null, hermes: false }, panes), lp);
  assert.deepEqual(rememberPane(lp, { machine: null, pane: "p5", hermes: true }, panes), lp);
});

test("rememberPane keeps only pane ids, never a terminal block's address", () => {
  const lp = { devbox: "devbox/p1" };
  // A layout terminal block without a pane: focusedInstance names it by its address.
  assert.equal(rememberPane(lp, { machine: "devbox", pane: "devbox/t7", hermes: true }, panes), lp);
  assert.equal(rememberPane(lp, { machine: "devbox", pane: "devbox/x3", hermes: true }, panes), lp);
  assert.equal(rememberPane(lp, { machine: "devbox", pane: "devbox/p3", hermes: true }, undefined), lp);
});
