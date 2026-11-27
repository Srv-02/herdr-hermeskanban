// The Hermes Kanban API of one instance, as plain calls. Every call names its machine first and goes only there
// (exec on: machine); an action on a task takes the machine from the task, never from the focus. exec is injected
// (herdr's exec in the mod, a fake in tests). Kanban calls carry board=default; /api/status is public and goes
// without key and board. Hard delete (DELETE /tasks/{id}) is deliberately missing: archiving is a PATCH.

import { BASE, KANBAN, parseResponse, requestSpec, withBoard } from "./request.js";
import { normalizeTask, problemCount } from "./board.js";
import { cleanAuthor } from "./author.js";

export const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

const MODES = new Set(["gated", "open"]);

function needMachine(machine) {
  if (typeof machine !== "string" || !machine) throw new Error("a Hermes call needs a machine");
}

// Checked before the URL is built, and encoded anyway: an ID never reaches the path or the query unchecked.
function idPath(id) {
  if (typeof id !== "string" || !SAFE_ID.test(id)) throw new Error("unsafe task id");
  return encodeURIComponent(id);
}

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj?.[k] !== undefined).map((k) => [k, obj[k]]));

export function createApi(exec, mode) {
  // Synchronous checks first (they throw before any request), then the request.
  function send(machine, reqMode, method, url, body) {
    const spec = requestSpec(machine, { mode: reqMode, method, url, body });
    return Promise.resolve()
      .then(() => exec(spec.cmd, spec.args, spec.opts))
      .then(parseResponse, (e) => ({ code: 0, json: null, error: String(e?.message ?? e) }));
  }
  function kanban(machine, method, path, body) {
    needMachine(machine);
    const m = mode(machine);
    if (!MODES.has(m)) throw new Error(`no access mode for ${machine}`);
    return send(machine, m, method, `${BASE}${KANBAN}${withBoard(path)}`, body);
  }
  const withTask = (machine) => (r) => ({ ...r, task: normalizeTask(r.json?.task, machine) });

  const api = {
    status(machine) {
      needMachine(machine);
      return send(machine, "none", "GET", `${BASE}/api/status`);
    },
    board: (machine) => kanban(machine, "GET", "/board"),
    workflow: (machine) => kanban(machine, "GET", "/workflow"),
    orchestration: (machine) => kanban(machine, "GET", "/orchestration"),
    diagnostics: (machine) => kanban(machine, "GET", "/diagnostics?severity=warning").then((r) => ({ ...r, problems: problemCount(r.json) })),
    task: (machine, id) => kanban(machine, "GET", `/tasks/${idPath(id)}`),
    // status "archived" archives (plugin_api.py _patch_status); the answer carries the task as Hermes left it.
    // Hermes reads assignee null as "not sent" and unassigns only with "", so null goes out as "".
    patch(machine, id, fields) {
      const path = `/tasks/${idPath(id)}`;
      const body = pick(fields, ["status", "assignee", "priority"]);
      if (body.assignee === null) body.assignee = "";
      if (!Object.keys(body).length) throw new Error("a patch needs status, assignee or priority");
      return kanban(machine, "PATCH", path, body).then(withTask(machine));
    },
    // `author` (lib/author.js authorOf) is trimmed and cut to 64 characters; without one the comment is herdr's.
    comment(machine, id, body, author) {
      const path = `/tasks/${idPath(id)}/comments`;
      if (typeof body !== "string" || !body.trim()) throw new Error("a comment needs a text body");
      return kanban(machine, "POST", path, { body, author: cleanAuthor(author) ?? "herdr" });
    },
    create(machine, fields) {
      return kanban(machine, "POST", "/tasks", pick(fields, ["title", "body", "priority", "assignee"])).then(withTask(machine));
    },
    // An action on a task: the machine comes from the task alone.
    act(task, verb, payload) {
      if (typeof task?.machine !== "string" || !task.machine) throw new Error("the task has no machine");
      if (verb === "patch") return api.patch(task.machine, task.id, payload);
      if (verb === "comment") return api.comment(task.machine, task.id, payload?.body, payload?.author);
      throw new Error(`unknown verb ${verb}`);
    },
  };
  return api;
}
