// One poller run: ask the Worker what positions are due, fetch them from OpenSky, post them back.
// Stateless and runtime-agnostic (only `fetch`); runs from GitHub Actions or a laptop
// (scripts/poll-once.ts). OpenSky refuses Cloudflare's and AWS's networks, so not from a Worker
// or Netlify; it accepts GitHub's runners and home connections.

import { prefilter, RESTING, type IngestBody, type PlanResponse } from "./core/ingest";
import { OpenSkyClient, type Bbox, type RawStatesResult, type StatesFilter } from "./core/opensky";

export interface PollConfig {
  /** Worker origin, e.g. https://flightflux-api.example.workers.dev */
  api: string;
  ingestSecret: string;
  openskyClientId: string;
  openskyClientSecret: string;
  /** Begin a fresh discovery sweep at first-sweep pace (after a long outage). */
  restart?: boolean;
  /** Region boxes fetched at once. */
  concurrency?: number;
  /** Start no new box after this long (ms), for hosts that cap a run's length. */
  deadlineMs?: number;
  log?: (line: string) => void;
  fetchFn?: typeof fetch;
  /** Waits before retrying a Worker call that failed to connect (default 2 s, then 5 s). */
  retryDelaysMs?: number[];
}

export interface PollResult {
  tracked: number | null;
  boxes: number;
  fetched: number;
  failed: number;
  /** Boxes left unfetched at the deadline; they come round again next sweep. */
  skipped: number;
  known: number | null;
  credits: number | null;
  /** The Worker is over its daily storage budget and refused work until 00:00 UTC. Not a failure. */
  resting: boolean;
  ms: number;
}

/** The Worker answered with RESTING (core/ingest.ts): it takes no positions until 00:00 UTC. */
class RestingError extends Error {}

/** Trim and require one setting: values pasted into a dashboard often carry stray whitespace. */
export function requireEnv(env: Record<string, string | undefined>, key: string): string {
  const v = env[key]?.trim();
  if (!v) throw new Error(`missing ${key}`);
  return v;
}

export async function runPoll(c: PollConfig): Promise<PollResult> {
  const t0 = Date.now();
  const fetchFn = c.fetchFn ?? ((input, init) => fetch(input, init));
  const log = c.log ?? (() => {});
  const api = c.api.replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${c.ingestSecret}`, "Content-Type": "application/json" };
  const opensky = new OpenSkyClient(c.openskyClientId, c.openskyClientSecret, fetchFn);
  const result: PollResult = { tracked: null, boxes: 0, fetched: 0, failed: 0, skipped: 0, known: null, credits: null, resting: false, ms: 0 };

  // A GitHub runner sometimes can't connect to Cloudflare for a second or two: retry a call that
  // never got a response. A real outage still fails after the last retry. Both calls are safe to
  // repeat: a plan answered but lost is simply superseded, and re-ingesting a box is harmless.
  const retryDelays = c.retryDelaysMs ?? [2_000, 5_000];
  const send = async (url: string, init: RequestInit): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fetchFn(url, init);
      } catch (e) {
        const wait = retryDelays[attempt];
        if (wait === undefined) throw e;
        log(`${url.slice(api.length)} unreachable (${(e as Error).message}); retrying in ${wait / 1000} s`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  };

  const call = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const res = await send(`${api}${path}`, { ...init, headers: { ...headers, ...init?.headers } });
    if (!res.ok) {
      const text = await res.text();
      // Matched on the message too, for a Worker deployed before the `resting` flag.
      if (res.status === 503 && (text.includes('"resting":true') || text.includes(RESTING.error))) throw new RestingError(RESTING.error);
      throw new Error(`${path}: ${res.status} ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  };

  // Region boxes still to fetch; emptied early if the Worker starts resting.
  const queue: Bbox[] = [];

  const forward = async (filter: StatesFilter, label: string) => {
    const t = Date.now();
    let r: RawStatesResult;
    try {
      r = await opensky.statesRaw(filter);
    } catch (e) {
      result.failed++;
      log(`${label.padEnd(28)} opensky failed: ${(e as Error).message}`);
      return;
    }
    const body: IngestBody = {
      time: r.time,
      creditsRemaining: r.creditsRemaining,
      states: prefilter(r.rows),
      total: r.rows.length,
      ...("bbox" in filter ? { tile: filter.bbox } : {}),
    };
    let ack: { known: number };
    try {
      ack = await call<{ known: number }>("/api/_ingest", { method: "POST", body: JSON.stringify(body) });
    } catch (e) {
      if (!(e instanceof RestingError)) throw e;
      // The budget ran out mid-run: fetch nothing more that would be refused.
      if (!result.resting) log(`worker resting: ${e.message}; stopping`);
      result.resting = true;
      queue.length = 0;
      return;
    }
    result.fetched++;
    result.known = ack.known;
    result.credits = r.creditsRemaining ?? result.credits;
    log(
      `${label.padEnd(28)} ${String(r.rows.length).padStart(4)} aircraft, kept ${String(body.states.length).padStart(4)} | known ${ack.known} | credits ${r.creditsRemaining ?? "?"} | ${((Date.now() - t) / 1000).toFixed(1)} s`,
    );
  };

  // Reach OpenSky before asking for a plan: the Worker marks what it hands out as issued, so a
  // host OpenSky refuses (Cloudflare's and AWS's networks, so far) would otherwise use up the
  // schedule every run without fetching anything.
  try {
    await opensky.ready();
  } catch (e) {
    result.failed = 1;
    result.ms = Date.now() - t0;
    log(`opensky unreachable from this host (${(e as Error).message}); not asking the Worker for a plan`);
    return result;
  }

  let plan: PlanResponse;
  try {
    plan = await call<PlanResponse>(c.restart ? "/api/_plan?restart" : "/api/_plan");
  } catch (e) {
    if (!(e instanceof RestingError)) throw e;
    result.resting = true;
    result.ms = Date.now() - t0;
    log(`worker resting: ${e.message}; nothing to fetch`);
    return result;
  }
  result.tracked = plan.tracked?.length ?? null;
  result.boxes = plan.tiles.length;
  result.credits = plan.creditsRemaining;
  log(`plan: ${plan.tracked ? `${plan.tracked.length} tracked` : "tracked not due"}, ${plan.tiles.length} boxes, credits ${plan.creditsRemaining ?? "?"}`);

  if (plan.tracked && plan.tracked.length > 0) await forward({ icao24: plan.tracked }, "tracked");

  // A long gap earns a full sweep (~30 boxes): fetch a few at once, and stop starting new ones
  // at the deadline rather than be cut off mid-request by the host.
  if (!result.resting) queue.push(...plan.tiles);
  const deadline = t0 + (c.deadlineMs ?? Infinity);
  const worker = async () => {
    for (let tile = queue.shift(); tile; tile = queue.shift()) {
      if (Date.now() >= deadline) {
        result.skipped++;
        continue;
      }
      await forward({ bbox: tile }, `box ${tile.join(",")}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, c.concurrency ?? 1) }, worker));
  if (result.skipped > 0) log(`deadline reached: ${result.skipped} boxes left for the next sweep`);

  result.ms = Date.now() - t0;
  return result;
}
