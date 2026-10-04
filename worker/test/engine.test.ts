import { describe, expect, it } from "vitest";
import { AdsbdbClient } from "../src/core/adsbdb";
import { Engine } from "../src/core/engine";
import { distanceKm, interpolate } from "../src/core/geo";
import { OpenSkyClient, type Bbox } from "../src/core/opensky";
import { MemoryStore } from "../src/core/store";
import { SPLIT_AT } from "../src/core/tiles";

const IAH = { lat: 29.9844, lon: -95.3414 };
const LHR = { lat: 51.4706, lon: -0.461941 };
const T0 = 1_791_080_000;
const WORLD: Bbox = [-90, -180, 90, 180];

const airport = (code: string, icao: string, p: { lat: number; lon: number }) => ({
  iata_code: code,
  icao_code: icao,
  name: `${code} Airport`,
  municipality: code,
  country_name: "X",
  latitude: p.lat,
  longitude: p.lon,
});

/** Fake upstreams. Mutate `states` and `time` to simulate the world moving. */
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
      if (url.includes("/states/all")) {
        const p = new URL(url).searchParams;
        const ids = p.getAll("icao24");
        const box = ["lamin", "lomin", "lamax", "lomax"].map((k) => Number(p.get(k)));
        const inBox = (r: unknown[]) =>
          (r[6] as number) >= box[0]! && (r[6] as number) < box[2]! && (r[5] as number) >= box[1]! && (r[5] as number) < box[3]!;
        const states = world.states.filter((r) => (ids.length ? ids.includes(r[0] as string) : inBox(r)));
        return json({ time: world.time, states }, 200, { "x-rate-limit-remaining": "3000" });
      }
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

const sv = (icao24: string, callsign: string, p: { lat: number; lon: number }, alt: number, t = T0, vr = 0) => [
  icao24, callsign, "X", t, t, p.lon, p.lat, alt, false, 250, 45, vr, null, alt, null, false, 0,
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

/** Discover, look up routes, then fetch weather: the steps a fresh deploy goes through. */
async function warm(engine: Engine) {
  await engine.pollTile(WORLD);
  engine.rebuild();
  await engine.enrich({ requests: 40 }); // routes
  engine.rebuild();
  await engine.enrich({ requests: 40 }); // weather
  return engine.rebuild();
}

describe("Engine", () => {
  it("discovers a flight, resolves route and weather, and publishes blended temperatures", async () => {
    const world = fakeWorld();
    world.states = [sv("aa9300", "UAL880", interpolate(IAH, LHR, 0.4), 11000), sv("bbbbbb", "XYZ1", IAH, 11000)];
    const { engine } = makeEngine(world);

    const snap = await warm(engine);
    expect(snap.flights).toHaveLength(1);
    const f = snap.flights[0]!;
    expect(f).toMatchObject({ callsign: "UAL880", flightNo: "UA880", depTempC: 30, arrTempC: 12 });
    expect(f.flags.depTimeSource).toBe("estimated");
    expect(f.flownKm / f.distKm).toBeCloseTo(0.4, 1);
    expect(f.depTime).toBeLessThan(T0);
    expect(f.eta).toBeGreaterThan(T0);
    expect(f.origin.tz).toBe("America/Chicago");
    expect(snap.meta).toMatchObject({ known: 2, routed: 1, creditsRemaining: 3000 });
  });

  it("advances a stale fix along the route at its ground speed", async () => {
    const world = fakeWorld();
    world.states = [sv("aa9300", "UAL880", interpolate(IAH, LHR, 0.4), 11000)];
    const { engine } = makeEngine(world);
    const before = (await warm(engine)).flights[0]!;

    world.time = T0 + 1800; // 30 min later, no new fix
    const after = engine.rebuild().flights[0]!;
    expect(after.flownKm - before.flownKm).toBeCloseTo(450, -1); // 250 m/s x 1800 s
    expect(after.pos.t).toBe(T0 + 1800);
    expect(after.pos.fixT).toBe(T0);
    const expected = interpolate(IAH, LHR, after.flownKm / after.distKm);
    expect(distanceKm(after.pos, expected)).toBeLessThan(1);
  });

  it("refreshes tracked flights with one icao24-filtered call, never the worldwide query", async () => {
    const world = fakeWorld();
    world.states = [sv("aa9300", "UAL880", interpolate(IAH, LHR, 0.4), 11000)];
    const { engine } = makeEngine(world);
    await warm(engine);

    world.time = T0 + 300;
    world.states = [sv("aa9300", "UAL880", interpolate(IAH, LHR, 0.45), 11000, T0 + 300)];
    const before = world.calls.length;
    expect(await engine.refreshTracked()).toBe(1);
    const call = world.calls.slice(before).find((u) => u.includes("/states/all"))!;
    expect(call).toContain("icao24=aa9300");
    expect(call).not.toContain("lamin");
    expect(engine.rebuild().flights[0]!.pos.fixT).toBe(T0 + 300);
  });

  it("splits a region box that comes back too full", async () => {
    const world = fakeWorld();
    world.states = Array.from({ length: SPLIT_AT + 1 }, (_, i) => sv(`e${i}`, `ABC${i}`, { lat: 10, lon: 10 }, 11000));
    const { engine } = makeEngine(world);
    const { aircraft, next } = await engine.pollTile([0, 0, 45, 60]);
    expect(aircraft).toBe(SPLIT_AT + 1);
    expect(next).toEqual([
      [0, 0, 45, 30],
      [0, 30, 45, 60],
    ]);
  });

  it("uses a departure observed in the climb when it starts at the route's origin", async () => {
    const world = fakeWorld();
    world.states = [sv("cc0001", "UAL880", { lat: 30.0, lon: -95.3 }, 900, T0, 10)]; // 90 s after take-off
    const { engine, store } = makeEngine(world);
    await engine.pollTile(WORLD);
    expect(store.getDep("cc0001")).toMatchObject({ t: T0 - 90, source: "observed" });

    world.time = T0 + 4 * 3600;
    world.states = [sv("cc0001", "UAL880", interpolate(IAH, LHR, 0.35), 11000, world.time)];
    const f = (await warm(engine)).flights[0]!;
    expect(f).toMatchObject({ depTime: T0 - 90, flags: { depTimeSource: "observed" } });
  });

  it("finds a flight by IATA flight number and keeps tracking it", async () => {
    const world = fakeWorld();
    world.states = [sv("aa9300", "UAL880", interpolate(IAH, LHR, 0.5), 11000)];
    const { engine } = makeEngine(world);
    await engine.pollTile(WORLD);
    const f = await engine.search("ua 880");
    expect(f?.callsign).toBe("UAL880");
    expect(engine.trackedIds()).toContain("aa9300");
    expect(await engine.search("ZZ999")).toBeNull();
  });

  it("restores tracked fixes after an eviction", async () => {
    const world = fakeWorld();
    world.states = [sv("aa9300", "UAL880", interpolate(IAH, LHR, 0.4), 11000)];
    const a = makeEngine(world);
    const snap = await warm(a.engine);
    const saved = JSON.parse(JSON.stringify(a.engine.exportTracked()));

    // A new object shares the SQLite caches (same store here) but starts with empty memory.
    const b = new Engine({
      opensky: new OpenSkyClient("id", "secret", world.fetch, () => world.time * 1000),
      adsbdb: new AdsbdbClient(world.fetch),
      store: a.store,
      fetchFn: world.fetch,
      now: () => world.time * 1000,
    });
    b.importTracked(saved);
    expect(b.getSnapshot()!.flights.map((f) => f.callsign)).toEqual(snap.flights.map((f) => f.callsign));
    expect(b.trackedIds()).toEqual(["aa9300"]);
  });

  it("does not spend more requests than the budget", async () => {
    const world = fakeWorld();
    world.states = Array.from({ length: 100 }, (_, i) => sv(`d${i}`, `ABC${i}`, { lat: 10, lon: i }, 11000));
    const { engine } = makeEngine(world);
    await engine.pollTile(WORLD);
    engine.rebuild();
    const before = world.calls.length;
    await engine.enrich({ requests: 20 });
    expect(world.calls.length - before).toBeLessThanOrEqual(20);
  });
});
