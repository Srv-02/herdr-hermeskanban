import { test } from "node:test";
import assert from "node:assert/strict";
import { buttonAction, focusedInstance, hasHermes, isHermes, jumpTarget, rememberPane, visibleMachines, toastCommand, parseToastCommand } from "../mods/hermes-kanban/lib/instances.js";

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
// The watcher's snapshots: devbox runs Hermes, labbox has no kanban.db, nobox no snapshot yet.
const boards = { devbox: { machine: "devbox", hermes: true }, labbox: { machine: "labbox", hermes: false } };

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

test("hasHermes: a snapshot with hermes true, never this Mac", () => {
  assert.equal(hasHermes(boards, "devbox"), true);
  assert.equal(hasHermes(boards, "labbox"), false);
  assert.equal(hasHermes(boards, "nobox"), false);
  assert.equal(hasHermes({ null: { hermes: true } }, null), false);
  assert.equal(hasHermes(undefined, "devbox"), false);
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

test("focusedInstance: a shell pane before the first poll is no Hermes", () => {
  assert.deepEqual(focusedInstance({ spaces, panes, focused: f({ pane: "devbox/p2", terminal: "devbox/x2" }) }, last),
    { machine: "devbox", pane: null, hermes: false });
});

test("focusedInstance: a shell pane on a machine that runs Hermes is that Hermes", () => {
  assert.deepEqual(focusedInstance({ spaces, panes, boards, focused: f({ pane: "devbox/p2", terminal: "devbox/x2" }) }, last),
    { machine: "devbox", pane: "devbox/p2", hermes: true });
  // a terminal block on that machine, with and without a pane behind it
  assert.deepEqual(focusedInstance({ spaces, panes, boards, focused: f({ space: "s2", tab: "t3", terminal: "devbox/x2" }) }, last),
    { machine: "devbox", pane: "devbox/p2", hermes: true });
  assert.deepEqual(focusedInstance({ spaces, panes: [], boards, focused: f({ terminal: "devbox/t7" }) }, last),
    { machine: "devbox", pane: "devbox/t7", hermes: true });
});

test("focusedInstance: a shell pane on a machine without Hermes or without snapshot is no Hermes", () => {
  assert.deepEqual(focusedInstance({ spaces, panes, boards, focused: f({ space: "s2", tab: "t3", pane: "labbox/p4", terminal: "labbox/x4" }) }, last),
    { machine: "labbox", pane: null, hermes: false });
  const nobox = [...spaces, { id: "s9", machine: "nobox", tabs: [{ id: "t9" }] }];
  const noPanes = [...panes, { pane: "nobox/p9", terminal: "nobox/x9", tab: "t9", app: null, program: shell }];
  assert.deepEqual(focusedInstance({ spaces: nobox, panes: noPanes, boards, focused: f({ space: "s9", tab: "t9", pane: "nobox/p9", terminal: "nobox/x9" }) }, last),
    { machine: "nobox", pane: null, hermes: false });
});

test("focusedInstance: a Hermes pane counts before the first poll knows its machine", () => {
  const nobox = [...spaces, { id: "s9", machine: "nobox", tabs: [{ id: "t9" }] }];
  const noPanes = [...panes, { pane: "nobox/p9", terminal: "nobox/x9", tab: "t9", app: null, program: hermesProg }];
  assert.deepEqual(focusedInstance({ spaces: nobox, panes: noPanes, boards, focused: f({ space: "s9", tab: "t9", pane: "nobox/p9", terminal: "nobox/x9" }) }, last),
    { machine: "nobox", pane: "nobox/p9", hermes: true });
  assert.deepEqual(focusedInstance({ spaces: nobox, panes: noPanes, boards: undefined, focused: f({ space: "s9", tab: "t9", pane: "nobox/p9", terminal: "nobox/x9" }) }, last),
    { machine: "nobox", pane: "nobox/p9", hermes: true });
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
  // also with a snapshot that claims Hermes for this Mac
  assert.deepEqual(focusedInstance({ spaces, panes, boards: { ...boards, null: { hermes: true } }, focused: f({ space: "s3", tab: "t4", pane: "p5", terminal: "x5" }) }, last),
    { machine: null, pane: null, hermes: false });
});

test("focusedInstance: nothing focused is no Hermes", () => {
  assert.deepEqual(focusedInstance({ spaces, panes, focused: null }, last), { machine: null, pane: null, hermes: false });
});

test("jumpTarget: last focused terminal pane, else first Hermes pane, else first pane of a space there", () => {
  assert.deepEqual(jumpTarget("devbox", { spaces, panes }, { devbox: "devbox/p3" }), { pane: "devbox/p3" });
  assert.deepEqual(jumpTarget("devbox", { spaces, panes }, { devbox: "devbox/gone" }), { pane: "devbox/p1" });
  assert.deepEqual(jumpTarget("devbox", { spaces, panes }, {}), { pane: "devbox/p1" });
  assert.deepEqual(jumpTarget("labbox", { spaces, panes }, {}), { pane: "labbox/p4" });
  // a remembered shell pane wins over a Hermes pane
  assert.deepEqual(jumpTarget("devbox", { spaces, panes }, { devbox: "devbox/p2" }), { pane: "devbox/p2" });
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

test("rememberPane remembers a shell pane on a machine that runs Hermes, and jumpTarget goes there", () => {
  const focus = focusedInstance({ spaces, panes, boards, focused: f({ pane: "devbox/p2", terminal: "devbox/x2" }) });
  const lp = rememberPane({ devbox: "devbox/p1" }, focus, panes);
  assert.deepEqual(lp, { devbox: "devbox/p2" });
  assert.deepEqual(jumpTarget("devbox", { spaces, panes }, lp), { pane: "devbox/p2" });
  // a shell pane on a machine without Hermes is not remembered
  const other = focusedInstance({ spaces, panes, boards, focused: f({ space: "s2", tab: "t3", pane: "labbox/p4", terminal: "labbox/x4" }) });
  assert.equal(rememberPane(lp, other, panes), lp);
});

test("rememberPane keeps only pane ids, never a terminal block's address", () => {
  const lp = { devbox: "devbox/p1" };
  // A layout terminal block without a pane: focusedInstance names it by its address.
  assert.equal(rememberPane(lp, { machine: "devbox", pane: "devbox/t7", hermes: true }, panes), lp);
  assert.equal(rememberPane(lp, { machine: "devbox", pane: "devbox/x3", hermes: true }, panes), lp);
  assert.equal(rememberPane(lp, { machine: "devbox", pane: "devbox/p3", hermes: true }, undefined), lp);
});

const machines = ["devbox", "labbox", "nobox"];
const onDevbox = { machine: "devbox", pane: "devbox/p1", hermes: true };
const shellOnDevbox = { machine: "devbox", pane: null, hermes: false };

test("buttonAction: another instance that needs you is a jump, the first by name, Hermes or not", () => {
  const unseen = { nobox: { needs: 1, done: 0 }, labbox: { needs: 2, done: 0 } };
  assert.deepEqual(buttonAction({ focus: onDevbox, machines, unseen, on: true }), { kind: "jump", machine: "labbox", otherwise: "toggle" });
  assert.deepEqual(buttonAction({ focus: { machine: null, pane: null, hermes: false }, machines, unseen, on: false }), { kind: "jump", machine: "labbox", otherwise: "off" });
});

test("buttonAction: the shown instance needing you is no jump, a shell pane there is", () => {
  const unseen = { devbox: { needs: 1, done: 0 } };
  assert.deepEqual(buttonAction({ focus: onDevbox, machines, unseen, on: false }), { kind: "toggle" });
  // A focus on devbox without Hermes (no snapshot says so yet): the panel shows no board, so devbox's strip shows and
  // the button jumps there too.
  assert.deepEqual(buttonAction({ focus: shellOnDevbox, machines, unseen, on: false }), { kind: "jump", machine: "devbox", otherwise: "off" });
});

test("buttonAction: a needs-you event of an instance that is not visible is no jump", () => {
  assert.deepEqual(buttonAction({ focus: onDevbox, machines: ["devbox"], unseen: { labbox: { needs: 1, done: 0 } }, on: false }), { kind: "toggle" });
});

test("buttonAction: green (done) on another instance jumps too", () => {
  const unseen = { labbox: { needs: 0, done: 3 } };
  assert.deepEqual(buttonAction({ focus: onDevbox, machines, unseen, on: true }), { kind: "jump", machine: "labbox", otherwise: "toggle" });
  assert.deepEqual(buttonAction({ focus: shellOnDevbox, machines, unseen, on: true }), { kind: "jump", machine: "labbox", otherwise: "close" });
});

test("buttonAction: red wins over green, whatever the names", () => {
  const unseen = { devbox: { needs: 0, done: 2 }, nobox: { needs: 1, done: 0 } };
  assert.deepEqual(buttonAction({ focus: { machine: null, pane: null, hermes: false }, machines, unseen, on: false }), { kind: "jump", machine: "nobox", otherwise: "off" });
  // With only green ones, the first by name.
  const green = { nobox: { needs: 0, done: 1 }, labbox: { needs: 0, done: 4 } };
  assert.deepEqual(buttonAction({ focus: onDevbox, machines, unseen: green, on: false }), { kind: "jump", machine: "labbox", otherwise: "toggle" });
});

test("buttonAction: the shown instance's own dot, red or green, is no jump", () => {
  for (const u of [{ needs: 1, done: 0 }, { needs: 0, done: 1 }, { needs: 2, done: 5 }]) {
    assert.deepEqual(buttonAction({ focus: onDevbox, machines, unseen: { devbox: u }, on: true }), { kind: "toggle" });
  }
  // A green dot on an instance that is not visible is no jump either.
  assert.deepEqual(buttonAction({ focus: onDevbox, machines: ["devbox"], unseen: { labbox: { needs: 0, done: 1 } }, on: false }), { kind: "toggle" });
});

test("buttonAction: without Hermes the button is off, but a shown panel still closes", () => {
  assert.deepEqual(buttonAction({ focus: shellOnDevbox, machines, unseen: {}, on: false }), { kind: "off" });
  assert.deepEqual(buttonAction({ focus: shellOnDevbox, machines, unseen: undefined, on: true }), { kind: "close" });
  assert.deepEqual(buttonAction({ focus: null, machines: undefined, unseen: null, on: false }), { kind: "off" });
});

test("buttonAction: a shell pane on a machine that runs Hermes toggles, and is the shown instance", () => {
  const focus = focusedInstance({ spaces, panes, boards, focused: f({ pane: "devbox/p2", terminal: "devbox/x2" }) });
  assert.deepEqual(buttonAction({ focus, machines, unseen: { devbox: { needs: 2, done: 0 } }, on: false }), { kind: "toggle" });
  const labFocus = focusedInstance({ spaces, panes, boards, focused: f({ space: "s2", tab: "t3", pane: "labbox/p4", terminal: "labbox/x4" }) });
  assert.deepEqual(buttonAction({ focus: labFocus, machines, unseen: {}, on: false }), { kind: "off" });
});

test("buttonAction: a click into the panel keeps the last Hermes focus, so the button toggles", () => {
  const focus = focusedInstance({ spaces, panes, focused: f({}) }, onDevbox);
  assert.deepEqual(buttonAction({ focus, machines, unseen: {}, on: true }), { kind: "toggle" });
});

test("toastCommand and parseToastCommand carry machine and ID through the mod command", () => {
  const cmd = toastCommand("devbox", "t_a1b2");
  assert.equal(cmd, "hermes-kanban.toast:devbox/t_a1b2");
  // herdr hands nextCommand() the part after the first dot.
  const sent = (c) => c.slice(c.indexOf(".") + 1);
  assert.deepEqual(parseToastCommand(sent(cmd)), { machine: "devbox", id: "t_a1b2" });
  assert.deepEqual(parseToastCommand(sent(toastCommand("lab/box:2", "t/x y"))), { machine: "lab/box:2", id: "t/x y" });
  for (const c of ["refresh", "focus", "toast:", "toast:devbox", "toast:devbox/", "toast:a/b/c", "toast:%E0%A4%A/x", null, undefined, 7]) {
    assert.equal(parseToastCommand(c), null, String(c));
  }
});
