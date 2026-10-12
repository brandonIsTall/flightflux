import { describe, expect, it } from "vitest";
import { aircraftClass, aircraftName } from "../src/lib/aircraft";

describe("aircraft silhouette class", () => {
  it("picks the outline from the ICAO type", () => {
    for (const t of ["A388"]) expect(aircraftClass(t)).toBe("super4");
    for (const t of ["B744", "B748", "A346", "A343"]) expect(aircraftClass(t)).toBe("wide4");
    for (const t of ["A20N", "A321", "A21N", "B738", "B38M", "B752", "BCS3", "E190", "CRJ9"]) expect(aircraftClass(t)).toBe("narrow2");
    for (const t of ["B789", "B77W", "A359", "A35K", "A333", "A339", "B763", "A310", "MD11"]) expect(aircraftClass(t)).toBe("wide2");
  });

  it("draws an unknown type as a wide-body twin", () => {
    expect(aircraftClass(null)).toBe("wide2");
    expect(aircraftClass("ZZZZ")).toBe("wide2");
  });
});

describe("aircraft name", () => {
  it("reads common designators, passes unknown ones through, and hides a missing one", () => {
    expect(aircraftName("B789")).toBe("787-9");
    expect(aircraftName("a21n")).toBe("A321neo");
    expect(aircraftName("B77W")).toBe("777-300ER");
    expect(aircraftName("ZZZZ")).toBe("ZZZZ");
    expect(aircraftName(null)).toBeNull();
    expect(aircraftName("  ")).toBeNull();
  });
});
