// The leaderboard: the biggest temperature swings of the last 24 h, 7 d and 30 d, from the Worker.

import { useQuery } from "@tanstack/react-query";
import type { Flight, LeaderFlight, Leaders, LeaderWindow } from "../../../shared/types";
import { bySwing } from "../lib/rank";
import { useSnapshot, USING_FIXTURE } from "./snapshot";

const API_BASE = import.meta.env.VITE_API_BASE as string | undefined;

export const LEADER_WINDOWS: { key: LeaderWindow; label: string; seconds: number }[] = [
  { key: "24h", label: "24 h", seconds: 86_400 },
  { key: "7d", label: "7 days", seconds: 7 * 86_400 },
  { key: "30d", label: "30 days", seconds: 30 * 86_400 },
];

/**
 * The bundled sample has no history: rank its flights (all in the air) as every window, so the
 * tabs can be developed without the live API.
 */
export function leadersFromFlights(flights: Flight[], nowS: number): Leaders {
  const top: LeaderFlight[] = bySwing(flights)
    .slice(0, 10)
    .map(({ pos: _pos, flownKm: _flownKm, ...f }) => f);
  return { v: 1, generatedAt: nowS, windows: { "24h": top, "7d": top, "30d": top } };
}

export function useLeaders(enabled: boolean): { data: Leaders | undefined; isLoading: boolean; isError: boolean } {
  const snapshot = useSnapshot();
  const live = useQuery({
    queryKey: ["leaders"],
    enabled: enabled && !USING_FIXTURE,
    // The Worker's edge cache holds it 5 min.
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<Leaders> => {
      const res = await fetch(`${API_BASE}/api/leaders`);
      if (!res.ok) throw new Error(`leaders ${res.status}`);
      return (await res.json()) as Leaders;
    },
  });
  if (!USING_FIXTURE) return live;
  const data = snapshot.data ? leadersFromFlights(snapshot.data.flights, Date.now() / 1000) : undefined;
  return { data, isLoading: snapshot.isLoading, isError: snapshot.isError };
}
