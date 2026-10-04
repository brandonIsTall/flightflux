import { useEffect, useState } from "react";
import type { Snapshot } from "../../../shared/types";
import { USING_FIXTURE } from "../data/snapshot";

function ago(s: number): string {
  if (s < 90) return "1 min ago";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

/** The one status indicator on the screen. Its dot reports real state: live, stale, or offline. */
export function Freshness({ snapshot, isError, isFetching }: { snapshot?: Snapshot; isError: boolean; isFetching: boolean }) {
  const [nowS, setNowS] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = window.setInterval(() => setNowS(Date.now() / 1000), 15_000);
    return () => window.clearInterval(id);
  }, []);

  let label: React.ReactNode;
  let state: "live" | "stale" | "off";
  if (USING_FIXTURE && snapshot) {
    label = "Sample data";
    state = "stale";
  } else if (!snapshot) {
    label = isError ? "Offline" : "Connecting";
    state = isError ? "off" : "stale";
  } else {
    const age = nowS - snapshot.generatedAt;
    state = age > 15 * 60 || isError ? "stale" : "live";
    label = (
      <>
        {state === "live" ? "Live, " : "Showing positions from "}
        <span className="num">{ago(age)}</span>
      </>
    );
  }

  return (
    <div className="pointer-events-auto flex items-center gap-2 text-[12px] text-ink-2" role="status" aria-live="polite">
      <span
        aria-hidden
        className={`block h-1.5 w-1.5 rounded-full ${
          state === "live" ? "bg-ink-1" : state === "stale" ? "bg-ink-3" : "border border-ink-3"
        } ${isFetching ? "animate-pulse" : ""}`}
      />
      <span>{label}</span>
    </div>
  );
}
