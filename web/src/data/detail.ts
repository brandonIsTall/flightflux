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
  if (res.status === 404) throw new SearchError("no match", "none");
  if (res.status === 429) throw new SearchError("rate limited", "rate");
  if (!res.ok) throw new SearchError(`search ${res.status}`, "down");
  return (await res.json()) as Flight;
}
