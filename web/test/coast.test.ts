import { describe, expect, it } from "vitest";
import { coastlineSegments } from "../src/lib/earthTexture";

const land = (ring: number[][]): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }],
});

/** Longest segment's chord on the unit sphere. */
const longest = (xyz: Float32Array) => {
  let max = 0;
  for (let i = 0; i < xyz.length; i += 6)
    max = Math.max(max, Math.hypot(xyz[i]! - xyz[i + 3]!, xyz[i + 1]! - xyz[i + 4]!, xyz[i + 2]! - xyz[i + 5]!));
  return max;
};

describe("coastline segments", () => {
  it("splits long edges so they follow the sphere", () => {
    const segs = coastlineSegments(land([[0, 0], [10, 0], [10, 10], [0, 0]]));
    expect(longest(segs)).toBeLessThan(0.01); // 0.5 deg is ~0.0087 on the unit sphere
  });

  it("crosses the antimeridian the short way round", () => {
    // Fiji-like edge: 179.98 -> -180 is a few km, not a trip round the world.
    const segs = coastlineSegments(land([[179.98, -16.5], [-180, -16.49], [-179.5, -17], [179.98, -16.5]]));
    expect(longest(segs)).toBeLessThan(0.01);
  });

  it("skips polygon seams along the antimeridian and the south pole", () => {
    // Coast: the -85 parallel (10 deg -> 20 pieces) and the -170 meridian (5 deg -> 10 pieces).
    // Seams: the pole edge at -90 and the -180 meridian. Drawn, they'd add 30 more pieces.
    const segs = coastlineSegments(land([[-180, -85], [-170, -85], [-170, -90], [-180, -90], [-180, -85]]));
    expect(segs.length / 6).toBe(30);
  });
});
