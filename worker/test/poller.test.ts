import { describe, expect, it } from "vitest";
import type { Bbox } from "../src/core/opensky";
import { requireEnv, runPoll } from "../src/poller";

const TILES: Bbox[] = Array.from({ length: 10 }, (_, i) => [0, i * 10, 10, i * 10 + 10]);

/** Fake Worker + OpenSky. `delayMs` slows each OpenSky call; `failBox` makes one box fail. */
function fakeUpstreams(opts: { delayMs?: number; failBox?: number; tracked?: string[] | null } = {}) {
  const seen = { plan: [] as string[], ingested: [] as unknown[], inFlight: 0, maxInFlight: 0, auth: [] as string[] };
  const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers });
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/_plan")) {
      seen.plan.push(url);
      seen.auth.push(new Headers(init?.headers).get("authorization") ?? "");
      return json({ tracked: opts.tracked === undefined ? ["abc123"] : opts.tracked, tiles: TILES, creditsRemaining: 3900 });
    }
    if (url.includes("/api/_ingest")) {
      seen.ingested.push(JSON.parse(String(init?.body)));
      return json({ ok: true, known: seen.ingested.length });
    }
    if (url.includes("/token")) return json({ access_token: "t", expires_in: 1800 });
    if (url.includes("/states/all")) {
      seen.inFlight++;
      seen.maxInFlight = Math.max(seen.maxInFlight, seen.inFlight);
      await new Promise((r) => setTimeout(r, opts.delayMs ?? 1));
      seen.inFlight--;
      if (opts.failBox != null && url.includes(`lomin=${opts.failBox * 10}&`)) return json({}, 503);
      return json({ time: 1, states: [["abc123", "UAL880", "X", 1, 1, 10, 50, 11000, false, 250, 90, 0, null, 11000, null, false, 0]] }, 200, { "x-rate-limit-remaining": "3800" });
    }
    return json({}, 404);
  }) as typeof fetch;
  return { seen, fetchFn };
}

const base = { api: "https://w.example/", ingestSecret: "s3cret", openskyClientId: "id", openskyClientSecret: "x" };

describe("runPoll", () => {
  it("fetches the tracked set and every box, a few at a time, and posts each to the Worker", async () => {
    const { seen, fetchFn } = fakeUpstreams();
    const r = await runPoll({ ...base, fetchFn, concurrency: 4 });
    expect(r).toMatchObject({ tracked: 1, boxes: 10, fetched: 11, failed: 0, skipped: 0, credits: 3800 });
    expect(seen.maxInFlight).toBe(4);
    expect(seen.ingested.filter((b) => (b as { tile?: Bbox }).tile)).toHaveLength(10);
    expect(seen.auth).toEqual(["Bearer s3cret"]);
    expect(seen.plan[0]).toBe("https://w.example/api/_plan");
  });

  it("stops starting boxes at the deadline instead of being cut off by the host", async () => {
    const { fetchFn } = fakeUpstreams({ delayMs: 30, tracked: null });
    const r = await runPoll({ ...base, fetchFn, concurrency: 2, deadlineMs: 50 });
    expect(r.fetched).toBeGreaterThan(0);
    expect(r.skipped).toBeGreaterThan(0);
    expect(r.fetched + r.skipped).toBe(10);
  });

  it("counts an OpenSky failure and carries on", async () => {
    const { fetchFn } = fakeUpstreams({ failBox: 3, tracked: null });
    const r = await runPoll({ ...base, fetchFn, concurrency: 3 });
    expect(r).toMatchObject({ fetched: 9, failed: 1 });
  });

  it("asks for a restarted sweep when told to", async () => {
    const { seen, fetchFn } = fakeUpstreams({ tracked: null });
    await runPoll({ ...base, fetchFn, restart: true });
    expect(seen.plan[0]).toBe("https://w.example/api/_plan?restart");
  });
});

describe("requireEnv", () => {
  it("trims pasted values and rejects missing ones", () => {
    expect(requireEnv({ K: "  abc \n" }, "K")).toBe("abc");
    expect(() => requireEnv({ K: "   " }, "K")).toThrow("missing K");
    expect(() => requireEnv({}, "K")).toThrow("missing K");
  });
});
