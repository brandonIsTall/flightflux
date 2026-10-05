// One Durable Object instance owns the schedule, the caches and the snapshot, and serves every
// API request. Positions arrive from an external poller (see core/ingest.ts); the object itself
// only calls OpenSky as a fallback when none has reported for a while, since Cloudflare's
// network cannot reach OpenSky today.

import { DurableObject } from "cloudflare:workers";
import { AdsbdbClient } from "./core/adsbdb";
import { Engine } from "./core/engine";
import { isIngestBody, type PlanResponse } from "./core/ingest";
import { OpenSkyClient } from "./core/opensky";
import { initialSched, planNext, replaceTile, TICK_MS, type Sched } from "./core/sched";
import { probeUpstreams } from "./probe";
import { SqlStore } from "./sql-store";

export interface Env {
  SKY: DurableObjectNamespace<SkyState>;
  OPENSKY_CLIENT_ID: string;
  OPENSKY_CLIENT_SECRET: string;
  /** Shared with the external poller; required for /api/_plan and /api/_ingest. */
  INGEST_SECRET?: string;
}

const PERSIST_MS = 5 * 60_000;
/** Workers free plan allows 50 subrequests per invocation; leave headroom. */
const REQUESTS_PER_TICK = 44;
const SEARCHES_PER_MIN = 10;
/** Poll OpenSky directly only when no external poller has asked for a plan for this long. */
export const FALLBACK_AFTER_MS = 20 * 60_000;
/** A poller catching up may take this many region boxes in one plan (~0.5 s each). */
export const MAX_TILES_PER_PLAN = 12;

export class SkyState extends DurableObject<Env> {
  private engine: Engine;
  private sched: Sched = initialSched();
  private searchHits = new Map<string, { minute: number; count: number }>();
  private retired = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.engine = new Engine({
      opensky: new OpenSkyClient(env.OPENSKY_CLIENT_ID, env.OPENSKY_CLIENT_SECRET),
      adsbdb: new AdsbdbClient(),
      store: new SqlStore(ctx.storage.sql),
      log: (m) => console.log(m),
    });
    ctx.blockConcurrencyWhile(async () => {
      const sched = await ctx.storage.get<Sched>("sched");
      if (sched) this.sched = sched;
      // The object is evicted whenever it is idle, often between two 30 s alarms, so everything
      // that isn't in SQLite is gone by the next event. The engine keeps its aircraft there.
      this.engine.restore();
    });
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

  /** Start the alarm loop if it isn't running. Called by the cron trigger and on requests. */
  async ensureRunning(): Promise<void> {
    if (this.retired) return;
    if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(Date.now());
  }

  /**
   * What the external poller should fetch now. Marks it issued, so it is never handed out twice.
   * `restart` begins a fresh sweep from the first box at first-sweep pace (after a long outage).
   */
  async plan(restart = false): Promise<PlanResponse> {
    const creditsRemaining = this.engine.getSnapshot()?.meta.creditsRemaining ?? null;
    const tracked = this.engine.trackedIds();
    const now = Date.now();
    this.sched.lastPlanAt = now;
    if (restart) Object.assign(this.sched, { sweeps: 0, tileIdx: 0, lastTileAt: 0 });
    const p = planNext(this.sched, { now, hasTracked: tracked.length > 0, creditsRemaining, empty: this.engine.knownCount() === 0, maxTiles: MAX_TILES_PER_PLAN });
    await this.ctx.storage.put("sched", this.sched);
    return { tracked: p.track ? tracked : null, tiles: p.tileIdxs.map((i) => this.sched.tiles[i]!), creditsRemaining };
  }

  async alarm(): Promise<void> {
    if (this.retired) return;
    // Schedule the next run first so an exception can't stop the loop.
    await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
    const now = Date.now();
    const s = this.sched;
    let step = "enrich";
    let budget = REQUESTS_PER_TICK;
    try {
      // Fallback only: the poller normally owns OpenSky. At most one call per run, recorded before
      // the call so failures can't retry hot.
      if (now - (s.lastPlanAt ?? 0) >= FALLBACK_AFTER_MS) {
        const creditsRemaining = this.engine.getSnapshot()?.meta.creditsRemaining ?? null;
        const p = planNext(s, { now, hasTracked: this.engine.trackedIds().length > 0, creditsRemaining, empty: this.engine.knownCount() === 0, maxTiles: 1 });
        if (p.track) {
          // Both due: give the box back; it goes next tick.
          if (p.tileIdxs.length > 0) rewindTile(s);
          await this.ctx.storage.put("sched", s);
          step = "track";
          step = `track ${await this.engine.refreshTracked()}`;
          budget -= 2;
        } else if (p.tileIdxs.length > 0) {
          const idx = p.tileIdxs[0]!;
          const tile = s.tiles[idx]!;
          await this.ctx.storage.put("sched", s);
          step = `tile ${idx}`;
          const { aircraft, next } = await this.engine.pollTile(tile);
          if (replaceTile(s, tile, next)) await this.ctx.storage.put("sched", s);
          step = `tile ${idx}/${s.tiles.length} (${aircraft})`;
          budget -= 2;
        }
      }
      const stats = await this.engine.enrich({ requests: budget });
      // Rebuilding costs ~2 ms of the 10 ms CPU budget; skip it when nothing new arrived.
      const changed = step !== "enrich" || stats.routeHits > 0 || stats.weatherAirports > 0 || this.dirty;
      this.dirty = false;
      const snap = changed ? this.engine.rebuild(Date.now() - now) : this.engine.getSnapshot();
      if (step !== "enrich") this.engine.saveKnown();
      if (now - s.lastPersistAt >= PERSIST_MS) {
        s.lastPersistAt = now;
        await this.ctx.storage.put("sched", s);
      }
      console.log(
        JSON.stringify({ step, rebuilt: changed, flights: snap?.flights.length, known: snap?.meta.known, ...stats, queues: this.engine.queueSizes() }),
      );
    } catch (e) {
      console.error(`${step} failed: ${(e as Error).message}`);
    }
  }

  /** Positions arrived since the last rebuild. */
  private dirty = false;

  async fetch(req: Request): Promise<Response> {
    await this.ensureRunning();
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/api/_plan" || path === "/api/_ingest") {
      if (!(await this.authorized(req))) return json({ error: "unauthorized" }, 401);
      if (path === "/api/_plan") return json(await this.plan(url.searchParams.has("restart")));
      if (req.method !== "POST") return json({ error: "POST" }, 405);
      const body: unknown = await req.json().catch(() => null);
      if (!isIngestBody(body)) return json({ error: "bad body" }, 400);
      const { aircraft, next } = this.engine.ingest(body);
      this.engine.saveKnown();
      if (body.tile && replaceTile(this.sched, body.tile, next)) await this.ctx.storage.put("sched", this.sched);
      this.dirty = true;
      console.log(JSON.stringify({ step: body.tile ? `ingest tile ${body.tile.join(",")}` : "ingest tracked", aircraft, kept: body.states.length, known: this.engine.knownCount() }));
      return json({ ok: true, known: this.engine.knownCount(), tiles: this.sched.tiles.length });
    }

    if (path === "/api/snapshot") {
      const snap = this.engine.getSnapshot();
      if (!snap || snap.flights.length === 0) return json({ error: "warming up" }, 503, { "Retry-After": "60" });
      return json(snap, 200, { "Cache-Control": "public, max-age=15, s-maxage=30" });
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

/** Undo the last box planNext() issued (the fallback path does one OpenSky call per tick). */
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
