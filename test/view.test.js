import { test } from "node:test";
import assert from "node:assert/strict";
import { NEEDS_YOU, OPEN_DONE, filterTasks, groupTasks, hintOf, prioLabel, agentsLabel, toggleAgent, pickedAgents } from "../mods/hermes-kanban/lib/view.js";

const ORDER = ["triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done"];
const t = (id, o = {}) => ({
  machine: "devbox", id, title: `title ${id}`, status: "todo", assignee: null, priority: 0, createdAt: 100,
  summary: null, failure: null, ...o,
});
const tasks = [
  t("t_1", { status: "done", assignee: "coder" }),
  t("t_2", { status: "blocked", assignee: "coder", summary: "needs key" }),
  t("t_3", { status: "ready", priority: 1 }),
  t("t_4", { status: "running", assignee: "analyst", priority: 3 }),
  t("t_5", { status: "ready", priority: 2, assignee: "coder" }),
  t("t_6", { status: "ready", priority: 2, assignee: "coder", createdAt: 50 }),
];

test("groupTasks: Hermes order, empty groups hidden, blocked and review need you", () => {
  const g = groupTasks(tasks, "status", ORDER);
  assert.deepEqual(g.map((x) => x.key), ["ready", "running", "blocked", "done"]);
  assert.deepEqual(g.map((x) => x.needsYou), [false, false, true, false]);
  assert.equal(g[0].count, 3);
});

test("groupTasks: higher priority first, then oldest first", () => {
  const g = groupTasks(tasks, "status", ORDER);
  assert.deepEqual(g[0].tasks.map((x) => x.id), ["t_6", "t_5", "t_3"]);
});

test("groupTasks: unknown status goes last, labels optional", () => {
  const g = groupTasks([t("t_7", { status: "odd" }), t("t_8", { status: "done" })], "status", ORDER, { done: "Done" });
  assert.deepEqual(g.map((x) => [x.key, x.label]), [["done", "Done"], ["odd", "odd"]]);
});

test("groupTasks by agent puts none last", () => {
  const g = groupTasks(tasks, "agent", ORDER);
  assert.deepEqual(g.map((x) => x.key), ["analyst", "coder", "none"]);
  assert.ok(g.every((x) => !x.needsYou));
});

test("groupTasks by none gives one group", () => {
  const g = groupTasks(tasks, "none", ORDER);
  assert.equal(g.length, 1);
  assert.equal(g[0].count, 6);
  assert.deepEqual(groupTasks([], "none", ORDER), []);
});

test("filterTasks: open hides done; agent none; P3+ means priority >= 3", () => {
  const f = (o) => filterTasks(tasks, { state: "open", query: "", agents: [], prio: "all", ...o }).map((x) => x.id);
  assert.ok(!f({}).includes("t_1"));
  assert.deepEqual(f({ state: "done" }), ["t_1"]);
  assert.equal(f({ state: "all" }).length, 6);
  assert.deepEqual(f({ agents: ["none"] }), ["t_3"]);
  assert.deepEqual(f({ agents: ["analyst"] }), ["t_4"]);
  assert.deepEqual(f({ prio: "p1" }), ["t_3"]);
  assert.deepEqual(f({ prio: "p2" }), ["t_5", "t_6"]);
  assert.deepEqual(f({ prio: "p3+" }), ["t_4"]);
});

test("filterTasks: query matches id, title, agent", () => {
  const f = (query) => filterTasks(tasks, { state: "all", query, agents: [], prio: "all" }).map((x) => x.id);
  assert.deepEqual(f("T_3"), ["t_3"]);
  assert.deepEqual(f("title t_4"), ["t_4"]);
  assert.deepEqual(f("ANALYST"), ["t_4"]);
  assert.deepEqual(f("nothing"), []);
});

test("hintOf: blocked reason from summary, then failure, else 'blocked'", () => {
  assert.deepEqual(hintOf(t("a", { status: "blocked", summary: "s", failure: "f" }), ""), { text: "s", tone: "red" });
  assert.deepEqual(hintOf(t("a", { status: "blocked", failure: "f" }), ""), { text: "f", tone: "red" });
  assert.deepEqual(hintOf(t("a", { status: "blocked" }), ""), { text: "blocked", tone: "red" });
});

test("hintOf: ready without agent depends on kanban.default_assignee", () => {
  const readyNoAgent = t("a", { status: "ready" });
  assert.deepEqual(hintOf(readyNoAgent, ""), { text: "no agent, will not start", tone: "orange" });
  assert.deepEqual(hintOf(readyNoAgent, "coder"), { text: "goes to coder", tone: "blue" });
});

test("hintOf: ready with agent starts, others have no hint", () => {
  assert.deepEqual(hintOf(t("a", { status: "ready", assignee: "coder" }), ""), { text: "starts with next dispatch", tone: "blue" });
  assert.equal(hintOf(t("a", { status: "running" }), ""), null);
});

test("prioLabel", () => {
  assert.equal(prioLabel(0), null);
  assert.equal(prioLabel(-1), null);
  assert.equal(prioLabel(2), "P2");
});

test("NEEDS_YOU and OPEN_DONE", () => {
  assert.deepEqual(NEEDS_YOU, ["blocked", "review"]);
  assert.ok(OPEN_DONE.open(t("a")) && !OPEN_DONE.open(t("a", { status: "done" })));
  assert.ok(OPEN_DONE.done(t("a", { status: "done" })) && OPEN_DONE.all(t("a")));
});

test("groupTasks: a task without createdAt sorts after dated ones of equal priority", () => {
  const list = [t("t_n", { createdAt: null }), t("t_new", { createdAt: 200 }), t("t_old", { createdAt: 10 })];
  assert.deepEqual(groupTasks(list, "none", ORDER)[0].tasks.map((x) => x.id), ["t_old", "t_new", "t_n"]);
});

test("hintOf: a missing default assignee reads like an empty one", () => {
  const readyNoAgent = t("a", { status: "ready" });
  for (const d of [null, undefined]) assert.deepEqual(hintOf(readyNoAgent, d), { text: "no agent, will not start", tone: "orange" });
});

// ---- the task overlay ----
import { activityOf, blockReason, runLine, prioChoices } from "../mods/hermes-kanban/lib/view.js";

test("activityOf: events and comments, newest first, with the reason of a block", () => {
  const detail = {
    events: [
      { kind: "created", at: 100, payload: null },
      { kind: "claimed", at: 200, payload: { lock: "w1" } },
      { kind: "blocked", at: 400, payload: { reason: "needs input: which range?" } },
      { kind: "crashed", at: 300, payload: { error: "no binary" } },
    ],
    comments: [{ author: "herdr", body: "Only v2.4", at: 500 }],
  };
  assert.deepEqual(activityOf(detail), [
    { at: 500, text: "herdr commented: Only v2.4", tone: "blue" },
    { at: 400, text: "Blocked: needs input: which range?", tone: "red" },
    { at: 300, text: "Crashed: no binary", tone: "red" },
    { at: 200, text: "Claimed", tone: "yellow" },
    { at: 100, text: "Created", tone: null },
  ]);
  assert.deepEqual(activityOf({ events: [], comments: [] }), []);
});

// Hermes' event kinds (kanban_db.py): no heartbeats in the list, no "commented" twice next to the comment itself.
test("activityOf: heartbeats left out, commented events only without listed comments, status events say the status", () => {
  const events = [
    { kind: "heartbeat", at: 150, payload: null },
    { kind: "commented", at: 160, payload: { author: "herdr" } },
    { kind: "status", at: 170, payload: { status: "todo" } },
    { kind: "spawned", at: 180, payload: null },
    { kind: "timed_out", at: 190, payload: null },
    { kind: "gave_up", at: 191, payload: null },
    { kind: "reclaimed", at: 192, payload: null },
    { kind: "completed", at: 193, payload: { summary: "notes written" } },
  ];
  const withComments = activityOf({ events, comments: [{ author: "herdr", body: "hi", at: 160 }] });
  assert.deepEqual(withComments.map((a) => a.text), ["Completed: notes written", "Reclaimed", "Gave up", "Timed out", "Spawned", "Status: todo", "herdr commented: hi"]);
  assert.deepEqual(withComments.map((a) => a.tone), [null, "red", "red", "red", "yellow", null, "blue"]);
  const without = activityOf({ events, comments: [] });
  assert.ok(without.some((a) => a.text === "Commented"), "a commented event shows when no comment is listed");
  assert.ok(!without.some((a) => /heartbeat/i.test(a.text)));
});

test("blockReason: the newest blocked event's reason, then the summary, then the failure", () => {
  const events = [
    { kind: "blocked", at: 100, payload: { reason: "old reason" } },
    { kind: "blocked", at: 300, payload: { reason: "needs input: which range?" } },
    { kind: "unblocked", at: 200, payload: null },
  ];
  assert.equal(blockReason({ events }, { summary: "s", failure: "f" }), "needs input: which range?");
  assert.equal(blockReason({ events: [{ kind: "blocked", at: 1, payload: null }] }, { summary: "s", failure: "f" }), "s");
  assert.equal(blockReason(null, { summary: null, failure: "breaker: 3 crashes" }), "breaker: 3 crashes");
  assert.equal(blockReason(null, { summary: "", failure: null }), null);
});

test("runLine: id, outcome and duration; a running run counts to now", () => {
  assert.equal(runLine({ id: 7, status: "done", outcome: "blocked", startedAt: 100, endedAt: 352 }, 999), "#7 blocked · 4m 12s");
  assert.equal(runLine({ id: 8, status: "running", outcome: null, startedAt: 100, endedAt: null }, 140), "#8 running · 0m 40s");
  assert.equal(runLine({ id: 9, status: "queued", outcome: null, startedAt: null, endedAt: null }, 140), "#9 queued");
});

test("prioChoices: none and P1-P4 as Hermes' raw values, and a present value above 4", () => {
  assert.deepEqual(prioChoices(2), [[0, "none"], [1, "P1"], [2, "P2"], [3, "P3"], [4, "P4"]]);
  assert.deepEqual(prioChoices(7), [[0, "none"], [1, "P1"], [2, "P2"], [3, "P3"], [4, "P4"], [7, "P7"]]);
});

test("hintOf in single agent mode names no agent", () => {
  const ready = t("a", { status: "ready" });
  assert.deepEqual(hintOf(ready, "coder", { single: true }), { text: "starts with next dispatch", tone: "blue" });
  assert.deepEqual(hintOf(ready, "", { single: true }), { text: "no agent, will not start", tone: "orange" });
});

test("activityOf in single agent mode names the instance for an agent's comment", () => {
  const detail = { events: [], comments: [{ at: 2, author: "default", body: "done it" }, { at: 1, author: "herdr", body: "go" }] };
  const texts = activityOf(detail, { agents: ["default"], instance: "devbox" }).map((x) => x.text);
  assert.deepEqual(texts, ["devbox commented: done it", "herdr commented: go"]);
});

// The agent filter picks several: a task matches when its agent (or "none" for no agent) is picked; none picked = all.
test("filterTasks: several agents, no agent among them, empty means all", () => {
  const f = (agents) => filterTasks(tasks, { state: "all", query: "", agents, prio: "all" }).map((x) => x.id).sort();
  const all = f([]);
  assert.equal(all.length, 6);
  assert.deepEqual(f(["analyst", "none"]), ["t_3", "t_4"]);
  assert.deepEqual(f(["analyst", "coder", "none"]), all);
  assert.deepEqual(f(["nobody"]), []);
});

test("toggleAgent: a pick toggles, All agents clears", () => {
  assert.deepEqual(toggleAgent([], "coder"), ["coder"]);
  assert.deepEqual(toggleAgent(["coder"], "none"), ["coder", "none"]);
  assert.deepEqual(toggleAgent(["coder", "none"], "coder"), ["none"]);
  assert.deepEqual(toggleAgent(["coder", "none"], "all"), []);
});

test("agentsLabel: All agents, the one name, or the count", () => {
  assert.equal(agentsLabel([]), "All agents");
  assert.equal(agentsLabel(["coder"]), "coder");
  assert.equal(agentsLabel(["none"]), "no agent");
  assert.equal(agentsLabel(["coder", "none"]), "2 agents");
});

// What applies on a board: only picks it knows (its agents and "none"); single agent mode lifts the filter.
test("pickedAgents: unknown names drop out, single agent mode picks all", () => {
  assert.deepEqual(pickedAgents(["coder", "gone", "none"], ["coder", "analyst"], false), ["coder", "none"]);
  assert.deepEqual(pickedAgents(["coder"], ["coder"], true), []);
  assert.deepEqual(pickedAgents("coder", ["coder"], false), [], "an old single value is dropped");
});

// Single agent mode hides the agent: the search does not find a task by it either.
test("filterTasks: in single agent mode the query does not match the agent", () => {
  const f = (single) => filterTasks(tasks, { state: "all", query: "analyst", agents: [], prio: "all", single }).map((x) => x.id);
  assert.deepEqual(f(false), ["t_4"]);
  assert.deepEqual(f(true), []);
});
