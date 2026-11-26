// The settings of the mod, defined in one place: key, type, default and what it does. Pattern of ghchecker's
// lib/settings.js. They live in hermes-kanban.json in the herdr app folder (~/.config/herdr-app/hermes-kanban.json),
// as nested objects:
//   { "toast": { "done": false }, "single_agent": ["devbox"] }
// A dotted key ("toast.done") works too. A missing or broken file, or a value of the wrong type, means the default.

export const CONFIG_FILE = "hermes-kanban.json";

export const SETTINGS = [
  { key: "single_agent", type: "machines", default: [], label: "Single agent mode",
    about: "Per instance: the agent filter and the agent choice disappear. Hermes assigns new tasks through its kanban.default_assignee; the mod never assigns one itself." },
  { key: "status.color", type: "choice", choices: ["color", "mono"], default: "color", label: "Status colors",
    about: "Mono draws every status in one quiet color. Tasks that need you stay red." },
  { key: "toast.needs_you", type: "boolean", default: true, label: "Toast when a task needs you",
    about: "A toast when a task becomes blocked or waits for review. Failed tasks follow this switch too." },
  { key: "toast.done", type: "boolean", default: true, label: "Toast when a task is done",
    about: "A toast when a task finishes." },
  { key: "sound.needs_you", type: "boolean", default: true, label: "Sound when a task needs you",
    about: "A sound with the toast for a blocked task or one waiting for review." },
  { key: "sound.done", type: "boolean", default: false, label: "Sound when a task is done",
    about: "A sound when a task finishes." },
  { key: "badge", type: "boolean", default: false, label: "Dock badge",
    about: "The number of tasks that need you on the herdr icon in the Dock." },
  { key: "poll_seconds", type: "choice", choices: [15, 30, 60, 120], default: 30, label: "Check every",
    about: "Seconds between two cheap checks of each visible instance. The board is fetched only when it changed." },
  { key: "update_check", type: "boolean", default: true, label: "Check for updates automatically",
    about: "Once a day, Hermes Kanban asks GitHub whether a new version exists. Nothing about you or your boards is sent, but GitHub sees your IP address." },
];

const CHECK = {
  boolean: (v) => typeof v === "boolean" ? v : undefined,
  // One of the setting's choices (checked in parseSettings and withSettings with the setting at hand).
  choice: (v, s) => s?.choices?.includes(v) ? v : undefined,
  // A list of herdr machine names: strings only, trimmed, empty ones and duplicates dropped.
  machines: (v) => Array.isArray(v) && v.every((x) => typeof x === "string")
    ? [...new Set(v.map((x) => x.trim()).filter(Boolean))] : undefined,
};

const fresh = (v) => Array.isArray(v) ? [...v] : v; // a default list is never shared between loads
const at = (cfg, key) => key in cfg ? cfg[key] : key.split(".").reduce((o, k) => o && typeof o === "object" ? o[k] : undefined, cfg);

// The settings from the file's text: every key of SETTINGS, each its default when missing or wrong.
// `problems` names the keys that were present but unusable, and a file that is not a JSON object.
export function parseSettings(text) {
  let cfg = null;
  const problems = [];
  if (text != null && String(text).trim() !== "") {
    try { cfg = JSON.parse(text); } catch { problems.push(CONFIG_FILE); }
    if (cfg !== null && (typeof cfg !== "object" || Array.isArray(cfg))) { problems.push(CONFIG_FILE); cfg = null; }
  }
  const values = {};
  for (const s of SETTINGS) {
    const raw = cfg ? at(cfg, s.key) : undefined, value = raw === undefined ? undefined : CHECK[s.type](raw, s);
    if (raw !== undefined && value === undefined) problems.push(s.key);
    values[s.key] = value ?? fresh(s.default);
  }
  return { values, problems };
}

export const defaults = () => parseSettings(null).values;

// Reads the file through herdr's readTextFile (null when absent); a read that fails means the defaults.
export async function loadSettings(readTextFile, appHome) {
  const text = await readTextFile(`${appHome()}/${CONFIG_FILE}`).catch(() => null);
  return parseSettings(text);
}

// Single agent mode holds per instance: the machine is in the list.
export function isSingleAgent(settings, machine) {
  const list = settings?.single_agent;
  return Array.isArray(list) && list.includes(machine);
}

// The file's new text with `edits` ({ key: value }) written in: a dotted key as a nested object, other keys kept as
// they are. A broken file is never overwritten: it throws, and the dialog says so.
export function withSettings(text, edits) {
  let cfg = {};
  if (text != null && String(text).trim() !== "") {
    cfg = JSON.parse(text);
    if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) throw new Error(`${CONFIG_FILE} is not a JSON object`);
  }
  for (const [key, value] of Object.entries(edits)) {
    const s = SETTINGS.find((x) => x.key === key);
    if (!s || CHECK[s.type](value, s) === undefined) throw new Error(`not a setting: ${key}`);
    if (key in cfg) { cfg[key] = value; continue; } // a dotted key the person wrote stays dotted
    const parts = key.split("."), last = parts.pop();
    let node = cfg;
    for (const p of parts) node = node[p] = node[p] && typeof node[p] === "object" && !Array.isArray(node[p]) ? node[p] : {};
    node[last] = value;
  }
  return `${JSON.stringify(cfg, null, 2)}\n`;
}

// Writes `edits` with herdr's writeTextFile, which refuses when the file changed since it was read.
export async function saveSettings(edits, { readTextFile, writeTextFile, appHome }) {
  const path = `${appHome()}/${CONFIG_FILE}`, text = await readTextFile(path);
  await writeTextFile(path, withSettings(text, edits), text);
}

// The keys whose value differs between two value sets (what Save writes).
export function changedSettings(before, after) {
  return Object.fromEntries(SETTINGS.map((x) => x.key).filter((k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])).map((k) => [k, after[k]]));
}
