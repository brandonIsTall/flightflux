// Store backed by the Durable Object's SQLite database.
//
// The free plan allows 5M rows read a day, and Cloudflare evicts this object between events
// (often between two 30 s alarms), so nothing here may scale with table size per wake:
//   - no table is ever loaded whole: a route or weather series is a primary-key lookup (1 row),
//     made the first time it's needed and then held in memory, misses included;
//   - expiry is one scan of each table a day (pruneStorage, timed by the caller from persisted
//     state): an index on `at` would make it cheaper but costs an extra written row per insert,
//     and writes are capped too (100k rows a day).
//   - a cold wake doesn't look up the saved aircraft's routes and weather one by one either: the
//     engine saves them inside the known-set document and primes this cache from it.
// `rowsRead` counts what this instance has read, for the logs.

import { MemoryStore, ROUTE_TTL_S, WEATHER_KEEP_S, type RouteEntry } from "./core/store";
import type { TempSeries } from "./core/weather";

const ROUTES = "route_cache";
const WEATHER = "weather_cache";

export class SqlStore extends MemoryStore {
  /** Keys already looked up in SQLite this instance (found or not). */
  private routeLooked = new Set<string>();
  private weatherLooked = new Set<string>();
  rowsRead = 0;
  rowsWritten = 0;

  constructor(private readonly sql: SqlStorage) {
    super();
    // Idempotent; after the first run each statement is a schema check, no table reads.
    // WITHOUT ROWID: the key is the table itself. A rowid table with a TEXT key keeps a hidden
    // index beside it, and Cloudflare counts a written row for each, doubling the cost of a write.
    sql.exec(`CREATE TABLE IF NOT EXISTS ${ROUTES} (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL) WITHOUT ROWID`);
    sql.exec(`CREATE TABLE IF NOT EXISTS ${WEATHER} (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL) WITHOUT ROWID`);
    // One row per document (a row may hold up to 2 MB): the known set, curation keys, snapshot.
    sql.exec("CREATE TABLE IF NOT EXISTS blobs (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  }

  private one(query: string, ...bindings: unknown[]): string | undefined {
    const cur = this.sql.exec<{ v: string }>(query, ...bindings);
    const row = cur.toArray()[0];
    this.rowsRead += cur.rowsRead;
    return row?.v;
  }

  private run(query: string, ...bindings: unknown[]) {
    const cur = this.sql.exec(query, ...bindings);
    cur.toArray();
    this.rowsRead += cur.rowsRead;
    this.rowsWritten += cur.rowsWritten;
  }

  override getRoute(k: string) {
    if (!this.routeLooked.has(k)) {
      this.routeLooked.add(k);
      const v = this.one(`SELECT v FROM ${ROUTES} WHERE k = ?`, k);
      if (v !== undefined) super.putRoute(k, JSON.parse(v));
    }
    return super.getRoute(k);
  }

  override putRoute(k: string, e: RouteEntry) {
    this.routeLooked.add(k);
    super.putRoute(k, e);
    this.run(`INSERT OR REPLACE INTO ${ROUTES} VALUES (?, ?, ?)`, k, JSON.stringify(e), e.at);
  }

  override getWeather(k: string) {
    if (!this.weatherLooked.has(k)) {
      this.weatherLooked.add(k);
      const v = this.one(`SELECT v FROM ${WEATHER} WHERE k = ?`, k);
      if (v !== undefined) super.putWeather(k, JSON.parse(v));
    }
    return super.getWeather(k);
  }

  override putWeather(k: string, s: TempSeries) {
    this.weatherLooked.add(k);
    super.putWeather(k, s);
    this.run(`INSERT OR REPLACE INTO ${WEATHER} VALUES (?, ?, ?)`, k, JSON.stringify(s), s.fetchedAt);
  }

  override primeRoute(k: string, e: RouteEntry | undefined) {
    if (this.routeLooked.has(k)) return;
    this.routeLooked.add(k);
    super.primeRoute(k, e);
  }

  override primeWeather(k: string, s: TempSeries | undefined) {
    if (this.weatherLooked.has(k)) return;
    this.weatherLooked.add(k);
    super.primeWeather(k, s);
  }

  override getBlob(k: string) {
    return this.one("SELECT v FROM blobs WHERE k = ?", k);
  }

  override putBlob(k: string, v: string) {
    this.run("INSERT OR REPLACE INTO blobs VALUES (?, ?)", k, v);
  }

  // Departures stay in memory only: they're cheap to re-estimate if the object restarts.

  /**
   * One-time move from the first version's tables (rowid tables, plus `at` indexes) to the
   * WITHOUT ROWID ones. Reads and writes each cached row once. The caller records that it ran.
   */
  migrateLegacy() {
    for (const [from, to] of [["routes", ROUTES], ["weather", WEATHER]] as const) {
      const exists = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?", from).one().n;
      if (!exists) continue;
      this.run(`INSERT OR IGNORE INTO ${to} SELECT k, v, at FROM ${from}`);
      this.run(`DROP TABLE ${from}`);
    }
  }

  /** Expiry: memory only. Storage is pruned by pruneStorage(), once a day. */
  override prune(nowS: number) {
    super.prune(nowS);
  }

  /** Delete expired rows: one scan of each table, so call it daily, not per wake. */
  pruneStorage(nowS: number) {
    this.run(`DELETE FROM ${ROUTES} WHERE at < ?`, nowS - ROUTE_TTL_S);
    this.run(`DELETE FROM ${WEATHER} WHERE at < ?`, nowS - WEATHER_KEEP_S);
    // Forget lookups of rows that may now be gone (misses stay misses).
    this.routeLooked = new Set([...this.routeLooked].filter((k) => !super.getRoute(k) || nowS - super.getRoute(k)!.at <= ROUTE_TTL_S));
    this.weatherLooked = new Set([...this.weatherLooked].filter((k) => !super.getWeather(k) || nowS - super.getWeather(k)!.fetchedAt <= WEATHER_KEEP_S));
  }
}
