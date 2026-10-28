import { Suspense, useEffect, useMemo, useRef } from "react";
import { motion } from "motion/react";
import type { Flight } from "../../shared/types";
import { ready, useBoot } from "./boot";
import { useReplayTrack } from "./data/replay";
import { hasLanded, useSnapshot } from "./data/snapshot";
import { Scene } from "./globe/Scene";
import { useStore } from "./store";
import { BootOverlay } from "./ui/BootOverlay";
import { Cockpit } from "./ui/Cockpit";
import { DataSources } from "./ui/DataSources";
import { DetailPanel } from "./ui/DetailPanel";
import { FlightList } from "./ui/FlightList";
import { Freshness } from "./ui/Freshness";
import { Legend } from "./ui/Legend";
import { ReplayBar } from "./ui/ReplayBar";
import { Tooltip } from "./ui/Tooltip";
import { TopBar } from "./ui/TopBar";

export function App() {
  const snapshot = useSnapshot();
  const extra = useStore((s) => s.extraFlights);
  const inOrbit = useStore((s) => s.cameraMode === "orbit");
  const hasPanel = useStore((s) => s.selectedId !== null);
  const selectedId = useStore((s) => s.selectedId);
  const replay = useStore((s) => s.replay);
  // The flight only, so seeking or pausing doesn't rebuild the globe's layers.
  const replayed = replay?.flight;
  useReplayTrack();
  // The server may swap a flight off the globe for a bigger temperature swing. The one being viewed
  // stays: its last copy is kept, and the client keeps moving it along its route.
  const held = useRef<Flight | null>(null);
  const flights = useMemo(() => {
    // A replay shows its flight alone, as it was then.
    if (replayed) return [replayed];
    const base = snapshot.data?.flights ?? [];
    const ids = new Set(base.map((f) => f.id));
    const nowS = Date.now() / 1000;
    // Flights past their arrival leave the globe (unless you're riding one), so a stale cache
    // never shows planes parked at their destinations.
    const all = [...base, ...extra.filter((f) => !ids.has(f.id))].filter((f) => f.id === selectedId || !hasLanded(f, nowS));
    if (selectedId && held.current?.id === selectedId && !all.some((f) => f.id === selectedId)) all.push(held.current);
    return all;
  }, [snapshot.data, extra, selectedId, replayed]);
  useEffect(() => {
    held.current = (selectedId && flights.find((f) => f.id === selectedId)) || null;
  }, [flights, selectedId]);
  const booted = useBoot((s) => s.phase === "done");

  // Tell the boot what the network has delivered.
  useEffect(() => {
    if (snapshot.data) {
      ready.snapshot = true;
      ready.flights = snapshot.data.flights.length;
      ready.known = snapshot.data.meta.known;
    }
  }, [snapshot.data]);
  const failed = snapshot.isError && !snapshot.data;

  return (
    <div className={`relative h-full w-full bg-space ${hasPanel ? "has-panel" : ""} ${replay ? "replaying" : ""}`}>
      <Suspense fallback={null}>
        <Scene flights={flights} failed={failed} />
      </Suspense>

      {/* Chrome sits over the WebGL canvas; the canvas keeps pointer events except where the chrome is.
          It fades in at the end of the boot. */}
      <motion.div
        className="pointer-events-none absolute inset-0 flex flex-col justify-between"
        initial={{ opacity: 0 }}
        animate={{ opacity: booted ? 1 : 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } }}
      >
        {replay ? <ReplayBar replay={replay} /> : <TopBar flights={flights} />}
        <div className="flex items-end justify-between px-4 pb-4 sm:px-6 sm:pb-5">
          {inOrbit ? <Legend /> : <span />}
          {/* Live-data status means nothing for a past flight. */}
          {!replay && <Freshness snapshot={snapshot.data} isError={snapshot.isError} isFetching={snapshot.isFetching} />}
        </div>
      </motion.div>

      <BootOverlay />
      <Cockpit flights={flights} />
      <DetailPanel flights={flights} />
      <FlightList flights={flights} />
      <DataSources />
      {inOrbit && <Tooltip flights={flights} />}
    </div>
  );
}
