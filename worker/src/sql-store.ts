// Store backed by the Durable Object's SQLite database (free tier: 100k rows written/day).
// Rows are loaded as raw JSON at startup and parsed on first use, so waking a cold object
// doesn't spend its 10 ms CPU budget decoding thousands of cached routes.

import { MemoryStore, ROUTE_TTL_S, WEATHER_KEEP_S, type RouteEntry } from "./core/store";
import type { TempSeries } from "./core/weather";

export class SqlStore extends MemoryStore {
  private rawRoutes = new Map<string, string>();
  private rawWeather = new Map<string, string>();

  constructor(private readonly sql: SqlStorage) {
    super();
    sql.exec("CREATE TABLE IF NOT EXISTS routes (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS weather (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL)");
    for (const r of sql.exec<{ k: string; v: string }>("SELECT k, v FROM routes")) this.rawRoutes.set(r.k, r.v);
    for (const r of sql.exec<{ k: string; v: string }>("SELECT k, v FROM weather")) this.rawWeather.set(r.k, r.v);
  }

  override getRoute(k: string) {
    const raw = this.rawRoutes.get(k);
    if (raw !== undefined) {
      this.rawRoutes.delete(k);
      super.putRoute(k, JSON.parse(raw));
    }
    return super.getRoute(k);
  }

  override putRoute(k: string, e: RouteEntry) {
    this.rawRoutes.delete(k);
    super.putRoute(k, e);
    this.sql.exec("INSERT OR REPLACE INTO routes VALUES (?, ?, ?)", k, JSON.stringify(e), e.at);
  }

  override getWeather(k: string) {
    const raw = this.rawWeather.get(k);
    if (raw !== undefined) {
      this.rawWeather.delete(k);
      super.putWeather(k, JSON.parse(raw));
    }
    return super.getWeather(k);
  }

  override putWeather(k: string, s: TempSeries) {
    this.rawWeather.delete(k);
    super.putWeather(k, s);
    this.sql.exec("INSERT OR REPLACE INTO weather VALUES (?, ?, ?)", k, JSON.stringify(s), s.fetchedAt);
  }

  // Departures stay in memory only: they're cheap to re-estimate if the object restarts.

  override prune(nowS: number) {
    super.prune(nowS);
    this.sql.exec("DELETE FROM routes WHERE at < ?", nowS - ROUTE_TTL_S);
    this.sql.exec("DELETE FROM weather WHERE at < ?", nowS - WEATHER_KEEP_S);
  }
}
