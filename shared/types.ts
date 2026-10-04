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
  /**
   * Unix seconds this position is for. Usually projected along the route from the last fix, so
   * clients should keep advancing it at gsMs along the great circle origin -> dest.
   */
  t: number;
  /** Unix seconds of the last real transponder fix. */
  fixT: number;
}

/** observed: caught climbing out of the origin. estimated: back-calculated (median error ~6 min). */
export type DepTimeSource = "observed" | "estimated";

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
  flights: Flight[];
  meta: {
    /** Cruise-phase airline flights currently known from discovery sweeps. */
    known: number;
    /** Known flights with a long-haul route (the pool curation picks from). */
    routed: number;
    creditsRemaining: number | null;
    stepMs: number;
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
