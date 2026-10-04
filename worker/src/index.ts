// Worker entry: forwards /api/* to the single SkyState Durable Object and keeps it polling.

import { SkyState, type Env } from "./sky-state";

export { SkyState };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const sky = (env: Env) => env.SKY.get(env.SKY.idFromName("global"));

export default {
  async fetch(req, env, ctx): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (req.method !== "GET" || !url.pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
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
