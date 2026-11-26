// Short relative age for the board rows: "now", "14m", "2h", "3d". No Intl (herdr's QuickJS lacks it).
export function ago(epochSeconds, nowSeconds) {
  if (epochSeconds === null || epochSeconds === undefined) return "";
  const s = nowSeconds - epochSeconds;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// How long a run took: "4m 12s", past an hour "3h 07m". Empty without both ends.
export function duration(from, to) {
  if (typeof from !== "number" || typeof to !== "number") return "";
  const s = Math.max(0, Math.round(to - from)), two = (n) => String(n).padStart(2, "0");
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${two(Math.floor((s % 3600) / 60))}m`;
  return `${Math.floor(s / 60)}m ${two(s % 60)}s`;
}
