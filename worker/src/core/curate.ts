// Picks the flights shown on the globe: long, plausible routes with dramatic temperature swings,
// spread around the world, and stable from one poll to the next.

import type { Flight } from "../../../shared/types";

export const CURATED_MAX = 150;
export const MIN_ROUTE_KM = 2500;
/** A plane further than this from its claimed great circle is probably flying a different route. */
export const MAX_CROSS_TRACK_KM = 300;
export const LON_BAND_DEG = 30;
export const MAX_PER_BAND = 25;

const AIRLINE_CALLSIGN = /^[A-Z]{3}\d{1,4}[A-Z]{0,2}$/;

export function isAirlineCallsign(cs: string): boolean {
  return AIRLINE_CALLSIGN.test(cs);
}

export interface Plausibility {
  ok: boolean;
  reason?: "too-short" | "off-track" | "behind-origin" | "past-destination" | "nearly-landed";
}

export function checkPlausible(distKm: number, crossKm: number, alongKm: number): Plausibility {
  if (distKm < MIN_ROUTE_KM) return { ok: false, reason: "too-short" };
  if (Math.abs(crossKm) > MAX_CROSS_TRACK_KM) return { ok: false, reason: "off-track" };
  if (alongKm < -50) return { ok: false, reason: "behind-origin" };
  if (alongKm > distKm + 50) return { ok: false, reason: "past-destination" };
  if (distKm - alongKm < 100) return { ok: false, reason: "nearly-landed" };
  return { ok: true };
}

/** The fields curation needs, so it can run on lightweight candidates before Flights are built. */
export type Curatable = Pick<Flight, "icao24" | "callsign" | "distKm" | "depTempC" | "arrTempC"> & {
  pos: { lon: number };
};

export const hysteresisKey = (f: Pick<Flight, "icao24" | "callsign">) => `${f.icao24}:${f.callsign}`;

export function score(f: Curatable): number {
  // Temperature swing dominates; distance breaks ties toward longer, more visible arcs.
  return Math.abs(f.arrTempC - f.depTempC) + f.distKm / 2000;
}

/** A newcomer must beat the weakest flight on the globe by this much (score ~ degrees C) to replace it. */
export const SWAP_MARGIN = 5;
/** At most this many such replacements in any rolling hour, so the globe changes gradually. */
export const SWAPS_PER_HOUR = 12;
/** A flight stays on the globe at least this long before a newcomer may replace it. */
export const MIN_DWELL_S = 45 * 60;

export interface SwapOptions {
  /** When each previously shown flight joined the globe (unix s), by hysteresis key. */
  enteredAt: ReadonlyMap<string, number>;
  /** Replacements still allowed this hour. */
  swapsLeft: number;
  nowS: number;
}

/**
 * Keep every still-valid flight from the previous set (so lines don't flicker), then fill by score
 * with a per-longitude-band cap for geographic spread. Finally, a few clearly better newcomers may
 * replace the weakest shown flights (SWAP_MARGIN, SWAPS_PER_HOUR, MIN_DWELL_S), so a big new swing
 * doesn't wait for a weaker flight to land.
 */
export function curate<T extends Curatable>(
  eligible: T[],
  previous: Set<string>,
  max = CURATED_MAX,
  swaps?: SwapOptions,
): { chosen: T[]; swappedIn: number } {
  const band = (f: T) => Math.floor((f.pos.lon + 180) / LON_BAND_DEG);
  const perBand = new Map<number, number>();
  const take = (f: T) => perBand.set(band(f), (perBand.get(band(f)) ?? 0) + 1);
  const drop = (f: T) => perBand.set(band(f), (perBand.get(band(f)) ?? 0) - 1);

  const kept = eligible.filter((f) => previous.has(hysteresisKey(f))).slice(0, max);
  kept.forEach(take);
  const chosen = new Set(kept.map(hysteresisKey));

  const rest = eligible.filter((f) => !chosen.has(hysteresisKey(f))).sort((a, b) => score(b) - score(a));
  const out = [...kept];
  const waiting: T[] = [];
  for (const f of rest) {
    if (out.length >= max || (perBand.get(band(f)) ?? 0) >= MAX_PER_BAND) {
      waiting.push(f);
      continue;
    }
    out.push(f);
    take(f);
  }

  let swappedIn = 0;
  if (!swaps || swaps.swapsLeft <= 0 || waiting.length === 0) return { chosen: out, swappedIn };
  // Weakest first; only flights that have had their minimum time on the globe can be replaced.
  const replaceable = kept
    .filter((f) => swaps.nowS - (swaps.enteredAt.get(hysteresisKey(f)) ?? 0) >= MIN_DWELL_S)
    .sort((a, b) => score(a) - score(b));
  for (const f of waiting) {
    if (swappedIn >= swaps.swapsLeft || replaceable.length === 0) break;
    // Newcomers come best first: once one can't beat the weakest by the margin, none can.
    if (score(f) < score(replaceable[0]!) + SWAP_MARGIN) break;
    // The weakest flight this newcomer can take the place of without breaking its band's cap.
    const i = replaceable.findIndex((w) => band(w) === band(f) || (perBand.get(band(f)) ?? 0) < MAX_PER_BAND);
    const weakest = replaceable[i];
    if (!weakest || score(f) < score(weakest) + SWAP_MARGIN) continue;
    replaceable.splice(i, 1);
    out[out.indexOf(weakest)] = f;
    drop(weakest);
    take(f);
    swappedIn++;
  }
  return { chosen: out, swappedIn };
}
