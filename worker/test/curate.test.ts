import { describe, expect, it } from "vitest";
import type { Flight } from "../../shared/types";
import { checkPlausible, curate, hysteresisKey, isAirlineCallsign, MAX_PER_BAND, MIN_DWELL_S, SWAP_MARGIN } from "../src/core/curate";

function flight(i: number, lon: number, swing: number): Flight {
  const ap = { icao: "XXXX", iata: null, name: "", city: "", country: "", lat: 0, lon: 0 };
  return {
    id: `a${i}-20261004`,
    icao24: `a${i}`,
    callsign: `TST${i}`,
    flightNo: null,
    airline: null,
    aircraftType: null,
    origin: ap,
    dest: ap,
    pos: { lat: 0, lon, altM: 11000, gsMs: 250, trackDeg: 90, vRateMs: 0, t: 0, fixT: 0 },
    distKm: 6000,
    flownKm: 1000,
    depTime: 0,
    eta: 0,
    depTempC: 10,
    arrTempC: 10 + swing,
    flags: { depTimeSource: "estimated" },
  };
}

describe("isAirlineCallsign", () => {
  it.each(["BAW117", "UAL880", "DLH4AB", "QFA1"])("accepts %s", (c) => expect(isAirlineCallsign(c)).toBe(true));
  it.each(["N123AB", "GABCD", "BAW", "BA117", ""])("rejects %s", (c) => expect(isAirlineCallsign(c)).toBe(false));
});

describe("checkPlausible", () => {
  it("accepts a long route with the plane on track", () => expect(checkPlausible(6000, 50, 2000).ok).toBe(true));
  it("rejects short routes", () => expect(checkPlausible(1500, 0, 500).reason).toBe("too-short"));
  it("rejects planes far off the path", () => expect(checkPlausible(6000, 400, 2000).reason).toBe("off-track"));
  it("rejects planes past the destination", () =>
    expect(checkPlausible(6000, 0, 6100).reason).toBe("past-destination"));
  it("rejects planes about to land", () => expect(checkPlausible(6000, 0, 5950).reason).toBe("nearly-landed"));
});

describe("curate", () => {
  it("prefers bigger temperature swings", () => {
    const out = curate([flight(1, 0, 2), flight(2, 40, 30), flight(3, 80, 15)], new Set(), 2).chosen;
    expect(out.map((f) => f.icao24)).toEqual(["a2", "a3"]);
  });

  it("keeps previously shown flights even when they score lower", () => {
    const low = flight(1, 0, 1);
    const out = curate([low, flight(2, 40, 30), flight(3, 80, 15)], new Set([hysteresisKey(low)]), 2).chosen;
    expect(out.map((f) => f.icao24)).toEqual(["a1", "a2"]);
  });

  it("caps flights per 30-degree longitude band", () => {
    const crowded = Array.from({ length: 40 }, (_, i) => flight(i, 5, 20));
    const elsewhere = flight(99, 100, 1);
    const out = curate([...crowded, elsewhere], new Set(), 150).chosen;
    expect(out.filter((f) => f.pos.lon === 5)).toHaveLength(25);
    expect(out.some((f) => f.icao24 === "a99")).toBe(true);
  });
});

describe("curate swaps", () => {
  const NOW = 100_000;
  // Swing s scores s + 3 (distKm 6000 / 2000), so scores differ exactly as swings do.
  const shown = (f: ReturnType<typeof flight>, enteredAt = NOW - MIN_DWELL_S) => ({ key: hysteresisKey(f), enteredAt });
  const run = (eligible: ReturnType<typeof flight>[], prev: { key: string; enteredAt: number }[], max: number, swapsLeft = 6) =>
    curate(eligible, new Set(prev.map((p) => p.key)), max, {
      enteredAt: new Map(prev.map((p) => [p.key, p.enteredAt])),
      swapsLeft,
      nowS: NOW,
    });

  it("replaces the weakest shown flight with one at least SWAP_MARGIN better", () => {
    const weak = flight(1, 0, 10);
    const strong = flight(2, 0, 10 + SWAP_MARGIN);
    const r = run([weak, strong], [shown(weak)], 1);
    expect(r.chosen.map((f) => f.icao24)).toEqual(["a2"]);
    expect(r.swappedIn).toBe(1);
  });

  it("keeps the shown flight when the newcomer is less than SWAP_MARGIN better", () => {
    const weak = flight(1, 0, 10);
    const r = run([weak, flight(2, 0, 10 + SWAP_MARGIN - 1)], [shown(weak)], 1);
    expect(r.chosen.map((f) => f.icao24)).toEqual(["a1"]);
    expect(r.swappedIn).toBe(0);
  });

  it("swaps no more than allowed this hour, weakest first", () => {
    const kept = [flight(1, 0, 1), flight(2, 40, 2), flight(3, 80, 3)];
    const better = [flight(4, 0, 30), flight(5, 40, 30), flight(6, 80, 30)];
    const r = run([...kept, ...better], kept.map((f) => shown(f)), 3, 2);
    expect(r.swappedIn).toBe(2);
    expect(r.chosen.map((f) => f.icao24).sort()).toEqual(["a3", "a4", "a5"]);
  });

  it("protects a flight that joined the globe less than MIN_DWELL_S ago", () => {
    const fresh = flight(1, 0, 1);
    const r = run([fresh, flight(2, 0, 30)], [shown(fresh, NOW - MIN_DWELL_S + 60)], 1);
    expect(r.chosen.map((f) => f.icao24)).toEqual(["a1"]);
  });

  it("does not swap past a longitude band's cap", () => {
    const full = Array.from({ length: MAX_PER_BAND }, (_, i) => flight(i, 5, 20));
    const elsewhere = flight(90, 100, 1);
    const crowding = flight(91, 5, 40); // much better, but its band is already full
    const prev = [...full, elsewhere].map((f) => shown(f));
    const r = run([...full, elsewhere, crowding], prev, MAX_PER_BAND + 1);
    // It may only replace a flight in its own band, never the weak one elsewhere.
    expect(r.chosen.filter((f) => f.pos.lon === 5)).toHaveLength(MAX_PER_BAND);
    expect(r.chosen.some((f) => f.icao24 === "a90")).toBe(true);
    expect(r.chosen.some((f) => f.icao24 === "a91")).toBe(true);
  });
});
