import { describe, expect, it } from "vitest";
import { INITIAL_TILES, splitTile, tileCredits } from "../src/core/tiles";

describe("tiles", () => {
  it("cover every point on the globe exactly once", () => {
    for (let lat = -89; lat < 90; lat += 2) {
      for (let lon = -179; lon < 180; lon += 2) {
        const n = INITIAL_TILES.filter(([a, b, c, d]) => lat >= a && lat < c && lon >= b && lon < d).length;
        expect(n, `${lat},${lon}`).toBe(1);
      }
    }
  });

  it("keep a full sweep around 110 credits", () => {
    const total = INITIAL_TILES.reduce((n, t) => n + tileCredits(t), 0);
    expect(total).toBeLessThanOrEqual(115);
  });

  it("split along the longer side and stop at a minimum size", () => {
    expect(splitTile([0, 0, 10, 40])).toEqual([[0, 0, 10, 20], [0, 20, 10, 40]]);
    expect(splitTile([0, 0, 40, 10])).toEqual([[0, 0, 20, 10], [20, 0, 40, 10]]);
    expect(splitTile([0, 0, 8, 8])).toEqual([[0, 0, 8, 8]]);
  });
});
