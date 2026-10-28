import { describe, expect, it } from "vitest";
import { FIX_LOG_KEEP_S } from "../src/core/fixlog";
import { ROUTE_TTL_S } from "../src/core/store";
import { SqlStore } from "../src/sql-store";
import { fakeSql } from "./fake-sql";

const T = 1_791_080_000;
const entry = (at: number) => ({ route: null, at });

describe("SqlStore", () => {
  it("never loads a table whole: waking reads nothing, lookups are by key", () => {
    const f = fakeSql();
    const a = new SqlStore(f.sql);
    for (let i = 0; i < 500; i++) a.putRoute(`ABC${i}`, entry(T));

    f.queries.length = 0;
    const b = new SqlStore(f.sql); // a cold wake
    expect(f.queries.filter((q) => /^\s*SELECT/i.test(q))).toEqual([]);
    expect(b.rowsRead).toBe(0);

    expect(b.getRoute("ABC7")).toEqual(entry(T));
    expect(b.getRoute("ABC7")).toEqual(entry(T)); // held in memory
    expect(b.getRoute("NOPE1")).toBeUndefined();
    expect(b.getRoute("NOPE1")).toBeUndefined(); // misses too
    expect(b.rowsRead).toBe(1);
    expect(f.queries.filter((q) => /^\s*SELECT/i.test(q))).toHaveLength(2);
    expect(f.plan("SELECT v FROM route_cache WHERE k = ?", "ABC7")).toMatch(/USING PRIMARY KEY/);
  });

  it("keeps no index beside the cache tables (each costs a written row per insert)", () => {
    const f = fakeSql();
    new SqlStore(f.sql);
    const indexes = f.db.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type = 'index'").all() as { tbl_name: string }[];
    expect(indexes.filter((i) => i.tbl_name !== "blobs")).toEqual([]);
  });

  it("keeps a day of routes in memory and reads older ones back from SQLite", () => {
    const f = fakeSql();
    const s = new SqlStore(f.sql);
    const old = { route: null, at: T - 2 * 24 * 3600 };
    s.putRoute("OLD1", old);
    s.putRoute("NEW1", entry(T));
    s.prune(T);
    expect(s.routes.has("OLD1")).toBe(false);
    expect(s.routes.has("NEW1")).toBe(true);
    const before = s.rowsRead;
    expect(s.getRoute("OLD1")).toEqual(old); // still in SQLite: one row read, no lookup
    expect(s.rowsRead).toBe(before + 1);
  });

  it("expires rows only when asked, in one statement per table", () => {
    const f = fakeSql();
    const s = new SqlStore(f.sql);
    s.putRoute("OLD1", entry(T - ROUTE_TTL_S - 10));
    s.putRoute("NEW1", entry(T));
    f.queries.length = 0;
    s.prune(T); // per-wake expiry: memory only
    expect(f.queries).toEqual([]);
    s.pruneStorage(T);
    expect(f.queries).toHaveLength(3);
    const count = () => (f.db.prepare("SELECT COUNT(*) AS n FROM route_cache").get() as { n: number }).n;
    expect(count()).toBe(1);
    expect(s.rowsWritten).toBe(3); // two inserts, one delete
  });

  it("keeps the fix log in storage only, read by a seek over its key and pruned after a month", () => {
    const f = fakeSql();
    const s = new SqlStore(f.sql);
    expect(s.lastFixesAt()).toBeUndefined();
    for (let i = 0; i < 10; i++) s.putFixes(T + i * 300, `[${i}]`);
    expect(s.fixes.size).toBe(0); // never held in memory
    expect(new SqlStore(f.sql).lastFixesAt()).toBe(T + 9 * 300);
    expect(s.getFixes(T + 300, T + 900)).toEqual(["[1]", "[2]", "[3]"]);
    expect(f.plan("SELECT v FROM fix_log WHERE t BETWEEN ? AND ? ORDER BY t", T, T)).toMatch(/USING INTEGER PRIMARY KEY/);
    s.putFixes(T - FIX_LOG_KEEP_S - 1, "[old]");
    s.pruneStorage(T);
    expect(s.getFixes(0, T + 9 * 300)).toHaveLength(10);
  });

  it("moves the first version's cache into the new tables once", () => {
    const f = fakeSql();
    f.db.exec("CREATE TABLE routes (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL)");
    f.db.exec("CREATE INDEX routes_at ON routes (at)");
    f.db.prepare("INSERT INTO routes VALUES (?, ?, ?)").run("UAL880", JSON.stringify(entry(T)), T);
    f.db.exec("CREATE TABLE weather (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL)");
    const s = new SqlStore(f.sql);
    s.migrateLegacy();
    expect(new SqlStore(f.sql).getRoute("UAL880")).toEqual(entry(T));
    const tables = (f.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    expect(tables.sort()).toEqual(["blobs", "fix_log", "route_cache", "weather_cache"]);
    s.migrateLegacy(); // nothing left to move
  });

  it("primes its cache from a saved document without reading storage", () => {
    const f = fakeSql();
    new SqlStore(f.sql).putRoute("UAL880", entry(T));
    const s = new SqlStore(f.sql);
    s.primeRoute("UAL880", entry(T - 5));
    s.primeRoute("ABC1", undefined); // a known miss
    expect(s.getRoute("UAL880")).toEqual(entry(T - 5));
    expect(s.getRoute("ABC1")).toBeUndefined();
    expect(s.rowsRead).toBe(0);
  });

  it("keeps blobs in one row each", () => {
    const f = fakeSql();
    const s = new SqlStore(f.sql);
    s.putBlob("known", "x".repeat(300_000));
    s.putBlob("known", "y");
    expect(new SqlStore(f.sql).getBlob("known")).toBe("y");
    expect(new SqlStore(f.sql).getBlob("none")).toBeUndefined();
  });
});
