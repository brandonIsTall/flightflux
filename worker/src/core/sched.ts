// The OpenSky schedule: which positions are due now. Pure, so the Durable Object can run it for
// its own polling and for an external poller's plan request alike, and so it can be tested.
//
// Budget (PLAN §2.5): tracked flights every 5 min, one discovery sweep of every region box every
// ~75 min, both 3x slower when credits run low. The first sweep is front-loaded so a fresh deploy
// fills the globe in minutes.

import type { Bbox } from "./opensky";
import { INITIAL_TILES } from "./tiles";

/** Positions for the flights on the globe: 288 calls x 4 credits = ~1,150 credits/day. */
export const TRACK_INTERVAL_MS = 5 * 60_000;
/** One discovery sweep of every region box: ~108 credits each, ~19 a day = ~2,100 credits/day. */
export const SWEEP_MS = 75 * 60_000;
/** Below this many OpenSky credits, slow everything down 3x rather than run dry. */
export const LOW_CREDITS = 800;
/** During the first sweep (or with nothing known), boxes are due this often. */
export const FIRST_SWEEP_TILE_MS = 28_000;

/** Scheduler state, persisted so a recreated object can never call OpenSky faster than planned. */
export interface Sched {
  lastTrackAt: number;
  lastTileAt: number;
  /** When an external poller last asked for a plan; the object polls itself only when none does. */
  lastPlanAt: number;
  /** When the alarm last asked GitHub to start the poller (src/dispatch.ts). */
  lastDispatchAt?: number;
  /** When expired cache rows were last deleted (a full scan, so daily). */
  lastPruneAt: number;
  /** Storage layout version (2: WITHOUT ROWID cache tables). */
  schema: number;
  /** SQLite rows read and written today (UTC), against the free plan's daily caps. */
  usage: Usage;
  tileIdx: number;
  sweeps: number;
  tiles: Bbox[];
}

export const initialSched = (): Sched => ({
  lastTrackAt: 0,
  lastTileAt: 0,
  lastPlanAt: 0,
  lastPruneAt: 0,
  schema: 0,
  usage: { day: "", read: 0, written: 0, searches: 0 },
  tileIdx: 0,
  sweeps: 0,
  tiles: INITIAL_TILES,
});

export interface PlanInput {
  now: number;
  /** Whether there is anything to track. */
  hasTracked: boolean;
  creditsRemaining: number | null;
  /** No aircraft known at all (fresh object, or one whose polling failed for a long time): sweep fast. */
  empty?: boolean;
  /** At most this many region boxes. The object's fallback takes one; a poller catching up takes several. */
  maxTiles: number;
}

export interface Plan {
  track: boolean;
  /** Indexes into `sched.tiles`, in sweep order. */
  tileIdxs: number[];
}

/** Decide what is due and mark it as issued in `s` (mutated). Record before calling OpenSky so failures can't retry hot. */
export function planNext(s: Sched, input: PlanInput): Plan {
  const { now } = input;
  const slow = (input.creditsRemaining ?? Infinity) < LOW_CREDITS ? 3 : 1;
  const plan: Plan = { track: false, tileIdxs: [] };

  if (input.hasTracked && now - s.lastTrackAt >= TRACK_INTERVAL_MS * slow) {
    s.lastTrackAt = now;
    plan.track = true;
  }

  const tileEvery = s.sweeps === 0 || input.empty ? FIRST_SWEEP_TILE_MS : (SWEEP_MS / s.tiles.length) * slow;
  // Never more than one whole sweep at once: a long outage shouldn't spend a box twice in one plan.
  const due = Math.min(input.maxTiles, s.tiles.length, Math.floor((now - s.lastTileAt) / tileEvery));
  if (due <= 0) return plan;
  // The first sweep isn't rate-limited beyond one box per tick, so a catching-up poller takes
  // every box it is allowed; afterwards only as many as the sweep interval has earned.
  for (let i = 0; i < due; i++) {
    const idx = s.tileIdx % s.tiles.length;
    plan.tileIdxs.push(idx);
    s.tileIdx = idx + 1;
    if (s.tileIdx >= s.tiles.length) {
      s.tileIdx = 0;
      s.sweeps++;
    }
  }
  s.lastTileAt = now;
  return plan;
}

/** Replace a box with its halves (after a too-full response), keeping the sweep position. */
export function replaceTile(s: Sched, tile: Bbox, next: Bbox[]): boolean {
  if (next.length <= 1) return false;
  const idx = s.tiles.findIndex((t) => t.every((v, i) => v === tile[i]));
  if (idx < 0) return false;
  s.tiles = [...s.tiles.slice(0, idx), ...next, ...s.tiles.slice(idx + 1)];
  if (s.tileIdx > idx) s.tileIdx += next.length - 1;
  return true;
}

/** Durable Objects free plan: 5M rows read and 100k rows written a day, reset at 00:00 UTC. */
export const READ_BUDGET = 4_000_000;
export const WRITE_BUDGET = 80_000;
export const PRUNE_EVERY_MS = 24 * 3600_000;

export interface Usage {
  /** UTC date, YYYY-MM-DD. */
  day: string;
  read: number;
  written: number;
  /** Searches answered today: each can cost an adsbdb lookup, an Open-Meteo call and a few writes. */
  searches?: number;
}

/** Searches per UTC day across all visitors. The Worker also limits each visitor (wrangler.jsonc). */
export const SEARCH_BUDGET = 1_000;

/** Add rows to today's tally, starting a new one at UTC midnight. */
export function recordUsage(s: Sched, now: number, read: number, written: number) {
  const day = new Date(now).toISOString().slice(0, 10);
  if (!s.usage || s.usage.day !== day) s.usage = { day, read: 0, written: 0, searches: 0 };
  s.usage.read += read;
  s.usage.written += written;
}

/**
 * Past our share of a daily cap: stop optional work (ingests, lookups) until UTC midnight, so the
 * snapshot keeps being served from the rows left rather than every request failing.
 */
export function overBudget(s: Sched, now: number): boolean {
  const day = new Date(now).toISOString().slice(0, 10);
  return !!s.usage && s.usage.day === day && (s.usage.read >= READ_BUDGET || s.usage.written >= WRITE_BUDGET);
}

/** Count a search against today's cap. False when the cap is reached (the search is refused). */
export function takeSearch(s: Sched, now: number): boolean {
  recordUsage(s, now, 0, 0);
  if ((s.usage.searches ?? 0) >= SEARCH_BUDGET) return false;
  s.usage.searches = (s.usage.searches ?? 0) + 1;
  return true;
}
