// En-route temperatures: what the ground below a flight measured as it passed, for replays.
//
// The route is sampled at PROFILE_POINTS evenly spaced fractions, each at the time the plane passed
// it (linear from take-off to landing, as replays fly it), and one Open-Meteo request returns the
// hourly 2 m temperature at every sample over the flight's dates. That is PROFILE_POINTS location
// calls against the shared daily quota, so it is done once per landed leaderboard flight, kept on
// its board record, and capped per day (sched.ts takeEnroute).

import { interpolate, type LatLon } from "./geo";
import { fetchTempSeries, tempAt } from "./weather";

/** 17 points: 16 segments, one every ~6% of the route. */
export const PROFILE_POINTS = 17;

export interface Profiled {
  origin: LatLon;
  dest: LatLon;
  depTime: number;
  eta: number;
  depTempC: number;
  arrTempC: number;
}

/** Where and when the plane was at each profile point. */
export function profileSamples(f: Profiled): (LatLon & { t: number })[] {
  return Array.from({ length: PROFILE_POINTS }, (_, i) => {
    const q = i / (PROFILE_POINTS - 1);
    return { ...interpolate(f.origin, f.dest, q), t: Math.round(f.depTime + q * (f.eta - f.depTime)) };
  });
}

const utcDate = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

/**
 * The flight's profile, or null if any point has no temperature. The ends are pinned to the
 * flight's own departure and arrival temperatures, so the replay agrees with the headline numbers.
 */
export async function fetchProfile(f: Profiled, fetchFn: typeof fetch = fetch, now: () => number = Date.now): Promise<number[] | null> {
  const samples = profileSamples(f);
  const series = await fetchTempSeries(
    samples.map((s, i) => ({ key: String(i), lat: s.lat, lon: s.lon })),
    fetchFn,
    now,
    { start: utcDate(f.depTime), end: utcDate(f.eta) },
  );
  const temps = samples.map((s, i) => {
    const ser = series.get(String(i));
    return ser ? tempAt(ser, s.t) : null;
  });
  if (temps.some((t) => t == null)) return null;
  const out = temps.map((t) => Math.round(t! * 10) / 10);
  out[0] = f.depTempC;
  out[out.length - 1] = f.arrTempC;
  return out;
}
