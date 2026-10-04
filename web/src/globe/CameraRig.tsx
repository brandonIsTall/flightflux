// Flies the camera between the orbit view and a first-person seat on the selected flight.
//
// The cockpit pose rides the plane: each frame it is recomputed from the flight's projected
// position and the globe's spin, so the view keeps moving along the route while the user is in
// it. The flight to and from it blends the orbit pose and the cockpit pose with an ease and a
// bulge away from the globe, so the camera swings out and dives in rather than cutting straight
// through the surface.

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from "three";
import type { Flight } from "../../../shared/types";
import { progressAt } from "../data/snapshot";
import { interpolate, toVec3 } from "../lib/geo";
import { useStore } from "../store";
import { spin } from "./spin";

/** Camera flight duration. Reduced motion makes it a quick cross-dissolve instead. */
const FLIGHT_S = 2.4;
const FLIGHT_REDUCED_S = 0.25;
/**
 * Seat height above the surface, in globe radii (~220 km: stylized, so the horizon curves and the
 * route ribbon arches overhead). The route line itself is lifted higher mid-route.
 */
const SEAT_HEIGHT = 0.035;
/** The horizon sits this far above the screen centre, so the ground fills the lower half. */
const HORIZON_ABOVE_CENTER = (4 * Math.PI) / 180;
const ORBIT_FOV = 40;
const COCKPIT_FOV = 58;
/** Look-around limits and spring-back. */
const YAW_MAX = (40 * Math.PI) / 180;
const PITCH_MAX = (16 * Math.PI) / 180;
const LOOK_SENSITIVITY = 0.0032;
const COCKPIT_NEAR = 0.0015;
const ORBIT_NEAR = 0.1;

const UP = new Vector3(0, 1, 0);
const fromDir = new Vector3();
const toDir = new Vector3();
const seatForward = new Vector3();
const seatTarget = new Vector3();
const lookTarget = new Vector3();
const lookUp = new Vector3();
const radialUp = new Vector3();

/** Spherical interpolation between two unit vectors (falls back to a lerp when nearly parallel). */
function slerpDir(a: Vector3, b: Vector3, t: number, out: Vector3): Vector3 {
  const cos = Math.min(1, Math.max(-1, a.dot(b)));
  const omega = Math.acos(cos);
  if (omega < 1e-4) return out.copy(a).lerp(b, t).normalize();
  const sinO = Math.sin(omega);
  return out
    .copy(a)
    .multiplyScalar(Math.sin((1 - t) * omega) / sinO)
    .addScaledVector(b, Math.sin(t * omega) / sinO)
    .normalize();
}
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function CameraRig({ flights }: { flights: Flight[] }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const selectedId = useStore((s) => s.selectedId);
  const mode = useStore((s) => s.cameraMode);
  const flight = useMemo(() => flights.find((f) => f.id === selectedId) ?? null, [flights, selectedId]);

  // Mutable per-frame state, outside React.
  const st = useRef({
    t: 0,
    orbitPos: new Vector3(0, 0.6, 3),
    orbitQuat: new Quaternion(),
    fromPos: new Vector3(),
    fromQuat: new Quaternion(),
    look: { yaw: 0, pitch: 0, dragging: false, lastX: 0, lastY: 0 },
  });
  const seatPos = useMemo(() => new Vector3(), []);
  const seatQuat = useMemo(() => new Quaternion(), []);
  const tmpPos = useMemo(() => new Vector3(), []);
  const tmpQuat = useMemo(() => new Quaternion(), []);
  const ahead = useMemo(() => new Vector3(), []);
  const m = useMemo(() => new Matrix4(), []);
  const reduced = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  // Look-around: drag on the canvas while seated. Offsets spring back when released.
  useEffect(() => {
    const el = gl.domElement;
    const look = st.current.look;
    const down = (e: PointerEvent) => {
      if (useStore.getState().cameraMode !== "cockpit") return;
      look.dragging = true;
      look.lastX = e.clientX;
      look.lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!look.dragging) return;
      look.yaw = clamp(look.yaw - (e.clientX - look.lastX) * LOOK_SENSITIVITY, -YAW_MAX, YAW_MAX);
      look.pitch = clamp(look.pitch - (e.clientY - look.lastY) * LOOK_SENSITIVITY, -PITCH_MAX, PITCH_MAX);
      look.lastX = e.clientX;
      look.lastY = e.clientY;
    };
    const up = () => void (look.dragging = false);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, [gl]);

  // Entering a flight: remember where the orbit camera was, so the return goes back there.
  useEffect(() => {
    const s = st.current;
    if (mode === "to-cockpit") {
      if (useStore.getState().cameraMode === "to-cockpit" && s.t === 0) {
        s.orbitPos.copy(camera.position);
        s.orbitQuat.copy(camera.quaternion);
      }
      s.fromPos.copy(camera.position);
      s.fromQuat.copy(camera.quaternion);
      s.t = 0;
    } else if (mode === "to-orbit") {
      s.fromPos.copy(camera.position);
      s.fromQuat.copy(camera.quaternion);
      s.t = 0;
      s.look.yaw = 0;
      s.look.pitch = 0;
    }
  }, [mode, camera]);

  useFrame((_, dt) => {
    const s = st.current;
    if (mode === "orbit") return;

    // Where the seat is right now (world space, including the globe's spin).
    if (flight) {
      const nowS = Date.now() / 1000;
      const p = progressAt(flight, nowS);
      const r = 1 + SEAT_HEIGHT;
      toVec3(interpolate(flight.origin, flight.dest, p), r, seatPos).applyAxisAngle(UP, spin.y);
      toVec3(interpolate(flight.origin, flight.dest, Math.min(1, p + 0.004)), r, ahead).applyAxisAngle(UP, spin.y);
      const up = tmpPos.copy(seatPos).normalize();
      m.lookAt(seatPos, ahead, up);
      seatQuat.setFromRotationMatrix(m);
      // Pitch down so the horizon (acos(1/r) below level) lands just above centre, then look-around.
      const pitchDown = Math.acos(1 / r) - HORIZON_ABOVE_CENTER;
      seatQuat.multiply(tmpQuat.setFromAxisAngle(X_AXIS, -pitchDown));
      seatQuat.multiply(tmpQuat.setFromAxisAngle(Y_AXIS, s.look.yaw));
      seatQuat.multiply(tmpQuat.setFromAxisAngle(X_AXIS, s.look.pitch));
    }

    if (mode === "cockpit") {
      if (!flight) {
        useStore.getState().select(null);
        return;
      }
      if (!s.look.dragging) {
        s.look.yaw *= Math.exp(-dt / 0.35);
        s.look.pitch *= Math.exp(-dt / 0.35);
      }
      camera.position.copy(seatPos);
      camera.quaternion.copy(seatQuat);
      setLens(camera, COCKPIT_NEAR, COCKPIT_FOV);
      return;
    }

    // In flight between the two poses.
    const duration = reduced ? FLIGHT_REDUCED_S : FLIGHT_S;
    s.t = Math.min(1, s.t + dt / duration);
    const k = easeInOutCubic(s.t);
    const toPos = mode === "to-cockpit" ? seatPos : s.orbitPos;
    if (mode === "to-cockpit" && !flight) {
      useStore.getState().setCameraMode("orbit");
      return;
    }
    // Fly along a great arc around the globe (direction slerped, distance lerped) with a bulge
    // mid-flight: the camera swings over the surface instead of cutting through it.
    fromDir.copy(s.fromPos).normalize();
    toDir.copy(toPos).normalize();
    const dist = s.fromPos.length() + (toPos.length() - s.fromPos.length()) * k + 0.22 * Math.sin(Math.PI * k);
    camera.position.copy(slerpDir(fromDir, toDir, k, tmpPos)).multiplyScalar(dist);
    // Orientation: look at a point that slides from the globe's centre (what orbit looks at) to
    // the seat's forward point, with "up" turning from world-up to the local vertical. Blending
    // quaternions directly let the camera stare into space mid-flight.
    const seatK = mode === "to-cockpit" ? k : 1 - k;
    seatForward.set(0, 0, -1).applyQuaternion(seatQuat);
    seatTarget.copy(seatPos).addScaledVector(seatForward, 0.3);
    lookTarget.set(0, 0, 0).lerp(seatTarget, seatK);
    lookUp.copy(UP).lerp(radialUp.copy(camera.position).normalize(), seatK).normalize();
    m.lookAt(camera.position, lookTarget, lookUp);
    camera.quaternion.setFromRotationMatrix(m);
    const near = dist < 1.3 ? COCKPIT_NEAR : ORBIT_NEAR;
    setLens(camera, near, ORBIT_FOV + (COCKPIT_FOV - ORBIT_FOV) * seatK);

    if (s.t >= 1) {
      s.t = 0;
      // Land exactly on the destination pose.
      camera.position.copy(toPos);
      camera.quaternion.copy(mode === "to-cockpit" ? seatQuat : s.orbitQuat);
      useStore.getState().setCameraMode(mode === "to-cockpit" ? "cockpit" : "orbit");
    }
  });

  return null;
}

function setLens(camera: PerspectiveCamera, near: number, fov: number) {
  if (camera.near !== near || Math.abs(camera.fov - fov) > 0.01) {
    camera.near = near;
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
