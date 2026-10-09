// One poller run: ask the Worker what positions are due, fetch them from OpenSky, post them back.
// Stateless, so it can run anywhere that can reach OpenSky (Cloudflare Workers cannot): a GitHub
// Actions cron (.github/workflows/poll.yml), a laptop, any scheduler.
//
// Env: FLIGHTFLUX_API (Worker origin), INGEST_SECRET, OPENSKY_CLIENT_ID, OPENSKY_CLIENT_SECRET.
// Usage: npm run poll -w worker [-- --restart]   (also reads worker/.dev.vars when present)
//        --restart begins a fresh discovery sweep at first-sweep pace, e.g. after a long outage.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prefilter, type IngestBody, type PlanResponse } from "../src/core/ingest";
import { OpenSkyClient, type RawStatesResult, type StatesFilter } from "../src/core/opensky";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const devVars = join(root, ".dev.vars");
const env: Record<string, string | undefined> = { ...process.env };
if (existsSync(devVars)) {
  for (const l of readFileSync(devVars, "utf8").split("\n")) {
    const i = l.indexOf("=");
    if (i > 0 && !l.startsWith("#")) env[l.slice(0, i).trim()] ??= l.slice(i + 1).trim();
  }
}
const need = (k: string) => {
  // Trim: a secret pasted into GitHub from a phone often carries a trailing space or newline,
  // which would make the bearer token silently mismatch.
  const v = env[k]?.trim();
  if (!v) throw new Error(`missing ${k}`);
  return v;
};
const api = need("FLIGHTFLUX_API").replace(/\/$/, "");
const secret = need("INGEST_SECRET");
const opensky = new OpenSkyClient(need("OPENSKY_CLIENT_ID"), need("OPENSKY_CLIENT_SECRET"));
const headers = { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${api}${path}`, { ...init, headers: { ...headers, ...init?.headers } });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function forward(filter: StatesFilter, label: string): Promise<void> {
  const t = performance.now();
  let r: RawStatesResult;
  try {
    r = await opensky.statesRaw(filter);
  } catch (e) {
    console.log(`${label.padEnd(28)} opensky failed: ${(e as Error).message}`);
    return;
  }
  const body: IngestBody = {
    time: r.time,
    creditsRemaining: r.creditsRemaining,
    states: prefilter(r.rows),
    total: r.rows.length,
    ...("bbox" in filter ? { tile: filter.bbox } : {}),
  };
  const ack = await call<{ known: number }>("/api/_ingest", { method: "POST", body: JSON.stringify(body) });
  console.log(
    `${label.padEnd(28)} ${String(r.rows.length).padStart(4)} aircraft, kept ${String(body.states.length).padStart(4)} | known ${ack.known} | credits ${r.creditsRemaining ?? "?"} | ${((performance.now() - t) / 1000).toFixed(1)} s`,
  );
}

const plan = await call<PlanResponse>(process.argv.includes("--restart") ? "/api/_plan?restart" : "/api/_plan");
console.log(`plan: ${plan.tracked ? `${plan.tracked.length} tracked` : "tracked not due"}, ${plan.tiles.length} boxes, credits ${plan.creditsRemaining ?? "?"}`);
if (plan.tracked && plan.tracked.length > 0) await forward({ icao24: plan.tracked }, "tracked");
for (const tile of plan.tiles) await forward({ bbox: tile }, `box ${tile.join(",")}`);
