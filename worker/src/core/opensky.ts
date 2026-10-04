// OpenSky Network REST client: OAuth2 client-credentials token + state vectors + live tracks.

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

export interface StatesResult {
  time: number;
  states: StateVector[];
  creditsRemaining: number | null;
}

export interface LiveTrack {
  icao24: string;
  callsign: string | null;
  startTime: number;
  endTime: number;
  /** [time, lat, lon, baroAltM, trueTrack, onGround] */
  path: [number, number | null, number | null, number | null, number | null, boolean][];
}

type Raw = (string | number | boolean | null | number[])[];

export function parseState(r: Raw): StateVector {
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
      throw new OpenSkyError(`token request failed: ${res.status} ${detail}`, res.status);
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

  async states(): Promise<StatesResult> {
    const res = await this.get("/states/all");
    if (!res.ok) throw new OpenSkyError(`states failed: ${res.status}`, res.status);
    const remaining = res.headers.get("x-rate-limit-remaining");
    const j = (await res.json()) as { time: number; states: Raw[] | null };
    return {
      time: j.time,
      states: (j.states ?? []).map(parseState),
      creditsRemaining: remaining === null ? null : Number(remaining),
    };
  }

  /** Live track for an airborne aircraft. Costs ~4 credits; returns null when OpenSky has none. */
  async liveTrack(icao24: string): Promise<LiveTrack | null> {
    const res = await this.get(`/tracks/all?icao24=${encodeURIComponent(icao24)}&time=0`);
    if (res.status === 404) return null;
    if (!res.ok) throw new OpenSkyError(`track failed: ${res.status}`, res.status);
    const j = (await res.json()) as LiveTrack | null;
    return j && typeof j.startTime === "number" ? j : null;
  }
}
