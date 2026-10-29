import { describe, expect, it } from "vitest";
import { fetchProfile, PROFILE_POINTS, profileSamples } from "../src/core/enroute";
import { distanceKm, interpolate } from "../src/core/geo";

const YQB = { lat: 46.79, lon: -71.39 };
const SXM = { lat: 18.04, lon: -63.11 };
const DEP = 1_793_180_000; // 2026-10-28 08:13 UTC
const flight = { origin: YQB, dest: SXM, depTime: DEP, eta: DEP + 5 * 3600, depTempC: 2, arrTempC: 30 };

/** Open-Meteo stand-in: each location's temperature is its latitude-driven value, rising 1 C an hour. */
function fakeMeteo(urls: string[], missing?: number) {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    urls.push(String(input));
    const lats = url.searchParams.get("latitude")!.split(",").map(Number);
    const times = Array.from({ length: 48 }, (_, i) => DEP - (DEP % 86_400) + i * 3600);
    const out = lats.map((lat, i) => ({
      timezone: "GMT",
      utc_offset_seconds: 0,
      hourly: { time: times, temperature_2m: times.map((t) => (i === missing ? null : 40 - lat + (t - times[0]!) / 3600)) },
    }));
    return new Response(JSON.stringify(out.length === 1 ? out[0] : out));
  }) as typeof fetch;
}

describe("en-route temperatures", () => {
  it("samples the route where and when the plane passed", () => {
    const s = profileSamples(flight);
    expect(s).toHaveLength(PROFILE_POINTS);
    expect(distanceKm(s[0]!, YQB)).toBeLessThan(0.01);
    expect(s[0]!.t).toBe(DEP);
    expect(s.at(-1)!.t).toBe(flight.eta);
    expect(distanceKm(s[8]!, interpolate(YQB, SXM, 0.5))).toBeLessThan(0.01);
    expect(s[8]!.t).toBe(DEP + 2.5 * 3600);
  });

  it("asks once for the flight's UTC dates and pins the ends to its own temperatures", async () => {
    const urls: string[] = [];
    const p = (await fetchProfile(flight, fakeMeteo(urls)))!;
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("start_date=2026-10-28");
    expect(urls[0]).toContain("end_date=2026-10-28");
    expect(urls[0]).toContain("timezone=GMT");
    expect(p).toHaveLength(PROFILE_POINTS);
    expect([p[0], p.at(-1)]).toEqual([2, 30]);
    // Midway: 40 - lat at the midpoint, plus the hours since midnight at that time.
    const mid = profileSamples(flight)[8]!;
    expect(p[8]).toBeCloseTo(40 - mid.lat + (mid.t - (DEP - (DEP % 86_400))) / 3600, 1);
  });

  it("gives up rather than invent a point Open-Meteo has no value for", async () => {
    expect(await fetchProfile(flight, fakeMeteo([], 5))).toBeNull();
  });
});
