// Worker entry: forwards /api/* to the single SkyState Durable Object and keeps its loop running.

import { normalizeQuery } from "./core/engine";
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

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });
}

export default {
  async fetch(req, env, ctx): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (!url.pathname.startsWith("/api/") || (req.method !== "GET" && !(req.method === "POST" && isPollerPath(url.pathname)))) {
      return new Response("Not found", { status: 404 });
    }
    if (isPollerPath(url.pathname)) return sky(env).fetch(req);

    // Search: reject what can't be a flight number before waking the object, and limit each
    // visitor (10 a minute per data centre; see wrangler.jsonc). The object enforces a daily cap.
    if (url.pathname === "/api/search") {
      if (!normalizeQuery(url.searchParams.get("q") ?? "")) return json({ error: "expected a flight number like BA117" }, 400);
      const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
      if (env.SEARCH_LIMITER && !(await env.SEARCH_LIMITER.limit({ key: ip })).success) {
        return json({ error: "too many searches, try again in a minute" }, 429);
      }
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

  // Cron safety net (hourly): replaces the alarm if it is missing or long overdue.
  async scheduled(_event, env): Promise<void> {
    await sky(env).ensureRunning();
  },
} satisfies ExportedHandler<Env>;
