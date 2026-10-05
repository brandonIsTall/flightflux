// The OpenSky schedule: which positions are due now. Pure, so the Durable Object can run it for
// its own polling and for an external poller's plan request alike, and so it can be tested.
//
// Budget (PLAN §2.5): tracked flights every 5 min, one discovery sweep of every region box every
// ~75 min, both 3x slower when credits run low. The first sweep is front-loaded so a fresh deploy
// fills the globe in minutes.

import type { Bbox } from "./opensky";
import { INITIAL_TILES } from "./tiles";

export const TICK_MS = 30_000;
/** Positions for the flights on the globe: 288 calls x 4 credits = ~1,150 credits/day. */
export const TRACK_INTERVAL_MS = 5 * 60_000;
/** One discovery sweep of every region box: ~108 credits each, ~19 a day = ~2,100 credits/day. */
export const SWEEP_MS = 75 * 60_000;
/** Below this many OpenSky credits, slow everything down 3x rather than run dry. */
export const LOW_CREDITS = 800;
/** During the first sweep, boxes are due this often (one per Durable Object tick). */
export const FIRST_SWEEP_TILE_MS = TICK_MS - 2_000;

/** Scheduler state, persisted so a recreated object can never call OpenSky faster than planned. */
export interface Sched {
  lastTrackAt: number;
  lastTileAt: number;
  lastPersistAt: number;
  /** When an external poller last asked for a plan; the object polls itself only when none does. */
  lastPlanAt: number;
  tileIdx: number;
  sweeps: number;
  tiles: Bbox[];
}

export const initialSched = (): Sched => ({
  lastTrackAt: 0,
  lastTileAt: 0,
  lastPersistAt: 0,
  lastPlanAt: 0,
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
  /** At most this many region boxes. The object polls one per tick; a poller catching up on a 5 min cadence takes several. */
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
