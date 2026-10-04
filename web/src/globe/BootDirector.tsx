// Advances the Thermal Boot beats every frame. Each beat has a minimum duration so the sequence
// reads even when everything is cached, and a gate on the real loading stage it represents, so
// it never runs ahead of the data. When both texture and snapshot arrive within the first
// moments (a repeat visit served from cache) the whole thing plays at triple speed.

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { Flight } from "../../../shared/types";
import { beats, completeBeats, ready, useBoot } from "../boot";
import { cToF } from "../lib/color";
import { useStore } from "../store";

/** Seconds a stage may wait before the status line admits it. */
const SLOW_AFTER_S = 8;

interface Beat {
  key: keyof typeof beats;
  /** Starts when this beat is at least this far along. */
  after: keyof typeof beats | null;
  afterAt: number;
  duration: number;
  gate?: () => boolean;
  label?: string;
}

const SCRIPT: Beat[] = [
  { key: "sweep", after: null, afterAt: 0, duration: 1.2 },
  { key: "graticule", after: "sweep", afterAt: 0.4, duration: 1.2 },
  { key: "dots", after: "graticule", afterAt: 0.6, duration: 0.9 },
  { key: "texture", after: "dots", afterAt: 1, duration: 0.8, gate: () => ready.texture },
  { key: "pings", after: "texture", afterAt: 0.5, duration: 1.3, gate: () => ready.snapshot, label: "Acquiring transponders" },
  { key: "routes", after: "pings", afterAt: 0.7, duration: 1.4, label: "Resolving routes" },
  { key: "warm", after: "routes", afterAt: 0.9, duration: 1.3, label: "Reading skies" },
  { key: "handoff", after: "warm", afterAt: 1, duration: 0.8 },
];

export function BootDirector({ flights, failed }: { flights: Flight[]; failed: boolean }) {
  const st = useRef({ elapsed: 0, rate: 1, waitingStart: 0, readoutIdx: 0, readoutAt: 0, finished: false, decidedRate: false });
  const units = useStore((s) => s.units);
  const reduced = useBoot((s) => s.reduced);
  const skipped = useBoot((s) => s.skipped);

  // Reduced motion: no choreography, just wait for the data and go.
  useEffect(() => {
    if (!reduced) return;
    completeBeats();
    useBoot.getState().set({ label: "Loading flights" });
  }, [reduced]);

  useFrame((_, dt) => {
    const s = st.current;
    const boot = useBoot.getState();
    if (s.finished) return;

    if (reduced) {
      if (ready.texture && ready.snapshot) finish(s);
      else if (failed) finish(s, "Couldn't reach the flight feed. Showing what's cached.");
      return;
    }
    if (skipped) {
      completeBeats();
      finish(s);
      return;
    }

    s.elapsed += dt;
    // A repeat visit has texture and snapshot almost at once: play it fast.
    if (!s.decidedRate && s.elapsed > 0.35) {
      s.decidedRate = true;
      s.rate = ready.texture && ready.snapshot ? 3 : 1;
    }
    const step = dt * s.rate;

    let blocked: Beat | null = null;
    for (const b of SCRIPT) {
      if (beats[b.key] >= 1) continue;
      const prev = b.after ? beats[b.after] : 1;
      if (prev < b.afterAt) break;
      if (b.gate && !b.gate()) {
        blocked = b;
        break;
      }
      if (beats[b.key] === 0 && b.label && boot.label !== b.label) {
        boot.set({ label: b.label, count: b.key === "routes" ? 0 : b.key === "pings" ? 0 : null, readout: null });
      }
      beats[b.key] = Math.min(1, beats[b.key] + step / b.duration);
      // Counters follow the beat.
      if (b.key === "pings") boot.set({ count: Math.round(ready.known * Math.min(1, beats.pings * 1.15)) });
      if (b.key === "routes") boot.set({ count: Math.round(ready.flights * Math.min(1, beats.routes * 1.1)) });
      if (b.key === "warm") {
        s.readoutAt += step;
        if (s.readoutAt > 0.22 && flights.length > 0) {
          s.readoutAt = 0;
          const f = flights[s.readoutIdx++ % flights.length]!;
          const pick = s.readoutIdx % 2 ? { code: f.origin.iata ?? f.origin.icao, t: f.depTempC } : { code: f.dest.iata ?? f.dest.icao, t: f.arrTempC };
          boot.set({ readout: `${pick.code} ${Math.round(units === "F" ? cToF(pick.t) : pick.t)}°` });
        }
      }
      if (b.key === "handoff" && boot.phase !== "handoff") boot.set({ phase: "handoff", count: null, readout: null });
      break; // one beat advances at a time; overlaps come from `afterAt`
    }

    // Honest waiting: name what we're waiting for, say so after a while (wall-clock, so a slow
    // renderer can't stretch it), and give up on a dead feed.
    if (blocked) {
      if (s.waitingStart === 0) {
        s.waitingStart = performance.now();
        (window as unknown as { __ffWait?: number }).__ffWait = s.waitingStart;
        if (blocked.key === "pings") boot.set({ label: "Waiting for the flight feed", count: null });
      }
      if (failed && blocked.key === "pings") {
        finish(s, ready.snapshot ? null : "Couldn't reach the flight feed. Showing what's cached.");
        return;
      }
      if (performance.now() - s.waitingStart > SLOW_AFTER_S * 1000 && !boot.notice) {
        boot.set({ notice: blocked.key === "pings" ? "The flight feed is slow. Still trying." : "Still loading the globe." });
      }
    } else if (s.waitingStart !== 0) {
      s.waitingStart = 0;
      if (boot.notice) boot.set({ notice: null });
    }

    if (beats.handoff >= 1) finish(s);
  });

  return null;
}

function finish(s: { finished: boolean }, notice: string | null = null) {
  s.finished = true;
  completeBeats();
  useBoot.getState().set({ phase: "done", notice, count: null, readout: null });
}
