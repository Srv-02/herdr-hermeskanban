// Short relative age for the board rows: "now", "14m", "2h", "3d". No Intl (herdr's QuickJS lacks it).
export function ago(epochSeconds, nowSeconds) {
  if (epochSeconds === null || epochSeconds === undefined) return "";
  const s = nowSeconds - epochSeconds;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
