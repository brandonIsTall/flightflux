// Renders the stylized globe texture from Natural Earth land polygons in the app's own tokens,
// so the globe matches the chrome exactly and no imagery has to be downloaded.

import { geoEquirectangular, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import { CanvasTexture, SRGBColorSpace } from "three";

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
