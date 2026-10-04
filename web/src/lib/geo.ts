// Great-circle math and the mapping from lat/lon to the unit globe.

import { Vector3 } from "three";

export interface LatLon {
  lat: number;
  lon: number;
}

export const EARTH_RADIUS_KM = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Unit-sphere position. +Y is north; lon 0 faces +Z. */
export function toVec3(p: LatLon, r = 1, out = new Vector3()): Vector3 {
  const phi = rad(90 - p.lat);
  const theta = rad(p.lon + 180);
  return out.set(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

export function centralAngle(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const distanceKm = (a: LatLon, b: LatLon) => centralAngle(a, b) * EARTH_RADIUS_KM;

/** Point a fraction f (0..1) along the great circle from a to b. */
export function interpolate(a: LatLon, b: LatLon, f: number): LatLon {
  const d = centralAngle(a, b);
  if (d === 0) return { ...a };
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(rad(a.lat)) * Math.cos(rad(a.lon)) + B * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon));
  const y = A * Math.cos(rad(a.lat)) * Math.sin(rad(a.lon)) + B * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon));
  const z = A * Math.sin(rad(a.lat)) + B * Math.sin(rad(b.lat));
  return { lat: deg(Math.atan2(z, Math.sqrt(x * x + y * y))), lon: deg(Math.atan2(y, x)) };
}

/** Initial bearing from a to b, degrees clockwise from north. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Height of a route arc above the globe at fraction f: a sine bump whose peak grows with route
 * length, so long-haul arcs lift clear of the surface and short ones hug it.
 */
export function arcLift(f: number, angleRad: number): number {
  const peak = 0.02 + 0.16 * Math.min(1, angleRad / Math.PI);
  return peak * Math.sin(Math.PI * f);
}
