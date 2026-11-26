// A fake Hermes for the screenshot instance: answers every command the mod runs on a machine (the curl requests to the
// Kanban API, the stamp, the probe, the access scripts, the gateway restart) with made-up data for two machines,
// devbox and labbox, so the README images never show a real board, machine, person or key.
// The demo hook (../demo-hook.mjs) points the instance's copy of the mod at this file: its exec runs
//   node hermes.mjs '<{ cmd, args, on }>' '<{ scene, state }>'
// locally and never reaches a machine. Times are relative to now, so "14m" stays 14 minutes old whenever the shots are
// taken. Writes (move, assign, comment, create, setup, restart) answer as Hermes does and change nothing.
//
// Scenes (DEMO_SCENE at prepare, baked into the copy by the hook):
//   board          the whole board of devbox (the default)
//   overlay        devbox without its ready and running tasks, so the first row is the blocked release notes
//   notifications  as board; once the file <state>/demo-turn exists, a running task on labbox needs input (its stamp
//                  changes with it), and the fake writes <state>/demo-turned when it served that board
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REQUEST_SCRIPT } from "../../../mods/hermes-kanban/lib/request.js";
import { STAMP_SCRIPT } from "../../../mods/hermes-kanban/lib/changes.js";
import { PROBE_SCRIPT, SETUP_SCRIPT, REMOVE_SCRIPT, DELETE_TOKEN_SCRIPT } from "../../../mods/hermes-kanban/lib/setup.js";

const MACHINES = ["devbox", "labbox"];
const ORDER = [["triage", "Triage"], ["todo", "Todo"], ["scheduled", "Scheduled"], ["ready", "Ready"], ["running", "Running"],
  ["blocked", "Blocked"], ["review", "Review"], ["done", "Done"]];
const MANUAL = {
  archived: ["ready", "todo", "triage"], blocked: ["done", "ready", "scheduled", "todo", "triage"], done: ["ready", "todo", "triage"],
  ready: ["blocked", "done", "review", "scheduled", "todo", "triage"], review: ["done", "ready", "todo", "triage"],
  running: ["blocked", "done", "ready", "review", "scheduled", "todo", "triage"], scheduled: ["ready", "todo", "triage"],
  todo: ["ready", "scheduled", "triage"], triage: ["ready", "todo"],
};

// One task as /board lists it: the fields the mod reads, the rest as Hermes sends them for a plain task.
function task(now, id, title, status, assignee, priority, minutes, extra = {}) {
  const created = Math.round(now - minutes * 60);
  return {
    id, title, body: null, assignee, status, priority, created_by: "dashboard", created_at: created,
    started_at: ["running", "blocked", "review", "done"].includes(status) ? created + 60 : null,
    completed_at: status === "done" ? created + Math.round(minutes * 30) : null,
    workspace_kind: "scratch", consecutive_failures: 0, last_failure_error: null, comment_count: 0,
    latest_summary: null, warnings: null, ...extra,
  };
}

function tasksOf(machine, { scene, turned, now }) {
  if (machine === "labbox") {
    return [
      task(now, "t_b7c8", "Check the nightly backup report", turned ? "blocked" : "running", "research", 2, 35,
        turned ? { latest_summary: "needs input: two backups are missing, retry them or skip?" } : {}),
      task(now, "t_d9e0", "Tag the v2.4 release candidate", "review", "coder", 1, 140, { latest_summary: "ready for review: tag v2.4.0-rc.1 built" }),
      task(now, "t_f1a2", "Clean up old build caches", "done", "coder", 0, 400),
    ];
  }
  const all = [
    task(now, "t_a1b2", "Draft release notes for v2.4", "blocked", "writer", 2, 125, {
      body: "Collect the changes since the last release and write short notes for the blog and the changelog.",
      latest_summary: "needs input: start from v2.3.0 or from the hotfix v2.3.2?", comment_count: 1,
    }),
    task(now, "t_k1l2", "Mirror the docs to example.com", "blocked", "coder", 1, 300, {
      consecutive_failures: 3, last_failure_error: "rsync: connection to docs.example.com timed out",
    }),
    task(now, "t_c3d4", "Fix the flaky login test", "running", "coder", 3, 26, { comment_count: 2 }),
    task(now, "t_e5f6", "Compare three vector databases", "running", "research", 1, 48),
    task(now, "t_o5p6", "Summarize last week's support tickets", "ready", "research", 2, 6),
    task(now, "t_m3n4", "Sort the inbox labels", "ready", null, 1, 95),
    task(now, "t_i9j0", "Review the API rate limits", "review", "coder", 2, 90, { latest_summary: "ready for review: limits raised to 600 per minute" }),
    task(now, "t_w3x4", "Translate the FAQ into German", "done", "writer", 1, 240),
    task(now, "t_y5z6", "Benchmark the search index", "done", "research", 0, 600),
  ];
  return scene === "overlay" ? all.filter((t) => !["ready", "running"].includes(t.status)) : all;
}

function board(machine, ctx) {
  const tasks = tasksOf(machine, ctx);
  return {
    columns: ORDER.map(([name]) => ({ name, tasks: tasks.filter((t) => t.status === name) })),
    assignees: ["coder", "research", "writer"],
    now: Math.round(ctx.now),
  };
}

// GET /tasks/{id}: the task with its body, comments, events and runs. The release notes carry the full story.
function detail(machine, id, ctx) {
  const t = tasksOf(machine, { ...ctx, scene: "board" }).find((x) => x.id === id);
  if (!t) return null;
  const at = (s) => t.created_at + s;
  const events = [{ id: 1, task_id: id, kind: "created", payload: null, created_at: t.created_at, run_id: null }];
  const runs = [];
  const comments = [];
  if (t.started_at) {
    events.push({ id: 2, task_id: id, kind: "claimed", payload: { lock: "worker-1" }, created_at: t.started_at, run_id: 7 });
    runs.push({ id: 7, task_id: id, profile: t.assignee, status: t.status === "done" ? "done" : t.status, started_at: t.started_at,
      ended_at: t.status === "running" ? null : at(1800), outcome: t.status === "running" ? null : t.status === "done" ? "completed" : t.status,
      summary: t.latest_summary, error: t.last_failure_error });
  }
  if (id === "t_a1b2") {
    events.push({ id: 3, task_id: id, kind: "blocked", payload: { reason: t.latest_summary }, created_at: at(4200), run_id: 7 });
    comments.push({ id: 5, task_id: id, author: "writer", body: "The last release was v2.3.2, a hotfix. Should the notes start at v2.3.0 or at v2.3.2?", created_at: at(4200) });
  }
  if (t.status === "done") events.push({ id: 4, task_id: id, kind: "completed", payload: { summary: "done" }, created_at: t.completed_at, run_id: 7 });
  return { task: t, comments, events, attachments: [], links: { parents: [], children: [] }, link_tasks: [], child_results: [], runs };
}

const STATUS = {
  version: "0.23.4", release_date: "2026.11.20", gateway_running: true, gateway_state: "running", active_agents: 2,
  auth_required: true, auth_providers: ["session-token"], overall: "ok",
};

function diagnostics(machine) {
  if (machine !== "devbox") return { diagnostics: [] };
  return { diagnostics: [{ task_id: "t_k1l2", task_title: "Mirror the docs to example.com", task_status: "blocked", task_assignee: "coder",
    diagnostics: [{ kind: "repeated_failures", severity: "error", title: "Task keeps failing", detail: "3 failures in a row.", actions: [], count: 1 }] }] };
}

// One curl request of REQUEST_SCRIPT: $1 mode, $2 method, $3 URL, $4 body. Prints the body and the HTTP code as curl's
// -w would.
function request(machine, [mode, method, url, body], ctx) {
  const http = (code, json) => ({ code: 0, stdout: `${JSON.stringify(json)}\n${code}`, stderr: "" });
  const u = new URL(url);
  if (u.pathname === "/api/status") return http(200, STATUS);
  const KANBAN = "/api/plugins/kanban";
  if (!u.pathname.startsWith(KANBAN) || u.searchParams.get("board") !== "default") return http(404, { detail: "not found" });
  if (mode !== "gated") return http(401, { detail: "unauthorized" });
  const p = u.pathname.slice(KANBAN.length);
  const sent = body ? JSON.parse(body) : {};
  if (method === "GET" && p === "/board") {
    if (machine === "labbox" && ctx.turned && ctx.state) fs.writeFileSync(path.join(ctx.state, "demo-turned"), "");
    return http(200, board(machine, ctx));
  }
  if (method === "GET" && p === "/workflow") return http(200, { columns: ORDER.map(([key, label]) => ({ key, label })), manual: MANUAL, archived: "archived" });
  if (method === "GET" && p === "/orchestration") return http(200, { default_assignee: "", resolved_default_assignee: "writer", active_profile: "writer" });
  if (method === "GET" && p === "/diagnostics") return http(200, diagnostics(machine));
  if (method === "GET" && p === "/stats") return http(200, { total: tasksOf(machine, ctx).length });
  const m = p.match(/^\/tasks\/([A-Za-z0-9_-]+)(\/comments)?$/);
  if (m && method === "GET" && !m[2]) {
    const d = detail(machine, m[1], ctx);
    return d ? http(200, d) : http(404, { detail: "task not found" });
  }
  if (m && method === "PATCH" && !m[2]) {
    const d = detail(machine, m[1], ctx);
    return d ? http(200, { task: { ...d.task, ...sent, assignee: sent.assignee === "" ? null : sent.assignee ?? d.task.assignee } }) : http(200, { task: null });
  }
  if (m && method === "POST" && m[2]) return http(200, { comment: { id: 99, task_id: m[1], author: sent.author, body: sent.body, created_at: Math.round(ctx.now) } });
  if (method === "POST" && p === "/tasks") {
    return http(200, { task: task(ctx.now, "t_n3w0", sent.title ?? "", sent.assignee ? "ready" : "triage", sent.assignee || null, sent.priority ?? 0, 0, { body: sent.body ?? null }) });
  }
  return http(404, { detail: "not found" });
}

// The probe of a machine with access set up: one gateway unit, its drop-in, the key, and a gateway that runs with it.
const PROBE = ["home=yes", "unit=hermes-gateway.service", "curl=8.5.0", "python3=yes", "token=yes", "dropin=hermes-gateway.service",
  "env=hermes-gateway.service:yes", ""].join("\n");

// The answer to one exec call, as { code, stdout, stderr }. `ctx`: { scene, state, now (ms) }.
export function answer({ cmd, args = [], on = null }, { scene = "board", state = null, now = Date.now() } = {}) {
  const fail = (why) => ({ code: 1, stdout: "", stderr: `demo: ${why}` });
  if (!MACHINES.includes(on)) return fail(`no machine ${on}`);
  const turned = scene === "notifications" && Boolean(state) && fs.existsSync(path.join(state, "demo-turn"));
  const ctx = { scene, state, now: now / 1000, turned };
  if (cmd === "hermes" && args[0] === "gateway" && args[1] === "restart") return { code: 0, stdout: "Gateway restarted.\n", stderr: "" };
  if (cmd !== "sh" || args[0] !== "-c") return fail(`not a command of the mod: ${cmd}`);
  const script = args[1], rest = args.slice(3);
  if (script === REQUEST_SCRIPT) return request(on, rest, ctx);
  if (script === STAMP_SCRIPT) {
    const size = on === "labbox" && turned ? 245760 : 241664;
    return { code: 0, stdout: `kanban.db 1795000000.0000000000 ${size}\nkanban.db-wal 1795000000.0000000000 4096\n`, stderr: "" };
  }
  if (script === PROBE_SCRIPT) return { code: 0, stdout: PROBE, stderr: "" };
  if ([SETUP_SCRIPT, REMOVE_SCRIPT, DELETE_TOKEN_SCRIPT].includes(script)) return { code: 0, stdout: "", stderr: "" };
  return fail("unknown script");
}

// As a command: node hermes.mjs '<call>' '<ctx>' prints the answer's stdout and stderr and exits with its code.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let r;
  try {
    r = answer(JSON.parse(process.argv[2] ?? "{}"), JSON.parse(process.argv[3] ?? "{}"));
  } catch (e) {
    r = { code: 1, stdout: "", stderr: `demo: ${e?.message ?? e}` };
  }
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.code;
}
