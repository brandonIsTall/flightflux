import { describe, expect, it } from "vitest";
import type { LeaderFlight } from "../../shared/types";
import { KEEP_S, Leaderboard, LEADER_TOP, undominated, type Scored } from "../src/core/leaders";

const NOW = 1_791_080_000;
const H = 3600;

const scored = (n: number, eta: number, swing: number, depTime = eta - 10 * H): Scored => ({
  icao24: `a${n}`,
  callsign: `TST${n}`,
  depTime,
  eta,
  depTempC: 0,
  arrTempC: swing,
});
const idOf = (c: Scored) => `${c.icao24}-${c.depTime}`;
const describe_ = (c: Scored) => ({ ...c, id: idOf(c) }) as unknown as LeaderFlight;

describe("undominated", () => {
  it("drops a flight once LEADER_TOP others land no earlier and swing more", () => {
    const later = Array.from({ length: LEADER_TOP }, (_, i) => scored(i, NOW - H, 20 + i));
    const beaten = scored(99, NOW - 2 * H, 10);
    const tooFew = scored(98, NOW - 2 * H, 10);
    expect(undominated([...later, beaten], NOW)).not.toContain(beaten);
    expect(undominated([...later.slice(1), tooFew], NOW)).toContain(tooFew);
  });

  it("keeps a smaller swing that landed later: it can still top a short window", () => {
    const earlier = Array.from({ length: LEADER_TOP }, (_, i) => scored(i, NOW - 5 * 86_400, 30 + i));
    const recent = scored(99, NOW - H, 5);
    expect(undominated([...earlier, recent], NOW)).toContain(recent);
  });

  it("forgets flights that landed before the longest window", () => {
    expect(undominated([scored(1, NOW - KEEP_S - 1, 50)], NOW)).toEqual([]);
  });

  it("stays small over a month of flights", () => {
    const month = Array.from({ length: 30_000 }, (_, i) => scored(i, NOW - Math.floor((i / 30_000) * KEEP_S), ((i * 7919) % 4001) / 100));
    expect(undominated(month, NOW).length).toBeLessThan(250);
  });
});

describe("Leaderboard", () => {
  it("ranks each window from one board and keeps landed flights", () => {
    const b = new Leaderboard();
    b.update([scored(1, NOW - 2 * H, 30), scored(2, NOW - 3 * 86_400, 40), scored(3, NOW - 20 * 86_400, 50), scored(4, NOW + H, 10)], idOf, describe_, NOW);
    const top = b.top(NOW);
    expect(top.windows["24h"].map((f) => f.icao24)).toEqual(["a1", "a4"]);
    expect(top.windows["7d"].map((f) => f.icao24)).toEqual(["a2", "a1", "a4"]);
    expect(top.windows["30d"].map((f) => f.icao24)).toEqual(["a3", "a2", "a1", "a4"]);

    // Later rebuilds no longer score the landed flights; they stay.
    b.update([scored(4, NOW + H, 12)], idOf, describe_, NOW + 60);
    expect(b.top(NOW + 60).windows["30d"]).toHaveLength(4);
  });

  it("re-scores a flight in the air in place, even when its id moves", () => {
    const b = new Leaderboard();
    b.update([scored(1, NOW + H, 20, NOW - 8 * H)], idOf, describe_, NOW);
    b.update([scored(1, NOW + H, 25, NOW - 8 * H + 120)], idOf, describe_, NOW + 300); // take-off estimate moved
    const w = b.top(NOW + 300).windows["24h"];
    expect(w).toHaveLength(1);
    expect(w[0]!.arrTempC).toBe(25);
  });

  it("is dirty only when something worth saving changed, and round-trips", () => {
    const b = new Leaderboard();
    const dep = NOW - 8 * H;
    b.update([scored(1, NOW + H, 20, dep)], idOf, describe_, NOW);
    expect(b.dirty).toBe(true);
    b.dirty = false;
    b.update([scored(1, NOW + H + 60, 20, dep)], idOf, describe_, NOW + 60); // ETA nudged a minute
    expect(b.dirty).toBe(false);
    b.update([scored(1, NOW + H + 60, 22, dep)], idOf, describe_, NOW + 120); // forecast moved
    expect(b.dirty).toBe(true);

    const copy = new Leaderboard();
    copy.load(b.toJSON());
    expect(copy.top(NOW)).toEqual(b.top(NOW));
  });
});
