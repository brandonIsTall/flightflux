import { describe, expect, it } from "vitest";
import { subsolarPoint } from "../src/lib/sun";

describe("subsolarPoint", () => {
  it("is near the equator at the March equinox and overhead at noon UTC near 0 longitude", () => {
    const p = subsolarPoint(new Date(Date.UTC(2026, 2, 20, 12, 0)));
    expect(Math.abs(p.lat)).toBeLessThan(1.5);
    expect(Math.abs(p.lon)).toBeLessThan(3); // equation of time is ~ -7 min in late March
  });

  it("reaches the tropics at the solstices", () => {
    expect(subsolarPoint(new Date(Date.UTC(2026, 5, 21, 12, 0))).lat).toBeGreaterThan(22.5);
    expect(subsolarPoint(new Date(Date.UTC(2026, 11, 21, 12, 0))).lat).toBeLessThan(-22.5);
  });

  it("moves west 15 degrees per hour", () => {
    const a = subsolarPoint(new Date(Date.UTC(2026, 9, 4, 12, 0))).lon;
    const b = subsolarPoint(new Date(Date.UTC(2026, 9, 4, 14, 0))).lon;
    expect(a - b).toBeCloseTo(30, 0);
  });
});
