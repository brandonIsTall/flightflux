import { describe, expect, it } from "vitest";
import { arcLift, distanceKm, interpolate, toVec3 } from "../src/lib/geo";

const LHR = { lat: 51.4706, lon: -0.461941 };
const JFK = { lat: 40.6398, lon: -73.7789 };

describe("geo", () => {
  it("maps the poles and the prime meridian onto the globe", () => {
    expect(toVec3({ lat: 90, lon: 0 }).y).toBeCloseTo(1);
    expect(toVec3({ lat: -90, lon: 0 }).y).toBeCloseTo(-1);
    const v = toVec3({ lat: 0, lon: 0 });
    expect(v.length()).toBeCloseTo(1);
    expect(v.y).toBeCloseTo(0);
  });

  it("keeps east to the right of the prime meridian when viewed from +Z", () => {
    const west = toVec3({ lat: 0, lon: -90 });
    const east = toVec3({ lat: 0, lon: 90 });
    expect(east.x).toBeGreaterThan(west.x);
  });

  it("measures LHR-JFK within 1% of 5,540 km", () => {
    expect(distanceKm(LHR, JFK)).toBeGreaterThan(5485);
    expect(distanceKm(LHR, JFK)).toBeLessThan(5595);
  });

  it("interpolates the endpoints and a point in between", () => {
    expect(interpolate(LHR, JFK, 0).lat).toBeCloseTo(LHR.lat);
    expect(interpolate(LHR, JFK, 1).lon).toBeCloseTo(JFK.lon);
    const mid = interpolate(LHR, JFK, 0.5);
    expect(distanceKm(LHR, mid)).toBeCloseTo(distanceKm(mid, JFK), 0);
  });

  it("lifts arcs more for longer routes and not at all at the ends", () => {
    expect(arcLift(0, 1)).toBe(0);
    expect(arcLift(1, 1)).toBeCloseTo(0);
    expect(arcLift(0.5, 2)).toBeGreaterThan(arcLift(0.5, 0.5));
  });
});
