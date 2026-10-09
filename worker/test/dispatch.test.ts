import { describe, expect, it } from "vitest";
import { dispatchPoll } from "../src/dispatch";
import { dispatchDue, untilDispatch } from "../src/core/wake";

describe("dispatchPoll", () => {
  it("starts poll.yml on main with the token, and reports success on 204", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const r = await dispatchPoll({ GITHUB_DISPATCH_TOKEN: " tok \n", GITHUB_REPO: "o/r" }, fetchFn);
    expect(r).toBe("dispatched");
    expect(calls[0]!.url).toBe("https://api.github.com/repos/o/r/actions/workflows/poll.yml/dispatches");
    const h = new Headers(calls[0]!.init!.headers);
    expect(h.get("authorization")).toBe("Bearer tok");
    expect(h.get("user-agent")).toBeTruthy(); // GitHub rejects requests without one
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ ref: "main" });
  });

  it("does nothing without a token", async () => {
    const fetchFn = (async () => {
      throw new Error("should not be called");
    }) as typeof fetch;
    expect(await dispatchPoll({ GITHUB_REPO: "o/r" }, fetchFn)).toBe("not configured");
  });

  it("reports GitHub's refusal or a network error instead of throwing", async () => {
    const denied = (async () => new Response('{"message":"Bad credentials"}', { status: 401 })) as typeof fetch;
    expect(await dispatchPoll({ GITHUB_DISPATCH_TOKEN: "t", GITHUB_REPO: "o/r" }, denied)).toMatch(/^failed: 401 .*Bad credentials/);
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect(await dispatchPoll({ GITHUB_DISPATCH_TOKEN: "t", GITHUB_REPO: "o/r" }, down)).toBe("failed: fetch failed");
  });
});

describe("dispatchDue", () => {
  const T = 1_791_080_000_000;
  const min = 60_000;
  it("starts the poller about every 5 minutes", () => {
    expect(dispatchDue(T, 0, 0)).toBe(true);
    expect(dispatchDue(T + 2 * min, T, 0)).toBe(false);
    expect(dispatchDue(T + 5 * min, T, 0)).toBe(true);
    expect(dispatchDue(T + 4.6 * min, T, 0)).toBe(true); // alarms can fire a little early
  });
  it("skips when a poller asked for a plan in the last 4 minutes", () => {
    expect(dispatchDue(T + 10 * min, T, T + 8 * min)).toBe(false);
    expect(dispatchDue(T + 10 * min, T, T + 5 * min)).toBe(true);
  });
});

describe("untilDispatch", () => {
  const T = 1_791_080_000_000;
  const min = 60_000;
  it("lands the idle alarm on the next 5-minute start, not 5 minutes after the last alarm", () => {
    // Dispatched at T, the poller asked for its plan 15 s later, the last follow-up alarm ran at T+2m.
    const wait = untilDispatch(T + 2 * min, T, T + 15_000);
    expect(T + 2 * min + wait).toBe(T + 5 * min - 30_000 + 0); // due 30 s early is allowed by dispatchDue
    expect(dispatchDue(T + 2 * min + wait, T, T + 15_000)).toBe(true);
  });
  it("waits for the 4-minute freshness window when a run started late", () => {
    const wait = untilDispatch(T + 4.5 * min, T, T + 70_000);
    expect(dispatchDue(T + 4.5 * min + wait, T, T + 70_000)).toBe(true);
    expect(wait).toBeLessThanOrEqual(60_000);
  });
  it("never schedules sooner than 30 s", () => {
    expect(untilDispatch(T + 20 * min, T, T)).toBe(30_000);
  });
});
