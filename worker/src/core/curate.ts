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

export const hysteresisKey = (f: Pick<Flight, "icao24" | "callsign">) => `${f.icao24}:${f.callsign}`;

export function score(f: Flight): number {
  // Temperature swing dominates; distance breaks ties toward longer, more visible arcs.
  return Math.abs(f.arrTempC - f.depTempC) + f.distKm / 2000;
}

/**
 * Keep every still-valid flight from the previous set (so lines don't flicker), then fill by score
 * with a per-longitude-band cap for geographic spread.
 */
export function curate(eligible: Flight[], previous: Set<string>, max = CURATED_MAX): Flight[] {
  const band = (f: Flight) => Math.floor((f.pos.lon + 180) / LON_BAND_DEG);
  const perBand = new Map<number, number>();
  const take = (f: Flight) => perBand.set(band(f), (perBand.get(band(f)) ?? 0) + 1);

  const kept = eligible.filter((f) => previous.has(hysteresisKey(f))).slice(0, max);
  kept.forEach(take);
  const chosen = new Set(kept.map(hysteresisKey));

  const rest = eligible.filter((f) => !chosen.has(hysteresisKey(f))).sort((a, b) => score(b) - score(a));
  const out = [...kept];
  for (const f of rest) {
    if (out.length >= max) break;
    if ((perBand.get(band(f)) ?? 0) >= MAX_PER_BAND) continue;
    out.push(f);
    take(f);
  }
  return out;
}
