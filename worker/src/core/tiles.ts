// Discovery sweeps the world one bounding box at a time, so no single OpenSky response is large
// enough to blow the Workers free plan's 10 ms CPU limit.
//
// Initial boxes come from real traffic (2026-10-04 02:00 UTC), split until each held <= 500
// aircraft, i.e. ~1,000 at peak hours. Boxes that come back too full are split at runtime.

import type { Bbox } from "./opensky";

export const INITIAL_TILES: Bbox[] = [
  [-90, -180, 0, -60], [0, -180, 45, -120], [45, -180, 90, -120],
  [0, -120, 22, -90], [22, -120, 34, -105], [34, -120, 45, -105], [22, -105, 34, -90], [34, -105, 45, -90],
  [0, -90, 22, -60], [22, -90, 34, -75], [34, -90, 45, -82], [34, -82, 45, -75], [22, -75, 45, -60],
  [45, -120, 90, -60],
  [-90, -60, 0, 60], [0, -60, 45, 0], [45, -60, 90, 0], [0, 0, 45, 30], [0, 30, 45, 60], [45, 0, 90, 30], [45, 30, 90, 60],
  [-90, 60, 0, 180], [0, 60, 45, 90], [0, 90, 45, 120], [45, 60, 90, 120],
  [0, 120, 22, 150], [22, 120, 45, 150], [0, 150, 45, 180], [45, 120, 90, 180],
];

/** A box that returns more aircraft than this is split in two for the next sweep. */
export const SPLIT_AT = 900;
/** Never split below this size (degrees on the longer side). */
const MIN_SIDE_DEG = 6;

export function splitTile([la0, lo0, la1, lo1]: Bbox): Bbox[] {
  const w = lo1 - lo0;
  const h = la1 - la0;
  if (Math.max(w, h) < MIN_SIDE_DEG * 2) return [[la0, lo0, la1, lo1]];
  if (w >= h) {
    const m = Math.round((lo0 + lo1) / 2);
    return [[la0, lo0, la1, m], [la0, m, la1, lo1]];
  }
  const m = Math.round((la0 + la1) / 2);
  return [[la0, lo0, m, lo1], [m, lo0, la1, lo1]];
}

export function tileCredits([la0, lo0, la1, lo1]: Bbox): number {
  const area = (la1 - la0) * (lo1 - lo0);
  return area <= 25 ? 1 : area <= 100 ? 2 : area <= 400 ? 3 : 4;
}
