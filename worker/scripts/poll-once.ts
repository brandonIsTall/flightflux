// One poller run from the command line (GitHub Actions, a laptop). See src/poller.ts.
//
// Env: FLIGHTFLUX_API (Worker origin), INGEST_SECRET, OPENSKY_CLIENT_ID, OPENSKY_CLIENT_SECRET.
// Usage: npm run poll -w worker [-- --restart]   (also reads worker/.dev.vars when present)
//        --restart begins a fresh discovery sweep at first-sweep pace, e.g. after a long outage.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { requireEnv, runPoll } from "../src/poller";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const devVars = join(root, ".dev.vars");
const env: Record<string, string | undefined> = { ...process.env };
if (existsSync(devVars)) {
  for (const l of readFileSync(devVars, "utf8").split("\n")) {
    const i = l.indexOf("=");
    if (i > 0 && !l.startsWith("#")) env[l.slice(0, i).trim()] ??= l.slice(i + 1).trim();
  }
}

const r = await runPoll({
  api: requireEnv(env, "FLIGHTFLUX_API"),
  ingestSecret: requireEnv(env, "INGEST_SECRET"),
  openskyClientId: requireEnv(env, "OPENSKY_CLIENT_ID"),
  openskyClientSecret: requireEnv(env, "OPENSKY_CLIENT_SECRET"),
  restart: process.argv.includes("--restart"),
  concurrency: 4,
  log: console.log,
});
if (r.failed > 0 && r.fetched === 0) process.exit(1);
