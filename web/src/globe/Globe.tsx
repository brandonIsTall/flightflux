// The sphere with its stylized land texture, a day/night terminator, a horizon glow that works
// from orbit (limb) and from the cockpit (horizon), and a soft halo for the orbit view.

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { AdditiveBlending, BackSide, Color, ShaderMaterial, Vector3, type CanvasTexture } from "three";
import { loadLand, OCEAN, renderEarthTexture } from "../lib/earthTexture";
import { toVec3 } from "../lib/geo";
import { subsolarPoint } from "../lib/sun";
import { useStore } from "../store";
import { spin } from "./spin";

export const GLOBE_RADIUS = 1;
const AIR = "#8FA1B8";

let texturePromise: Promise<CanvasTexture> | null = null;
function getTexture() {
  texturePromise ??= loadLand().then((land) => renderEarthTexture(land));
  return texturePromise;
}

const earthShader = {
  uniforms: {
    map: { value: null as CanvasTexture | null },
    sunDir: { value: new Vector3(1, 0, 0) },
    rimColor: { value: new Color(AIR) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      vUv = uv;
      vNormal = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vView = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D map;
    uniform vec3 sunDir;
    uniform vec3 rimColor;
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      vec3 base = texture2D(map, vUv).rgb;
      // Night side drops to 78% (the globe is already dark); the terminator is a soft band so it
      // reads as dusk, not a hard line.
      float day = smoothstep(-0.12, 0.18, dot(vNormal, sunDir));
      vec3 lit = base * mix(0.78, 1.0, day);
      // Surface fresnel: the limb from orbit, the horizon from the cockpit.
      float rim = pow(1.0 - abs(dot(vNormal, vView)), 4.0);
      gl_FragColor = vec4(lit + rimColor * rim * 0.35, 1.0);
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

function Earth({ texture }: { texture: CanvasTexture }) {
  const material = useMemo(() => {
    const m = new ShaderMaterial({ ...earthShader, uniforms: { ...earthShader.uniforms } });
    m.uniforms.map = { value: texture };
    m.uniforms.sunDir = { value: new Vector3() };
    return m;
  }, [texture]);
  const sunLocal = useMemo(() => toVec3(subsolarPoint()), []);
  const tmp = useMemo(() => new Vector3(), []);

  useFrame(({ camera }) => {
    // The shader works in view space: rotate the sun by the globe's spin, then into the camera's frame.
    tmp.copy(sunLocal).applyAxisAngle(UP, spin.y).transformDirection(camera.matrixWorldInverse);
    (material.uniforms.sunDir!.value as Vector3).copy(tmp);
  });

  return (
    <mesh material={material}>
      <sphereGeometry args={[GLOBE_RADIUS, 128, 96]} />
    </mesh>
  );
}

const UP = new Vector3(0, 1, 0);

export function Globe() {
  const [texture, setTexture] = useState<CanvasTexture | null>(null);
  const halo = useRef<ShaderMaterial>(null);
  const inOrbit = useStore((s) => s.cameraMode === "orbit" || s.cameraMode === "to-orbit");

  useEffect(() => {
    let live = true;
    getTexture()
      .then((t) => live && setTexture(t))
      .catch((e) => console.error("earth texture failed", e));
    return () => void (live = false);
  }, []);

  return (
    <group>
      {texture ? (
        <Earth texture={texture} />
      ) : (
        <mesh>
          <sphereGeometry args={[GLOBE_RADIUS, 96, 64]} />
          <meshBasicMaterial color={OCEAN} />
        </mesh>
      )}
      {/* The outer halo only makes sense from outside; from the cockpit the surface rim takes over. */}
      <mesh scale={1.09} visible={inOrbit}>
        <sphereGeometry args={[GLOBE_RADIUS, 96, 64]} />
        <shaderMaterial ref={halo} args={[haloShader]} transparent depthWrite={false} side={BackSide} blending={AdditiveBlending} />
      </mesh>
    </group>
  );
}
