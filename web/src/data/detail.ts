// Flight detail (aircraft type, registration, photo) and search against the Worker API.

import { useQuery } from "@tanstack/react-query";
import type { Flight, FlightDetail } from "../../../shared/types";
import { USING_FIXTURE } from "./snapshot";

const API_BASE = import.meta.env.VITE_API_BASE as string | undefined;

export function useFlightDetail(flight: Flight | null) {
  return useQuery({
    queryKey: ["flight", flight?.id],
    enabled: !!flight && !USING_FIXTURE,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<FlightDetail> => {
      const res = await fetch(`${API_BASE}/api/flight/${flight!.id}`);
      if (!res.ok) throw new Error(`detail ${res.status}`);
      return (await res.json()) as FlightDetail;
    },
  });
}

export class SearchError extends Error {
  constructor(
    message: string,
    readonly kind: "none" | "rate" | "down",
  ) {
    super(message);
  }
}

/** Any airborne flight by number or callsign. Throws SearchError with a user-facing kind. */
export async function searchFlight(q: string): Promise<Flight> {
  if (USING_FIXTURE) throw new SearchError("search needs the live API", "none");
  const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q)}`);
  if (res.status === 404 || res.status === 400) throw new SearchError("no match", "none");
  if (res.status === 429) throw new SearchError("rate limited", "rate");
  if (!res.ok) throw new SearchError(`search ${res.status}`, "down");
  return (await res.json()) as Flight;
}

/** What a failed search says. `onGlobe` is the curated count (0 while it is unknown). The globe shows only the curated flights, and the server only knows
 * aircraft its sweeps have picked up, so a miss doesn't mean the flight has landed. */
export function searchErrorMessage(kind: SearchError["kind"], key: string, onGlobe: number): string {
  if (kind === "rate") return "Too many searches. Try again in a minute.";
  if (kind === "down") return "Search is unavailable right now.";
  const count = onGlobe > 0 ? `${onGlobe} ` : "";
  return `${key} isn't one of the ${count}flights on the globe (the biggest temperature swings), and we couldn't find it elsewhere in the sky. It may have landed or not be tracked yet.`;
}
