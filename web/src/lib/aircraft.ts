// ICAO aircraft type designator -> the silhouette drawn on the globe. Only what the outline can
// show: body width, wingspan and engine count. Curation favours long-haul, so anything unknown is
// drawn as the commonest long-haul shape, a wide-body twin.

export type AircraftClass = "narrow2" | "wide2" | "wide4" | "super4";

export const AIRCRAFT_CLASSES: AircraftClass[] = ["narrow2", "wide2", "wide4", "super4"];

const SUPER4 = /^A38/;
const WIDE4 = /^(B74|BLCF|A34|IL96)/;
// A318-A321 (and neos), 737s, 757s, A220, E-Jets, CRJs, C919, 717/MD-80/90.
const NARROW2 = /^(A318|A319|A320|A321|A19N|A20N|A21N|B73|B3[7-9X]M|B75|BCS[13]|E1[79]\d|E29\d|E75[LS]|CRJ|C919|B712|MD8|MD9)/;

export function aircraftClass(icaoType: string | null | undefined): AircraftClass {
  const t = (icaoType ?? "").toUpperCase();
  if (SUPER4.test(t)) return "super4";
  if (WIDE4.test(t)) return "wide4";
  if (NARROW2.test(t)) return "narrow2";
  return "wide2";
}
