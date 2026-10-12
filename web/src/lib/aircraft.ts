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

/** Readable names for common ICAO type designators; anything else shows as its code. */
const NAMES: Record<string, string> = {
  A19N: "A319neo", A20N: "A320neo", A21N: "A321neo", A318: "A318", A319: "A319", A320: "A320", A321: "A321",
  A332: "A330-200", A333: "A330-300", A338: "A330-800neo", A339: "A330-900neo",
  A342: "A340-200", A343: "A340-300", A345: "A340-500", A346: "A340-600",
  A359: "A350-900", A35K: "A350-1000", A388: "A380",
  BCS1: "A220-100", BCS3: "A220-300",
  B37M: "737 MAX 7", B38M: "737 MAX 8", B39M: "737 MAX 9", B3XM: "737 MAX 10",
  B737: "737-700", B738: "737-800", B739: "737-900",
  B752: "757-200", B753: "757-300", B762: "767-200", B763: "767-300", B764: "767-400",
  B772: "777-200", B77L: "777-200LR", B773: "777-300", B77W: "777-300ER", B778: "777-8", B779: "777-9",
  B788: "787-8", B789: "787-9", B78X: "787-10",
  B744: "747-400", B748: "747-8", BLCF: "747 Dreamlifter",
  E170: "E170", E175: "E175", E190: "E190", E195: "E195", E290: "E190-E2", E295: "E195-E2",
  MD11: "MD-11", C919: "C919", IL96: "Il-96",
};

/** "B789" -> "787-9"; an unknown designator is shown as is; null when there is none. */
export function aircraftName(icaoType: string | null | undefined): string | null {
  const t = icaoType?.trim().toUpperCase();
  if (!t) return null;
  return NAMES[t] ?? t;
}
