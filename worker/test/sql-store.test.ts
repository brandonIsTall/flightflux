import { describe, expect, it } from "vitest";
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

  it("expires rows only when asked, in one statement per table", () => {
    const f = fakeSql();
    const s = new SqlStore(f.sql);
    s.putRoute("OLD1", entry(T - ROUTE_TTL_S - 10));
    s.putRoute("NEW1", entry(T));
    f.queries.length = 0;
    s.prune(T); // per-wake expiry: memory only
    expect(f.queries).toEqual([]);
    s.pruneStorage(T);
    expect(f.queries).toHaveLength(2);
    const count = () => (f.db.prepare("SELECT COUNT(*) AS n FROM route_cache").get() as { n: number }).n;
    expect(count()).toBe(1);
    expect(s.rowsWritten).toBe(3); // two inserts, one delete
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
    expect(tables.sort()).toEqual(["blobs", "route_cache", "weather_cache"]);
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
