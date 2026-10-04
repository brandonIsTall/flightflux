// The poller's brain. Runs in the Durable Object (and in the Node harness for live testing).
//
// Work is split into small ticks so each invocation stays under the Workers free-plan limit of
// ~50 outbound requests:
//   pollStates()  1 OpenSky call (+ token refresh): positions for every aircraft.
//   enrich()      fills caches a batch at a time: weather, departure tracks, routes.
//   rebuild()     no network: joins positions with caches into the curated snapshot.

import { globalFetch } from "./http";
import type { Airport, Flight, FlightDetail, Snapshot } from "../../../shared/types";
import { AdsbdbClient, type Aircraft } from "./adsbdb";
import { curate, checkPlausible, hysteresisKey, isAirlineCallsign } from "./curate";
import { distanceKm, trackOffsets } from "./geo";
import { OpenSkyClient, type StateVector, type StatesResult } from "./opensky";
import { ROUTE_TTL_S, type Store } from "./store";
import { estimateDeparture, estimateEta, utcDay } from "./timing";
import { fetchTempSeries, tempAt, WEATHER_TTL_S, type LatLonKey } from "./weather";

/** Cruise filter: ignore aircraft that are climbing out, descending in, or slow. */
export const MIN_CANDIDATE_ALT_M = 6000;
export const MIN_CANDIDATE_GS_MS = 150;
/** An observed or tracked departure must start this close to the route's origin to be trusted. */
export const DEP_MATCH_KM = 60;
/** Keep this many OpenSky credits in reserve for position polls; tracks only spend above it. */
export const TRACK_CREDIT_RESERVE = 1500;
export const TRACKS_PER_DAY = 250;
export const TRACKS_PER_TICK = 4;
export const ROUTE_CONCURRENCY = 8;

export interface EnrichBudget {
  /** Outbound requests this tick may make. */
  requests: number;
}

export interface EngineDeps {
  opensky: OpenSkyClient;
  adsbdb: AdsbdbClient;
  store: Store;
  fetchFn?: typeof fetch;
  now?: () => number;
  log?: (msg: string) => void;
}

export interface TickStats {
  routeLookups: number;
  routeHits: number;
  weatherAirports: number;
  tracks: number;
  errors: string[];
}

export class Engine {
  private states: StatesResult | null = null;
  private onGroundPrev = new Set<string>();
  private curatedKeys = new Set<string>();
  private snapshot: Snapshot | null = null;
  private routeQueue = new Map<string, number>(); // callsign -> priority
  private weatherQueue = new Map<string, LatLonKey>(); // icao -> coords
  private trackQueue = new Set<string>(); // icao24
  private trackTried = new Set<string>();
  private tracksToday = { day: "", count: 0 };
  private aircraftCache = new Map<string, Aircraft | null>();
  /** Flights found via search, so detail() can serve them even when they're not curated. */
  private searched = new Map<string, Flight>();
  private adsbdbBackoffUntil = 0;

  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly log: (msg: string) => void;

  constructor(private readonly deps: EngineDeps) {
    this.fetchFn = deps.fetchFn ?? globalFetch;
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? (() => {});
  }

  private nowS = () => Math.floor(this.now() / 1000);

  getSnapshot(): Snapshot | null {
    return this.snapshot;
  }

  hasStates(): boolean {
    return this.states !== null;
  }

  /** Fetch global positions and record any take-offs seen since the last poll. */
  async pollStates(): Promise<StatesResult> {
    const res = await this.deps.opensky.states();
    this.recordDepartures(res);
    this.states = res;
    this.deps.store.prune(this.nowS());
    return res;
  }

  private recordDepartures(res: StatesResult) {
    const onGround = new Set<string>();
    for (const s of res.states) {
      if (s.onGround) {
        onGround.add(s.icao24);
        continue;
      }
      if (s.lat == null || s.lon == null || this.deps.store.getDep(s.icao24)) continue;
      const alt = s.baroAltM ?? s.geoAltM;
      // Was on the ground last poll and airborne now: it took off within one poll interval.
      if (this.onGroundPrev.has(s.icao24)) {
        const t = this.states ? Math.round((this.states.time + res.time) / 2) : res.time;
        this.deps.store.putDep(s.icao24, { t, lat: s.lat, lon: s.lon, source: "observed", at: res.time });
        continue;
      }
      // First seen low and climbing: back out the climb time.
      if (alt != null && alt < 1500 && (s.vRateMs ?? 0) > 2) {
        const t = res.time - Math.round(alt / (s.vRateMs ?? 1));
        this.deps.store.putDep(s.icao24, { t, lat: s.lat, lon: s.lon, source: "observed", at: res.time });
      }
    }
    this.onGroundPrev = onGround;
  }

  /** Spend up to `budget.requests` outbound requests filling caches. */
  async enrich(budget: EnrichBudget): Promise<TickStats> {
    const stats: TickStats = { routeLookups: 0, routeHits: 0, weatherAirports: 0, tracks: 0, errors: [] };
    let left = budget.requests;

    // 1. Weather: one request per 50 airports, so it's the cheapest way to unlock flights.
    if (this.weatherQueue.size > 0 && left > 0) {
      const locs = [...this.weatherQueue.values()].slice(0, 50 * Math.min(2, left));
      try {
        const series = await fetchTempSeries(locs, this.fetchFn, this.now);
        for (const [icao, s] of series) {
          this.deps.store.putWeather(icao, s);
          this.weatherQueue.delete(icao);
        }
        stats.weatherAirports = series.size;
      } catch (e) {
        stats.errors.push(`weather: ${(e as Error).message}`);
      }
      left -= Math.ceil(locs.length / 50);
    }

    // 2. Departure tracks for curated flights still on estimated departure times.
    const day = utcDay(this.nowS());
    if (this.tracksToday.day !== day) this.tracksToday = { day, count: 0 };
    const credits = this.states?.creditsRemaining ?? null;
    const canTrack = () =>
      left > 0 &&
      stats.tracks < TRACKS_PER_TICK &&
      this.tracksToday.count < TRACKS_PER_DAY &&
      (credits == null || credits - stats.tracks * 4 > TRACK_CREDIT_RESERVE);
    for (const icao24 of [...this.trackQueue]) {
      if (!canTrack()) break;
      this.trackQueue.delete(icao24);
      this.trackTried.add(icao24);
      left--;
      stats.tracks++;
      this.tracksToday.count++;
      try {
        const tr = await this.deps.opensky.liveTrack(icao24);
        const first = tr?.path[0];
        if (tr && first && first[1] != null && first[2] != null) {
          const lowStart = first[3] == null || first[3] < 3000;
          if (lowStart) {
            this.deps.store.putDep(icao24, {
              t: first[0],
              lat: first[1],
              lon: first[2],
              source: "track",
              at: this.nowS(),
            });
          }
        }
      } catch (e) {
        stats.errors.push(`track ${icao24}: ${(e as Error).message}`);
      }
    }

    // 3. Routes, fastest aircraft first (long-haul jets cruise fastest), in parallel batches.
    if (left > 0 && this.now() >= this.adsbdbBackoffUntil) {
      const batch = [...this.routeQueue.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, left)
        .map(([cs]) => cs);
      for (let i = 0; i < batch.length; i += ROUTE_CONCURRENCY) {
        const chunk = batch.slice(i, i + ROUTE_CONCURRENCY);
        const results = await Promise.allSettled(chunk.map((cs) => this.deps.adsbdb.route(cs)));
        let throttled = false;
        results.forEach((r, j) => {
          const cs = chunk[j]!;
          stats.routeLookups++;
          if (r.status === "fulfilled") {
            this.deps.store.putRoute(cs, { route: r.value, at: this.nowS() });
            this.routeQueue.delete(cs);
            if (r.value) stats.routeHits++;
          } else {
            const status = (r.reason as { status?: number }).status;
            if (status === 429 || (status != null && status >= 500)) throttled = true;
            stats.errors.push(`route ${cs}: ${(r.reason as Error).message}`);
          }
        });
        if (throttled) {
          this.adsbdbBackoffUntil = this.now() + 5 * 60_000;
          this.log("adsbdb throttled; pausing route lookups for 5 min");
          break;
        }
      }
    }
    return stats;
  }

  /** Join positions with cached routes, weather and departures. No network. */
  rebuild(pollMs = 0): Snapshot | null {
    if (!this.states) return null;
    const { store } = this.deps;
    const nowS = this.nowS();
    const eligible: Flight[] = [];
    let airborne = 0;
    let candidates = 0;
    let routed = 0;
    this.routeQueue.clear();
    this.weatherQueue.clear();

    for (const s of this.states.states) {
      if (s.onGround) continue;
      airborne++;
      if (!this.isCandidate(s)) continue;
      candidates++;
      const entry = store.getRoute(s.callsign);
      if (!entry || nowS - entry.at > ROUTE_TTL_S) {
        this.routeQueue.set(s.callsign, s.velocityMs ?? 0);
        continue;
      }
      if (!entry.route) continue;
      routed++;
      const f = this.buildFlight(s, entry.route, true);
      if (f) eligible.push(f);
    }

    const flights = curate(eligible, this.curatedKeys);
    this.curatedKeys = new Set(flights.map(hysteresisKey));
    for (const f of flights) {
      if (f.flags.depTimeSource === "estimated" && !this.trackTried.has(f.icao24)) this.trackQueue.add(f.icao24);
    }
    for (const k of this.trackQueue) if (!flights.some((f) => f.icao24 === k)) this.trackQueue.delete(k);

    this.snapshot = {
      v: 1,
      generatedAt: nowS,
      statesTime: this.states.time,
      flights,
      meta: { airborne, candidates, routed, creditsRemaining: this.states.creditsRemaining, pollMs },
    };
    return this.snapshot;
  }

  private isCandidate(s: StateVector): boolean {
    const alt = s.baroAltM ?? s.geoAltM ?? 0;
    return (
      s.lat != null &&
      s.lon != null &&
      alt >= MIN_CANDIDATE_ALT_M &&
      (s.velocityMs ?? 0) >= MIN_CANDIDATE_GS_MS &&
      isAirlineCallsign(s.callsign)
    );
  }

  /**
   * Build a Flight from a state vector and route, or null when the route is implausible or weather
   * isn't cached yet (in which case the airports are queued). `requirePlausible` is false for
   * search, where a user-picked short-haul flight should still show.
   */
  private buildFlight(
    s: StateVector,
    route: { origin: Airport; dest: Airport; callsignIata: string | null; airline: Flight["airline"] },
    curatedRules: boolean,
  ): Flight | null {
    const pos = { lat: s.lat!, lon: s.lon! };
    const distKm = distanceKm(route.origin, route.dest);
    const { crossKm, alongKm } = trackOffsets(route.origin, route.dest, pos);
    if (curatedRules && !checkPlausible(distKm, crossKm, alongKm).ok) return null;
    if (!curatedRules && Math.abs(crossKm) > 600) return null;

    const t = this.states?.time ?? this.nowS();
    const gs = s.velocityMs ?? 0;
    const flownKm = Math.min(distKm, Math.max(0, alongKm));
    const eta = estimateEta(t, distKm - flownKm, gs);

    const dep = this.deps.store.getDep(s.icao24);
    const depValid = dep && distanceKm(dep, route.origin) <= DEP_MATCH_KM && dep.t < t;
    const depTime = depValid ? dep.t : estimateDeparture(t, flownKm, gs);
    const depTimeSource = depValid ? dep.source : "estimated";

    const ow = this.weatherFor(route.origin);
    const dw = this.weatherFor(route.dest);
    if (!ow || !dw) return null;
    const depTempC = tempAt(ow, depTime);
    const arrTempC = tempAt(dw, eta);
    if (depTempC == null || arrTempC == null) return null;

    return {
      id: `${s.icao24}-${utcDay(depTime)}`,
      icao24: s.icao24,
      callsign: s.callsign,
      flightNo: route.callsignIata,
      airline: route.airline,
      origin: { ...route.origin, tz: ow.tz, utcOffsetS: ow.utcOffsetS },
      dest: { ...route.dest, tz: dw.tz, utcOffsetS: dw.utcOffsetS },
      pos: {
        lat: pos.lat,
        lon: pos.lon,
        altM: Math.round(s.baroAltM ?? s.geoAltM ?? 0),
        gsMs: Math.round(gs * 10) / 10,
        trackDeg: Math.round((s.trackDeg ?? 0) * 10) / 10,
        vRateMs: Math.round((s.vRateMs ?? 0) * 10) / 10,
        t: s.timePosition ?? t,
      },
      distKm: Math.round(distKm),
      flownKm: Math.round(flownKm),
      depTime,
      eta,
      depTempC,
      arrTempC,
      flags: { depTimeSource },
    };
  }

  /** Cached series for an airport; queues a (re)fetch when missing or older than an hour. */
  private weatherFor(a: Airport) {
    const s = this.deps.store.getWeather(a.icao);
    if (!s || this.nowS() - s.fetchedAt > WEATHER_TTL_S) {
      this.weatherQueue.set(a.icao, { key: a.icao, lat: a.lat, lon: a.lon });
    }
    return s;
  }

  /**
   * Find any airborne flight by flight number ("BA117") or callsign ("BAW117").
   * Spends at most 1 adsbdb call and 1 Open-Meteo call.
   */
  async search(query: string): Promise<Flight | null> {
    const q = query.toUpperCase().replace(/\s+/g, "");
    if (!/^[A-Z0-9]{3,8}$/.test(q) || !this.states) return null;
    const { store } = this.deps;

    let entry = store.getRoute(q);
    if (!entry) {
      entry = { route: await this.deps.adsbdb.route(q), at: this.nowS() };
      store.putRoute(q, entry);
    }
    const icao = entry.route?.callsignIcao ?? q;
    const s = this.states.states.find((x) => x.callsign === icao && !x.onGround && x.lat != null);
    if (!s || !entry.route) return null;
    if (icao !== q) store.putRoute(icao, entry);

    const route = entry.route;
    const missing = [route.origin, route.dest].filter((a) => !store.getWeather(a.icao));
    if (missing.length > 0) {
      const series = await fetchTempSeries(
        missing.map((a) => ({ key: a.icao, lat: a.lat, lon: a.lon })),
        this.fetchFn,
        this.now,
      );
      for (const [k, v] of series) store.putWeather(k, v);
    }
    const f = this.buildFlight(s, route, false);
    if (f) {
      if (this.searched.size > 200) this.searched.clear();
      this.searched.set(f.id, f);
    }
    return f;
  }

  /** Snapshot flight (or search result) plus aircraft type and photo. */
  async detail(id: string): Promise<FlightDetail | null> {
    const f =
      this.snapshot?.flights.find((x) => x.id === id || x.icao24 === id) ??
      this.searched.get(id) ??
      [...this.searched.values()].find((x) => x.icao24 === id);
    if (!f) return null;
    if (!this.aircraftCache.has(f.icao24)) {
      try {
        this.aircraftCache.set(f.icao24, await this.deps.adsbdb.aircraft(f.icao24));
      } catch {
        return { ...f, aircraft: null }; // transient: don't cache the miss
      }
    }
    return { ...f, aircraft: this.aircraftCache.get(f.icao24) ?? null };
  }

  queueSizes() {
    return { routes: this.routeQueue.size, weather: this.weatherQueue.size, tracks: this.trackQueue.size };
  }
}
