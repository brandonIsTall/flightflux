// Store backed by the Durable Object's SQLite database (free tier: 100k rows written/day). Everything is also held in memory
// (it's small: a few thousand rows), so reads stay synchronous and cheap.

import { DEP_TTL_S, MemoryStore, ROUTE_TTL_S, WEATHER_KEEP_S, type DepEntry, type RouteEntry } from "./core/store";
import type { TempSeries } from "./core/weather";

export class SqlStore extends MemoryStore {
  constructor(private readonly sql: SqlStorage) {
    super();
    sql.exec("CREATE TABLE IF NOT EXISTS routes (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS weather (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS deps (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL)");
    for (const r of sql.exec<{ k: string; v: string }>("SELECT k, v FROM routes")) this.routes.set(r.k, JSON.parse(r.v));
    for (const r of sql.exec<{ k: string; v: string }>("SELECT k, v FROM weather")) this.weather.set(r.k, JSON.parse(r.v));
    for (const r of sql.exec<{ k: string; v: string }>("SELECT k, v FROM deps")) this.deps.set(r.k, JSON.parse(r.v));
  }

  override putRoute(k: string, e: RouteEntry) {
    super.putRoute(k, e);
    this.sql.exec("INSERT OR REPLACE INTO routes VALUES (?, ?, ?)", k, JSON.stringify(e), e.at);
  }

  override putWeather(k: string, s: TempSeries) {
    super.putWeather(k, s);
    this.sql.exec("INSERT OR REPLACE INTO weather VALUES (?, ?, ?)", k, JSON.stringify(s), s.fetchedAt);
  }

  override putDep(k: string, e: DepEntry) {
    super.putDep(k, e);
    // Observed take-offs happen ~100k times a day worldwide; persisting them would blow the free
    // tier's 100k rows/day. Only track-derived departures (which cost OpenSky credits) persist.
    if (e.source !== "track") return;
    this.sql.exec("INSERT OR REPLACE INTO deps VALUES (?, ?, ?)", k, JSON.stringify(e), e.at);
  }

  override prune(nowS: number) {
    super.prune(nowS);
    this.sql.exec("DELETE FROM routes WHERE at < ?", nowS - ROUTE_TTL_S);
    this.sql.exec("DELETE FROM weather WHERE at < ?", nowS - WEATHER_KEEP_S);
    this.sql.exec("DELETE FROM deps WHERE at < ?", nowS - DEP_TTL_S);
  }
}
