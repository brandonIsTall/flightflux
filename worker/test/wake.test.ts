import { describe, expect, it } from "vitest";
import { DRAIN_MS, HEARTBEAT_MS, nextAlarmDelay, POLLER_STALE_MS, pollerHealth } from "../src/core/wake";

describe("nextAlarmDelay", () => {
  it("runs every 30 s only while lookups are queued", () => {
    expect(nextAlarmDelay({ routes: 3, weather: 0 })).toBe(DRAIN_MS);
    expect(nextAlarmDelay({ routes: 0, weather: 1 })).toBe(DRAIN_MS);
    expect(nextAlarmDelay({ routes: 0, weather: 0 })).toBe(HEARTBEAT_MS);
  });

  it("doesn't wake every 30 s for routes while adsbdb lookups are paused", () => {
    const now = 1_000_000;
    expect(nextAlarmDelay({ routes: 50, weather: 0 }, now, now + 4 * 60_000)).toBe(4 * 60_000);
    expect(nextAlarmDelay({ routes: 50, weather: 0 }, now, now - 1)).toBe(DRAIN_MS);
    expect(nextAlarmDelay({ routes: 50, weather: 2 }, now, now + 4 * 60_000)).toBe(DRAIN_MS);
  });

  it("wakes an idle object every 5 minutes, to start the poller", () => {
    expect(HEARTBEAT_MS).toBe(5 * 60_000);
  });
});

describe("pollerHealth", () => {
  const now = 1_800_000_000_000;

  it("reports when the poller last asked for a plan, in whole minutes", () => {
    expect(pollerHealth(now, now - 7.5 * 60_000)).toEqual({ lastPlanAt: now - 7.5 * 60_000, ageMin: 7, stale: false });
  });

  it("stays quiet through an 18-minute GitHub hiccup and turns stale after 20 minutes", () => {
    expect(pollerHealth(now, now - 18 * 60_000).stale).toBe(false);
    expect(pollerHealth(now, now - POLLER_STALE_MS).stale).toBe(false);
    expect(pollerHealth(now, now - POLLER_STALE_MS - 1).stale).toBe(true);
  });

  it("is stale when no poller has ever asked", () => {
    expect(pollerHealth(now, 0)).toEqual({ lastPlanAt: null, ageMin: null, stale: true });
  });

  it("never reports a negative age if clocks disagree", () => {
    expect(pollerHealth(now, now + 5_000)).toMatchObject({ ageMin: 0, stale: false });
  });
});
