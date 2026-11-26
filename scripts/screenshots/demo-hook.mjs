// Patches a COPY of the mod for the screenshot instance (never mods/hermes-kanban, never an installed mod):
// - every exec the mod runs on a machine (watcher.js, viewer.js, create.js, access.js: the Kanban API through createApi,
//   the stamp, the probe, the access scripts, the restart) goes to the fake Hermes in demo/hermes.mjs instead, run
//   locally: it never reaches a machine;
// - lib/instances.js treats the local demo spaces named devbox and labbox as those machines, each with Hermes in its
//   terminal (the demo instance knows no machines);
// - lib/update.js asks GitHub nothing: the latest release is 1.0.0 (up to date), or 1.1.0 with DEMO_UPDATE=1 for a look
//   at the gold gear and the gold box (never for the README).
// Each anchor is exact text of the mod; when one is gone the hook stops loudly (test/screenshot-hook.test.js applies it
// to the current mod on every npm test). Usage: node demo-hook.mjs <copy of mods/hermes-kanban>
// DEMO_SCENE (board | overlay | notifications, see demo/hermes.mjs) and DEMO_STATE (the folder of the scene's turn
// file, default: two levels above the copy, the instance's HERDR_APP_HOME) are baked into the copy.
import fs from "node:fs";
import path from "node:path";

const mod = process.argv[2];
if (!mod) { console.error("usage: demo-hook.mjs <mod copy>"); process.exit(2); }
const fake = path.resolve(import.meta.dirname, "demo/hermes.mjs");
const scene = process.env.DEMO_SCENE || "board";
if (!["board", "overlay", "notifications"].includes(scene)) { console.error(`demo-hook: unknown DEMO_SCENE ${scene}`); process.exit(2); }
const state = path.resolve(process.env.DEMO_STATE || path.join(mod, "..", ".."));
const tag = process.env.DEMO_UPDATE === "1" ? "v1.1.0" : "v1.0.0";
const MARK = "// HK_DEMO: demo-hook";

// The import of herdr without exec, and exec from the fake's module instead.
const HERDR_IMPORT = /^import \{([^}]*)\} from "herdr";$/m;
function swapExec(text) {
  const m = text.match(HERDR_IMPORT);
  const names = m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (!names.includes("exec")) return null;
  const rest = names.filter((n) => n !== "exec");
  return text.replace(HERDR_IMPORT, `import { ${rest.join(", ")} } from "herdr";\nimport { exec } from "./demo-exec.js"; ${MARK}: the fake Hermes`);
}

// The local demo spaces as machines, their terminal panes as Hermes panes. Appended to lib/instances.js.
const INSTANCES = `
${MARK}: the local spaces named devbox and labbox stand for those machines, with Hermes in every terminal pane.
const DEMO_MACHINES = ["devbox", "labbox"];
function demoView(spaces, panes) {
  const ss = (spaces ?? []).map((s) => (s.machine == null && DEMO_MACHINES.includes(s.name) ? { ...s, machine: s.name } : s));
  const tabs = new Set(ss.filter((s) => DEMO_MACHINES.includes(s.machine)).flatMap((s) => (s.tabs ?? []).map((t) => t.id)));
  const ps = (panes ?? []).map((p) => (tabs.has(p.tab) && p.terminal ? { ...p, app: "hermes" } : p));
  return { spaces: ss, panes: ps };
}
export const visibleMachines = (spaces) => realVisibleMachines(demoView(spaces, []).spaces);
export function focusedInstance(view, last = null) {
  return realFocusedInstance({ ...view, ...demoView(view.spaces, view.panes) }, last);
}
export function jumpTarget(machine, view, lastPanes) {
  return realJumpTarget(machine, demoView(view.spaces, view.panes), lastPanes);
}
`;

// The copy's own exec: the fake, run locally with the call as JSON. `on` goes to the fake as data, never to herdr.
const DEMO_EXEC = `${MARK}: written into the screenshot instance's copy of the mod only. Every call goes to the fake Hermes,
// run on this computer; nothing reaches a machine.
import { exec as hostExec } from "herdr";

const FAKE = ${JSON.stringify(fake)};
const CTX = ${JSON.stringify(JSON.stringify({ scene, state }))};
export const exec = (cmd, args = [], opts = {}) =>
  hostExec("node", [FAKE, JSON.stringify({ cmd, args, on: opts?.on ?? null }), CTX], { timeout: 20000 });
`;

// [file, anchor, replacement]: an anchor is a string that must occur exactly once, or a function that returns the new
// text (null: not found).
const patches = [
  ["watcher.js", swapExec],
  ["viewer.js", swapExec],
  ["create.js", swapExec],
  ["access.js", swapExec],
  ["lib/instances.js", "export const visibleMachines = (spaces) =>", "const realVisibleMachines = (spaces) =>"],
  ["lib/instances.js", "export function focusedInstance({ spaces, panes, focused }, last = null) {", "function realFocusedInstance({ spaces, panes, focused }, last = null) {"],
  ["lib/instances.js", "export function jumpTarget(machine, { spaces, panes }, lastPanes) {", "function realJumpTarget(machine, { spaces, panes }, lastPanes) {"],
  ["lib/update.js", "export async function fetchRelease(fetchFn, sleep) {",
    `export async function fetchRelease(fetchFn, sleep) {\n  return { tag: ${JSON.stringify(tag)} }; ${MARK}: no request to GitHub`],
];

for (const [file, anchor, replacement] of patches) {
  const p = path.join(mod, file), text = fs.readFileSync(p, "utf8");
  let next = null;
  if (typeof anchor === "function") next = anchor(text);
  else if (text.split(anchor).length === 2) next = text.replace(anchor, replacement);
  if (next === null) { console.error(`demo-hook: anchor not found once in ${file}: ${typeof anchor === "function" ? "exec in the import of herdr" : anchor}`); process.exit(1); }
  fs.writeFileSync(p, next);
}
fs.appendFileSync(path.join(mod, "lib/instances.js"), INSTANCES);
fs.writeFileSync(path.join(mod, "demo-exec.js"), DEMO_EXEC);
console.log(`demo-hook: patched ${mod} (scene ${scene}, latest release ${tag})`);
