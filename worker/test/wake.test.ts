import { describe, expect, it } from "vitest";
import { DRAIN_MS, HEARTBEAT_MS, nextAlarmDelay } from "../src/core/wake";

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
