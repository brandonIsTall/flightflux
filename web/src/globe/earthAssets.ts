// Loads the land polygons once and derives both the globe texture and the dot-matrix samples
// the boot sequence uses. Shared by Globe and BootLayer.

import { useEffect, useState } from "react";
import type { CanvasTexture } from "three";
import { ready } from "../boot";
import { loadLand, renderEarthTexture, sampleLand } from "../lib/earthTexture";

export interface EarthAssets {
  texture: CanvasTexture;
  /** xyz triplets on the unit sphere, one per land dot. */
  landSamples: Float32Array;
}

let promise: Promise<EarthAssets> | null = null;

export function getEarthAssets(): Promise<EarthAssets> {
  promise ??= loadLand().then((land) => {
    const texture = renderEarthTexture(land);
    const landSamples = sampleLand(texture.image as HTMLCanvasElement, 1.004);
    ready.texture = true;
    return { texture, landSamples };
  });
  return promise;
}

export function useEarthAssets(): EarthAssets | null {
  const [assets, setAssets] = useState<EarthAssets | null>(null);
  useEffect(() => {
    let live = true;
    getEarthAssets()
      .then((a) => live && setAssets(a))
      .catch((e) => console.error("earth assets failed", e));
    return () => void (live = false);
  }, []);
  return assets;
}
