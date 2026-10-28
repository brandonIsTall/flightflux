// The app's one clock. Everything that places a flight asks it for "now": real time normally, or
// the replay's virtual time while a past flight is being replayed (see Replay in store.ts).

import { useEffect, useState } from "react";
import { replayTime, useStore } from "../store";

/** Unix seconds now, or the replay's time. Cheap: call it every frame. */
export function nowS(): number {
  const r = useStore.getState().replay;
  return r ? replayTime(r) : Date.now() / 1000;
}

/**
 * `nowS()` as React state, refreshed every `periodMs` (faster while replaying, when time runs at
 * hundreds of times real speed) and at once when a replay starts, seeks or pauses. `running`
 * false freezes it.
 */
export function useNowS(periodMs: number, running = true): number {
  const replay = useStore((s) => s.replay);
  const [t, setT] = useState(nowS);
  const period = replay ? Math.min(periodMs, 100) : periodMs;
  useEffect(() => {
    setT(nowS());
    if (!running) return;
    const id = window.setInterval(() => setT(nowS()), period);
    return () => window.clearInterval(id);
  }, [period, running, replay]);
  return t;
}
