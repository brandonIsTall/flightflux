// Wire format shared by the Worker API and the web client.

export interface Airport {
  icao: string;
  iata: string | null;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  /** IANA zone from Open-Meteo, once weather has been fetched for this airport. */
  tz?: string;
  utcOffsetS?: number;
}

export interface Position {
  lat: number;
  lon: number;
  altM: number;
  gsMs: number;
  trackDeg: number;
  vRateMs: number;
  /** Unix seconds of the position fix. */
  t: number;
}

export type DepTimeSource = "observed" | "track" | "estimated";

export interface Flight {
  /** icao24 + departure day, stable for the life of one flight. */
  id: string;
  icao24: string;
  callsign: string;
  flightNo: string | null;
  airline: { name: string; icao: string; iata: string | null } | null;
  origin: Airport;
  dest: Airport;
  pos: Position;
  distKm: number;
  flownKm: number;
  depTime: number;
  eta: number;
  depTempC: number;
  arrTempC: number;
  flags: { depTimeSource: DepTimeSource };
}

export interface Snapshot {
  v: 1;
  generatedAt: number;
  /** OpenSky `time` of the state vectors the positions came from. */
  statesTime: number;
  flights: Flight[];
  meta: {
    airborne: number;
    candidates: number;
    routed: number;
    creditsRemaining: number | null;
    pollMs: number;
  };
}

export interface FlightDetail extends Flight {
  aircraft: {
    type: string | null;
    icaoType: string | null;
    registration: string | null;
    photoUrl: string | null;
    photoThumbUrl: string | null;
  } | null;
}
