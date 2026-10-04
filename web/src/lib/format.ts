// Display formatting. Units follow the C/F toggle: C pairs with metric, F with imperial.

import type { Units } from "../store";
import { cToF } from "./color";

export function formatTemp(c: number, units: Units, digits = 0): string {
  const v = units === "F" ? cToF(c) : c;
  return `${v.toFixed(digits)}°`;
}

/** Signed change, e.g. "+12°" or "−3°" (real minus sign). */
export function formatDelta(c: number, units: Units): string {
  const v = units === "F" ? (c * 9) / 5 : c;
  const r = Math.round(v);
  return r === 0 ? "±0°" : `${r > 0 ? "+" : "−"}${Math.abs(r)}°`;
}

export function formatAltitude(m: number, units: Units): string {
  return units === "F" ? `${Math.round(m * 3.28084).toLocaleString()} ft` : `${Math.round(m).toLocaleString()} m`;
}

export function formatSpeed(ms: number, units: Units): string {
  return units === "F" ? `${Math.round(ms * 2.23694)} mph` : `${Math.round(ms * 3.6)} km/h`;
}

export function formatDistance(km: number, units: Units): string {
  return units === "F" ? `${Math.round(km * 0.621371).toLocaleString()} mi` : `${Math.round(km).toLocaleString()} km`;
}

/** "14:20" in the airport's local time. Falls back to its UTC offset when the zone name is missing. */
export function formatLocalTime(unixS: number, tz?: string, utcOffsetS?: number): string {
  if (tz) {
    try {
      return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(
        unixS * 1000,
      );
    } catch {
      /* unknown zone id */
    }
  }
  const d = new Date((unixS + (utcOffsetS ?? 0)) * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function formatDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}
