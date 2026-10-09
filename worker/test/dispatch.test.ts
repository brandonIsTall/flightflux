import { describe, expect, it } from "vitest";
import { dispatchPoll, isHourlySlot } from "../src/dispatch";

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

describe("isHourlySlot", () => {
  it("is true only for the 5-minute cron's first run of each hour", () => {
    expect(isHourlySlot(Date.UTC(2026, 9, 9, 7, 0, 0))).toBe(true);
    expect(isHourlySlot(Date.UTC(2026, 9, 9, 7, 0, 40))).toBe(true); // cron runs can start late
    expect(isHourlySlot(Date.UTC(2026, 9, 9, 7, 5, 0))).toBe(false);
    expect(isHourlySlot(Date.UTC(2026, 9, 9, 7, 55, 0))).toBe(false);
  });
});
