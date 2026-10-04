// One gradient line per flight: the flown part solid and bright, the part ahead dimmer with a
// dash flowing toward the destination.

import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Line2 } from "three-stdlib";
import type { Flight } from "../../../shared/types";
import { progressAt, tempAtProgress } from "../data/snapshot";
import { tempToRgb, type RGB } from "../lib/color";
import { arcLift, centralAngle, interpolate, toVec3 } from "../lib/geo";
import { useStore } from "../store";

const SEGMENTS = 64;
/** The part of the route still ahead is drawn at this fraction of full brightness. */
const AHEAD_DIM = 0.45;
/** Non-hovered lines drop to this while something is hovered. */
const UNFOCUSED_OPACITY = 0.3;
/** Dash flow speed in world units per second (globe radius = 1). */
const DASH_SPEED = 0.035;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

const dim = ([r, g, b]: RGB, k: number): RGB => [r * k, g * k, b * k];

/** Re-renders every few seconds so the flown/ahead split tracks the plane. */
function useCoarseClock(periodMs: number) {
  const [nowS, setNowS] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = window.setInterval(() => setNowS(Date.now() / 1000), periodMs);
    return () => window.clearInterval(id);
  }, [periodMs]);
  return nowS;
}

const Route = memo(function Route({ f, nowS, focus }: { f: Flight; nowS: number; focus: "none" | "focused" | "unfocused" }) {
  const poly = useMemo(() => buildPolyline(f), [f]);
  const setHovered = useStore((s) => s.setHovered);
  const select = useStore((s) => s.select);
  const ahead = useRef<Line2>(null);

  const split = Math.min(SEGMENTS - 1, Math.max(1, Math.round(progressAt(f, nowS) * SEGMENTS)));
  const flown = useMemo(
    () => ({ points: poly.points.slice(0, split + 1), colors: poly.colors.slice(0, split + 1) }),
    [poly, split],
  );
  const rest = useMemo(
    () => ({ points: poly.points.slice(split), colors: poly.colors.slice(split).map((c) => dim(c, AHEAD_DIM)) }),
    [poly, split],
  );

  useFrame((_, dt) => {
    if (ahead.current && !reducedMotion()) ahead.current.material.dashOffset -= DASH_SPEED * dt;
  });

  const opacity = focus === "unfocused" ? UNFOCUSED_OPACITY : 1;
  const width = focus === "focused" ? 2.6 : 1.6;
  const handlers = {
    onPointerOver: (e: { stopPropagation: () => void }) => {
      if (useStore.getState().cameraMode !== "orbit") return;
      e.stopPropagation();
      setHovered(f.id);
      document.body.style.cursor = "pointer";
    },
    onPointerOut: () => {
      setHovered(null);
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
        points={flown.points}
        vertexColors={flown.colors}
        lineWidth={width}
        transparent
        opacity={opacity}
        toneMapped={false}
        {...handlers}
      />
      <Line
        ref={ahead}
        points={rest.points}
        vertexColors={rest.colors}
        lineWidth={width * 0.8}
        transparent
        opacity={opacity}
        dashed
        dashSize={0.03}
        gapSize={0.02}
        toneMapped={false}
        {...handlers}
      />
    </group>
  );
});

export function Routes({ flights }: { flights: Flight[] }) {
  const nowS = useCoarseClock(5_000);
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
