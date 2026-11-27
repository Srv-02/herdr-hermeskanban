// Who a comment comes from: the full name of the Mac user (id -F, else the login, else "herdr"), or the name set in
// the settings. The name goes into the comment's JSON body, nowhere else. Pure logic, exec injected.

export const AUTHOR_MAX = 64;
const FALLBACK = "herdr";

// Trimmed and cut to AUTHOR_MAX characters (code points: an emoji is never cut in half); null when nothing is left.
export function cleanAuthor(name) {
  if (typeof name !== "string") return null;
  const s = Array.from(name.trim()).slice(0, AUTHOR_MAX).join("").trim();
  return s || null;
}

// The OS name, read on this computer: `id -F` (macOS: the full name), else `id -un` (the login), else "herdr". A step
// that fails, exits with a code other than 0 or prints nothing falls through to the next.
export async function readOsName(exec) {
  for (const flag of ["-F", "-un"]) {
    try {
      const r = await exec("id", [flag], { timeout: 5000 });
      const name = r?.code === 0 ? cleanAuthor(r.stdout) : null;
      if (name) return name;
    } catch { /* the next step */ }
  }
  return FALLBACK;
}

// The author of a comment now: the custom name while "Change name" is on and one is stored, else the OS name
// (shared hermes-kanban.osName, from the watcher), else "herdr".
export function authorOf(settings, osName) {
  const custom = settings?.["author.custom"] === true ? cleanAuthor(settings["author.name"]) : null;
  return custom ?? cleanAuthor(osName) ?? FALLBACK;
}
