// Where the sun is overhead right now. Good to about a degree, which is all a terminator needs.

import type { LatLon } from "./geo";

export function subsolarPoint(date = new Date()): LatLon {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = (date.getTime() - start) / 86_400_000;
  const declination = 23.44 * Math.sin(((2 * Math.PI) / 365) * (dayOfYear - 81));
  // Equation of time, in minutes: the sun runs up to ~16 min ahead of or behind the clock.
  const b = ((2 * Math.PI) / 365) * (dayOfYear - 81);
  const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60 + eot;
  const lon = -(utcMinutes / 4 - 180);
  return { lat: declination, lon: ((lon + 540) % 360) - 180 };
}
