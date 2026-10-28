// Ranking by temperature change, shared by the flight list and (later) the leaderboard.

import type { Flight } from "../../../shared/types";

export const swing = (f: Pick<Flight, "depTempC" | "arrTempC">) => Math.abs(f.arrTempC - f.depTempC);

/** Flights sorted by the size of their temperature change, biggest first. */
export function bySwing<T extends Pick<Flight, "depTempC" | "arrTempC">>(flights: T[]): T[] {
  return [...flights].sort((a, b) => swing(b) - swing(a));
}

/**
 * 1-based rank by temperature change for each ranked flight, by id. Only `rankedIds` take a place
 * (the curated flights, not ones added by search), so filtering the list never renumbers it.
 */
export function rankBySwing(sorted: Flight[], rankedIds: ReadonlySet<string>): Map<string, number> {
  const ranks = new Map<string, number>();
  for (const f of sorted) if (rankedIds.has(f.id)) ranks.set(f.id, ranks.size + 1);
  return ranks;
}
