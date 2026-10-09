// The globe view: canvas, camera, controls, auto-spin, bloom, and the data layers.

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useRef } from "react";
import type { Group } from "three";
import type { Flight } from "../../../shared/types";
import { useStore } from "../store";
import { BootDirector } from "./BootDirector";
import { BootLayer } from "./BootLayer";
import { CameraRig } from "./CameraRig";
import { useEarthAssets } from "./earthAssets";
import { Globe } from "./Globe";
import { Planes } from "./Planes";
import { Routes } from "./Routes";
import { spin } from "./spin";

/** Degrees per second of auto-spin: never still, still readable. */
const SPIN_DEG_S = 2;
/** Idle time after the last drag or zoom before the spin eases back in. */
const RESUME_AFTER_MS = 30_000;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function Spinner({ children }: { children: React.ReactNode }) {
  const group = useRef<Group>(null);
  const speed = useRef(0);
  const paused = useStore((s) => s.spinPaused);
  const hovering = useStore((s) => s.hoveredId !== null);
  // Off orbit, the camera rides a plane inside this group: the world must hold still.
  const seated = useStore((s) => s.cameraMode !== "orbit");
  const still = reducedMotion();

  useFrame((_, dt) => {
    if (!group.current) return;
    const target = paused || hovering || seated || still ? 0 : (SPIN_DEG_S * Math.PI) / 180;
    // Ease out over ~0.6 s, back in over ~2 s.
    const k = target === 0 ? 1 - Math.exp(-dt / 0.2) : 1 - Math.exp(-dt / 0.7);
    speed.current += (target - speed.current) * k;
    group.current.rotation.y += speed.current * dt;
    spin.y = group.current.rotation.y;
  });

  return <group ref={group}>{children}</group>;
}

/** Keeps the whole globe in view on narrow screens by backing the camera off as the aspect drops. */
function FitCamera() {
  const { camera, size } = useThree();
  const controls = useThree((s) => s.controls) as { minDistance?: number; maxDistance?: number } | null;
  useEffect(() => {
    const aspect = size.width / size.height;
    // 3 units fits the globe with margin on a landscape viewport; portrait needs more room.
    const dist = 3 / Math.min(1, aspect * 1.15);
    const dir = camera.position.clone().normalize();
    camera.position.copy(dir.multiplyScalar(dist));
    camera.updateProjectionMatrix();
    if (controls) {
      controls.minDistance = Math.min(1.45, dist * 0.5);
      controls.maxDistance = Math.max(4, dist * 1.3);
    }
  }, [camera, size, controls]);
  return null;
}

function Controls() {
  const setSpinPaused = useStore((s) => s.setSpinPaused);
  const inOrbit = useStore((s) => s.cameraMode === "orbit");
  const timer = useRef<number | null>(null);

  const onStart = () => {
    if (timer.current) window.clearTimeout(timer.current);
    setSpinPaused(true);
  };
  const onEnd = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSpinPaused(false), RESUME_AFTER_MS);
  };
  useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), []);

  return (
    <OrbitControls
      enabled={inOrbit}
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.55}
      zoomSpeed={0.6}
      makeDefault
      minDistance={1.45}
      maxDistance={4}
      onStart={onStart}
      onEnd={onEnd}
    />
  );
}

export function Scene({ flights, failed }: { flights: Flight[]; failed: boolean }) {
  const effects = !new URLSearchParams(location.search).has("noeffects");
  const assets = useEarthAssets();
  return (
    <Canvas
      camera={{ position: [0, 0.6, 3], fov: 40, near: 0.1, far: 50 }}
      dpr={[1, 2]}
      flat
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      onCreated={({ gl }) => gl.setClearColor("#0B0E13")}
      onPointerMissed={() => useStore.getState().cameraMode === "orbit" && useStore.getState().select(null)}
    >
      <Spinner>
        <Globe />
        <Routes flights={flights} />
        <Planes flights={flights} />
        <BootLayer flights={flights} landSamples={assets?.landSamples ?? null} />
      </Spinner>
      <BootDirector flights={flights} failed={failed} />
      <Controls />
      <FitCamera />
      <CameraRig flights={flights} />
      {effects && (
        <EffectComposer multisampling={0}>
          {/* Threshold keeps the dark globe and chrome out; only the data glows. */}
          <Bloom luminanceThreshold={0.8} luminanceSmoothing={0.25} intensity={0.35} mipmapBlur radius={0.5} />
          <Vignette eskil={false} offset={0.25} darkness={0.45} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
