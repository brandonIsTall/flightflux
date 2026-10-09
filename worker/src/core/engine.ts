// The poller's brain. Runs in the Durable Object (and in the Node harness for live testing).
//
// Each Durable Object run must stay under the Workers free plan's 10 ms CPU and ~50 outbound
// requests, so work is split into small steps, at most one OpenSky call per run:
//   refreshTracked()  positions for the flights on the globe, one small icao24-filtered call.
//   pollTile()        discovery: one region box of the world per call, swept over ~75 min.
//   enrich()          fills caches a batch at a time: Open-Meteo weather, adsbdb routes.
//   rebuild()         no network: projects each flight along its route to "now" and curates.
//
// Long-haul flights move predictably, so between fixes each plane is advanced along its
// great-circle route at its last ground speed (the client does the same every frame).

import type { Airport, Flight, FlightDetail, Snapshot } from "../../../shared/types";
import { AdsbdbClient, type Aircraft, type Route } from "./adsbdb";
import { curate, checkPlausible, hysteresisKey, isAirlineCallsign, MIN_ROUTE_KM } from "./curate";
import { distanceKm, interpolate, trackOffsets } from "./geo";
import { globalFetch } from "./http";
import type { IngestBody } from "./ingest";
import { OpenSkyClient, parseState, toRaw, type Bbox, type RawState, type StateVector, type StatesResult } from "./opensky";
import { ROUTE_TTL_S, type RouteEntry, type Store } from "./store";
import { SPLIT_AT, splitTile } from "./tiles";
import { estimateDeparture, estimateEta, utcDay } from "./timing";
import { fetchTempSeries, tempAt, WEATHER_TTL_S, type LatLonKey, type TempSeries } from "./weather";

/** Cruise filter: ignore aircraft that are climbing out, descending in, or slow. */
export const MIN_CANDIDATE_ALT_M = 6000;
export const MIN_CANDIDATE_GS_MS = 150;
/** A departure observed in the climb must start this close to the route's origin to be trusted. */
export const DEP_MATCH_KM = 60;
/** An observed departure further than this from the distance-based estimate is a previous leg. */
export const DEP_AGREE_S = 90 * 60;
/** Forget an untracked aircraft not seen for this long (a little over one sweep). */
export const KNOWN_TTL_S = 100 * 60;
/** Searched flights stay tracked this long even if they aren't curated. */
export const PIN_TTL_S = 3 * 3600;
export const ROUTE_CONCURRENCY = 8;
/** OpenSky caps the URL; 150 icao24 params is ~2.1 KB. */
export const MAX_TRACKED = 160;
/** Known aircraft saved across evictions, newest fixes first: ~130 bytes each as compact rows. */
export const MAX_SAVED_KNOWN = 2500;
const KNOWN_BLOB = "known";
/** Durable Object SQLite rows hold at most 2 MB; stay well clear. */
export const MAX_DOC_BYTES = 1_500_000;
const CURATED_BLOB = "curated";

/** The known-set document (see saveKnown). */
interface SavedKnown {
  credits: number | null;
  /** When positions last arrived (ms). */
  at: number;
  /** Compact OpenSky rows with the fix time appended (index 14). */
  rows: RawState[];
  /** Cached route of each saved callsign that had one. */
  routes?: Record<string, RouteEntry>;
  /** Every airport those routes use, and the cached weather of those that had it. */
  airports?: string[];
  weather?: Record<string, TempSeries>;
}

/** A flight number or callsign ("ba 117" -> "BA117"), or null if it can't be one. */
export function normalizeQuery(query: string): string | null {
  const q = query.toUpperCase().replace(/\s+/g, "");
  return /^[A-Z0-9]{3,8}$/.test(q) ? q : null;
}

/** Last fix for an aircraft. Only cruise-phase airline flights are kept. */
export interface Known {
  s: StateVector;
  /** Unix seconds of the fix (timePosition, else the response time). */
  t: number;
}

/** A projected, temperature-tagged aircraft: enough to curate on, cheap to build. */
interface Candidate {
  k: Known;
  route: Route;
  ow: TempSeries;
  dw: TempSeries;
  distKm: number;
  flownKm: number;
  eta: number;
  depTime: number;
  depObserved: boolean;
  depTempC: number;
  arrTempC: number;
  ageS: number;
  icao24: string;
  callsign: string;
  pos: { lon: number };
}

export interface EnrichBudget {
  /** Outbound requests this run may make. */
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

export interface StepStats {
  routeLookups: number;
  routeHits: number;
  weatherAirports: number;
  errors: string[];
}

export class Engine {
  private known = new Map<string, Known>();
  private curatedKeys = new Set<string>();
  private snapshot: Snapshot | null = null;
  private routeQueue = new Map<string, number>(); // callsign -> priority
  private weatherQueue = new Map<string, LatLonKey>(); // icao -> coords
  private aircraftCache = new Map<string, Aircraft | null>();
  /** icao24 -> pinned-until (unix s), for searched flights. */
  private pinned = new Map<string, number>();
  private searched = new Map<string, Flight>();
  /**
   * callsign -> `at` of a cached route that can never be curated (unknown, or shorter than
   * MIN_ROUTE_KM). Keyed to the entry's timestamp so a refreshed or search-cached route is
   * re-evaluated. Most traffic is short-haul, so skipping these keeps rebuild() cheap.
   */
  private neverCurated = new Map<string, number>();
  private adsbdbBackoffUntil = 0;
  private creditsRemaining: number | null = null;
  private lastFixAt = 0;

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

  /** Serve a stored snapshot without restoring anything else: what a cold read-only request needs. */
  adoptSnapshot(snap: Snapshot) {
    this.snapshot = snap;
    this.creditsRemaining = snap.meta.creditsRemaining;
  }

  knownCount(): number {
    return this.known.size;
  }

  /**
   * Save what an eviction would lose, in one store row: the known aircraft (compact rows, newest
   * first, minus the ones whose cached route can never be curated), the credit count, and the
   * cached route and weather each saved aircraft needs, so a cold restore reads this row instead
   * of one row per aircraft. Call after anything that changes them. Returns the document's size.
   */
  saveKnown(): number {
    const { store } = this.deps;
    const saved = [...this.known.values()]
      .filter((k) => {
        const nc = this.neverCurated.get(k.s.callsign);
        return nc === undefined || nc !== store.getRoute(k.s.callsign)?.at;
      })
      .sort((a, b) => b.t - a.t)
      .slice(0, MAX_SAVED_KNOWN);
    const routes: Record<string, RouteEntry> = {};
    const weather: Record<string, TempSeries> = {};
    const airports = new Set<string>();
    for (const k of saved) {
      const e = store.getRoute(k.s.callsign);
      if (!e) continue;
      routes[k.s.callsign] = e;
      for (const a of e.route ? [e.route.origin.icao, e.route.dest.icao] : []) {
        if (airports.has(a)) continue;
        airports.add(a);
        const w = store.getWeather(a);
        if (w) weather[a] = w;
      }
    }
    const doc: SavedKnown = {
      credits: this.creditsRemaining,
      at: this.lastFixAt,
      rows: saved.map((k) => [...toRaw(k.s), k.t]),
      routes,
      airports: [...airports],
      weather,
    };
    // A row holds at most 2 MB. Shed the optional parts first: without them a cold restore just
    // looks the routes and weather up one row each, as it would for new aircraft.
    let json = JSON.stringify(doc);
    if (json.length > MAX_DOC_BYTES) json = JSON.stringify({ ...doc, weather: {}, airports: [] });
    if (json.length > MAX_DOC_BYTES) json = JSON.stringify({ ...doc, weather: {}, airports: [], routes: {} });
    if (json.length > MAX_DOC_BYTES) json = JSON.stringify({ ...doc, weather: {}, airports: [], routes: {}, rows: doc.rows.slice(0, 1000) });
    store.putBlob(KNOWN_BLOB, json);
    return json.length;
  }

  /** Reload saved aircraft, their routes and weather, and curation keys; then rebuild. */
  restore() {
    const { store } = this.deps;
    const raw = store.getBlob(KNOWN_BLOB);
    if (raw) {
      const saved = JSON.parse(raw) as SavedKnown;
      this.creditsRemaining = saved.credits;
      this.lastFixAt = saved.at;
      for (const r of saved.rows) {
        const s = parseState(r);
        if (!this.known.has(s.icao24)) this.known.set(s.icao24, { s, t: r[14] as number });
        // Absent from the document means no route was cached when it was saved.
        store.primeRoute(s.callsign, saved.routes?.[s.callsign]);
      }
      for (const a of saved.airports ?? []) store.primeWeather(a, saved.weather?.[a]);
    }
    const curated = store.getBlob(CURATED_BLOB);
    if (curated) for (const k of JSON.parse(curated) as string[]) this.curatedKeys.add(k);
    this.rebuild();
  }

  /** When route lookups may resume after adsbdb throttled us (ms), or 0. */
  routesPausedUntil(): number {
    return this.adsbdbBackoffUntil;
  }

  /** icao24s whose positions refreshTracked() updates: the curated set plus pinned searches. */
  trackedIds(): string[] {
    const nowS = this.nowS();
    for (const [k, until] of this.pinned) if (until < nowS) this.pinned.delete(k);
    const ids = new Set([...(this.snapshot?.flights.map((f) => f.icao24) ?? []), ...this.pinned.keys()]);
    return [...ids].slice(0, MAX_TRACKED);
  }

  /** Fresh positions for the flights on the globe. Returns how many came back. */
  async refreshTracked(): Promise<number> {
    const ids = this.trackedIds();
    if (ids.length === 0) return 0;
    const res = await this.deps.opensky.states({ icao24: ids });
    return this.applyStates(res).aircraft;
  }

  /**
   * Discovery: fetch one region box. Returns the boxes to use in its place next sweep: itself, or
   * two halves when it came back too full to parse comfortably within the CPU limit.
   */
  async pollTile(tile: Bbox): Promise<{ aircraft: number; next: Bbox[] }> {
    return this.applyStates(await this.deps.opensky.states({ bbox: tile }), tile);
  }

  /**
   * Take in a states response, from our own call or an external poller. `total` is the size of
   * the unfiltered response when the poller pre-filtered the rows. Returns how many aircraft were
   * in the response and, for a region box, the boxes to use in its place next sweep.
   */
  applyStates(res: StatesResult, tile?: Bbox, total = res.states.length): { aircraft: number; next: Bbox[] } {
    this.creditsRemaining = res.creditsRemaining;
    this.lastFixAt = this.now();
    for (const s of res.states) this.merge(s, res.time);
    if (!tile) return { aircraft: total, next: [] };
    this.expireKnown();
    this.deps.store.prune(this.nowS());
    const next = total > SPLIT_AT ? splitTile(tile) : [tile];
    if (next.length > 1) this.log(`tile ${tile.join(",")} had ${total} aircraft; splitting`);
    return { aircraft: total, next };
  }

  /** Compact rows from an external poller (see core/ingest.ts). */
  ingest(body: IngestBody): { aircraft: number; next: Bbox[] } {
    const res: StatesResult = { time: body.time, states: body.states.map(parseState), creditsRemaining: body.creditsRemaining };
    return this.applyStates(res, body.tile, body.total);
  }

  /** When positions last arrived from OpenSky, by any path (ms). 0 before the first. */
  lastPositionsAt(): number {
    return this.lastFixAt;
  }

  private merge(s: StateVector, responseTime: number) {
    if (s.onGround || s.lat == null || s.lon == null) return;
    this.recordClimbDeparture(s, responseTime);
    if (!this.isCandidate(s)) return;
    this.known.set(s.icao24, { s, t: s.timePosition ?? responseTime });
  }

  /** An airliner caught low and climbing just took off: back out the climb time. */
  private recordClimbDeparture(s: StateVector, t: number) {
    const alt = s.baroAltM ?? s.geoAltM;
    const vr = s.vRateMs ?? 0;
    if (alt == null || alt >= 1500 || vr <= 2 || !isAirlineCallsign(s.callsign)) return;
    const depT = t - Math.round(alt / vr);
    const prev = this.deps.store.getDep(s.icao24);
    // Same climb seen twice: keep the first. Climbing again later: a new leg, replace it.
    if (prev && depT - prev.t < 30 * 60) return;
    this.deps.store.putDep(s.icao24, {
      t: depT,
      lat: s.lat!,
      lon: s.lon!,
      source: "observed",
      at: t,
    });
  }

  private expireKnown() {
    const nowS = this.nowS();
    const tracked = new Set(this.trackedIds());
    for (const [k, v] of this.known) if (nowS - v.t > KNOWN_TTL_S && !tracked.has(k)) this.known.delete(k);
  }

  /** Spend up to `budget.requests` outbound requests filling caches. */
  async enrich(budget: EnrichBudget): Promise<StepStats> {
    const stats: StepStats = { routeLookups: 0, routeHits: 0, weatherAirports: 0, errors: [] };
    let left = budget.requests;

    // 1. Weather: one request per 50 airports, so it's the cheapest way to unlock flights.
    if (this.weatherQueue.size > 0 && left > 0) {
      const locs = [...this.weatherQueue.values()].slice(0, 50 * Math.min(2, left));
      left -= Math.ceil(locs.length / 50);
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
    }

    // 2. Routes, fastest aircraft first (long-haul jets cruise fastest), in parallel batches.
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

  /** Join known aircraft with cached routes, weather and departures. No network. */
  rebuild(stepMs = 0): Snapshot {
    const { store } = this.deps;
    const nowS = this.nowS();
    const eligible: Candidate[] = [];
    let routed = 0;
    this.routeQueue.clear();
    this.weatherQueue.clear();

    for (const k of this.known.values()) {
      const cs = k.s.callsign;
      const entry = store.getRoute(cs);
      if (!entry || nowS - entry.at > ROUTE_TTL_S) {
        this.routeQueue.set(cs, k.s.velocityMs ?? 0);
        continue;
      }
      if (this.neverCurated.get(cs) === entry.at) continue;
      if (!entry.route || distanceKm(entry.route.origin, entry.route.dest) < MIN_ROUTE_KM) {
        this.neverCurated.set(cs, entry.at);
        continue;
      }
      routed++;
      const c = this.evaluate(k, entry.route, true);
      if (c) eligible.push(c);
    }

    if (this.neverCurated.size > 50_000) this.neverCurated.clear(); // routes expire after 24 h
    // Score cheap candidates; only the ~150 winners become full Flight objects. Building one per
    // eligible aircraft every run cost more in garbage collection than everything else combined.
    const chosen = curate(eligible, this.curatedKeys);
    const keys = chosen.map(hysteresisKey);
    if (keys.length !== this.curatedKeys.size || keys.some((k) => !this.curatedKeys.has(k))) {
      this.deps.store.putBlob(CURATED_BLOB, JSON.stringify(keys)); // hysteresis survives an eviction
    }
    this.curatedKeys = new Set(keys);
    this.snapshot = {
      v: 1,
      generatedAt: nowS,
      flights: chosen.map((c) => this.materialize(c)),
      meta: { known: this.known.size, routed, creditsRemaining: this.creditsRemaining, stepMs },
    };
    return this.snapshot;
  }

  private isCandidate(s: StateVector): boolean {
    const alt = s.baroAltM ?? s.geoAltM ?? 0;
    return alt >= MIN_CANDIDATE_ALT_M && (s.velocityMs ?? 0) >= MIN_CANDIDATE_GS_MS && isAirlineCallsign(s.callsign);
  }

  /**
   * Project a known aircraft along its route to now and look up its temperatures. null when the
   * route is implausible or weather isn't cached yet (then its airports are queued). Curated rules
   * are relaxed for search, where a user-picked short-haul flight should still show.
   */
  private evaluate(k: Known, route: Route, curatedRules: boolean): Candidate | null {
    const { s } = k;
    const nowS = this.nowS();
    const distKm = distanceKm(route.origin, route.dest);
    const { crossKm, alongKm } = trackOffsets(route.origin, route.dest, { lat: s.lat!, lon: s.lon! });
    const gs = s.velocityMs ?? 0;
    const ageS = Math.max(0, nowS - k.t);
    const projAlong = alongKm + (gs * ageS) / 1000;
    if (curatedRules && !checkPlausible(distKm, crossKm, projAlong).ok) return null;
    if (!curatedRules && (Math.abs(crossKm) > 600 || projAlong > distKm)) return null;

    const flownKm = Math.min(distKm, Math.max(0, projAlong));
    const eta = estimateEta(nowS, distKm - flownKm, gs);
    const estDep = estimateDeparture(k.t, Math.max(0, alongKm), gs);
    const dep = this.deps.store.getDep(s.icao24);
    // Trust an observed take-off only if it left this origin and roughly agrees with the distance
    // flown; otherwise it belongs to an earlier leg from the same airport.
    const depObserved =
      !!dep &&
      dep.t < k.t &&
      distanceKm(dep, route.origin) <= DEP_MATCH_KM &&
      Math.abs(dep.t - estDep) <= DEP_AGREE_S;
    const depTime = depObserved ? dep.t : estDep;

    const ow = this.weatherFor(route.origin);
    const dw = this.weatherFor(route.dest);
    if (!ow || !dw) return null;
    const depTempC = tempAt(ow, depTime);
    const arrTempC = tempAt(dw, eta);
    if (depTempC == null || arrTempC == null) return null;
    return {
      k, route, ow, dw, distKm, flownKm, eta, depTime, depObserved, depTempC, arrTempC, ageS,
      icao24: s.icao24,
      callsign: s.callsign,
      pos: { lon: s.lon! },
    };
  }

  private materialize(c: Candidate): Flight {
    const { k, route, ow, dw } = c;
    const { s } = k;
    // Always the great-circle projection, never the raw fix: mixing the two made every flight
    // jump by its cross-track offset a minute after each refresh. Clients draw along the route.
    const pos = interpolate(route.origin, route.dest, c.flownKm / c.distKm);
    return {
      id: `${s.icao24}-${utcDay(c.depTime)}`,
      icao24: s.icao24,
      callsign: s.callsign,
      flightNo: route.callsignIata,
      airline: route.airline,
      origin: { ...route.origin, tz: ow.tz, utcOffsetS: ow.utcOffsetS },
      dest: { ...route.dest, tz: dw.tz, utcOffsetS: dw.utcOffsetS },
      pos: {
        lat: Math.round(pos.lat * 1e4) / 1e4,
        lon: Math.round(pos.lon * 1e4) / 1e4,
        altM: Math.round(s.baroAltM ?? s.geoAltM ?? 0),
        gsMs: Math.round((s.velocityMs ?? 0) * 10) / 10,
        trackDeg: Math.round((s.trackDeg ?? 0) * 10) / 10,
        vRateMs: Math.round((s.vRateMs ?? 0) * 10) / 10,
        t: this.nowS(),
        fixT: k.t,
      },
      distKm: Math.round(c.distKm),
      flownKm: Math.round(c.flownKm),
      depTime: c.depTime,
      eta: c.eta,
      depTempC: c.depTempC,
      arrTempC: c.arrTempC,
      flags: { depTimeSource: c.depObserved ? "observed" : "estimated" },
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
   * Find a known airborne flight by flight number ("BA117") or callsign ("BAW117") and pin it so
   * its position keeps refreshing. Spends at most 1 adsbdb call and 1 Open-Meteo call.
   */
  async search(query: string): Promise<Flight | null> {
    const q = normalizeQuery(query);
    if (!q) return null;
    const { store } = this.deps;

    let entry = store.getRoute(q);
    if (!entry) {
      entry = { route: await this.deps.adsbdb.route(q), at: this.nowS() };
      store.putRoute(q, entry);
    }
    const icao = entry.route?.callsignIcao ?? q;
    const k = [...this.known.values()].find((x) => x.s.callsign === icao);
    if (!k || !entry.route) return null;
    if (icao !== q) store.putRoute(icao, entry);

    const route = entry.route;
    const missing = [route.origin, route.dest].filter((a) => !store.getWeather(a.icao));
    if (missing.length > 0) {
      const series = await fetchTempSeries(
        missing.map((a) => ({ key: a.icao, lat: a.lat, lon: a.lon })),
        this.fetchFn,
        this.now,
      );
      for (const [key, v] of series) store.putWeather(key, v);
    }
    const c = this.evaluate(k, route, false);
    const f = c ? this.materialize(c) : null;
    if (f) {
      this.pinned.set(f.icao24, this.nowS() + PIN_TTL_S);
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
    return { routes: this.routeQueue.size, weather: this.weatherQueue.size };
  }
}
