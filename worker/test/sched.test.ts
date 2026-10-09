import { describe, expect, it } from "vitest";
import { FIRST_SWEEP_TILE_MS, initialSched, overBudget, planNext, READ_BUDGET, recordUsage, replaceTile, SEARCH_BUDGET, SWEEP_MS, takeSearch, TRACK_INTERVAL_MS, WRITE_BUDGET } from "../src/core/sched";
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
    expect(s.sweeps).toBe(2);
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
