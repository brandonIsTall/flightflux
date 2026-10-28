import { describe, expect, it } from "vitest";
import { fixRow, trackFrom } from "../src/core/fixlog";

const T = 1_791_080_000;
const fix = (icao24: string, callsign: string, t: number, lat = 50.123456, lon = -20.987654, altM = 11_277) => ({ icao24, callsign, t, lat, lon, altM });

describe("fix log", () => {
  it("logs only fixes newer than the last row, compacted", () => {
    expect(fixRow([fix("a1", "BAW1", T - 600), fix("b2", "UAL2", T - 60)], T - 300)).toEqual([["b2", "UAL2", T - 60, 50.1235, -20.9877, 11_280]]);
  });

  it("builds one flight's track: its own leg only, each fix once, oldest first", () => {
    const rows = [
      JSON.stringify(fixRow([fix("a1", "BAW1", T + 100, 50, -1), fix("a1", "BAW9", T + 110, 0, 0)], 0)),
      JSON.stringify(fixRow([fix("a1", "BAW1", T + 400, 51, -2), fix("c3", "BAW1", T + 400, 9, 9)], 0)),
      JSON.stringify(fixRow([fix("a1", "BAW1", T + 400, 51, -2), fix("a1", "BAW1", T + 99_999, 5, 5)], 0)), // repeat; a later leg
    ];
    expect(trackFrom(rows, "a1", "BAW1", T, T + 10_000)).toEqual([
      [T + 100, 50, -1, 11_280],
      [T + 400, 51, -2, 11_280],
    ]);
  });
});
