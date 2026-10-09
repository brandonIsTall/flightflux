// A top-down airliner silhouette per flight, advanced along its route every frame and tinted with
// the blended temperature at that point. One instanced mesh per silhouette class (narrow-body
// twin, wide-body twin, quad, A380), so 150 planes cost four draw calls.

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Color, DoubleSide, InstancedMesh, Matrix4, MeshBasicMaterial, Vector3 } from "three";
import type { Flight } from "../../../shared/types";
import { progressAt, tempAtProgress } from "../data/snapshot";
import { AIRCRAFT_CLASSES, aircraftClass, type AircraftClass } from "../lib/aircraft";
import { tempToRgb } from "../lib/color";
import { arcLift, centralAngle, interpolate, toVec3 } from "../lib/geo";
import { beats } from "../boot";
import { useStore } from "../store";
import { aircraftGeometry, SPECS } from "./aircraftShapes";
import { spin } from "./spin";

const MAX = 512;
/** Nose-to-tail length of a wide-body twin, in world units (globe radius = 1). */
const LENGTH = 0.042;
/** Planes ride just above their route line so the line doesn't cut through them. */
const ABOVE_LINE = 0.002;

const tmpColor = new Color();
const pos = new Vector3();
const ahead = new Vector3();
const up = new Vector3();
const fwd = new Vector3();
const right = new Vector3();
const scale = new Vector3();
const world = new Vector3();
const m = new Matrix4();
const UP = new Vector3(0, 1, 0);

interface Entry {
  f: Flight;
  angle: number;
  /** Index in the full list, for the boot stagger. */
  i: number;
}

function PlaneClass({ cls, entries, material }: { cls: AircraftClass; entries: Entry[]; material: MeshBasicMaterial }) {
  const mesh = useRef<InstancedMesh>(null);
  const geometry = useMemo(() => aircraftGeometry(cls), [cls]);
  const size = LENGTH * SPECS[cls].scale;

  useFrame(({ camera }) => {
    const im = mesh.current;
    if (!im) return;
    const nowS = Date.now() / 1000;
    const { hoveredId, selectedId, cameraMode } = useStore.getState();
    const active = hoveredId ?? selectedId;
    // The camera sits on the selected plane once seated; don't draw it in the lens.
    const seated = cameraMode === "cockpit" || cameraMode === "to-cockpit";
    const n = Math.min(MAX, entries.length);
    for (let j = 0; j < n; j++) {
      const { f, angle, i } = entries[j]!;
      const p = progressAt(f, nowS);
      const lift = 1 + arcLift(p, angle) + ABOVE_LINE;
      toVec3(interpolate(f.origin, f.dest, p), lift, pos);
      // Heading: along the arc toward a point a little further on (or from one a little back,
      // at the very end), flattened onto the plane's local horizon.
      if (p < 0.99) toVec3(interpolate(f.origin, f.dest, p + 0.01), lift, ahead).sub(pos);
      else ahead.copy(pos).sub(toVec3(interpolate(f.origin, f.dest, p - 0.01), lift, fwd));
      up.copy(pos).normalize();
      fwd.copy(ahead).addScaledVector(up, -ahead.dot(up)).normalize();
      right.crossVectors(fwd, up);
      // From the seat, other planes are tiny neighbours; anything within a few seat-heights of
      // the lens would fill the screen, so it isn't drawn at all.
      const tooClose = seated && camera.position.distanceTo(world.copy(pos).applyAxisAngle(UP, spin.y)) < 0.25;
      // During the boot, planes grow in with the transponder pings (staggered like them).
      const boot = Math.min(1, Math.max(0, (beats.pings * 1.4 - ((i * 0.618034) % 1)) * 3));
      const s =
        size *
        boot *
        ((seated && f.id === selectedId) || tooClose ? 0 : seated ? 0.2 : active === f.id ? 1.6 : active === null ? 1 : 0.8);
      m.makeBasis(right, fwd, up).scale(scale.setScalar(s)).setPosition(pos);
      im.setMatrixAt(j, m);
      const [r, g, b] = tempToRgb(tempAtProgress(f, p));
      // Only the focused plane is pushed into the bloom: a filled silhouette glowing at full size
      // washes its temperature color out to white.
      const k = active === f.id ? 1.15 : active === null ? 1 : 0.5;
      im.setColorAt(j, tmpColor.setRGB(r * k, g * k, b * k));
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geometry, material, MAX]} frustumCulled={false} />;
}

export function Planes({ flights }: { flights: Flight[] }) {
  const material = useMemo(() => new MeshBasicMaterial({ toneMapped: false, side: DoubleSide }), []);
  const buckets = useMemo(() => {
    const out = new Map<AircraftClass, Entry[]>(AIRCRAFT_CLASSES.map((c) => [c, []]));
    flights.forEach((f, i) => out.get(aircraftClass(f.aircraftType))!.push({ f, angle: centralAngle(f.origin, f.dest), i }));
    return out;
  }, [flights]);

  return (
    <group>
      {AIRCRAFT_CLASSES.map((cls) => (
        <PlaneClass key={cls} cls={cls} entries={buckets.get(cls)!} material={material} />
      ))}
    </group>
  );
}
