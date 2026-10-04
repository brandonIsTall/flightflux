// One Durable Object instance ("global") owns the poller and serves every API request.

import { DurableObject } from "cloudflare:workers";
import type { Snapshot } from "../../shared/types";
import { AdsbdbClient } from "./core/adsbdb";
import { Engine } from "./core/engine";
import { OpenSkyClient } from "./core/opensky";
import { SqlStore } from "./sql-store";

export interface Env {
  SKY: DurableObjectNamespace<SkyState>;
  OPENSKY_CLIENT_ID: string;
  OPENSKY_CLIENT_SECRET: string;
}

export const TICK_MS = 30_000;
/**
 * Positions are fetched at most this often: 720 polls x 4 credits = 2,880 of the 4,000 daily
 * OpenSky credits, leaving room for departure tracks. Persisted, so an evicted and recreated
 * object can never poll faster than this.
 */
export const POLL_INTERVAL_MS = 120_000;
/** Workers free plan allows 50 subrequests per invocation; leave headroom. */
const REQUESTS_PER_TICK = 44;
const SEARCHES_PER_MIN = 10;

export class SkyState extends DurableObject<Env> {
  private engine: Engine;
  private tick = 0;
  private lastPollAt = 0;
  private searchHits = new Map<string, { minute: number; count: number }>();
  private restored: Snapshot | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.engine = new Engine({
      opensky: new OpenSkyClient(env.OPENSKY_CLIENT_ID, env.OPENSKY_CLIENT_SECRET),
      adsbdb: new AdsbdbClient(),
      store: new SqlStore(ctx.storage.sql),
      log: (m) => console.log(m),
    });
    ctx.blockConcurrencyWhile(async () => {
      this.restored = (await ctx.storage.get<Snapshot>("snapshot")) ?? null;
      this.lastPollAt = (await ctx.storage.get<number>("lastPollAt")) ?? 0;
    });
  }

  /** Start the alarm loop if it isn't running. Called by the cron trigger and on first request. */
  async ensureRunning(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(Date.now());
  }

  async alarm(): Promise<void> {
    // Schedule the next tick first so an exception can't stop the loop.
    await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
    const started = Date.now();
    let budget = REQUESTS_PER_TICK;
    try {
      const polled = started - this.lastPollAt >= POLL_INTERVAL_MS - 5_000;
      if (polled) {
        // Record the attempt before calling out, so a failing poll can't be retried every tick.
        this.lastPollAt = started;
        await this.ctx.storage.put("lastPollAt", started);
        await this.engine.pollStates();
        budget -= 2; // states + possible token refresh
      }
      if (!this.engine.hasStates()) return; // recreated mid-interval: wait for the next poll
      this.engine.rebuild();
      const stats = await this.engine.enrich({ requests: budget });
      const snap = this.engine.rebuild(Date.now() - started);
      // Persist once per poll interval; this copy only serves requests after an eviction.
      if (snap && polled) await this.ctx.storage.put("snapshot", snap);
      console.log(
        JSON.stringify({ tick: this.tick, flights: snap?.flights.length, ...stats, queues: this.engine.queueSizes() }),
      );
    } catch (e) {
      console.error(`tick ${this.tick} failed: ${(e as Error).message}`);
    } finally {
      this.tick++;
    }
  }

  async fetch(req: Request): Promise<Response> {
    await this.ensureRunning();
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/api/snapshot") {
      const snap = this.engine.getSnapshot() ?? this.restored;
      if (!snap) return json({ error: "warming up" }, 503, { "Retry-After": "30" });
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
