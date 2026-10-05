import { describe, expect, it } from "vitest";
import { isIngestBody, prefilter } from "../src/core/ingest";
import type { RawState } from "../src/core/opensky";

const row = (cs: string, alt: number | null, gs: number, vr: number, onGround = false): RawState => [
  "abc123", cs, "X", 1, 1, 10, 50, alt, onGround, gs, 90, vr, null, alt, null, false, 0,
];

describe("prefilter", () => {
  it("keeps cruising airliners and climbing-out airliners, drops the rest", () => {
    const rows = [
      row("UAL880", 11000, 250, 0), // cruise: keep
      row("BAW117", 900, 80, 8), // climb-out: keep (observed departure)
      row("N123AB", 11000, 250, 0), // not an airline callsign
      row("DLH400", 3000, 200, 5), // mid-climb: nothing to learn yet
      row("AFR006", 11000, 250, 0, true), // on ground flag
      row("QFA1", null, 250, 0), // no altitude
      row("", 11000, 250, 0),
    ];
    expect(prefilter(rows).map((r) => r[1])).toEqual(["UAL880", "BAW117"]);
  });
});

describe("isIngestBody", () => {
  const ok = { time: 1, creditsRemaining: 3000, states: [], total: 12 };
  it("accepts well-formed bodies with and without a tile", () => {
    expect(isIngestBody(ok)).toBe(true);
    expect(isIngestBody({ ...ok, creditsRemaining: null, tile: [0, 0, 10, 10] })).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isIngestBody(null)).toBe(false);
    expect(isIngestBody({ ...ok, time: "1" })).toBe(false);
    expect(isIngestBody({ ...ok, tile: [0, 0, 10] })).toBe(false);
    expect(isIngestBody({ ...ok, states: new Array(2001).fill([]) })).toBe(false);
    expect(isIngestBody({ ...ok, total: undefined })).toBe(false);
  });
});
