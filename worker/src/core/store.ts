// Caches that survive between polls. The Durable Object persists them in SQLite;
// tests and the Node harness use the in-memory version.

import type { Route } from "./adsbdb";
import type { TempSeries } from "./weather";
import type { DepTimeSource } from "../../../shared/types";

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
  /** Small named documents (the known-aircraft set, curation keys) that must outlive an eviction. */
  getBlob(key: string): string | undefined;
  putBlob(key: string, value: string): void;
  /** Drop entries older than their TTLs. */
  prune(nowS: number): void;
}

export const ROUTE_TTL_S = 24 * 3600;
export const DEP_TTL_S = 20 * 3600;
export const WEATHER_KEEP_S = 6 * 3600;

export class MemoryStore implements Store {
  readonly routes = new Map<string, RouteEntry>();
  readonly weather = new Map<string, TempSeries>();
  readonly deps = new Map<string, DepEntry>();
  readonly blobs = new Map<string, string>();

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
  }
}
