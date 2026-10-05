// The ingest contract between an external poller and the Worker.
//
// Cloudflare's network cannot reach OpenSky (its Cloudflare front answers 522 to Workers from
// every data centre tried), so positions are fetched elsewhere, e.g. a GitHub Actions cron, and
// POSTed to /api/_ingest. The poller first asks /api/_plan what is due, so the Durable Object
// stays the only keeper of the schedule and the credit budget.
//
// Bodies carry OpenSky's compact rows, pre-filtered to the aircraft the engine can use, so the
// Durable Object parses a fraction of a region's traffic within its 10 ms CPU allowance.

import { isAirlineCallsign } from "./curate";
import { MIN_CANDIDATE_ALT_M, MIN_CANDIDATE_GS_MS } from "./engine";
import type { Bbox, RawState } from "./opensky";
import { parseState } from "./opensky";

export interface PlanResponse {
  /** icao24s whose positions are due, or null when the tracked set isn't due yet. */
  tracked: string[] | null;
  /** Region boxes due for discovery, in sweep order. */
  tiles: Bbox[];
  creditsRemaining: number | null;
}

export interface IngestBody {
  /** OpenSky's response time (unix s). */
  time: number;
  creditsRemaining: number | null;
  /** Compact OpenSky rows, already run through `prefilter`. */
  states: RawState[];
  /** Rows in the unfiltered response: decides whether a box is split for the next sweep. */
  total: number;
  /** Set for a discovery box; absent for a tracked refresh. */
  tile?: Bbox;
}

/** Keep cruise-phase airliners (candidates) and low climbing airliners (observed departures). */
export function prefilter(rows: RawState[]): RawState[] {
  return rows.filter((r) => {
    const s = parseState(r);
    if (s.onGround || s.lat == null || s.lon == null || !isAirlineCallsign(s.callsign)) return false;
    const alt = s.baroAltM ?? s.geoAltM;
    if (alt != null && alt >= MIN_CANDIDATE_ALT_M && (s.velocityMs ?? 0) >= MIN_CANDIDATE_GS_MS) return true;
    return alt != null && alt < 1500 && (s.vRateMs ?? 0) > 2;
  });
}

/** Shape check for a body from the network; anything else is a 400. */
export function isIngestBody(b: unknown): b is IngestBody {
  if (typeof b !== "object" || b === null) return false;
  const o = b as Record<string, unknown>;
  const tileOk =
    o.tile === undefined || (Array.isArray(o.tile) && o.tile.length === 4 && o.tile.every((v) => typeof v === "number"));
  return (
    typeof o.time === "number" &&
    (o.creditsRemaining === null || typeof o.creditsRemaining === "number") &&
    Array.isArray(o.states) &&
    o.states.length <= 2000 &&
    typeof o.total === "number" &&
    tileOk
  );
}
