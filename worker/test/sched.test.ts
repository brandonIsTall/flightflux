import { describe, expect, it } from "vitest";
import { aheadOfWritePace, FIRST_SWEEP_TILE_MS, MAX_TILE_GAP_MS, PACE_HEADROOM, initialSched, overBudget, planNext, READ_BUDGET, recordTileYield, recordUsage, replaceTile, SEARCH_BUDGET, SWEEP_MS, takeSearch, tileStatsOf, TRACK_INTERVAL_MS, WRITE_BUDGET, type Sched } from "../src/core/sched";
import { INITIAL_TILES } from "../src/core/tiles";

const T = 1_791_080_000_000;
const input = (now: number, extra: Partial<Parameters<typeof planNext>[1]> = {}) => ({
  now,
  hasTracked: true,
  creditsRemaining: 3000,
  maxTiles: 12,
  ...extra,
});

describe("planNext", () => {
  it("front-loads the first sweep and hands out up to maxTiles boxes to a catching-up poller", () => {
    const s = initialSched();
    const p = planNext(s, input(T));
    expect(p.track).toBe(true);
    expect(p.tileIdxs).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(s.tileIdx).toBe(12);
    // Nothing more until the next tile interval has passed.
    expect(planNext(s, input(T + 1000)).tileIdxs).toEqual([]);
    expect(planNext(s, input(T + 1000)).track).toBe(false);
  });

  it("takes one box per tick on the object's own loop", () => {
    const s = initialSched();
    expect(planNext(s, input(T, { maxTiles: 1 })).tileIdxs).toEqual([0]);
    expect(planNext(s, input(T + FIRST_SWEEP_TILE_MS, { maxTiles: 1 })).tileIdxs).toEqual([1]);
  });

  it("after the first sweep, paces boxes so a sweep takes SWEEP_MS whatever the poller cadence", () => {
    const s = initialSched();
    s.sweeps = 1;
    s.lastTileAt = T;
    const n = INITIAL_TILES.length;
    // Every 5 min: about 2 boxes a run. Every 30 min: about 11. Same credits per hour.
    expect(planNext(s, input(T + 5 * 60_000)).tileIdxs.length).toBe(Math.floor((5 * 60_000 * n) / SWEEP_MS));
    s.lastTileAt = T;
    expect(planNext(s, input(T + 30 * 60_000)).tileIdxs.length).toBe(Math.floor((30 * 60_000 * n) / SWEEP_MS));
    // A whole sweep is never more than maxTiles at once, and never hands the same box out twice.
    s.lastTileAt = T;
    const p = planNext(s, input(T + 2 * SWEEP_MS, { maxTiles: 50 }));
    expect(p.tileIdxs.length).toBe(n);
    expect(new Set(p.tileIdxs).size).toBe(n);
  });

  it("sweeps at first-sweep pace again when nothing is known, whatever the sweep count says", () => {
    const s = initialSched();
    s.sweeps = 3;
    s.lastTileAt = T;
    expect(planNext(s, input(T + 60_000)).tileIdxs.length).toBe(0);
    s.lastTileAt = T;
    expect(planNext(s, input(T + 60_000, { empty: true })).tileIdxs.length).toBe(2);
  });

  it("slows down 3x when credits run low", () => {
    const s = initialSched();
    s.sweeps = 1;
    s.lastTrackAt = T;
    s.lastTileAt = T;
    const low = input(T + TRACK_INTERVAL_MS * 2, { creditsRemaining: 500 });
    expect(planNext(s, low).track).toBe(false);
    expect(planNext(s, input(T + TRACK_INTERVAL_MS * 3, { creditsRemaining: 500 })).track).toBe(true);
  });

  it("never asks to track when there is nothing tracked", () => {
    expect(planNext(initialSched(), input(T, { hasTracked: false })).track).toBe(false);
  });
});

describe("replaceTile", () => {
  it("swaps a box for its halves and keeps the sweep position", () => {
    const s = initialSched();
    s.tileIdx = 5;
    const tile = s.tiles[2]!;
    expect(replaceTile(s, tile, [[0, 0, 1, 1], [1, 1, 2, 2]])).toBe(true);
    expect(s.tiles.length).toBe(INITIAL_TILES.length + 1);
    expect(s.tileIdx).toBe(6);
    expect(replaceTile(s, [9, 9, 9, 9], [[0, 0, 1, 1], [1, 1, 2, 2]])).toBe(false);
    expect(replaceTile(s, s.tiles[0]!, [s.tiles[0]!])).toBe(false);
  });
});

describe("daily storage budget", () => {
  const noon = Date.UTC(2026, 9, 6, 12);
  it("tallies rows per UTC day and starts over at midnight", () => {
    const s = initialSched();
    recordUsage(s, noon, 10, 2);
    recordUsage(s, noon + 60_000, 5, 1);
    expect(s.usage).toEqual({ day: "2026-10-06", read: 15, written: 3, searches: 0 });
    recordUsage(s, Date.UTC(2026, 9, 7, 0, 1), 1, 1);
    expect(s.usage).toEqual({ day: "2026-10-07", read: 1, written: 1, searches: 0 });
  });

  it("trips on either cap, and only for today", () => {
    const s = initialSched();
    expect(overBudget(s, noon)).toBe(false);
    recordUsage(s, noon, READ_BUDGET, 0);
    expect(overBudget(s, noon)).toBe(true);
    expect(overBudget(s, Date.UTC(2026, 9, 7, 0, 1))).toBe(false);
    const w = initialSched();
    recordUsage(w, noon, 0, WRITE_BUDGET);
    expect(overBudget(w, noon)).toBe(true);
  });

  it("paces writes evenly over the UTC day, after some headroom for the morning catch-up", () => {
    const midnight = Date.UTC(2026, 9, 6);
    const s = initialSched();
    expect(aheadOfWritePace(s, midnight + 60_000)).toBe(false);
    recordUsage(s, midnight + 60_000, 0, PACE_HEADROOM - 100);
    expect(aheadOfWritePace(s, midnight + 60_000)).toBe(false);
    recordUsage(s, midnight + 60_000, 0, 200);
    expect(aheadOfWritePace(s, midnight + 60_000)).toBe(true);
    // By noon the pace allows half the rest of the budget.
    expect(aheadOfWritePace(s, noon)).toBe(false);
    recordUsage(s, noon, 0, (WRITE_BUDGET - PACE_HEADROOM) / 2);
    expect(aheadOfWritePace(s, noon)).toBe(true);
    // A new day starts a new tally.
    expect(aheadOfWritePace(s, midnight + 86_400_000 + 60_000)).toBe(false);
  });

  it("works with scheduler state saved before the tally existed", () => {
    const old = { ...initialSched() } as Partial<ReturnType<typeof initialSched>>;
    delete old.usage;
    const s = { ...initialSched(), ...old };
    recordUsage(s, noon, 1, 1);
    expect(s.usage.read).toBe(1);
  });
});

describe("daily search cap", () => {
  const noon = Date.UTC(2026, 9, 9, 12);
  it("answers SEARCH_BUDGET searches a day, then refuses until UTC midnight", () => {
    const s = initialSched();
    for (let i = 0; i < SEARCH_BUDGET; i++) expect(takeSearch(s, noon)).toBe(true);
    expect(takeSearch(s, noon + 60_000)).toBe(false);
    expect(takeSearch(s, Date.UTC(2026, 9, 10, 0, 1))).toBe(true);
    expect(s.usage.searches).toBe(1);
  });

  it("works with a tally saved before searches were counted", () => {
    const s = initialSched();
    s.usage = { day: "2026-10-09", read: 5, written: 5 };
    expect(takeSearch(s, noon)).toBe(true);
    expect(s.usage).toEqual({ day: "2026-10-09", read: 5, written: 5, searches: 1 });
  });
});

describe("weighted sweep", () => {
  /** A sched past its first sweep, boxes last visited in round-robin order up to T, with the given rates. */
  const steady = (rates: number[]): Sched => {
    const s = initialSched();
    s.sweeps = 1;
    s.lastTileAt = T;
    tileStatsOf(s).forEach((t, i) => (t.rate = rates[i]!));
    return s;
  };
  /** Run a poller every 5 min for a day; count visits and the longest gap per box. */
  const day = (s: Sched) => {
    const visits = s.tiles.map(() => 0);
    const last = tileStatsOf(s).map((t) => t.lastAt);
    const maxGap = s.tiles.map(() => 0);
    for (let t = T + 5 * 60_000; t <= T + 24 * 3_600_000; t += 5 * 60_000) {
      for (const i of planNext(s, input(t, { maxTiles: 50 })).tileIdxs) {
        visits[i]!++;
        maxGap[i] = Math.max(maxGap[i]!, t - last[i]!);
        last[i] = t;
      }
    }
    return { visits, maxGap, total: visits.reduce((a, b) => a + b, 0) };
  };
  const n = INITIAL_TILES.length;

  it("visits a busy box more often, for the same number of boxes in all", () => {
    const even = day(steady(Array(n).fill(1)));
    const busy = day(steady([10, ...Array(n - 1).fill(1)]));
    expect(busy.total).toBe(even.total); // same credits
    const median = [...busy.visits].sort((a, b) => a - b)[Math.floor(n / 2)]!;
    expect(busy.visits[0]! / median).toBeGreaterThanOrEqual(2);
    expect(busy.visits[0]! / median).toBeLessThanOrEqual(3.5);
  });

  it("never leaves a quiet box unvisited for longer than MAX_TILE_GAP_MS", () => {
    const rates = INITIAL_TILES.map((_, i) => (i % 2 === 0 ? 20 : 0.001));
    const { visits, maxGap } = day(steady(rates));
    expect(Math.max(...maxGap)).toBeLessThanOrEqual(MAX_TILE_GAP_MS + 5 * 60_000);
    expect(visits[0]!).toBeGreaterThan(visits[1]!);
  });

  it("learns a box's rate as new aircraft per hour since its previous visit", () => {
    const s = steady(Array(n).fill(1));
    tileStatsOf(s)[3]!.gapMs = 30 * 60_000;
    recordTileYield(s, INITIAL_TILES[3]!, 20); // 40 an hour
    expect(tileStatsOf(s)[3]!.rate).toBeCloseTo(1 + 0.3 * (40 - 1));
  });

  it("splits a box's history between its halves", () => {
    const s = steady(Array(n).fill(1));
    tileStatsOf(s)[0]!.rate = 8;
    const halves = [
      [-90, -180, -45, -60],
      [-45, -180, 0, -60],
    ] as const;
    expect(replaceTile(s, INITIAL_TILES[0]!, halves.map((h) => [...h]))).toBe(true);
    expect(s.tiles).toHaveLength(n + 1);
    expect(tileStatsOf(s).slice(0, 2).map((t) => t.rate)).toEqual([4, 4]);
    expect(tileStatsOf(s)[2]!.rate).toBe(1);
  });

  it("staggers the history it creates for old state, so boxes don't all come due at once", () => {
    const s = initialSched();
    s.lastTileAt = T;
    s.tileIdx = 5;
    const at = tileStatsOf(s).map((t) => t.lastAt);
    expect(at[4]).toBe(T); // the box the round-robin sweep handed out last
    expect(at[5]).toBe(T - (n - 1) * (SWEEP_MS / n)); // the one it was about to come back to
    expect(new Set(at).size).toBe(n);
  });

  it("plans from state saved before box history existed", () => {
    const { tileStats: _, ...saved } = initialSched();
    const s: Sched = { ...initialSched(), ...saved }; // as sky-state loads it
    expect(s.tileStats).toBeUndefined();
    s.sweeps = 2;
    s.lastTileAt = T;
    const p = planNext(s, input(T + 10 * 60_000));
    expect(p.tileIdxs.length).toBe(Math.floor((10 * 60_000 * n) / SWEEP_MS));
    expect(tileStatsOf(s)).toHaveLength(n);
  });
});
