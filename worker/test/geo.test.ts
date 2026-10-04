import { describe, expect, it } from "vitest";
import { bearingDeg, distanceKm, interpolate, trackOffsets } from "../src/core/geo";

const LHR = { lat: 51.4706, lon: -0.461941 };
const JFK = { lat: 40.6398, lon: -73.7789 };

describe("geo", () => {
  it("measures LHR-JFK within 1% of the published 5,540 km", () => {
    expect(distanceKm(LHR, JFK)).toBeGreaterThan(5485);
    expect(distanceKm(LHR, JFK)).toBeLessThan(5595);
  });

  it("gives a westbound initial bearing for LHR-JFK", () => {
    expect(bearingDeg(LHR, JFK)).toBeGreaterThan(280);
    expect(bearingDeg(LHR, JFK)).toBeLessThan(300);
  });

  it("puts a point on the great circle at ~0 cross-track and the right along-track", () => {
    const mid = interpolate(LHR, JFK, 0.4);
    const { crossKm, alongKm } = trackOffsets(LHR, JFK, mid);
    expect(Math.abs(crossKm)).toBeLessThan(1);
    expect(alongKm).toBeCloseTo(distanceKm(LHR, JFK) * 0.4, 0);
  });

  it("reports a point behind the origin as negative along-track", () => {
    const behind = interpolate(JFK, LHR, 1.05); // past LHR, continuing east
    expect(trackOffsets(LHR, JFK, behind).alongKm).toBeLessThan(0);
  });

  it("flags a point well off the path", () => {
    const { crossKm } = trackOffsets(LHR, JFK, { lat: 35, lon: -40 });
    expect(Math.abs(crossKm)).toBeGreaterThan(1000);
  });
});
