// Departure-time estimates and ETAs.

/** Typical descent + approach + landing allowance beyond the great-circle cruise estimate. */
export const APPROACH_S = 15 * 60;
/** Climb-out is slower than cruise; this inflates the time to cover the flown distance. */
export const CLIMB_FACTOR = 0.88;
/** Extra seconds for take-off roll and initial climb, not covered by the distance model. */
export const TAKEOFF_S = 5 * 60;
/** Ground speed assumed when the transponder reports something implausible. */
export const FALLBACK_GS_MS = 230;

const kmPerS = (gsMs: number) => (gsMs > 50 ? gsMs : FALLBACK_GS_MS) / 1000;

export function estimateEta(t: number, remainingKm: number, gsMs: number): number {
  return Math.round(t + Math.max(0, remainingKm) / kmPerS(gsMs) + APPROACH_S);
}

export function estimateDeparture(t: number, flownKm: number, gsMs: number): number {
  return Math.round(t - Math.max(0, flownKm) / (kmPerS(gsMs) * CLIMB_FACTOR) - TAKEOFF_S);
}

/** UTC calendar day of a unix time, as YYYYMMDD. Used to make flight ids stable per departure. */
export function utcDay(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 10).replaceAll("-", "");
}
