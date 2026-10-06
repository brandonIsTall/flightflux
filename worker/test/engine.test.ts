import { describe, expect, it } from "vitest";
import { AdsbdbClient } from "../src/core/adsbdb";
import { Engine } from "../src/core/engine";
import { prefilter } from "../src/core/ingest";
import { distanceKm, interpolate } from "../src/core/geo";
import { OpenSkyClient, type Bbox } from "../src/core/opensky";
import { MemoryStore } from "../src/core/store";
import { SPLIT_AT } from "../src/core/tiles";
import { SqlStore } from "../src/sql-store";
import { fakeSql } from "./fake-sql";

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

  it("re-evaluates a callsign once its unknown route is replaced by a search", async () => {
    const world = fakeWorld();
    // Discovery sees the flight under a callsign adsbdb doesn't know...
    world.states = [sv("aa9300", "DAL77", interpolate(IAH, LHR, 0.4), 11000)];
    const { engine, store } = makeEngine(world);
    expect((await warm(engine)).flights).toHaveLength(0);
    expect(store.getRoute("DAL77")?.route).toBeNull();

    // ...then a better source caches the real route under that callsign.
    const real = store.getRoute("UAL880")?.route ?? (await new AdsbdbClient(world.fetch).route("UAL880"));
    store.putRoute("DAL77", { route: real, at: T0 + 1 });
    engine.rebuild();
    await engine.enrich({ requests: 40 }); // weather
    expect(engine.rebuild().flights.map((f) => f.callsign)).toEqual(["DAL77"]);
  });

  it("never jumps between a raw fix and its route projection", async () => {
    const world = fakeWorld();
    const offTrack = { ...interpolate(IAH, LHR, 0.4), lat: interpolate(IAH, LHR, 0.4).lat + 1.5 }; // ~170 km off
    world.states = [sv("aa9300", "UAL880", offTrack, 11000)];
    const { engine } = makeEngine(world);
    const fresh = (await warm(engine)).flights[0]!;
    world.time = T0 + 90;
    const later = engine.rebuild().flights[0]!;
    expect(distanceKm(fresh.pos, later.pos)).toBeLessThan(30); // 250 m/s x 90 s = 22 km along track
  });

  it("does not reuse a morning departure for an evening leg from the same airport", async () => {
    const world = fakeWorld();
    const { engine, store } = makeEngine(world);
    world.states = [sv("cc0001", "UAL880", { lat: 30.0, lon: -95.3 }, 900, T0, 10)]; // climb-out at ~T0
    await engine.pollTile(WORLD);
    expect(store.getDep("cc0001")?.t).toBe(T0 - 90);

    // 13 h later the same aircraft is 40% along IAH->LHR: only ~3 h in the air, so the
    // morning take-off can't be this leg's departure.
    world.time = T0 + 13 * 3600;
    world.states = [sv("cc0001", "UAL880", interpolate(IAH, LHR, 0.4), 11000, world.time)];
    const f = (await warm(engine)).flights[0]!;
    expect(f.flags.depTimeSource).toBe("estimated");
    expect(f.depTime).toBeGreaterThan(T0 + 8 * 3600); // ~T0 + 10 h, nowhere near the 06:00 take-off

    // Caught climbing again: the new leg's take-off replaces the old one.
    world.states = [sv("cc0001", "UAL880", { lat: 30.0, lon: -95.3 }, 900, world.time, 10)];
    await engine.pollTile(WORLD);
    expect(store.getDep("cc0001")?.t).toBe(world.time - 90);
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

  it("restores the known set, credits and curation after an eviction from the store alone", async () => {
    const world = fakeWorld();
    world.states = [sv("aa9300", "UAL880", interpolate(IAH, LHR, 0.4), 11000), sv("cccccc", "DLH400", IAH, 11000)];
    const a = makeEngine(world);
    const snap = await warm(a.engine);
    a.engine.saveKnown();
    const blob = JSON.parse(a.store.blobs.get("known")!) as { credits: number; rows: unknown[][] };
    expect(blob.credits).toBe(3000);
    // DLH400's route is unknown (404) and so can never be curated: not worth saving.
    expect(blob.rows.map((r) => r[1])).toEqual(["UAL880"]);
    expect(a.store.blobs.get("curated")).toBe(JSON.stringify(["aa9300:UAL880"]));

    // A new object shares the SQLite caches (same store here) but starts with empty memory.
    const b = new Engine({
      opensky: new OpenSkyClient("id", "secret", world.fetch, () => world.time * 1000),
      adsbdb: new AdsbdbClient(world.fetch),
      store: a.store,
      fetchFn: world.fetch,
      now: () => world.time * 1000,
    });
    b.restore();
    expect(b.getSnapshot()!.flights.map((f) => f.callsign)).toEqual(snap.flights.map((f) => f.callsign));
    expect(b.getSnapshot()!.meta.creditsRemaining).toBe(3000);
    expect(b.trackedIds()).toEqual(["aa9300"]);
    expect(b.knownCount()).toBe(1);
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

  it("ingests pre-filtered rows from an external poller exactly like its own call", async () => {
    const world = fakeWorld();
    const rows = [sv("aa9300", "UAL880", interpolate(IAH, LHR, 0.4), 11000), sv("bbbbbb", "N1", IAH, 11000)];
    const { engine } = makeEngine(world);
    const before = world.calls.length;
    const r = engine.ingest({ time: T0, creditsRemaining: 2500, states: prefilter(rows), total: rows.length, tile: WORLD });
    expect(r).toEqual({ aircraft: 2, next: [WORLD] });
    expect(engine.lastPositionsAt()).toBe(T0 * 1000);
    engine.rebuild();
    await engine.enrich({ requests: 40 });
    engine.rebuild();
    await engine.enrich({ requests: 40 });
    const snap = engine.rebuild();
    expect(snap.flights.map((f) => f.callsign)).toEqual(["UAL880"]);
    expect(snap.meta.creditsRemaining).toBe(2500);
    // The engine itself never called OpenSky.
    expect(world.calls.slice(before).some((u) => u.includes("opensky"))).toBe(false);
  });

  it("splits an ingested box by the unfiltered count, not the rows kept", () => {
    const world = fakeWorld();
    const { engine } = makeEngine(world);
    const r = engine.ingest({ time: T0, creditsRemaining: null, states: [], total: SPLIT_AT + 1, tile: [0, 0, 40, 40] });
    expect(r.next).toHaveLength(2);
  });

  it("restores from SQLite after a cold wake in a fixed few rows, whatever the cache size", async () => {
    const world = fakeWorld();
    // One long-haul flight among 300 aircraft whose routes are unknown (cached as misses).
    world.states = [
      sv("aa9300", "UAL880", interpolate(IAH, LHR, 0.4), 11000),
      ...Array.from({ length: 300 }, (_, i) => sv(`d${i}`, `ABC${i}`, { lat: 10, lon: i / 2 }, 11000)),
    ];
    const f = fakeSql();
    const mk = (store: SqlStore) =>
      new Engine({
        opensky: new OpenSkyClient("id", "secret", world.fetch, () => world.time * 1000),
        adsbdb: new AdsbdbClient(world.fetch),
        store,
        fetchFn: world.fetch,
        now: () => world.time * 1000,
      });
    const a = mk(new SqlStore(f.sql));
    await a.pollTile(WORLD);
    a.rebuild();
    await a.enrich({ requests: 400 });
    a.rebuild();
    await a.enrich({ requests: 40 });
    expect(a.rebuild().flights.map((x) => x.callsign)).toEqual(["UAL880"]);
    expect((f.db.prepare("SELECT COUNT(*) AS n FROM route_cache").get() as { n: number }).n).toBeGreaterThan(300);
    a.saveKnown();

    const store = new SqlStore(f.sql); // the next wake
    const b = mk(store);
    b.restore();
    expect(b.getSnapshot()!.flights.map((x) => x.callsign)).toEqual(["UAL880"]);
    // The known-set document carries the route and weather it needs; plus the curation keys.
    expect(store.rowsRead).toBe(2);
  });
});
