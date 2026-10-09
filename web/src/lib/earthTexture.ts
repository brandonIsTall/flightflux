// Renders the stylized globe texture from Natural Earth land polygons in the app's own tokens,
// so the globe matches the chrome exactly and no imagery has to be downloaded.

import { geoEquirectangular, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import { CanvasTexture, SRGBColorSpace, Vector3 } from "three";
import { toVec3 } from "./geo";

export const OCEAN = "#0F141B";
export const LAND = "#1E2633";
/** Coastline color. Drawn as vector lines on the globe (Globe.tsx), not into the texture. */
export const COAST = "#E8EBEF";

export async function loadLand(): Promise<GeoJSON.FeatureCollection> {
  const topo = (await import("world-atlas/land-50m.json")).default as unknown as Topology;
  return feature(topo, topo.objects.land as GeometryCollection) as GeoJSON.FeatureCollection;
}

/**
 * Equirectangular texture, `width` x `width/2`: flat land and ocean fills only. Coastlines are
 * vector lines (see coastlineSegments) so they stay sharp however far the camera zooms in.
 */
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

/** Longest coastline edge before it's split, in degrees, so long edges follow the sphere's curve. */
const MAX_EDGE_DEG = 0.5;

/**
 * Every coastline edge as a pair of points on a sphere of radius r (xyz, xyz, ...), for line
 * segments. Edges along the antimeridian and the south pole are polygon seams, not coast: skipped.
 */
export function coastlineSegments(land: GeoJSON.FeatureCollection, r = 1): Float32Array {
  const out: number[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const seam = (p: number[], q: number[]) =>
    (Math.abs(p[0]!) > 179.99 && Math.abs(q[0]!) > 179.99) || (p[1]! < -89.99 && q[1]! < -89.99);
  const ring = (pts: number[][]) => {
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1]!;
      const q = pts[i]!;
      if (seam(p, q)) continue;
      // An edge across the antimeridian (179.9 -> -180) is short: go the short way round.
      let dLon = q[0]! - p[0]!;
      if (dLon > 180) dLon -= 360;
      else if (dLon < -180) dLon += 360;
      const steps = Math.max(1, Math.ceil(Math.hypot(dLon, q[1]! - p[1]!) / MAX_EDGE_DEG));
      toVec3({ lon: p[0]!, lat: p[1]! }, r, a);
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        toVec3({ lon: p[0]! + dLon * t, lat: p[1]! + (q[1]! - p[1]!) * t }, r, b);
        out.push(a.x, a.y, a.z, b.x, b.y, b.z);
        a.copy(b);
      }
    }
  };
  for (const f of land.features) {
    const g = f.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const poly of polys) for (const rings of poly) ring(rings);
  }
  return new Float32Array(out);
}
