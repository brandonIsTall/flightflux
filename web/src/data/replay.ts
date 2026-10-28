// Replaying a past flight: a Flight timed to fly from take-off to landing on the replay clock, and
// its recorded positions from the Worker (GET /api/track/:id).

import { useEffect } from "react";
import type { Flight, LeaderFlight, Track } from "../../../shared/types";
import { useStore } from "../store";
import { USING_FIXTURE } from "./snapshot";

const API_BASE = import.meta.env.VITE_API_BASE as string | undefined;

/** A replay lasts this long at its default speed. */
export const REPLAY_SECONDS = 40;

/**
 * The flight, set up so progressAt() runs linearly from 0 at take-off to 1 at landing: it starts
 * at the origin at depTime and moves at the average speed the route needs. Altitude is 0
 * (unknown) until a recorded track gives one (store.setReplayTrack).
 */
export function replayFlight(f: LeaderFlight): Flight {
  const durS = Math.max(60, f.eta - f.depTime);
  return {
    ...f,
    flownKm: 0,
    pos: {
      lat: f.origin.lat,
      lon: f.origin.lon,
      altM: 0,
      gsMs: Math.round(((f.distKm * 1000) / durS) * 10) / 10,
      trackDeg: 0,
      vRateMs: 0,
      t: f.depTime,
      fixT: f.depTime,
    },
  };
}

/** Virtual seconds per real second for the default replay length. */
export const defaultRate = (f: Pick<Flight, "depTime" | "eta">) => Math.max(60, Math.round((f.eta - f.depTime) / REPLAY_SECONDS));

/** Fetch the replayed flight's recorded positions into the replay, once per flight. */
export function useReplayTrack() {
  const id = useStore((s) => s.replay?.flight.id);
  const setTrack = useStore((s) => s.setReplayTrack);
  useEffect(() => {
    if (!id || USING_FIXTURE) return;
    let live = true;
    fetch(`${API_BASE}/api/track/${id}`)
      .then((r) => (r.ok ? (r.json() as Promise<Track>) : null))
      .then((t) => live && setTrack(id, t && t.points.length > 0 ? t.points : null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id, setTrack]);
}
