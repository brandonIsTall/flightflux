// Renders the stylized globe texture from Natural Earth land polygons in the app's own tokens,
// so the globe matches the chrome exactly and no imagery has to be downloaded.

import { geoEquirectangular, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import { CanvasTexture, SRGBColorSpace } from "three";
import { toVec3 } from "./geo";

export const OCEAN = "#0F141B";
export const LAND = "#1E2633";
const COAST = "rgba(232, 235, 239, 0.14)";

export async function loadLand(): Promise<GeoJSON.FeatureCollection> {
  const topo = (await import("world-atlas/land-50m.json")).default as unknown as Topology;
  return feature(topo, topo.objects.land as GeometryCollection) as GeoJSON.FeatureCollection;
}

/** Equirectangular texture, `width` x `width/2`. */
export function renderEarthTexture(land: GeoJSON.FeatureCollection, width = 4096): CanvasTexture {
  const height = width / 2;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = OCEAN;
  ctx.fillRect(0, 0, width, height);

  const projection = geoEquirectangular()
    .scale(width / (2 * Math.PI))
    .translate([width / 2, height / 2]);
  const path = geoPath(projection, ctx);

  ctx.beginPath();
  path(land);
  ctx.fillStyle = LAND;
  ctx.fill();
  ctx.lineWidth = Math.max(1, width / 2048);
  ctx.strokeStyle = COAST;
  ctx.stroke();

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Land as points on a sphere of radius r: samples the drawn canvas on an equal-area-ish grid
 * (rows every ~1.6°, columns scaled by cos(lat)) and keeps the land-colored pixels.
 */
export function sampleLand(canvas: HTMLCanvasElement, r = 1): Float32Array {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  const rows = 112;
  const out: number[] = [];
  for (let i = 0; i < rows; i++) {
    const lat = -90 + (180 * (i + 0.5)) / rows;
    const cols = Math.max(8, Math.round(2 * rows * Math.cos((lat * Math.PI) / 180)));
    for (let j = 0; j < cols; j++) {
      const lon = -180 + (360 * (j + 0.5)) / cols;
      const px = Math.floor(((lon + 180) / 360) * width);
      const py = Math.floor(((90 - lat) / 180) * height);
      const k = (py * width + px) * 4;
      // Land is lighter than ocean; the coastline stroke is lighter still. Both count.
      if (data[k]! > 20) {
        const v = toVec3({ lat, lon }, r);
        out.push(v.x, v.y, v.z);
      }
    }
  }
  return new Float32Array(out);
}
