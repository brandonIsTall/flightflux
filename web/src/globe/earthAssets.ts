// Loads the land polygons once and derives both the globe texture and the dot-matrix samples
// the boot sequence uses. Shared by Globe and BootLayer.

import { useEffect, useState } from "react";
import type { CanvasTexture } from "three";
import { ready } from "../boot";
import { coastlineSegments, loadLand, renderEarthTexture, sampleLand } from "../lib/earthTexture";

export interface EarthAssets {
  texture: CanvasTexture;
  /** xyz triplets on the unit sphere, one per land dot. */
  landSamples: Float32Array;
  /** Coastline edges as xyz pairs, just above the globe surface. */
  coast: Float32Array;
}

/** Just above the textured sphere (1.0005) so the coastline never z-fights with it. */
const COAST_RADIUS = 1.0008;

let promise: Promise<EarthAssets> | null = null;

export function getEarthAssets(): Promise<EarthAssets> {
  promise ??= loadLand().then((land) => {
    const texture = renderEarthTexture(land);
    const landSamples = sampleLand(texture.image as HTMLCanvasElement, 1.004);
    ready.texture = true;
    return { texture, landSamples, coast: coastlineSegments(land, COAST_RADIUS) };
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
