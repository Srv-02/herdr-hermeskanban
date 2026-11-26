// The poller: one state per visible machine, polled on its own beat (poll_seconds). Each poll first reads the cheap
// stamp of kanban.db; /board (with /diagnostics for the problems count) follows only when the stamp changed, when a
// refresh was asked, and every FULL_EVERY as a safety net. /api/status, /workflow and /orchestration come at the
// start, after an error and every META_EVERY. The probe runs only on trouble (401 or gateway down), never in normal
// operation. Boards are kept unfiltered, as Hermes returns them; filters belong to the view.
//
// Changes are reported against the last good board of the same machine. A machine's first board, also after it left
// the list and came back, only sets the baseline. A failed poll keeps the last snapshot and reports nothing.
// Dependencies are injected: api (createApi), run (exec of a { cmd, args, opts } spec), now, settings.
import { checkBoard, checkWorkflow, normalizeBoard, normalizeStatus, normalizeWorkflow } from "./board.js";
import { STAMP_SCRIPT, diffBoards, parseStamp } from "./changes.js";
import { PROBE_SCRIPT, accessState, parseProbe, scriptSpec } from "./setup.js";
import { SETTINGS } from "./settings.js";

export const FULL_EVERY = 300000;
export const META_EVERY = 300000;

const PACES = SETTINGS.find((s) => s.key === "poll_seconds");
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const message = (e) => String(e?.message ?? e);

function blank(machine) {
  return {
    machine, at: 0, board: null, status: null, workflow: null, defaultAssignee: "", mode: null, problems: null,
    access: { state: "unknown", removalPending: false }, error: null, unsupported: null, hermes: false,
  };
}

export function createPoller({ api, run, now, settings }) {
  const states = new Map();

  const pace = () => {
    const s = settings()?.poll_seconds;
    return (PACES.choices.includes(s) ? s : PACES.default) * 1000;
  };

  function due(st, t) {
    if (!st.snap || st.fullDue) return true;
    return t - st.lastPoll >= (st.snap.hermes ? pace() : META_EVERY);
  }

  async function probe(machine) {
    try {
      const r = await run(scriptSpec(machine, PROBE_SCRIPT, [], 15000));
      return parseProbe(r?.stdout);
    } catch {
      return null;
    }
  }

  // One poll of one machine: the next snapshot and the changes it brings. Never throws.
  async function poll(machine, st) {
    const t = now();
    const snap = { ...(st.snap ?? blank(machine)), at: t };
    const done = (changes = []) => ({ snap, changes });
    const failed = (error) => {
      snap.error = error;
      st.metaDue = true;
      return done();
    };
    try {
      const stamped = await run(scriptSpec(machine, STAMP_SCRIPT, [], 15000));
      const stamp = parseStamp(stamped?.stdout ?? "");
      if (stamp === null) {
        // No kanban.db: no Hermes here (now). Its old data goes, so a later Hermes starts with a new baseline.
        Object.assign(st, { stamp: null, mode: null, rawStatus: null, metaDue: true, fullDue: false });
        return { snap: { ...blank(machine), at: t }, changes: [] };
      }
      snap.hermes = true;

      const meta = st.metaDue || !st.mode || t - st.lastMeta >= META_EVERY;
      if (meta) {
        const s = await api.status(machine);
        if (s.code !== 200 || !isObj(s.json)) {
          Object.assign(st, { rawStatus: null, mode: null });
          snap.status = null;
          snap.mode = null;
          snap.access = accessState({ status: null, probe: await probe(machine), statsCode: 0 });
          return failed(`gateway down${s.error ? `: ${s.error}` : ` (HTTP ${s.code})`}`);
        }
        st.rawStatus = s.json;
        snap.status = normalizeStatus(s.json);
        st.mode = snap.mode = snap.status.gated ? "gated" : "open";
      }

      const full = meta || st.fullDue || stamp !== st.stamp || t - st.lastFull >= FULL_EVERY || snap.board === null;
      if (!full) {
        snap.error = null;
        return done();
      }
      st.fullDue = false;
      const [b, d] = await Promise.all([api.board(machine), api.diagnostics(machine)]);
      if (b.code === 401) {
        snap.access = accessState({ status: st.rawStatus, probe: await probe(machine), statsCode: 401 });
        snap.error = null;
        st.metaDue = true;
        return done();
      }
      if (b.code !== 200) return failed(b.error || `HTTP ${b.code}`);
      snap.access = accessState({ status: st.rawStatus, probe: null, statsCode: 200 });
      snap.error = null;
      st.stamp = stamp;
      st.lastFull = t;
      let changes = [];
      if (checkBoard(b.json)) {
        const next = normalizeBoard(b.json, machine);
        changes = diffBoards(snap.board, next);
        snap.board = next;
        snap.unsupported = null;
      } else {
        snap.board = null;
        snap.unsupported = `Hermes ${snap.status?.version ?? "?"} not supported yet`;
      }
      snap.problems = d.code === 200 ? d.problems : null;

      if (meta) {
        const [w, o] = await Promise.all([api.workflow(machine), api.orchestration(machine)]);
        if (w.code === 200 && checkWorkflow(w.json)) snap.workflow = normalizeWorkflow(w.json);
        if (o.code === 200 && isObj(o.json)) snap.defaultAssignee = typeof o.json.default_assignee === "string" ? o.json.default_assignee : "";
        st.metaDue = false;
        st.lastMeta = t;
      }
      return done(changes);
    } catch (e) {
      return failed(message(e));
    }
  }

  return {
    async tick(machines) {
      const list = [...new Set(machines)];
      for (const m of [...states.keys()]) if (!list.includes(m)) states.delete(m);
      const t = now();
      const results = await Promise.all(list.map(async (m) => {
        let st = states.get(m);
        if (!st) states.set(m, st = { snap: null, stamp: null, mode: null, rawStatus: null, lastPoll: 0, lastFull: 0, lastMeta: 0, metaDue: true, fullDue: false, busy: false });
        if (st.busy || !due(st, t)) return [];
        st.busy = true;
        st.lastPoll = t;
        try {
          const r = await poll(m, st);
          if (states.get(m) !== st) return []; // it left the list while being polled
          st.snap = r.snap;
          return r.changes;
        } finally {
          st.busy = false;
        }
      }));
      const snapshots = {};
      for (const m of list) {
        const snap = states.get(m)?.snap;
        if (snap) snapshots[m] = snap;
      }
      return { snapshots, changes: results.flat() };
    },
    refresh(machine) {
      const st = states.get(machine);
      if (st) st.fullDue = true;
    },
    // The access mode of a machine from its last /api/status, for createApi: "gated", "open" or null.
    mode: (machine) => states.get(machine)?.mode ?? null,
  };
}
