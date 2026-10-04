// The sphere, its stylized land texture, and a thin atmosphere rim.

import { useEffect, useState } from "react";
import { AdditiveBlending, BackSide, Color, type CanvasTexture } from "three";
import { loadLand, OCEAN, renderEarthTexture } from "../lib/earthTexture";

export const GLOBE_RADIUS = 1;

let texturePromise: Promise<CanvasTexture> | null = null;
function getTexture() {
  texturePromise ??= loadLand().then((land) => renderEarthTexture(land));
  return texturePromise;
}

const atmosphereShader = {
  uniforms: { color: { value: new Color("#8FA1B8") } },
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

export function Globe() {
  const [texture, setTexture] = useState<CanvasTexture | null>(null);
  useEffect(() => {
    let live = true;
    getTexture()
      .then((t) => live && setTexture(t))
      .catch((e) => console.error("earth texture failed", e));
    return () => void (live = false);
  }, []);

  return (
    <group>
      {/* Keyed so the textured sphere gets a fresh material instead of a patched one. */}
      {texture ? (
        <mesh key="earth">
          <sphereGeometry args={[GLOBE_RADIUS, 96, 64]} />
          <meshBasicMaterial map={texture} />
        </mesh>
      ) : (
        <mesh key="placeholder">
          <sphereGeometry args={[GLOBE_RADIUS, 96, 64]} />
          <meshBasicMaterial color={OCEAN} />
        </mesh>
      )}
      <mesh scale={1.09}>
        <sphereGeometry args={[GLOBE_RADIUS, 96, 64]} />
        <shaderMaterial args={[atmosphereShader]} transparent depthWrite={false} side={BackSide} blending={AdditiveBlending} />
      </mesh>
    </group>
  );
}
