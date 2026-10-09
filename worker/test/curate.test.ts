import { describe, expect, it } from "vitest";
import type { Flight } from "../../shared/types";
import { checkPlausible, curate, hysteresisKey, isAirlineCallsign } from "../src/core/curate";

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
    const out = curate([flight(1, 0, 2), flight(2, 40, 30), flight(3, 80, 15)], new Set(), 2);
    expect(out.map((f) => f.icao24)).toEqual(["a2", "a3"]);
  });

  it("keeps previously shown flights even when they score lower", () => {
    const low = flight(1, 0, 1);
    const out = curate([low, flight(2, 40, 30), flight(3, 80, 15)], new Set([hysteresisKey(low)]), 2);
    expect(out.map((f) => f.icao24)).toEqual(["a1", "a2"]);
  });

  it("caps flights per 30-degree longitude band", () => {
    const crowded = Array.from({ length: 40 }, (_, i) => flight(i, 5, 20));
    const elsewhere = flight(99, 100, 1);
    const out = curate([...crowded, elsewhere], new Set(), 150);
    expect(out.filter((f) => f.pos.lon === 5)).toHaveLength(25);
    expect(out.some((f) => f.icao24 === "a99")).toBe(true);
  });
});
