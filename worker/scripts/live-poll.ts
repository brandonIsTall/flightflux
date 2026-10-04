// Runs the real engine against the live APIs from Node, simulating the Durable Object's ticks.
// Usage: npm run live -w worker [-- <ticks>]   (reads credentials from worker/.dev.vars)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AdsbdbClient } from "../src/core/adsbdb";
import { Engine } from "../src/core/engine";
import { OpenSkyClient } from "../src/core/opensky";
import { MemoryStore } from "../src/core/store";
import { INITIAL_TILES } from "../src/core/tiles";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vars: Record<string, string> = Object.fromEntries(
  readFileSync(join(root, ".dev.vars"), "utf8")
    .split("\n")
    .filter((l: string) => l.includes("="))
    .map((l: string) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const ticks = Number(process.argv[2] ?? 12);

// Count requests per host, and time how long each OpenSky response takes to parse.
const perHost = new Map<string, number>();
let parseMs = 0;
const countingFetch: typeof fetch = async (input, init) => {
  const host = new URL(String(input)).host;
  perHost.set(host, (perHost.get(host) ?? 0) + 1);
  const res = await fetch(input, init);
  if (!String(input).includes("/states/all")) return res;
  const text = await res.text();
  const t = performance.now();
  JSON.parse(text);
  parseMs = performance.now() - t;
  return new Response(text, { status: res.status, headers: res.headers });
};

const engine = new Engine({
  opensky: new OpenSkyClient(vars.OPENSKY_CLIENT_ID!, vars.OPENSKY_CLIENT_SECRET!, countingFetch),
  adsbdb: new AdsbdbClient(countingFetch),
  store: new MemoryStore(),
  fetchFn: countingFetch,
  log: console.log,
});

// Same order as the Durable Object's warm-up: one region box per tick, then a tracked refresh.
let tiles = [...INITIAL_TILES];
const t0 = performance.now();
let firstCredits: number | null = null;
for (let i = 0; i < ticks; i++) {
  const s = performance.now();
  let step: string;
  parseMs = 0;
  if (i === ticks - 1) {
    step = `track ${await engine.refreshTracked()} of ${engine.trackedIds().length}`;
  } else {
    const idx = i % tiles.length;
    const { aircraft, next } = await engine.pollTile(tiles[idx]!);
    tiles = [...tiles.slice(0, idx), ...next, ...tiles.slice(idx + 1)];
    step = `tile ${idx} (${aircraft})`;
  }
  firstCredits ??= engine.getSnapshot()?.meta.creditsRemaining ?? null;
  const stats = await engine.enrich({ requests: 42 });
  const r = performance.now();
  const snap = engine.rebuild();
  const rebuildMs = performance.now() - r;
  console.log(
    `${String(i + 1).padStart(2)} ${step.padEnd(20)} parse ${parseMs.toFixed(1)} ms + rebuild ${rebuildMs.toFixed(1)} ms |`,
    `routes ${stats.routeHits}/${stats.routeLookups}, weather ${stats.weatherAirports} | known ${snap.meta.known}, flights ${snap.flights.length}`,
    stats.errors.slice(0, 1).join(""),
    `| ${((performance.now() - s) / 1000).toFixed(1)} s wall`,
  );
}
const snap = engine.getSnapshot()!;
console.log("queues", engine.queueSizes(), "requests", Object.fromEntries(perHost));
console.log(`credits: ${firstCredits} -> ${snap.meta.creditsRemaining} | total ${((performance.now() - t0) / 1000).toFixed(0)} s | snapshot ${(JSON.stringify(snap).length / 1024).toFixed(0)} KB`);
for (const f of snap.flights.slice(0, 6)) {
  console.log(
    `  ${f.callsign.padEnd(8)} ${f.origin.iata}->${f.dest.iata} ${String(f.depTempC).padStart(5)}C -> ${String(f.arrTempC).padStart(5)}C`,
    `${Math.round((f.flownKm / f.distKm) * 100)}% fix ${Math.round((snap.generatedAt - f.pos.fixT) / 60)} min old, dep ${f.flags.depTimeSource}`,
  );
}
// Rebuild on its own, warmed engine, no network noise.
{
  for (let i = 0; i < 20; i++) engine.rebuild();
  const times: number[] = [];
  for (let i = 0; i < 200; i++) {
    const t = performance.now();
    engine.rebuild();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  console.log(`rebuild alone (known ${engine.knownCount()}): median ${times[100]!.toFixed(2)} ms, p95 ${times[190]!.toFixed(2)} ms, max ${times[199]!.toFixed(2)} ms`);
}
writeFileSync(join(root, ".live-snapshot.json"), JSON.stringify(snap, null, 1));
