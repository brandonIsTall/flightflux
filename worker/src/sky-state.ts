// One Durable Object instance ("global") owns the poller and serves every API request.

import { DurableObject } from "cloudflare:workers";
import { AdsbdbClient } from "./core/adsbdb";
import { Engine, type Known } from "./core/engine";
import { OpenSkyClient, type Bbox } from "./core/opensky";
import { INITIAL_TILES } from "./core/tiles";
import { probeUpstreams } from "./probe";
import { SqlStore } from "./sql-store";

export interface Env {
  SKY: DurableObjectNamespace<SkyState>;
  OPENSKY_CLIENT_ID: string;
  OPENSKY_CLIENT_SECRET: string;
}

export const TICK_MS = 30_000;
/** Positions for the flights on the globe: 288 calls x 4 credits = ~1,150 credits/day. */
export const TRACK_INTERVAL_MS = 5 * 60_000;
/** One discovery sweep of every region box: ~108 credits each, ~19 a day = ~2,100 credits/day. */
export const SWEEP_MS = 75 * 60_000;
/** Below this many OpenSky credits, slow everything down 3x rather than run dry. */
const LOW_CREDITS = 800;
const PERSIST_MS = 5 * 60_000;
/** Workers free plan allows 50 subrequests per invocation; leave headroom. */
const REQUESTS_PER_TICK = 44;
const SEARCHES_PER_MIN = 10;

/** Scheduler state, persisted so a recreated object can never call OpenSky faster than planned. */
interface Sched {
  lastTrackAt: number;
  lastTileAt: number;
  lastPersistAt: number;
  tileIdx: number;
  sweeps: number;
  tiles: Bbox[];
}

export class SkyState extends DurableObject<Env> {
  private engine: Engine;
  private sched: Sched = { lastTrackAt: 0, lastTileAt: 0, lastPersistAt: 0, tileIdx: 0, sweeps: 0, tiles: INITIAL_TILES };
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
      const stored = await ctx.storage.get(["sched", "tracked"]);
      const sched = stored.get("sched") as Sched | undefined;
      if (sched) this.sched = sched;
      this.engine.importTracked((stored.get("tracked") as Known[] | undefined) ?? []);
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

  async alarm(): Promise<void> {
    if (this.retired) return;
    // Schedule the next run first so an exception can't stop the loop.
    await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
    const now = Date.now();
    const s = this.sched;
    const slow = (this.engine.getSnapshot()?.meta.creditsRemaining ?? Infinity) < LOW_CREDITS ? 3 : 1;
    // First sweep runs one box per tick so a fresh deploy fills the globe in ~15 min.
    const tileEvery = s.sweeps === 0 ? TICK_MS - 2_000 : (SWEEP_MS / s.tiles.length) * slow;
    let step = "enrich";
    let budget = REQUESTS_PER_TICK;
    try {
      // At most one OpenSky call per run, recorded before the call so failures can't retry hot.
      if (this.engine.trackedIds().length > 0 && now - s.lastTrackAt >= TRACK_INTERVAL_MS * slow) {
        s.lastTrackAt = now;
        await this.ctx.storage.put("sched", s);
        step = "track";
        step = `track ${await this.engine.refreshTracked()}`;
        budget -= 2;
      } else if (now - s.lastTileAt >= tileEvery) {
        const idx = s.tileIdx % s.tiles.length;
        const tile = s.tiles[idx]!;
        s.lastTileAt = now;
        s.tileIdx = idx + 1;
        if (s.tileIdx >= s.tiles.length) {
          s.tileIdx = 0;
          s.sweeps++;
        }
        await this.ctx.storage.put("sched", s);
        step = `tile ${idx}`;
        const { aircraft, next } = await this.engine.pollTile(tile);
        if (next.length > 1) {
          s.tiles = [...s.tiles.slice(0, idx), ...next, ...s.tiles.slice(idx + 1)];
          if (s.tileIdx > idx) s.tileIdx += next.length - 1;
          await this.ctx.storage.put("sched", s);
        }
        step = `tile ${idx}/${s.tiles.length} (${aircraft})`;
        budget -= 2;
      }
      const stats = await this.engine.enrich({ requests: budget });
      // Rebuilding costs ~2 ms of the 10 ms CPU budget; skip it when nothing new arrived.
      const changed = step !== "enrich" || stats.routeHits > 0 || stats.weatherAirports > 0;
      const snap = changed ? this.engine.rebuild(Date.now() - now) : this.engine.getSnapshot();
      if (now - s.lastPersistAt >= PERSIST_MS) {
        s.lastPersistAt = now;
        // Last fixes for the shown flights (~40 KB), not the 118 KB snapshot: on wake the engine
        // rebuilds from these plus the routes and weather already in SQLite.
        await this.ctx.storage.put({ sched: s, tracked: this.engine.exportTracked() });
      }
      console.log(
        JSON.stringify({ step, rebuilt: changed, flights: snap?.flights.length, known: snap?.meta.known, ...stats, queues: this.engine.queueSizes() }),
      );
    } catch (e) {
      console.error(`${step} failed: ${(e as Error).message}`);
    }
  }

  async fetch(req: Request): Promise<Response> {
    await this.ensureRunning();
    const url = new URL(req.url);
    const path = url.pathname;

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

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}
