// One gradient line per flight: the flown part solid and bright, the part ahead the same colors
// but translucent.

import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Line2 } from "three-stdlib";
import type { Flight } from "../../../shared/types";
import { progressAt, tempAtProgress } from "../data/snapshot";
import { tempToRgb, type RGB } from "../lib/color";
import { arcLift, centralAngle, interpolate, toVec3 } from "../lib/geo";
import { beats, useBoot } from "../boot";
import { useStore } from "../store";

const SEGMENTS = 64;
/** The part of the route still ahead is drawn at this opacity (times the focus opacity). */
const AHEAD_OPACITY = 0.3;
/** Non-hovered lines drop to this while something is hovered. */
const UNFOCUSED_OPACITY = 0.3;
/** The grey the routes trace in with, before they warm into their temperature colors. */
const TRACE_GREY: RGB = [0.33, 0.36, 0.4];

interface Polyline {
  points: [number, number, number][];
  colors: RGB[];
}

/** 65 points along the lifted great circle, each colored by the blended temperature there. */
function buildPolyline(f: Flight): Polyline {
  const angle = centralAngle(f.origin, f.dest);
  const points: [number, number, number][] = [];
  const colors: RGB[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const p = i / SEGMENTS;
    const v = toVec3(interpolate(f.origin, f.dest, p), 1 + arcLift(p, angle));
    points.push([v.x, v.y, v.z]);
    colors.push(tempToRgb(tempAtProgress(f, p)));
  }
  return { points, colors };
}

/** Re-renders every few seconds so the flown/ahead split tracks the plane. Frozen during the boot. */
function useCoarseClock(periodMs: number, running: boolean) {
  const [nowS, setNowS] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNowS(Date.now() / 1000), periodMs);
    return () => window.clearInterval(id);
  }, [periodMs, running]);
  return nowS;
}

const polylineLength = (pts: [number, number, number][]) => {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    len += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }
  return len;
};

const Route = memo(function Route({ f, nowS, focus }: { f: Flight; nowS: number; focus: "none" | "focused" | "unfocused" }) {
  const poly = useMemo(() => buildPolyline(f), [f]);
  const setHovered = useStore((s) => s.setHovered);
  const select = useStore((s) => s.select);
  const ahead = useRef<Line2>(null);
  const flownRef = useRef<Line2>(null);
  const warmApplied = useRef(-1);

  const split = Math.min(SEGMENTS - 1, Math.max(1, Math.round(progressAt(f, nowS) * SEGMENTS)));
  const flown = useMemo(() => {
    const points = poly.points.slice(0, split + 1);
    return { points, colors: poly.colors.slice(0, split + 1), length: polylineLength(points) };
  }, [poly, split]);
  const rest = useMemo(
    () => ({ points: poly.points.slice(split), colors: poly.colors.slice(split) }),
    [poly, split],
  );

  useFrame(() => {
    if (ahead.current) {
      // The part ahead only shows once the line has warmed up.
      ahead.current.material.opacity = AHEAD_OPACITY * opacity * beats.warm;
      ahead.current.visible = beats.warm > 0.01;
    }
    const line = flownRef.current;
    if (!line) return;
    // Boot: the flown line draws itself from the origin (a dash growing to full length)...
    line.material.dashSize = Math.max(0.0001, beats.routes * flown.length);
    line.visible = beats.routes > 0;
    // ...then floods with color from the origin outward.
    const w = beats.warm;
    if (w < 1 || warmApplied.current < 1) {
      const n = flown.colors.length;
      const flat = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const k = Math.min(1, Math.max(0, (w * 1.3 - i / Math.max(1, n - 1)) * 4));
        const c = flown.colors[i]!;
        flat[i * 3] = TRACE_GREY[0] + (c[0] - TRACE_GREY[0]) * k;
        flat[i * 3 + 1] = TRACE_GREY[1] + (c[1] - TRACE_GREY[1]) * k;
        flat[i * 3 + 2] = TRACE_GREY[2] + (c[2] - TRACE_GREY[2]) * k;
      }
      line.geometry.setColors(flat);
      warmApplied.current = w;
    }
  });

  const opacity = focus === "unfocused" ? UNFOCUSED_OPACITY : 1;
  const width = focus === "focused" ? 3.6 : 2.4;
  const handlers = {
    onPointerOver: (e: { stopPropagation: () => void }) => {
      if (useStore.getState().cameraMode !== "orbit") return;
      e.stopPropagation();
      setHovered(f.id);
      document.body.style.cursor = "pointer";
    },
    onPointerOut: () => {
      // Only clear our own hover: leaving this line mustn't wipe a neighbour's.
      if (useStore.getState().hoveredId === f.id) setHovered(null);
      document.body.style.cursor = "";
    },
    onClick: (e: { stopPropagation: () => void }) => {
      if (useStore.getState().cameraMode !== "orbit") return;
      e.stopPropagation();
      select(f.id);
    },
  };

  return (
    <group>
      <Line
        ref={flownRef}
        points={flown.points}
        vertexColors={flown.colors}
        lineWidth={width}
        transparent
        opacity={opacity}
        toneMapped={false}
        dashed
        dashSize={1000}
        gapSize={1000}
        {...handlers}
      />
      <Line
        ref={ahead}
        points={rest.points}
        vertexColors={rest.colors}
        lineWidth={width}
        transparent
        opacity={AHEAD_OPACITY * opacity}
        depthWrite={false}
        toneMapped={false}
        {...handlers}
      />
    </group>
  );
});

export function Routes({ flights }: { flights: Flight[] }) {
  const booted = useBoot((s) => s.phase === "done");
  const nowS = useCoarseClock(5_000, booted);
  const hoveredId = useStore((s) => s.hoveredId);
  const selectedId = useStore((s) => s.selectedId);
  const active = hoveredId ?? selectedId;
  return (
    <group>
      {flights.map((f) => (
        <Route key={f.id} f={f} nowS={nowS} focus={active === null ? "none" : active === f.id ? "focused" : "unfocused"} />
      ))}
    </group>
  );
}
