// Loads the snapshot from the Worker API (or the bundled fixture in dev) and projects each
// flight along its route to the current instant, matching the server's extrapolation.

import { useQuery } from "@tanstack/react-query";
import type { Flight, Snapshot } from "../../../shared/types";
import { interpolate, type LatLon } from "../lib/geo";

const API_BASE = import.meta.env.VITE_API_BASE as string | undefined;
export const SNAPSHOT_URL = API_BASE ? `${API_BASE}/api/snapshot` : "/fixture/snapshot.json";
export const USING_FIXTURE = !API_BASE;

async function fetchSnapshot(): Promise<Snapshot> {
  const res = await fetch(SNAPSHOT_URL);
  if (res.status === 503) throw new Error("warming up");
  if (!res.ok) throw new Error(`snapshot ${res.status}`);
  return (await res.json()) as Snapshot;
}

export function useSnapshot() {
  return useQuery({
    queryKey: ["snapshot"],
    queryFn: fetchSnapshot,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 3,
    retryDelay: (n) => Math.min(30_000, 2_000 * 2 ** n),
  });
}

/** Fraction of the route flown at unix time `nowS`, clamped to [0, 0.995] so planes never land. */
export function progressAt(f: Flight, nowS: number): number {
  const ageS = Math.max(0, nowS - f.pos.t);
  const km = f.flownKm + (f.pos.gsMs * ageS) / 1000;
  return Math.min(0.995, Math.max(0, km / f.distKm));
}

export function positionAt(f: Flight, nowS: number): LatLon {
  return interpolate(f.origin, f.dest, progressAt(f, nowS));
}

/** Blended temperature at a fraction along the route (the two-stop gradient). */
export function tempAtProgress(f: Flight, p: number): number {
  return f.depTempC + (f.arrTempC - f.depTempC) * p;
}
