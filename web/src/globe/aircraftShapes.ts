// Top-down airliner silhouettes, FR24-style: fuselage, swept wings, tailplane and engine pods
// that read as two or four at a glance. Built from a few parametric pieces in the XY plane, nose
// toward +Y, 1 unit nose to tail; Planes.tsx scales and orients them.

import { Shape, ShapeGeometry, type BufferGeometry } from "three";
import type { AircraftClass } from "../lib/aircraft";

interface Spec {
  /** Fuselage width, as a fraction of length. */
  body: number;
  /** Half wingspan. */
  span: number;
  /** Wing root chord and tip chord. */
  root: number;
  tip: number;
  /** How far the wingtip's leading edge sits behind the root's. */
  sweep: number;
  /** Tailplane half span. */
  tail: number;
  /** Engine positions along the half span (0 = centreline, 1 = tip), and pod size. */
  engines: number[];
  podW: number;
  podL: number;
  /** Drawn size relative to a wide-body twin. */
  scale: number;
}

// Proportions after the A320 / 787 / 747 / A380, with pods a little oversized so they still read
// when the plane is a few dozen pixels long.
export const SPECS: Record<AircraftClass, Spec> = {
  narrow2: { body: 0.085, span: 0.47, root: 0.2, tip: 0.06, sweep: 0.2, tail: 0.17, engines: [0.36], podW: 0.06, podL: 0.13, scale: 0.75 },
  wide2: { body: 0.095, span: 0.48, root: 0.22, tip: 0.055, sweep: 0.25, tail: 0.17, engines: [0.34], podW: 0.075, podL: 0.15, scale: 1 },
  wide4: { body: 0.1, span: 0.46, root: 0.24, tip: 0.06, sweep: 0.28, tail: 0.18, engines: [0.4, 0.7], podW: 0.06, podL: 0.13, scale: 1.1 },
  super4: { body: 0.12, span: 0.55, root: 0.28, tip: 0.07, sweep: 0.28, tail: 0.2, engines: [0.36, 0.64], podW: 0.065, podL: 0.13, scale: 1.25 },
};

const NOSE = 0.5;
const TAIL = -0.5;
/** Leading edge of the wing root. */
const WING_Y = 0.1;

const poly = (pts: [number, number][]) => {
  const s = new Shape();
  s.moveTo(pts[0]![0], pts[0]![1]);
  for (const [x, y] of pts.slice(1)) s.lineTo(x, y);
  s.closePath();
  return s;
};

/** A piece drawn on the right side, plus its mirror on the left. */
const mirrored = (right: [number, number][]) => [poly(right), poly(right.map(([x, y]) => [-x, y] as [number, number]).reverse())];

export function aircraftGeometry(cls: AircraftClass): BufferGeometry {
  const s = SPECS[cls];
  const hw = s.body / 2;

  // Fuselage: rounded nose, parallel body, tapering tail cone.
  const fuselage = new Shape();
  fuselage.moveTo(0, NOSE);
  fuselage.quadraticCurveTo(hw, NOSE - 0.01, hw, NOSE - 0.1);
  fuselage.lineTo(hw, TAIL + 0.28);
  fuselage.lineTo(hw * 0.3, TAIL);
  fuselage.lineTo(-hw * 0.3, TAIL);
  fuselage.lineTo(-hw, TAIL + 0.28);
  fuselage.lineTo(-hw, NOSE - 0.1);
  fuselage.quadraticCurveTo(-hw, NOSE - 0.01, 0, NOSE);

  // Leading edge y at a point x along the half span.
  const le = (x: number) => WING_Y - (s.sweep * (x - hw)) / (s.span - hw);
  const wing = mirrored([
    [hw * 0.9, WING_Y],
    [s.span, le(s.span)],
    [s.span, le(s.span) - s.tip],
    [hw * 0.9, WING_Y - s.root],
  ]);

  const tailY = TAIL + 0.17;
  const stab = mirrored([
    [hw * 0.3, tailY],
    [s.tail, tailY - 0.09],
    [s.tail, tailY - 0.13],
    [hw * 0.3, tailY - 0.11],
  ]);

  // Pods hang from the wing and stick out ahead of its leading edge.
  const pods = s.engines.flatMap((e) => {
    const x = hw + e * (s.span - hw);
    const front = le(x) + s.podL * 0.6;
    const r = s.podW / 2;
    return mirrored([
      [x - r, front - 0.015],
      [x - r * 0.6, front],
      [x + r * 0.6, front],
      [x + r, front - 0.015],
      [x + r * 0.7, front - s.podL],
      [x - r * 0.7, front - s.podL],
    ]);
  });

  return new ShapeGeometry([fuselage, ...wing, ...stab, ...pods], 4);
}
