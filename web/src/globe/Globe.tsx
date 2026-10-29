// The sphere with its stylized land texture, shaded relief (raised into terrain in the cockpit), a day/night terminator, a horizon glow that works
// from orbit (limb) and from the cockpit (horizon), and a soft halo for the orbit view.

import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { useMemo, useRef } from "react";
import { AdditiveBlending, BackSide, Color, ShaderMaterial, Vector2, Vector3, type CanvasTexture } from "three";
import { beats } from "../boot";
import { COAST, OCEAN, type Elevation } from "../lib/earthTexture";
import { useEarthAssets } from "./earthAssets";
import { toVec3 } from "../lib/geo";
import { subsolarPoint } from "../lib/sun";
import { useStore } from "../store";
import { HEIGHT_SCALE, relief } from "./relief";
import { spin } from "./spin";

export const GLOBE_RADIUS = 1;
const AIR = "#8FA1B8";
/**
 * How steep the hillshade treats a full-height rise over one radian of arc. Real relief is far too
 * gentle to see at globe scale; this exaggerates it into a shaded-relief map.
 */
const SHADE_SCALE = 0.25;

/** Highest land blends toward this lighter slate: still the dark blue scale, just raised. */
const PEAK = "#34425A";

const earthShader = {
  uniforms: {
    map: { value: null as CanvasTexture | null },
    elevation: { value: null as CanvasTexture | null },
    elevationTexel: { value: new Vector2(1 / 2048, 1 / 1024) },
    sunDir: { value: new Vector3(1, 0, 0) },
    rimColor: { value: new Color(AIR) },
    peakColor: { value: new Color(PEAK) },
    lift: { value: 0 },
    seated: { value: 0 },
    opacity: { value: 1 },
  },
  vertexShader: /* glsl */ `
    uniform sampler2D elevation;
    uniform float lift;
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      vUv = uv;
      vNormal = normalize(normalMatrix * normal);
      // In the cockpit the land stands up (lift is 0 in orbit, so the sphere stays smooth there).
      float h = texture2D(elevation, uv).r;
      vec4 mv = modelViewMatrix * vec4(position + normal * h * lift, 1.0);
      vView = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D map;
    uniform sampler2D elevation;
    uniform vec2 elevationTexel;
    uniform vec3 sunDir;
    uniform vec3 rimColor;
    uniform vec3 peakColor;
    uniform float seated;
    uniform float opacity;
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      vec3 base = texture2D(map, vUv).rgb;
      float h = texture2D(elevation, vUv).r;
      // Elevation tint: lowlands keep the land color, high ground and the ice sheets lighten.
      base = mix(base, peakColor, pow(h, 0.6) * 0.85);
      // Hillshade, in the local east/north/up frame: slope from the neighbouring texels (east steps
      // widen toward the poles), lit by a fixed cartographic light from the north-west, added as
      // the difference from flat ground so plains keep their color.
      float coslat = max(0.08, cos((vUv.y - 0.5) * 3.14159265));
      vec2 du = vec2(elevationTexel.x, 0.0);
      vec2 dv = vec2(0.0, elevationTexel.y);
      float dhE = (texture2D(elevation, vUv + du).r - texture2D(elevation, vUv - du).r) / (2.0 * elevationTexel.x * 6.2831853 * coslat);
      float dhN = (texture2D(elevation, vUv + dv).r - texture2D(elevation, vUv - dv).r) / (2.0 * elevationTexel.y * 3.14159265);
      vec3 slope = normalize(vec3(-dhE, -dhN, 1.0 / ${SHADE_SCALE.toFixed(1)}));
      const vec3 light = vec3(-0.5, 0.5, 0.70710678);
      float shade = dot(slope, light) - light.z;
      base += rimColor * shade * 0.12;
      base = max(base, vec3(0.0));
      // Night side drops to 78% (the globe is already dark); the terminator is a soft band so it
      // reads as dusk, not a hard line.
      float day = smoothstep(-0.12, 0.18, dot(vNormal, sunDir));
      vec3 lit = base * mix(0.78, 1.0, day);
      // Surface fresnel: the limb from orbit, the horizon from the cockpit. Seated low over the
      // ground nearly everything is at a grazing angle, so it tightens to the horizon there.
      float rim = pow(1.0 - abs(dot(vNormal, vView)), mix(4.0, 12.0, seated));
      gl_FragColor = vec4(lit + rimColor * rim * 0.35, opacity);
      // The map is sRGB (decoded to linear on sample); encode back for the sRGB framebuffer.
      #include <colorspace_fragment>
    }`,
};

const haloShader = {
  uniforms: { color: { value: new Color(AIR) } },
  vertexShader: /* glsl */ `
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vView = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      // Seen from outside on the back faces, |dot| is largest at the globe's edge and falls
      // to zero at the halo's outer edge: a soft rim of air fading into space.
      float rim = pow(abs(dot(vNormal, vView)), 5.0);
      gl_FragColor = vec4(color, rim * 0.6);
    }`,
};

function Earth({ texture, elevation }: { texture: CanvasTexture; elevation: Elevation }) {
  const material = useMemo(() => {
    const m = new ShaderMaterial({ ...earthShader, uniforms: { ...earthShader.uniforms }, transparent: true });
    m.uniforms.map = { value: texture };
    m.uniforms.elevation = { value: elevation.texture };
    m.uniforms.elevationTexel = { value: new Vector2(1 / elevation.width, 1 / elevation.height) };
    m.uniforms.sunDir = { value: new Vector3() };
    m.uniforms.lift = { value: 0 };
    m.uniforms.seated = { value: 0 };
    m.uniforms.opacity = { value: 0 };
    return m;
  }, [texture, elevation]);
  const sunLocal = useMemo(() => toVec3(subsolarPoint()), []);
  const tmp = useMemo(() => new Vector3(), []);

  useFrame(({ camera }) => {
    // The shader works in view space: rotate the sun by the globe's spin, then into the camera's frame.
    tmp.copy(sunLocal).applyAxisAngle(UP, spin.y).transformDirection(camera.matrixWorldInverse);
    (material.uniforms.sunDir!.value as Vector3).copy(tmp);
    // Cross-fades in over the boot's dot-matrix earth; solid once the boot is done.
    material.uniforms.opacity!.value = beats.texture;
    material.uniforms.lift!.value = HEIGHT_SCALE * relief.k;
    material.uniforms.seated!.value = relief.k;
  });

  return (
    <mesh material={material} renderOrder={1}>
      {/* Dense enough that raised ranges keep their shape in the cockpit; the hillshade adds the rest. */}
      <sphereGeometry args={[GLOBE_RADIUS * 1.0005, 512, 256]} />
    </mesh>
  );
}

const UP = new Vector3(0, 1, 0);

/** Coastline opacity and width (CSS px). Matches the old texture stroke's weight from orbit. */
const COAST_OPACITY = 0.17;
const COAST_WIDTH = 1.1;

/**
 * Coastlines as screen-space lines on the sphere: a constant ~1 px wherever the camera is, so
 * they stay sharp at any zoom with no texture levels to switch between.
 */
function Coastline({ segments }: { segments: Float32Array }) {
  const dpr = useThree((s) => s.viewport.dpr);
  const line = useMemo(() => {
    const geometry = new LineSegmentsGeometry().setPositions(segments);
    const material = new LineMaterial({ color: COAST, transparent: true, opacity: 0, depthWrite: false });
    const l = new LineSegments2(geometry, material);
    l.renderOrder = 2;
    l.frustumCulled = false;
    return l;
  }, [segments]);
  useFrame(() => {
    line.material.linewidth = COAST_WIDTH * dpr; // the material measures in device pixels
    line.material.opacity = COAST_OPACITY * beats.texture; // fades in with the textured earth
  });
  return <primitive object={line} />;
}

const stop = (e: ThreeEvent<PointerEvent>) => e.stopPropagation();
/** A click on bare globe clears the selection (onPointerMissed no longer fires: the globe is a hit). */
const onGlobeClick = (e: ThreeEvent<MouseEvent>) => {
  e.stopPropagation();
  const { cameraMode, select } = useStore.getState();
  if (cameraMode === "orbit") select(null);
};

export function Globe() {
  const assets = useEarthAssets();
  const halo = useRef<ShaderMaterial>(null);
  const inOrbit = useStore((s) => s.cameraMode === "orbit" || s.cameraMode === "to-orbit");

  return (
    <group>
      {/* The plain sphere stays underneath: it occludes the far side while the textured one fades in.
          Its handlers make it occlude pointer events too, so routes behind the Earth can't be hovered. */}
      <mesh onPointerOver={stop} onPointerMove={stop} onPointerDown={stop} onClick={onGlobeClick}>
        <sphereGeometry args={[GLOBE_RADIUS, 96, 64]} />
        <meshBasicMaterial color={OCEAN} />
      </mesh>
      {assets && <Earth texture={assets.texture} elevation={assets.elevation} />}
      {assets && <Coastline segments={assets.coast} />}
      {/* The outer halo only makes sense from outside; from the cockpit the surface rim takes over. */}
      <mesh scale={1.09} visible={inOrbit}>
        <sphereGeometry args={[GLOBE_RADIUS, 96, 64]} />
        <shaderMaterial ref={halo} args={[haloShader]} transparent depthWrite={false} side={BackSide} blending={AdditiveBlending} />
      </mesh>
    </group>
  );
}
