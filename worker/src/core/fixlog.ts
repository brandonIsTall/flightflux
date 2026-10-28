// The fix log: real positions kept for replaying a flight after it lands.
//
// Positions can't be fetched again later (OpenSky only serves the present), so about every 5 minutes
// one row records the new transponder fix of every long-haul flight the engine scored since the
// last row: ~250 entries, ~13 KB. Only each flight's latest fix is held, so a row is written as each
// poller run delivers the globe's positions (every ~5 min), not on a timer that could fall between
// two runs and lose one. That is ~300 rows written a day, read back only to build one flight's
// track (~150 rows for a 12-hour flight, then edge-cached). Rows older than FIX_LOG_KEEP_S go in
// the daily prune, so a flight on the 30-day leaderboard can still be replayed.

import type { TrackPoint } from "../../../shared/types";

/**
 * The least time between rows. Under the poller's 5 minutes, so a run that comes a little early
 * still gets its row; a timer alarm in between writes one only if this much has passed.
 */
export const FIX_LOG_EVERY_S = 4 * 60;
/** A little over the longest leaderboard window. */
export const FIX_LOG_KEEP_S = 31 * 86_400;

/** [icao24, callsign, fix time (unix s), lat, lon, altitude m]. */
export type LoggedFix = [string, string, number, number, number, number];

export interface FixSource {
  icao24: string;
  callsign: string;
  t: number;
  lat: number;
  lon: number;
  altM: number;
}

/** One row's entries: the fixes newer than `since`, compacted (~11 m, 10 m altitude steps). */
export function fixRow(fixes: FixSource[], since: number): LoggedFix[] {
  const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
  return fixes.filter((f) => f.t > since).map((f) => [f.icao24, f.callsign, f.t, r4(f.lat), r4(f.lon), Math.round(f.altM / 10) * 10]);
}

/** A flight's points from fix-log rows, oldest first, each fix once. */
export function trackFrom(rows: string[], icao24: string, callsign: string, depTime: number, eta: number): TrackPoint[] {
  const byT = new Map<number, TrackPoint>();
  for (const row of rows) {
    for (const [id, cs, t, lat, lon, alt] of JSON.parse(row) as LoggedFix[]) {
      if (id === icao24 && cs === callsign && t >= depTime && t <= eta) byT.set(t, [t, lat, lon, alt]);
    }
  }
  return [...byT.values()].sort((a, b) => a[0] - b[0]);
}
