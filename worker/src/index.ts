// Worker entry: forwards /api/* to the single SkyState Durable Object and keeps its loop running.

import { probeUpstreams } from "./probe";
import { SkyState, type Env } from "./sky-state";

export { SkyState };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

/** Poller endpoints (core/ingest.ts): authenticated, never cached, POST allowed. */
const isPollerPath = (p: string) => p === "/api/_plan" || p === "/api/_ingest";

/**
 * The object lives in Western Europe, near OpenSky's origin in Switzerland. It turned out not to
 * matter: OpenSky's Cloudflare front answers 522 to Workers from every data centre tried, which is
 * why positions come from an external poller (core/ingest.ts). Kept so the stored state stays put.
 */
const sky = (env: Env) => env.SKY.get(env.SKY.idFromName("global-weur"), { locationHint: "weur" });
/** The first instance, created in Ashburn before the hint existed. Retired once; kept so it can be again. */
const legacySky = (env: Env) => env.SKY.get(env.SKY.idFromName("global"));

export default {
  async fetch(req, env, ctx): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (!url.pathname.startsWith("/api/") || (req.method !== "GET" && !(req.method === "POST" && isPollerPath(url.pathname)))) {
      return new Response("Not found", { status: 404 });
    }
    if (isPollerPath(url.pathname)) return sky(env).fetch(req);

    // Diagnostic: can this Worker (or the poller's Durable Object, with ?do=1) reach each upstream?
    if (url.pathname === "/api/_probe") {
      const body = url.searchParams.has("do") ? await sky(env).probe() : await probeUpstreams();
      return new Response(JSON.stringify(body, null, 1), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // One-off housekeeping: stop the retired instance's alarm loop. Unlisted; harmless to repeat.
    if (url.pathname === "/api/_retire-legacy") {
      await legacySky(env).retire();
      return new Response("retired", { headers: CORS });
    }

    // The snapshot is identical for everyone: serve it from the edge cache when we can.
    const cacheable = url.pathname === "/api/snapshot";
    const cache = caches.default;
    if (cacheable) {
      const hit = await cache.match(req);
      if (hit) return hit;
    }

    const upstream = await sky(env).fetch(req);
    const res = new Response(upstream.body, upstream);
    for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
    if (cacheable && res.ok) ctx.waitUntil(cache.put(req, res.clone()));
    return res;
  },

  // Cron safety net: restarts the alarm loop if it ever stops (e.g. after a deploy).
  async scheduled(_event, env): Promise<void> {
    await sky(env).ensureRunning();
  },
} satisfies ExportedHandler<Env>;
