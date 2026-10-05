// OpenSky Network REST client: OAuth2 client-credentials token + state vectors.

import { globalFetch } from "./http";
export const OPENSKY_TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
export const OPENSKY_API = "https://opensky-network.org/api";

export interface StateVector {
  icao24: string;
  callsign: string;
  originCountry: string;
  timePosition: number | null;
  lastContact: number;
  lon: number | null;
  lat: number | null;
  baroAltM: number | null;
  onGround: boolean;
  velocityMs: number | null;
  trackDeg: number | null;
  vRateMs: number | null;
  geoAltM: number | null;
}

/** [lamin, lomin, lamax, lomax] in degrees. */
export type Bbox = [number, number, number, number];

export type StatesFilter = { bbox: Bbox } | { icao24: string[] };

export interface StatesResult {
  time: number;
  states: StateVector[];
  creditsRemaining: number | null;
}

export interface RawStatesResult {
  time: number;
  rows: RawState[];
  creditsRemaining: number | null;
}

/** One compact OpenSky row (see the states API docs for field order). */
export type RawState = (string | number | boolean | null | number[])[];

export function parseState(r: RawState): StateVector {
  return {
    icao24: r[0] as string,
    callsign: ((r[1] as string | null) ?? "").trim(),
    originCountry: r[2] as string,
    timePosition: r[3] as number | null,
    lastContact: r[4] as number,
    lon: r[5] as number | null,
    lat: r[6] as number | null,
    baroAltM: r[7] as number | null,
    onGround: r[8] as boolean,
    velocityMs: r[9] as number | null,
    trackDeg: r[10] as number | null,
    vRateMs: r[11] as number | null,
    geoAltM: r[13] as number | null,
  };
}

/** Inverse of parseState: the 14 fields the engine uses, in OpenSky's order. */
export function toRaw(s: StateVector): RawState {
  return [
    s.icao24, s.callsign, s.originCountry, s.timePosition, s.lastContact, s.lon, s.lat, s.baroAltM,
    s.onGround, s.velocityMs, s.trackDeg, s.vRateMs, null, s.geoAltM,
  ];
}

export class OpenSkyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export class OpenSkyClient {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchFn: typeof fetch = globalFetch,
    private readonly now: () => number = Date.now,
  ) {}

  private async getToken(): Promise<string> {
    // Refresh a minute early so a token never expires mid-request.
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value;
    const res = await this.fetchFn(OPENSKY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      // cf-ray names the Cloudflare data centre the answer came through: useful when OpenSky's
      // own Cloudflare front returns 52x for some paths and not others.
      const ray = res.headers.get("cf-ray") ?? "";
      throw new OpenSkyError(`token request failed: ${res.status} ${detail} ${ray}`.trim(), res.status);
    }
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, expiresAt: this.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  private async get(path: string): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.fetchFn(`${OPENSKY_API}${path}`, {
        headers: { Authorization: `Bearer ${await this.getToken()}` },
      });
      if (res.status === 401 && attempt === 0) {
        this.token = null; // token revoked or clock skew: fetch a fresh one and retry once
        continue;
      }
      return res;
    }
    throw new OpenSkyError("unreachable", 0);
  }

  /**
   * State vectors, filtered by a bounding box or a list of aircraft. Measured costs: a box of
   * <= 400 sq deg is 3 credits, anything larger or an icao24 list is 4. Always filter: the
   * unfiltered worldwide response (~800 KB) takes longer to parse than the free plan's 10 ms.
   */
  async states(filter: StatesFilter): Promise<StatesResult> {
    const r = await this.statesRaw(filter);
    return { time: r.time, states: r.rows.map(parseState), creditsRemaining: r.creditsRemaining };
  }

  /** Same call, rows left compact: what an external poller forwards to the Worker. */
  async statesRaw(filter: StatesFilter): Promise<RawStatesResult> {
    const q =
      "bbox" in filter
        ? `lamin=${filter.bbox[0]}&lomin=${filter.bbox[1]}&lamax=${filter.bbox[2]}&lomax=${filter.bbox[3]}`
        : filter.icao24.map((i) => `icao24=${encodeURIComponent(i)}`).join("&");
    const res = await this.get(`/states/all?${q}`);
    if (!res.ok) throw new OpenSkyError(`states failed: ${res.status}`, res.status);
    const remaining = res.headers.get("x-rate-limit-remaining");
    const j = (await res.json()) as { time: number; states: RawState[] | null };
    return { time: j.time, rows: j.states ?? [], creditsRemaining: remaining === null ? null : Number(remaining) };
  }
}
