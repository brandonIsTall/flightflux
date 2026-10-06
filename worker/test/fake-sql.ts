// A SqlStorage stand-in backed by Node's built-in SQLite, so the Durable Object's store can be
// tested outside workerd. rowsRead counts the rows a SELECT returns (Cloudflare counts rows
// scanned; tests check scans with query plans instead).

import { DatabaseSync } from "node:sqlite";

export function fakeSql() {
  const db = new DatabaseSync(":memory:");
  const queries: string[] = [];
  const sql = {
    exec(query: string, ...bindings: unknown[]) {
      queries.push(query);
      const st = db.prepare(query);
      const args = bindings as (string | number | null)[];
      let rows: Record<string, unknown>[] = [];
      let written = 0;
      if (/^\s*SELECT/i.test(query)) rows = st.all(...args) as Record<string, unknown>[];
      else written = Number(st.run(...args).changes);
      return {
        toArray: () => rows,
        one: () => rows[0],
        rowsRead: rows.length,
        rowsWritten: written,
        [Symbol.iterator]: () => rows[Symbol.iterator](),
      };
    },
  };
  /** The query plan's detail lines, e.g. "SEARCH routes USING INDEX routes_at (at<?)". */
  const plan = (query: string, ...bindings: (string | number)[]) =>
    (db.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...bindings) as { detail: string }[]).map((r) => r.detail).join(" | ");
  return { db, queries, plan, sql: sql as unknown as SqlStorage };
}
