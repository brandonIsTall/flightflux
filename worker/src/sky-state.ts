// One Durable Object instance owns the schedule, the caches and the snapshot, and serves every
// API request. Positions arrive from an external poller (see core/ingest.ts); the object itself
// only calls OpenSky as a fallback when none has reported for a while, since Cloudflare's
// network cannot reach OpenSky today.
//
// Cost model (free plan: 5M SQLite rows read a day). Cloudflare evicts the object between events,
// so treat every event as a cold start:
//   - a read-only request (snapshot, flight detail, plan) loads 2 rows: scheduler + snapshot;
//   - work (alarm, ingest, search) also restores the engine from one document holding the known
//     set and the routes and weather it needs (plus 1 row per aircraft new since it was saved);
//   - the alarm runs every 30 s only while lookups are queued, otherwise every 15 min;
//   - rows read and written are tallied per UTC day in the scheduler state; near either cap,
//     ingests and lookups pause until midnight and the stored snapshot keeps being served.

import { DurableObject } from "cloudflare:workers";
import type { Snapshot } from "../../shared/types";
import { AdsbdbClient } from "./core/adsbdb";
import { Engine } from "./core/engine";
import { isIngestBody, type PlanResponse } from "./core/ingest";
import { OpenSkyClient } from "./core/opensky";
import { initialSched, overBudget, planNext, PRUNE_EVERY_MS, recordUsage, replaceTile, type Sched } from "./core/sched";
import { AFTER_INGEST_MS, nextAlarmDelay, STUCK_MS } from "./core/wake";
import { probeUpstreams } from "./probe";
import { SqlStore } from "./sql-store";

export interface Env {
  SKY: DurableObjectNamespace<SkyState>;
  OPENSKY_CLIENT_ID: string;
  OPENSKY_CLIENT_SECRET: string;
  /** Shared with the external poller; required for /api/_plan and /api/_ingest. */
  INGEST_SECRET?: string;
}

/** Workers free plan allows 50 subrequests per invocation; leave headroom. */
const REQUESTS_PER_TICK = 44;
const SEARCHES_PER_MIN = 10;
/** Poll OpenSky directly only when no external poller has asked for a plan for this long. */
export const FALLBACK_AFTER_MS = 20 * 60_000;
/** A poller catching up may take this many region boxes in one plan (~0.5 s each). */
export const MAX_TILES_PER_PLAN = 12;
const SNAPSHOT_BLOB = "snapshot";

export class SkyState extends DurableObject<Env> {
  private engine: Engine;
  private store: SqlStore;
  private sched: Sched = initialSched();
  /** Whether the known set and its caches are loaded (only needed for work, not for reads). */
  private restored = false;
  private searchHits = new Map<string, { minute: number; count: number }>();
  private retired = false;
  /** Store counters already added to the daily tally. */
  private counted = { read: 0, written: 0 };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new SqlStore(ctx.storage.sql);
    this.engine = new Engine({
      opensky: new OpenSkyClient(env.OPENSKY_CLIENT_ID, env.OPENSKY_CLIENT_SECRET),
      adsbdb: new AdsbdbClient(),
      store: this.store,
      log: (m) => console.log(m),
    });
    ctx.blockConcurrencyWhile(async () => {
      const sched = await ctx.storage.get<Sched>("sched");
      if (sched) this.sched = { ...initialSched(), ...sched };
      if (this.sched.schema < 2) {
        this.store.migrateLegacy();
        this.sched.schema = 2;
        await ctx.storage.put("sched", this.sched);
      }
      const snap = this.store.getBlob(SNAPSHOT_BLOB);
      if (snap) this.engine.adoptSnapshot(JSON.parse(snap) as Snapshot);
    });
  }

  /** Add this instance's new SQLite reads and writes to today's tally and save the scheduler (1 row). */
  private async settle(now = Date.now()) {
    const read = this.store.rowsRead - this.counted.read;
    const written = this.store.rowsWritten - this.counted.written;
    this.counted = { read: this.store.rowsRead, written: this.store.rowsWritten };
    recordUsage(this.sched, now, read, written + 1);
    await this.ctx.storage.put("sched", this.sched);
  }

  /** Load the known set and rebuild from the cached routes and weather. Once per instance. */
  private restore() {
    if (this.restored) return;
    this.restored = true;
    this.engine.restore();
  }

  /** Reachability of every upstream from this object's data centre. */
  async probe(): Promise<Record<string, string>> {
    return probeUpstreams();
  }

  /** Stop polling for good and drop everything stored. For an instance that has been replaced. */
  async retire(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.retired = true;
  }

  /** Make sure an alarm is pending, and replace one that is long overdue. Called by the cron. */
  async ensureRunning(): Promise<void> {
    if (this.retired) return;
    const at = await this.ctx.storage.getAlarm();
    if (at == null || at < Date.now() - STUCK_MS) await this.ctx.storage.setAlarm(Date.now());
  }

  /** Bring the alarm forward to `delayMs` from now, never push it back (unless it is stuck). */
  private async alarmWithin(delayMs: number) {
    const now = Date.now();
    const at = await this.ctx.storage.getAlarm();
    if (at == null || at > now + delayMs || at < now - STUCK_MS) await this.ctx.storage.setAlarm(now + delayMs);
  }

  /**
   * What the external poller should fetch now. Marks it issued, so it is never handed out twice.
   * `restart` begins a fresh sweep from the first box at first-sweep pace (after a long outage).
   */
  async plan(restart = false): Promise<PlanResponse> {
    const snap = this.engine.getSnapshot();
    const creditsRemaining = snap?.meta.creditsRemaining ?? null;
    // The tracked set is the flights on the globe (from the stored snapshot) plus pinned searches.
    const tracked = this.engine.trackedIds();
    const now = Date.now();
    this.sched.lastPlanAt = now;
    if (restart) Object.assign(this.sched, { sweeps: 0, tileIdx: 0, lastTileAt: 0 });
    const p = planNext(this.sched, {
      now,
      hasTracked: tracked.length > 0,
      creditsRemaining,
      empty: (snap?.meta.known ?? 0) === 0,
      maxTiles: MAX_TILES_PER_PLAN,
    });
    await this.settle(now);
    return { tracked: p.track ? tracked : null, tiles: p.tileIdxs.map((i) => this.sched.tiles[i]!), creditsRemaining };
  }

  async alarm(): Promise<void> {
    if (this.retired) return;
    const now = Date.now();
    const readsBefore = this.store.rowsRead;
    const s = this.sched;
    let step = "enrich";
    let budget = REQUESTS_PER_TICK;
    if (overBudget(s, now)) {
      // Near a daily cap: keep serving the stored snapshot, do nothing else until UTC midnight.
      console.log(JSON.stringify({ step: "over daily storage budget", usage: s.usage }));
      await this.ctx.storage.setAlarm(nextUtcMidnight(now) + 60_000);
      return;
    }
    try {
      this.restore();
      if (now - (s.lastPruneAt ?? 0) >= PRUNE_EVERY_MS) {
        s.lastPruneAt = now;
        this.store.pruneStorage(Math.floor(now / 1000));
      }
      // Fallback only: the poller normally owns OpenSky. At most one call per run, recorded before
      // the call so failures can't retry hot.
      if (now - (s.lastPlanAt ?? 0) >= FALLBACK_AFTER_MS) {
        const creditsRemaining = this.engine.getSnapshot()?.meta.creditsRemaining ?? null;
        const p = planNext(s, { now, hasTracked: this.engine.trackedIds().length > 0, creditsRemaining, empty: this.engine.knownCount() === 0, maxTiles: 1 });
        if (p.track) {
          if (p.tileIdxs.length > 0) rewindTile(s); // both due: the box goes next time
          await this.ctx.storage.put("sched", s);
          step = "track";
          step = `track ${await this.engine.refreshTracked()}`;
          this.engine.saveKnown();
          budget -= 2;
        } else if (p.tileIdxs.length > 0) {
          const idx = p.tileIdxs[0]!;
          const tile = s.tiles[idx]!;
          await this.ctx.storage.put("sched", s);
          step = `tile ${idx}`;
          const { aircraft, next } = await this.engine.pollTile(tile);
          if (replaceTile(s, tile, next)) await this.ctx.storage.put("sched", s);
          this.engine.saveKnown();
          step = `tile ${idx}/${s.tiles.length} (${aircraft})`;
          budget -= 2;
        }
      }
    } catch (e) {
      console.error(`${step} failed: ${(e as Error).message}`);
    }
    let queues = this.engine.queueSizes();
    try {
      const stats = await this.engine.enrich({ requests: budget });
      const snap = this.engine.rebuild(Date.now() - now);
      this.store.putBlob(SNAPSHOT_BLOB, JSON.stringify(snap));
      // Keep the saved routes and weather current, so the next cold restore needn't look them up.
      const docBytes = stats.routeLookups > 0 || stats.weatherAirports > 0 ? this.engine.saveKnown() : undefined;
      queues = this.engine.queueSizes();
      console.log(
        JSON.stringify({ step, flights: snap.flights.length, known: snap.meta.known, ...stats, queues, rowsRead: this.store.rowsRead - readsBefore, docBytes, usage: s.usage }),
      );
    } catch (e) {
      console.error(`enrich failed: ${(e as Error).message}`);
    } finally {
      await this.settle(now).catch(() => {});
      // Always leave an alarm behind, so an exception can't stop the loop.
      await this.ctx.storage.setAlarm(Date.now() + nextAlarmDelay(queues, Date.now(), this.engine.routesPausedUntil()));
    }
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/api/_plan" || path === "/api/_ingest") {
      if (!(await this.authorized(req))) return json({ error: "unauthorized" }, 401);
      if (path === "/api/_plan") return json(await this.plan(url.searchParams.has("restart")));
      if (req.method !== "POST") return json({ error: "POST" }, 405);
      const body: unknown = await req.json().catch(() => null);
      if (!isIngestBody(body)) return json({ error: "bad body" }, 400);
      if (overBudget(this.sched, Date.now())) return json({ error: "daily storage budget reached; resumes at 00:00 UTC" }, 503);
      const readsBefore = this.store.rowsRead;
      this.restore();
      const { aircraft, next } = this.engine.ingest(body);
      const docBytes = this.engine.saveKnown();
      if (body.tile) replaceTile(this.sched, body.tile, next);
      await this.settle();
      // Enrich and rebuild once the poller's burst is over, not once per box.
      await this.alarmWithin(AFTER_INGEST_MS);
      console.log(
        JSON.stringify({
          step: body.tile ? `ingest tile ${body.tile.join(",")}` : "ingest tracked",
          aircraft,
          kept: body.states.length,
          known: this.engine.knownCount(),
          rowsRead: this.store.rowsRead - readsBefore,
          docBytes,
          usage: this.sched.usage,
        }),
      );
      return json({ ok: true, known: this.engine.knownCount(), tiles: this.sched.tiles.length });
    }

    if (path === "/api/snapshot") {
      const snap = this.engine.getSnapshot();
      if (!snap || snap.flights.length === 0) return json({ error: "warming up" }, 503, { "Retry-After": "60" });
      return json(snap, 200, { "Cache-Control": "public, max-age=15, s-maxage=60" });
    }

    const m = path.match(/^\/api\/flight\/([a-z0-9-]+)$/);
    if (m) {
      const d = await this.engine.detail(m[1]!);
      return d ? json(d, 200, { "Cache-Control": "public, max-age=30" }) : json({ error: "not found" }, 404);
    }

    if (path === "/api/search") {
      const ip = req.headers.get("cf-connecting-ip") ?? "local";
      if (!this.allowSearch(ip)) return json({ error: "too many searches, try again in a minute" }, 429);
      const q = url.searchParams.get("q") ?? "";
      try {
        this.restore();
        const f = await this.engine.search(q);
        return f ? json(f) : json({ error: "no airborne flight matches", q }, 404);
      } catch (e) {
        return json({ error: (e as Error).message }, 502);
      }
    }

    return json({ error: "not found" }, 404);
  }

  /** Bearer token equal to INGEST_SECRET, compared in constant time. No secret configured: nothing is authorized. */
  private async authorized(req: Request): Promise<boolean> {
    const secret = this.env.INGEST_SECRET;
    const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!secret || given.length === 0) return false;
    const enc = new TextEncoder();
    const [a, b] = [enc.encode(secret), enc.encode(given)];
    if (a.byteLength !== b.byteLength) return false;
    return crypto.subtle.timingSafeEqual(a, b);
  }

  private allowSearch(ip: string): boolean {
    const minute = Math.floor(Date.now() / 60_000);
    const e = this.searchHits.get(ip);
    if (!e || e.minute !== minute) {
      if (this.searchHits.size > 5000) this.searchHits.clear();
      this.searchHits.set(ip, { minute, count: 1 });
      return true;
    }
    return ++e.count <= SEARCHES_PER_MIN;
  }
}

function nextUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/** Undo the last box planNext() issued (the fallback path does one OpenSky call per run). */
function rewindTile(s: Sched) {
  if (s.tileIdx === 0) {
    s.tileIdx = s.tiles.length - 1;
    s.sweeps = Math.max(0, s.sweeps - 1);
  } else {
    s.tileIdx--;
  }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}
