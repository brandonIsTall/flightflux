// adsbdb.com: callsign -> route, icao24 -> aircraft. Free, keyless.

import { globalFetch } from "./http";
import type { Airport } from "../../../shared/types";

export const ADSBDB_API = "https://api.adsbdb.com/v0";

export interface Route {
  callsignIcao: string;
  callsignIata: string | null;
  airline: { name: string; icao: string; iata: string | null } | null;
  origin: Airport;
  dest: Airport;
}

export interface Aircraft {
  type: string | null;
  icaoType: string | null;
  registration: string | null;
  photoUrl: string | null;
  photoThumbUrl: string | null;
}

interface RawAirport {
  iata_code: string | null;
  icao_code: string;
  name: string;
  municipality: string;
  country_name: string;
  latitude: number;
  longitude: number;
}

const toAirport = (a: RawAirport): Airport => ({
  icao: a.icao_code,
  iata: a.iata_code || null,
  name: a.name,
  city: a.municipality,
  country: a.country_name,
  lat: a.latitude,
  lon: a.longitude,
});

export class AdsbdbError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export class AdsbdbClient {
  constructor(private readonly fetchFn: typeof fetch = globalFetch) {}

  /** Accepts ICAO ("BAW117") or IATA ("BA117") callsigns. null = adsbdb doesn't know it. */
  async route(callsign: string): Promise<Route | null> {
    const res = await this.fetchFn(`${ADSBDB_API}/callsign/${encodeURIComponent(callsign)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new AdsbdbError(`route ${callsign}: ${res.status}`, res.status);
    const j = (await res.json()) as { response: { flightroute?: any } | string };
    const fr = typeof j.response === "object" ? j.response.flightroute : undefined;
    if (!fr?.origin || !fr?.destination) return null;
    return {
      callsignIcao: fr.callsign_icao ?? fr.callsign,
      callsignIata: fr.callsign_iata ?? null,
      airline: fr.airline ? { name: fr.airline.name, icao: fr.airline.icao, iata: fr.airline.iata ?? null } : null,
      origin: toAirport(fr.origin),
      dest: toAirport(fr.destination),
    };
  }

  async aircraft(icao24: string): Promise<Aircraft | null> {
    const res = await this.fetchFn(`${ADSBDB_API}/aircraft/${encodeURIComponent(icao24)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new AdsbdbError(`aircraft ${icao24}: ${res.status}`, res.status);
    const j = (await res.json()) as { response: { aircraft?: any } | string };
    const a = typeof j.response === "object" ? j.response.aircraft : undefined;
    if (!a) return null;
    return {
      type: a.manufacturer && a.type ? `${a.manufacturer} ${a.type}` : (a.type ?? null),
      icaoType: a.icao_type ?? null,
      registration: a.registration ?? null,
      photoUrl: a.url_photo ?? null,
      photoThumbUrl: a.url_photo_thumbnail ?? null,
    };
  }
}
