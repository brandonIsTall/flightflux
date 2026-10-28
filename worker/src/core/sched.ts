// The OpenSky schedule: which positions are due now. Pure, so the Durable Object can run it for
// its own polling and for an external poller's plan request alike, and so it can be tested.
//
// Budget (PLAN §2.5): tracked flights every 5 min, and as many region boxes as one sweep of every
// box per ~75 min buys, both 3x slower when credits run low. The first sweep goes round every box
// in order and is front-loaded, so a fresh deploy fills the globe in minutes; after it, the boxes
// that keep turning up new aircraft are visited more often and the empty ones less (tileStats).

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
/** However quiet a box is, it is visited at least this often. */
export const MAX_TILE_GAP_MS = 3 * SWEEP_MS;
/** A box's visit weight is the square root of its rate over the mean rate, held to this range. */
export const MIN_TILE_WEIGHT = 0.4;
export const MAX_TILE_WEIGHT = 2.5;
/** How fast a box's rate follows new counts (exponential moving average). */
export const TILE_RATE_ALPHA = 0.3;

/** Per-box discovery history, aligned with `Sched.tiles`. */
export interface TileStat {
  /** When the box was last handed out (ms). */
  lastAt: number;
  /** The time between its last two visits (ms): what its newest count of new aircraft covers. */
  gapMs: number;
  /** New long-haul flights it turns up per hour, smoothed (see Engine.merge). */
  rate: number;
}

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
  /** Absent in state saved before weighted sweeps (see tileStatsOf). */
  tileStats?: TileStat[];
  /** Departure-watch boxes: today's count and the ones waiting for the next poller. */
  watch?: WatchState;
}

export interface WatchState {
  /** UTC date, YYYY-MM-DD. */
  day: string;
  /** Watch boxes handed out today (1 credit each). */
  boxes: number;
  /** Planned by the alarm, handed out by the next plan request. */
  pending: Bbox[];
  /** When `pending` was planned (ms). */
  at: number;
  /** callsign -> when a watch box was issued for it (unix s): see Engine.useWatched. */
  watched: Record<string, number>;
}

/**
 * Departure watch budget, on top of the sweep and the tracked refresh (~2,500 credits a day):
 * at most this many 1-credit boxes a UTC day, and none while credits are below WATCH_MIN_CREDITS.
 */
export const WATCH_BOXES_PER_DAY = 900;
export const WATCH_MIN_CREDITS = 1200;
/** Watch boxes planned per alarm; the poller runs every 5 min. */
export const WATCH_PER_PLAN = 8;
/** Planned watch boxes older than this are dropped: their flights' window has moved on. */
export const WATCH_PENDING_TTL_MS = 10 * 60_000;

const today = (now: number) => new Date(now).toISOString().slice(0, 10);

export function watchOf(s: Sched, now: number): WatchState {
  if (!s.watch || s.watch.day !== today(now)) {
    s.watch = { day: today(now), boxes: 0, pending: s.watch?.pending ?? [], at: s.watch?.at ?? 0, watched: s.watch?.watched ?? {} };
  }
  return s.watch;
}

/** How many watch boxes may be planned now: 0 while some wait, credits are low or today's are spent. */
export function watchAllowance(s: Sched, now: number, creditsRemaining: number | null): number {
  const w = watchOf(s, now);
  if (w.pending.length > 0 && now - w.at < WATCH_PENDING_TTL_MS) return 0;
  if (creditsRemaining !== null && creditsRemaining < WATCH_MIN_CREDITS) return 0;
  return Math.max(0, Math.min(WATCH_PER_PLAN, WATCH_BOXES_PER_DAY - w.boxes));
}

export function queueWatch(s: Sched, now: number, boxes: Bbox[]) {
  const w = watchOf(s, now);
  w.pending = boxes;
  w.at = now;
}

/** The planned watch boxes, counted against today's budget, or none if they went stale. */
export function takeWatch(s: Sched, now: number): Bbox[] {
  const w = watchOf(s, now);
  const fresh = now - w.at < WATCH_PENDING_TTL_MS ? w.pending : [];
  w.pending = [];
  w.boxes += fresh.length;
  return fresh;
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
  // tileStats is created on first use (tileStatsOf), so loading saved state never takes a default.
});

/**
 * The per-box history, created for state saved before it existed: every box equally busy, and
 * last visited where the round-robin sweep left it (the box before `tileIdx` most recently), so
 * the boxes don't all come due at once.
 */
export function tileStatsOf(s: Sched): TileStat[] {
  if (!s.tileStats || s.tileStats.length !== s.tiles.length) {
    const n = s.tiles.length;
    const step = SWEEP_MS / n;
    s.tileStats = s.tiles.map((_, i) => ({ lastAt: s.lastTileAt - ((s.tileIdx - 1 - i + 2 * n) % n) * step, gapMs: SWEEP_MS, rate: 1 }));
  }
  return s.tileStats;
}

/** Visit weight from a box's rate relative to the mean: busy boxes come round more often. */
export function tileWeight(rate: number, meanRate: number): number {
  if (meanRate <= 0) return 1;
  return Math.min(MAX_TILE_WEIGHT, Math.max(MIN_TILE_WEIGHT, Math.sqrt(rate / meanRate)));
}

/** Record how many new aircraft a box's latest visit found. */
export function recordTileYield(s: Sched, tile: Bbox, fresh: number) {
  const stats = tileStatsOf(s);
  const idx = s.tiles.findIndex((t) => t.every((v, i) => v === tile[i]));
  const st = stats[idx];
  if (!st) return;
  // Per hour, never over less than 10 min: a box handed out twice in quick succession (a catching-up
  // poller) shouldn't read as a sudden surge.
  const perHour = fresh / Math.max(1 / 6, st.gapMs / 3_600_000);
  st.rate = st.rate + TILE_RATE_ALPHA * (perHour - st.rate);
}

/** Spread of the time between visits across boxes (minutes), for the logs. */
export function sweepSpread(s: Sched): { minMin: number; medianMin: number; maxMin: number } {
  const gaps = tileStatsOf(s).map((t) => t.gapMs / 60_000).sort((a, b) => a - b);
  const r = (x: number | undefined) => Math.round(x ?? 0);
  return { minMin: r(gaps[0]), medianMin: r(gaps[Math.floor(gaps.length / 2)]), maxMin: r(gaps[gaps.length - 1]) };
}

export interface PlanInput {
  now: number;
  /** Whether there is anything to track. */
  hasTracked: boolean;
  creditsRemaining: number | null;
  /** No aircraft known at all (fresh object, or one whose polling failed for a long time): sweep fast. */
  empty?: boolean;
  /** At most this many region boxes: a poller catching up takes several. */
  maxTiles: number;
}

export interface Plan {
  track: boolean;
  /** Indexes into `sched.tiles`, most due first. */
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
  const stats = tileStatsOf(s);
  const issue = (idx: number) => {
    plan.tileIdxs.push(idx);
    const st = stats[idx]!;
    if (st.lastAt > 0) st.gapMs = now - st.lastAt;
    st.lastAt = now;
  };
  if (s.sweeps === 0 || input.empty) {
    // The first sweep isn't rate-limited beyond one box per tick, so a catching-up poller takes
    // every box it is allowed, in order, until every box has been seen once.
    for (let i = 0; i < due; i++) {
      const idx = s.tileIdx % s.tiles.length;
      issue(idx);
      s.tileIdx = idx + 1;
      if (s.tileIdx >= s.tiles.length) {
        s.tileIdx = 0;
        s.sweeps++;
      }
    }
  } else {
    // Afterwards the same number of boxes, but the most due ones: how long since a box's last visit,
    // scaled by how many new aircraft it tends to turn up. A box left alone for MAX_TILE_GAP_MS goes
    // first whatever its weight, so no part of the world goes unseen.
    const mean = stats.reduce((sum, t) => sum + t.rate, 0) / stats.length;
    const priority = (i: number) => {
      const age = now - stats[i]!.lastAt;
      return age >= MAX_TILE_GAP_MS ? Infinity : age * tileWeight(stats[i]!.rate, mean);
    };
    const order = stats.map((_, i) => i).sort((a, b) => priority(b) - priority(a) || stats[a]!.lastAt - stats[b]!.lastAt);
    for (const idx of order.slice(0, due)) issue(idx);
  }
  s.lastTileAt = now;
  return plan;
}

/** Replace a box with its halves (after a too-full response), keeping the sweep position. */
export function replaceTile(s: Sched, tile: Bbox, next: Bbox[]): boolean {
  if (next.length <= 1) return false;
  const idx = s.tiles.findIndex((t) => t.every((v, i) => v === tile[i]));
  if (idx < 0) return false;
  // Each half starts with the box's last visit and its share of the box's rate.
  const stats = tileStatsOf(s);
  const parent = stats[idx]!;
  const halves = next.map(() => ({ ...parent, rate: parent.rate / next.length }));
  s.tileStats = [...stats.slice(0, idx), ...halves, ...stats.slice(idx + 1)];
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

/** Writes a day may start with before pacing applies: room for the post-midnight catch-up. */
export const PACE_HEADROOM = 5_000;

/**
 * Ahead of an even spread of WRITE_BUDGET over the UTC day (plus PACE_HEADROOM): skip optional
 * lookups for now, so a busy day fills routes in later instead of hitting the cap and freezing
 * the globe until midnight.
 */
export function aheadOfWritePace(s: Sched, now: number): boolean {
  const day = new Date(now).toISOString().slice(0, 10);
  if (!s.usage || s.usage.day !== day) return false;
  const dayFraction = (now % 86_400_000) / 86_400_000;
  return s.usage.written >= PACE_HEADROOM + (WRITE_BUDGET - PACE_HEADROOM) * dayFraction;
}

/** Count a search against today's cap. False when the cap is reached (the search is refused). */
export function takeSearch(s: Sched, now: number): boolean {
  recordUsage(s, now, 0, 0);
  if ((s.usage.searches ?? 0) >= SEARCH_BUDGET) return false;
  s.usage.searches = (s.usage.searches ?? 0) + 1;
  return true;
}
