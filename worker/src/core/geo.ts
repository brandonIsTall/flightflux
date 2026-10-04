// Spherical-earth helpers. Accurate to ~0.5%, which is plenty for route plausibility and ETAs.

export const EARTH_RADIUS_KM = 6371.0088;

export interface LatLon {
  lat: number;
  lon: number;
}

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Central angle between two points, in radians. */
function centralAngle(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function distanceKm(a: LatLon, b: LatLon): number {
  return centralAngle(a, b) * EARTH_RADIUS_KM;
}

/** Initial great-circle bearing from a to b, degrees clockwise from north in [0, 360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Where point p sits relative to the great circle from `from` to `to`.
 * crossKm: signed distance off the path. alongKm: distance along the path from `from`
 * to p's projection (negative if p is "behind" the origin).
 */
export function trackOffsets(from: LatLon, to: LatLon, p: LatLon): { crossKm: number; alongKm: number } {
  const d13 = centralAngle(from, p);
  const t13 = rad(bearingDeg(from, p));
  const t12 = rad(bearingDeg(from, to));
  const dxt = Math.asin(Math.sin(d13) * Math.sin(t13 - t12));
  const cosAt = Math.cos(d13) / Math.cos(dxt);
  let dat = Math.acos(Math.max(-1, Math.min(1, cosAt)));
  if (Math.cos(t13 - t12) < 0) dat = -dat;
  return { crossKm: dxt * EARTH_RADIUS_KM, alongKm: dat * EARTH_RADIUS_KM };
}

/** Point a fraction f (0..1) of the way along the great circle from a to b. */
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
