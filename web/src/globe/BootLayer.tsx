// The WebGL half of the Thermal Boot: the graticule drawing itself, the dot-matrix earth, and the
// transponder pings. Each reads its beat value from `beats` every frame.

import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, Points, ShaderMaterial } from "three";
import type { Line2 } from "three-stdlib";
import type { Flight } from "../../../shared/types";
import { beats } from "../boot";
import { positionAt } from "../data/snapshot";
import { toVec3 } from "../lib/geo";

const GRATICULE_R = 1.002;

/** Latitude circles every 30° and meridians every 30°, as polylines on the globe. */
function graticuleLines(): { points: [number, number, number][]; length: number }[] {
  const out: { points: [number, number, number][]; length: number }[] = [];
  const circle = (fn: (t: number) => { lat: number; lon: number }, n: number) => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const v = toVec3(fn(i / n), GRATICULE_R);
      pts.push([v.x, v.y, v.z]);
    }
    let length = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      length += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    }
    out.push({ points: pts, length });
  };
  for (let lat = -60; lat <= 60; lat += 30) circle((t) => ({ lat, lon: -180 + 360 * t }), 96);
  for (let lon = -180; lon < 180; lon += 30) circle((t) => ({ lat: -90 + 180 * t, lon }), 48);
  return out;
}

function Graticule() {
  const lines = useMemo(graticuleLines, []);
  const refs = useRef<(Line2 | null)[]>([]);
  useFrame(() => {
    const draw = beats.graticule;
    const fade = 1 - beats.texture; // gone once the real texture is up
    refs.current.forEach((l, i) => {
      if (!l) return;
      const len = lines[i]!.length;
      // Dash length grows with the beat: the line appears to draw itself.
      l.material.dashSize = Math.max(0.0001, draw * len);
      l.material.gapSize = 1000;
      l.material.opacity = 0.35 * fade;
      l.visible = fade > 0.01;
    });
  });
  return (
    <group>
      {lines.map((l, i) => (
        <Line
          key={i}
          ref={(el) => void (refs.current[i] = el as Line2 | null)}
          points={l.points}
          color="#9AA3AE"
          lineWidth={1}
          dashed
          dashSize={0.0001}
          gapSize={1000}
          transparent
          opacity={0}
          toneMapped={false}
        />
      ))}
    </group>
  );
}

const dotsShader = {
  uniforms: { opacity: { value: 0 }, size: { value: 2.2 } },
  vertexShader: /* glsl */ `
    uniform float size;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = size * (3.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform float opacity;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      if (d > 0.5) discard;
      gl_FragColor = vec4(vec3(0.60, 0.64, 0.68), opacity * smoothstep(0.5, 0.3, d));
    }`,
};

/** Land as a halftone dot field, sampled from the same canvas the texture comes from. */
function DotEarth({ samples }: { samples: Float32Array }) {
  const geom = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(samples, 3));
    return g;
  }, [samples]);
  const mat = useMemo(() => new ShaderMaterial({ ...dotsShader, uniforms: { opacity: { value: 0 }, size: { value: 2.2 } }, transparent: true, depthWrite: false }), []);
  const ref = useRef<Points>(null);
  useFrame(() => {
    const o = beats.dots * (1 - beats.texture);
    mat.uniforms.opacity!.value = o * 0.9;
    if (ref.current) ref.current.visible = o > 0.01;
  });
  return <points ref={ref} geometry={geom} material={mat} />;
}

const pingShader = {
  uniforms: { t: { value: 0 }, appear: { value: 0 } },
  vertexShader: /* glsl */ `
    attribute float seed;
    varying float vSeed;
    void main() {
      vSeed = seed;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = 26.0 * (3.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform float t;
    uniform float appear;
    varying float vSeed;
    void main() {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      // Each ping starts at its own moment; before that nothing is drawn.
      float local = clamp((appear - vSeed) * 3.0, 0.0, 1.0);
      if (local <= 0.0) discard;
      // A dot, plus a ring expanding and fading on a 1.2 s cycle offset by the seed.
      float phase = fract(t / 1.2 + vSeed);
      float ring = smoothstep(0.06, 0.0, abs(d - phase)) * (1.0 - phase);
      float dot = smoothstep(0.22, 0.1, d);
      float a = (dot + ring * 0.8) * local;
      gl_FragColor = vec4(vec3(0.91, 0.92, 0.94), a);
    }`,
};

/** White transponder pings at each plane's position, appearing one after another. */
function Pings({ flights }: { flights: Flight[] }) {
  const geom = useMemo(() => {
    const nowS = Date.now() / 1000;
    const pos = new Float32Array(flights.length * 3);
    const seed = new Float32Array(flights.length);
    flights.forEach((f, i) => {
      const v = toVec3(positionAt(f, nowS), 1.01);
      pos.set([v.x, v.y, v.z], i * 3);
      seed[i] = (i * 0.618034) % 1; // golden-ratio spread so pings don't come in route order
    });
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    g.setAttribute("seed", new Float32BufferAttribute(seed, 1));
    return g;
  }, [flights]);
  const mat = useMemo(
    () => new ShaderMaterial({ ...pingShader, uniforms: { t: { value: 0 }, appear: { value: 0 } }, transparent: true, depthWrite: false, blending: AdditiveBlending }),
    [],
  );
  const ref = useRef<Points>(null);
  useFrame(({ clock }) => {
    mat.uniforms.t!.value = clock.elapsedTime;
    // Pings arrive over the beat, then fade once the routes have warmed up.
    mat.uniforms.appear!.value = beats.pings * 1.4;
    const fade = 1 - beats.warm;
    mat.opacity = fade;
    if (ref.current) ref.current.visible = beats.pings > 0 && fade > 0.01;
  });
  return <points ref={ref} geometry={geom} material={mat} />;
}

export function BootLayer({ flights, landSamples }: { flights: Flight[]; landSamples: Float32Array | null }) {
  return (
    <group>
      <Graticule />
      {landSamples && <DotEarth samples={landSamples} />}
      {flights.length > 0 && <Pings flights={flights} />}
    </group>
  );
}
