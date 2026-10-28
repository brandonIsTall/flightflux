// The replayed flight's recorded positions: small white dots where its transponder was actually
// heard, beside the great-circle route the plane is drawn along. Gaps are where it was out of range.

import { useMemo } from "react";
import { BufferGeometry, Float32BufferAttribute } from "three";
import { toVec3 } from "../lib/geo";
import { useStore } from "../store";

export function TrackDots() {
  const track = useStore((s) => s.replay?.track ?? null);
  const geom = useMemo(() => {
    if (!track) return null;
    const pos = new Float32Array(track.length * 3);
    track.forEach(([, lat, lon], i) => {
      const v = toVec3({ lat, lon }, 1.004);
      pos.set([v.x, v.y, v.z], i * 3);
    });
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    return g;
  }, [track]);
  if (!geom) return null;
  return (
    <points geometry={geom}>
      <pointsMaterial color="#e8eaf0" size={3} sizeAttenuation={false} transparent opacity={0.85} toneMapped={false} />
    </points>
  );
}
