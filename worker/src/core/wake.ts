// When the Durable Object's alarm should fire next. Every alarm may wake a cold object, and a
// cold wake is the expensive part (restoring the known set reads ~1 row per aircraft), so the
// object only runs often while there is work queued.

/** While routes or weather are queued: drain a batch (≤ 44 requests) every 30 s. */
export const DRAIN_MS = 30_000;
/**
 * Otherwise: start the GitHub poller if due, refresh stale weather, rebuild. Every 5 min, since
 * this alarm is what starts the poller (a cold wake reads ~3 rows, so ~1k rows a day).
 */
export const HEARTBEAT_MS = 5 * 60_000;
/** Start the GitHub poller this often... */
export const DISPATCH_EVERY_MS = 5 * 60_000;
/** ...unless a poller asked for a plan this recently (GitHub's own schedule, a manual run). */
export const POLLER_FRESH_MS = 4 * 60_000;
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

/** Whether the alarm should start the GitHub poller now. */
export function dispatchDue(now: number, lastDispatchAt: number, lastPlanAt: number): boolean {
  return now - lastDispatchAt >= DISPATCH_EVERY_MS - 30_000 && now - lastPlanAt >= POLLER_FRESH_MS;
}

/**
 * Milliseconds until dispatchDue() turns true (at least 30 s), so the idle alarm lands on the
 * 5-minute mark instead of drifting by however long each run's follow-up alarms took.
 */
export function untilDispatch(now: number, lastDispatchAt: number, lastPlanAt: number): number {
  const due = Math.max(lastDispatchAt + DISPATCH_EVERY_MS - 30_000, lastPlanAt + POLLER_FRESH_MS);
  return Math.max(DRAIN_MS, due - now);
}

/** An alarm this far overdue never fired (e.g. it was dropped while storage was blocked). */
export const STUCK_MS = 2 * 60_000;
