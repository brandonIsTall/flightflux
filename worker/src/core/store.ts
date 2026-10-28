// Caches that survive between polls. The Durable Object persists them in SQLite;
// tests and the Node harness use the in-memory version.

import type { Route } from "./adsbdb";
import type { TempSeries } from "./weather";
import type { DepTimeSource } from "../../../shared/types";
import { FIX_LOG_KEEP_S } from "./fixlog";

export interface RouteEntry {
  route: Route | null;
  at: number;
}

export interface DepEntry {
  t: number;
  lat: number;
  lon: number;
  source: DepTimeSource;
  at: number;
}

export interface Store {
  getRoute(callsign: string): RouteEntry | undefined;
  putRoute(callsign: string, e: RouteEntry): void;
  getWeather(icao: string): TempSeries | undefined;
  putWeather(icao: string, s: TempSeries): void;
  getDep(icao24: string): DepEntry | undefined;
  putDep(icao24: string, e: DepEntry): void;
  /**
   * Seed the in-memory cache from a saved document without touching storage: `undefined` records a
   * known miss. Lets a cold wake skip one lookup per aircraft. Overwrites nothing already cached.
   */
  primeRoute(callsign: string, e: RouteEntry | undefined): void;
  primeWeather(icao: string, s: TempSeries | undefined): void;
  /** One fix-log row (core/fixlog.ts), keyed by when it was written (unix s). */
  putFixes(t: number, rows: string): void;
  /** Fix-log rows written between `from` and `to` (unix s, inclusive), oldest first. */
  getFixes(from: number, to: number): string[];
  /** When the newest fix-log row was written, if any. */
  lastFixesAt(): number | undefined;
  /** Small named documents (the known-aircraft set, curation keys) that must outlive an eviction. */
  getBlob(key: string): string | undefined;
  putBlob(key: string, value: string): void;
  /** Drop entries older than their TTLs. */
  prune(nowS: number): void;
}

/**
 * A found route is kept a week: a flight number flies the same route for weeks or months, and
 * every lookup costs a row written. At 24 h, each daily flight was looked up again every day.
 */
export const ROUTE_TTL_S = 7 * 24 * 3600;
/** A miss (adsbdb doesn't know the callsign) is retried sooner, in case it learns the route. */
export const ROUTE_MISS_TTL_S = 24 * 3600;

/** Whether a cached route is due to be looked up again. */
export function routeExpired(e: RouteEntry, nowS: number): boolean {
  return nowS - e.at > (e.route ? ROUTE_TTL_S : ROUTE_MISS_TTL_S);
}
export const DEP_TTL_S = 20 * 3600;
export const WEATHER_KEEP_S = 6 * 3600;

export class MemoryStore implements Store {
  readonly routes = new Map<string, RouteEntry>();
  readonly weather = new Map<string, TempSeries>();
  readonly deps = new Map<string, DepEntry>();
  readonly blobs = new Map<string, string>();
  readonly fixes = new Map<number, string>();

  getRoute(k: string) {
    return this.routes.get(k);
  }
  putRoute(k: string, e: RouteEntry) {
    this.routes.set(k, e);
  }
  getWeather(k: string) {
    return this.weather.get(k);
  }
  putWeather(k: string, s: TempSeries) {
    this.weather.set(k, s);
  }
  getDep(k: string) {
    return this.deps.get(k);
  }
  putDep(k: string, e: DepEntry) {
    this.deps.set(k, e);
  }
  primeRoute(k: string, e: RouteEntry | undefined) {
    if (e && !this.routes.has(k)) this.routes.set(k, e);
  }
  primeWeather(k: string, s: TempSeries | undefined) {
    if (s && !this.weather.has(k)) this.weather.set(k, s);
  }
  putFixes(t: number, rows: string) {
    this.fixes.set(t, rows);
  }
  getFixes(from: number, to: number) {
    return [...this.fixes].filter(([t]) => t >= from && t <= to).sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  }
  lastFixesAt() {
    return this.fixes.size ? Math.max(...this.fixes.keys()) : undefined;
  }
  getBlob(k: string) {
    return this.blobs.get(k);
  }
  putBlob(k: string, v: string) {
    this.blobs.set(k, v);
  }

  prune(nowS: number) {
    for (const [k, e] of this.routes) if (nowS - e.at > ROUTE_TTL_S) this.routes.delete(k);
    for (const [k, s] of this.weather) if (nowS - s.fetchedAt > WEATHER_KEEP_S) this.weather.delete(k);
    for (const [k, e] of this.deps) if (nowS - e.at > DEP_TTL_S) this.deps.delete(k);
    for (const t of this.fixes.keys()) if (nowS - t > FIX_LOG_KEEP_S) this.fixes.delete(t);
  }
}
