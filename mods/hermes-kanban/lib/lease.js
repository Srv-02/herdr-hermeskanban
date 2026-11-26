// Lease (shared key hermes-kanban.lease): exactly one copy of the tab bar button (Herdr can show it in several windows
// and layouts) runs the watcher and the daily update check. The holder rewrites the shared key every minute (each write
// re-renders every mod, so not more often); others take over when the lease is older than 3 minutes (or missing).
// Adapted from ghchecker by Michael Mayer (MIT), mods/ghchecker/lib/lease.js.
export const LEASE_TTL_MS = 180000;
export const LEASE_RENEW_MS = 60000;

// `write` says whether the lease must be stored now; `at` stays the stored value while the holder is not renewing.
export function leaseNext(current, me, now) {
  const fresh = current && typeof current.at === "number";
  if (fresh && current.owner === me) return now - current.at >= LEASE_RENEW_MS ? { owner: me, at: now, mine: true, write: true } : { owner: me, at: current.at, mine: true, write: false };
  if (!fresh || now - current.at > LEASE_TTL_MS) return { owner: me, at: now, mine: true, write: true };
  return { owner: current.owner, at: current.at, mine: false, write: false };
}
