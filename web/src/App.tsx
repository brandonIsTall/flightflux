import { Suspense, useMemo } from "react";
import { useSnapshot } from "./data/snapshot";
import { Scene } from "./globe/Scene";
import { useStore } from "./store";
import { Cockpit } from "./ui/Cockpit";
import { DetailPanel } from "./ui/DetailPanel";
import { Freshness } from "./ui/Freshness";
import { Legend } from "./ui/Legend";
import { Tooltip } from "./ui/Tooltip";
import { TopBar } from "./ui/TopBar";

export function App() {
  const snapshot = useSnapshot();
  const extra = useStore((s) => s.extraFlights);
  const inOrbit = useStore((s) => s.cameraMode === "orbit");
  const hasPanel = useStore((s) => s.selectedId !== null);
  const flights = useMemo(() => {
    const base = snapshot.data?.flights ?? [];
    const ids = new Set(base.map((f) => f.id));
    return [...base, ...extra.filter((f) => !ids.has(f.id))];
  }, [snapshot.data, extra]);

  return (
    <div className={`relative h-full w-full bg-space ${hasPanel ? "has-panel" : ""}`}>
      <Suspense fallback={null}>
        <Scene flights={flights} />
      </Suspense>

      {/* Chrome sits over the WebGL canvas; the canvas keeps pointer events except where the chrome is. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
        <TopBar flights={flights} />
        <div className="flex items-end justify-between px-4 pb-4 sm:px-6 sm:pb-5">
          {inOrbit ? <Legend /> : <span />}
          <Freshness snapshot={snapshot.data} isError={snapshot.isError} isFetching={snapshot.isFetching} />
        </div>
      </div>

      <Cockpit flights={flights} />
      <DetailPanel flights={flights} />
      {inOrbit && <Tooltip flights={flights} />}
    </div>
  );
}
