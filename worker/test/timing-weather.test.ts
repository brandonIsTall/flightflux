import { describe, expect, it } from "vitest";
import { APPROACH_S, estimateDeparture, estimateEta, utcDay } from "../src/core/timing";
import { tempAt, type TempSeries } from "../src/core/weather";

describe("timing", () => {
  it("ETA is cruise time for the remaining distance plus the approach allowance", () => {
    expect(estimateEta(1000, 900, 250)).toBe(1000 + 3600 + APPROACH_S);
  });

  it("departure estimate is earlier than a pure cruise back-calculation", () => {
    const t = 100_000;
    expect(estimateDeparture(t, 900, 250)).toBeLessThan(t - 3600);
  });

  it("falls back to a typical speed when ground speed is implausible", () => {
    expect(estimateEta(0, 230, 0)).toBe(1000 + APPROACH_S);
  });

  it("formats a UTC day", () => {
    expect(utcDay(1791080018)).toBe("20261004");
  });
});

describe("tempAt", () => {
  const s: TempSeries = { times: [0, 3600, 7200], tempsC: [10, 20, 14], tz: "UTC", utcOffsetS: 0, fetchedAt: 0 };

  it("interpolates between hours", () => {
    expect(tempAt(s, 1800)).toBe(15);
    expect(tempAt(s, 5400)).toBe(17);
  });

  it("hits exact hours and the last hour", () => {
    expect(tempAt(s, 3600)).toBe(20);
    expect(tempAt(s, 7200)).toBe(14);
  });

  it("returns null outside the series", () => {
    expect(tempAt(s, -1)).toBeNull();
    expect(tempAt(s, 7201)).toBeNull();
  });
});
