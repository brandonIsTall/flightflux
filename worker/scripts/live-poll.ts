// Runs the real engine against the live APIs from Node, simulating the Durable Object's ticks.
// Usage: npm run live -w worker [-- <enrichTicks>]   (reads credentials from worker/.dev.vars)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AdsbdbClient } from "../src/core/adsbdb";
import { Engine } from "../src/core/engine";
import { OpenSkyClient } from "../src/core/opensky";
import { MemoryStore } from "../src/core/store";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vars: Record<string, string> = Object.fromEntries(
  readFileSync(join(root, ".dev.vars"), "utf8")
    .split("\n")
    .filter((l: string) => l.includes("="))
    .map((l: string) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const ticks = Number(process.argv[2] ?? 6);

// Count requests per host and time how long the states JSON takes to parse.
const perHost = new Map<string, number>();
const countingFetch: typeof fetch = async (input, init) => {
  const host = new URL(String(input)).host;
  perHost.set(host, (perHost.get(host) ?? 0) + 1);
  const res = await fetch(input, init);
  if (!String(input).includes("/states/all")) return res;
  const text = await res.text();
  const t = performance.now();
  JSON.parse(text);
  console.log(`states payload ${(text.length / 1024).toFixed(0)} KB, JSON.parse ${(performance.now() - t).toFixed(1)} ms`);
  return new Response(text, { status: res.status, headers: res.headers });
};

const engine = new Engine({
  opensky: new OpenSkyClient(vars.OPENSKY_CLIENT_ID!, vars.OPENSKY_CLIENT_SECRET!, countingFetch),
  adsbdb: new AdsbdbClient(countingFetch),
  store: new MemoryStore(),
  fetchFn: countingFetch,
  log: console.log,
});

const t0 = performance.now();
await engine.pollStates();
let cpu = performance.now();
engine.rebuild();
console.log(`rebuild (no network) ${(performance.now() - cpu).toFixed(1)} ms`);
for (let i = 0; i < ticks; i++) {
  const s = performance.now();
  const stats = await engine.enrich({ requests: 44 });
  cpu = performance.now();
  const snap = engine.rebuild()!;
  console.log(
    `tick ${i + 1}: ${(performance.now() - s).toFixed(0)} ms wall, rebuild ${(performance.now() - cpu).toFixed(1)} ms |`,
    `routes ${stats.routeHits}/${stats.routeLookups}, weather ${stats.weatherAirports}, tracks ${stats.tracks},`,
    `errors ${stats.errors.length} | flights ${snap.flights.length}`,
    stats.errors.slice(0, 2).join("; "),
  );
}
const snap = engine.getSnapshot()!;
console.log("meta", snap.meta, "queues", engine.queueSizes(), "requests", Object.fromEntries(perHost));
console.log(`total ${((performance.now() - t0) / 1000).toFixed(1)} s, snapshot ${(JSON.stringify(snap).length / 1024).toFixed(0)} KB`);
for (const f of snap.flights.slice(0, 8)) {
  console.log(
    `  ${f.callsign.padEnd(8)} ${f.origin.iata}->${f.dest.iata} ${String(f.depTempC).padStart(5)}C -> ${String(f.arrTempC).padStart(5)}C`,
    `${Math.round((f.flownKm / f.distKm) * 100)}% dep:${f.flags.depTimeSource}`,
  );
}
writeFileSync(join(root, ".live-snapshot.json"), JSON.stringify(snap, null, 1));
