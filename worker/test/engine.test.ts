import { describe, expect, it } from "vitest";
import { AdsbdbClient } from "../src/core/adsbdb";
import { Engine } from "../src/core/engine";
import { interpolate } from "../src/core/geo";
import { OpenSkyClient } from "../src/core/opensky";
import { MemoryStore } from "../src/core/store";

const IAH = { lat: 29.9844, lon: -95.3414 };
const LHR = { lat: 51.4706, lon: -0.461941 };
const T0 = 1_791_080_000;

const airport = (code: string, icao: string, p: { lat: number; lon: number }) => ({
  iata_code: code,
  icao_code: icao,
  name: `${code} Airport`,
  municipality: code,
  country_name: "X",
  latitude: p.lat,
  longitude: p.lon,
});

/** Fake upstreams. `states` is swapped between polls to simulate time passing. */
function fakeWorld() {
  const calls: string[] = [];
  const world = {
    states: [] as unknown[][],
    time: T0,
    calls,
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const json = (b: unknown, status = 200, headers: Record<string, string> = {}) =>
        new Response(JSON.stringify(b), { status, headers });
      if (url.includes("/token")) return json({ access_token: "t", expires_in: 1800 });
      if (url.includes("/states/all"))
        return json({ time: world.time, states: world.states }, 200, { "x-rate-limit-remaining": "3000" });
      if (url.includes("/tracks/all")) return json(null, 404);
      if (url.includes("/callsign/UAL880") || url.includes("/callsign/UA880"))
        return json({
          response: {
            flightroute: {
              callsign_icao: "UAL880",
              callsign_iata: "UA880",
              airline: { name: "United Airlines", icao: "UAL", iata: "UA" },
              origin: airport("IAH", "KIAH", IAH),
              destination: airport("LHR", "EGLL", LHR),
            },
          },
        });
      if (url.includes("/callsign/")) return json({ response: "unknown callsign" }, 404);
      if (url.includes("open-meteo")) {
        const lats = new URL(url).searchParams.get("latitude")!.split(",");
        const times = Array.from({ length: 72 }, (_, i) => T0 - 24 * 3600 + i * 3600);
        const one = (lat: string) => ({
          timezone: Number(lat) > 40 ? "Europe/London" : "America/Chicago",
          utc_offset_seconds: Number(lat) > 40 ? 3600 : -18000,
          // Houston warm (30 C), London cool (12 C), flat over time.
          hourly: { time: times, temperature_2m: times.map(() => (Number(lat) > 40 ? 12 : 30)) },
        });
        return json(lats.length === 1 ? one(lats[0]!) : lats.map(one));
      }
      return json({}, 404);
    }) as typeof fetch,
  };
  return world;
}

const sv = (icao24: string, callsign: string, p: { lat: number; lon: number }, alt: number, onGround = false, vr = 0) => [
  icao24, callsign, "X", T0, T0, p.lon, p.lat, alt, onGround, onGround ? 0 : 250, 45, vr, null, alt, null, false, 0,
];

function makeEngine(world: ReturnType<typeof fakeWorld>) {
  const store = new MemoryStore();
  const engine = new Engine({
    opensky: new OpenSkyClient("id", "secret", world.fetch, () => world.time * 1000),
    adsbdb: new AdsbdbClient(world.fetch),
    store,
    fetchFn: world.fetch,
    now: () => world.time * 1000,
  });
  return { engine, store };
}

describe("Engine", () => {
  it("resolves route and weather over ticks, then publishes a curated flight with blended temps", async () => {
    const world = fakeWorld();
    world.states = [sv("aa9300", "UAL880", interpolate(IAH, LHR, 0.4), 11000), sv("bbbbbb", "XYZ1", IAH, 11000)];
    const { engine } = makeEngine(world);

    await engine.pollStates();
    expect(engine.rebuild()!.flights).toHaveLength(0); // nothing cached yet
    await engine.enrich({ requests: 40 }); // route lookups
    engine.rebuild(); // queues weather for the routed flight
    await engine.enrich({ requests: 40 }); // weather
    const snap = engine.rebuild()!;

    expect(snap.flights).toHaveLength(1);
    const f = snap.flights[0]!;
    expect(f.callsign).toBe("UAL880");
    expect(f.flightNo).toBe("UA880");
    expect(f.depTempC).toBe(30);
    expect(f.arrTempC).toBe(12);
    expect(f.flownKm / f.distKm).toBeCloseTo(0.4, 1);
    expect(f.eta).toBeGreaterThan(T0);
    expect(f.depTime).toBeLessThan(T0);
    expect(f.origin.tz).toBe("America/Chicago");
    expect(snap.meta).toMatchObject({ airborne: 2, candidates: 2, routed: 1, creditsRemaining: 3000 });
  });

  it("records an observed take-off when an aircraft goes from ground to airborne", async () => {
    const world = fakeWorld();
    const { engine, store } = makeEngine(world);
    world.states = [sv("cc0001", "UAL880", IAH, 0, true)];
    await engine.pollStates();
    world.time = T0 + 120;
    world.states = [sv("cc0001", "UAL880", { lat: 30.1, lon: -95.2 }, 1200, false, 10)];
    await engine.pollStates();
    expect(store.getDep("cc0001")).toMatchObject({ t: T0 + 60, source: "observed" });
  });

  it("finds a flight by IATA flight number via search", async () => {
    const world = fakeWorld();
    world.states = [sv("aa9300", "UAL880", interpolate(IAH, LHR, 0.5), 11000)];
    const { engine } = makeEngine(world);
    await engine.pollStates();
    const f = await engine.search("ua 880");
    expect(f?.callsign).toBe("UAL880");
    expect(await engine.search("ZZ999")).toBeNull();
  });

  it("does not spend more requests than the budget", async () => {
    const world = fakeWorld();
    world.states = Array.from({ length: 100 }, (_, i) => sv(`d${i}`, `ABC${i}`, { lat: 10, lon: i }, 11000));
    const { engine } = makeEngine(world);
    await engine.pollStates();
    engine.rebuild();
    const before = world.calls.length;
    await engine.enrich({ requests: 20 });
    expect(world.calls.length - before).toBeLessThanOrEqual(20);
  });
});
