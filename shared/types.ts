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
  /** icao24, departure day and callsign ("c06aaa-20261028-tsc284"), stable for the life of one flight. */
  id: string;
  icao24: string;
  callsign: string;
  flightNo: string | null;
  airline: { name: string; icao: string; iata: string | null } | null;
  /** ICAO type designator ("B77W", "A388"), or null until (or unless) it's known. */
  aircraftType: string | null;
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
  /**
   * The temperature along the route, when known: entry i is at fraction i / (length - 1), the 2 m
   * temperature below the plane when it passed there (ends pinned to depTempC and arrTempC).
   * Without it the route blends straight from depTempC to arrTempC. Only landed leaderboard flights
   * have one, for replays.
   */
  profile?: number[];
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
    /** How quickly new flights reach the globe (absent from servers that predate it). */
    entry?: EntryLag;
  };
}

/**
 * Minutes from take-off until a flight is first seen in cruise (discover) and first shown on the
 * globe (onGlobe), over recent arrivals on the globe. Null until there are any.
 */
export interface EntryLag {
  n: number;
  discoverP50Min: number | null;
  discoverP90Min: number | null;
  onGlobeP50Min: number | null;
  onGlobeP90Min: number | null;
  swapsLastHour: number;
  /** How far back (minutes) the recorded arrivals reach. */
  windowMin?: number | null;
  /** Arrivals that replaced a shown flight, and the median wait from first seen to shown. */
  swap?: { n: number; gapP50Min: number | null };
  /** Arrivals that filled a free slot (a shown flight landed), and the same wait. */
  slot?: { n: number; gapP50Min: number | null };
  /** First-seen lag for arrivals first seen near their origin only: what the sweep controls. */
  near?: { n: number; discoverP50Min: number | null; discoverP90Min: number | null };
  /** Arrivals first seen by a departure watch box, and how many departures are remembered to watch. */
  watch?: { n: number; discoverP50Min: number | null; schedule: number };
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

/** A flight as the leaderboard keeps it: its values when last scored, without a live position. */
export type LeaderFlight = Omit<Flight, "pos" | "flownKm">;

export type LeaderWindow = "24h" | "7d" | "30d";

/** [unix s of the fix, lat, lon, altitude m]: one real transponder position. */
export type TrackPoint = [number, number, number, number];

/**
 * The positions recorded for one flight, oldest first. Sparse: about every 5 min while it was on
 * the globe, about every sweep (~75 min) otherwise, and none over oceans out of receiver range.
 */
export interface Track {
  id: string;
  points: TrackPoint[];
  /** The flight's en-route temperatures (see Flight.profile), when it has landed and they're known. */
  profile?: number[];
}

/**
 * The biggest temperature swings among flights landing (or due to land) within each rolling
 * window, biggest first. Ranks every long-haul flight the server scored, not only the curated ones.
 */
export interface Leaders {
  v: 1;
  generatedAt: number;
  windows: Record<LeaderWindow, LeaderFlight[]>;
}
