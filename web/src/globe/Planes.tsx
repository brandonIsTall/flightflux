// One small chevron per flight, advanced along its route every frame and tinted with the blended
// temperature at that point. A single instanced mesh, so 150 planes cost one draw call.

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Color, InstancedMesh, Matrix4, Object3D, Quaternion, Vector3 } from "three";
import type { Flight } from "../../../shared/types";
import { progressAt, tempAtProgress } from "../data/snapshot";
import { tempToRgb } from "../lib/color";
import { arcLift, centralAngle, interpolate, toVec3 } from "../lib/geo";
import { useStore } from "../store";
import { spin } from "./spin";

const MAX = 512;
const SIZE = 0.012;

const tmpObj = new Object3D();
const tmpColor = new Color();
const ahead = new Vector3();
const up = new Vector3();
const m = new Matrix4();
const q = new Quaternion();
const UP = new Vector3(0, 1, 0);

export function Planes({ flights }: { flights: Flight[] }) {
  const mesh = useRef<InstancedMesh>(null);
  const angles = useMemo(() => flights.map((f) => centralAngle(f.origin, f.dest)), [flights]);

  useFrame(({ camera }) => {
    const im = mesh.current;
    if (!im) return;
    const nowS = Date.now() / 1000;
    const { hoveredId, selectedId, cameraMode } = useStore.getState();
    const active = hoveredId ?? selectedId;
    // The camera sits on the selected plane once seated; don't draw its chevron in the lens.
    const seated = cameraMode === "cockpit" || cameraMode === "to-cockpit";
    const hideSelected = seated;
    const n = Math.min(MAX, flights.length);
    for (let i = 0; i < n; i++) {
      const f = flights[i]!;
      const p = progressAt(f, nowS);
      const lift = 1 + arcLift(p, angles[i]!);
      toVec3(interpolate(f.origin, f.dest, p), lift, tmpObj.position);
      // Point the chevron along the arc: toward the position a little further on.
      toVec3(interpolate(f.origin, f.dest, Math.min(1, p + 0.01)), lift, ahead);
      up.copy(tmpObj.position).normalize();
      m.lookAt(tmpObj.position, ahead, up);
      q.setFromRotationMatrix(m);
      tmpObj.quaternion.copy(q);
      // The cone geometry points +Y; rotate it to point down the look direction (-Z of lookAt).
      tmpObj.rotateX(-Math.PI / 2);
      // From the seat, other planes are tiny neighbours; anything within a few seat-heights of
      // the lens would fill the screen, so it isn't drawn at all.
      const tooClose = seated && camera.position.distanceTo(tmpObj.position.clone().applyAxisAngle(UP, spin.y)) < 0.25;
      const s =
        (hideSelected && f.id === selectedId) || tooClose ? 0 : seated ? 0.2 : active === f.id ? 1.6 : active === null ? 1 : 0.8;
      tmpObj.scale.setScalar(s);
      tmpObj.updateMatrix();
      im.setMatrixAt(i, tmpObj.matrix);
      const [r, g, b] = tempToRgb(tempAtProgress(f, p));
      const k = active === null || active === f.id ? 1.15 : 0.5; // a touch over 1 so markers catch the bloom
      im.setColorAt(i, tmpColor.setRGB(r * k, g * k, b * k));
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, MAX]} frustumCulled={false}>
      <coneGeometry args={[SIZE * 0.6, SIZE * 2.2, 4]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

