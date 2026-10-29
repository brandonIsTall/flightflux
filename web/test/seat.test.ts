import { describe, expect, it } from "vitest";
import { elevationAt } from "../src/lib/earthTexture";
import { arcLift, centralAngle, SEAT_ABOVE_LINE, SEAT_CLEARANCE, seatRadius } from "../src/lib/geo";

const LHR = { lat: 51.4706, lon: -0.461941 };
const SYD = { lat: -33.9461, lon: 151.177 };

describe("cockpit seat", () => {
  const angle = centralAngle(LHR, SYD);

  it("rides just above the route line: low at the ends, high mid-route", () => {
    expect(seatRadius(0, angle)).toBeCloseTo(1 + SEAT_ABOVE_LINE);
    expect(seatRadius(1, angle)).toBeCloseTo(1 + SEAT_ABOVE_LINE);
    expect(seatRadius(0.5, angle)).toBeCloseTo(1 + arcLift(0.5, angle) + SEAT_ABOVE_LINE);
    expect(seatRadius(0.5, angle)).toBeGreaterThan(seatRadius(0.1, angle));
  });

  it("never drops below the clearance over raised ground", () => {
    const ground = 0.005;
    expect(seatRadius(0, angle, ground)).toBeCloseTo(1 + ground + SEAT_CLEARANCE);
    // Mid-route the line is far above any ground, so the floor doesn't bite.
    expect(seatRadius(0.5, angle, ground)).toBeCloseTo(seatRadius(0.5, angle));
  });
});

describe("elevationAt", () => {
  // 4 x 2 grid: row 0 north, row 1 south; a single peak at column 1 of the north row.
  const grid = { width: 4, height: 2, data: new Uint8Array([0, 255, 0, 0, 0, 0, 0, 0]) };

  it("reads a pixel at its centre", () => {
    // Column 1 centre is lon -45; row 0 centre is lat 45.
    expect(elevationAt(grid, { lat: 45, lon: -45 })).toBeCloseTo(1);
    expect(elevationAt(grid, { lat: -45, lon: 45 })).toBeCloseTo(0);
  });

  it("blends between pixel centres and wraps across the antimeridian", () => {
    expect(elevationAt(grid, { lat: 45, lon: -90 })).toBeCloseTo(0.5);
    expect(elevationAt(grid, { lat: 0, lon: -45 })).toBeCloseTo(0.5);
    expect(elevationAt(grid, { lat: 45, lon: 179 })).toBeCloseTo(0);
    expect(elevationAt(grid, { lat: 45, lon: -181 + 360 })).toBeCloseTo(0);
  });
});
