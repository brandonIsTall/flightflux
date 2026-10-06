// When the Durable Object's alarm should fire next. Every alarm may wake a cold object, and a
// cold wake is the expensive part (restoring the known set reads ~1 row per aircraft), so the
// object only runs often while there is work queued.

/** While routes or weather are queued: drain a batch (≤ 44 requests) every 30 s. */
export const DRAIN_MS = 30_000;
/** Otherwise: refresh stale weather, rebuild, and check on the poller. */
export const HEARTBEAT_MS = 15 * 60_000;
/** After an ingest, enrich and rebuild shortly, once the poller's burst of requests is done. */
export const AFTER_INGEST_MS = 5_000;

/**
 * `routesPausedUntil` (ms) is when route lookups resume after adsbdb throttled us: until then a
 * route queue alone is no reason to wake every 30 s.
 */
export function nextAlarmDelay(queues: { routes: number; weather: number }, now = 0, routesPausedUntil = 0): number {
  if (queues.weather > 0) return DRAIN_MS;
  if (queues.routes > 0) return Math.min(HEARTBEAT_MS, Math.max(DRAIN_MS, routesPausedUntil - now));
  return HEARTBEAT_MS;
}

/** An alarm this far overdue never fired (e.g. it was dropped while storage was blocked). */
export const STUCK_MS = 2 * 60_000;
