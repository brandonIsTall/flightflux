// Open-Meteo hourly 2 m temperature, batched across airports.

export const OPEN_METEO_API = "https://api.open-meteo.com/v1/forecast";

/** Hourly series for one airport. times are unix seconds (UTC), on the hour. */
export interface TempSeries {
  times: number[];
  tempsC: number[];
  tz: string;
  utcOffsetS: number;
  fetchedAt: number;
}

export interface LatLonKey {
  key: string;
  lat: number;
  lon: number;
}

/** Locations per request. Keeps URLs short; each location still counts toward the daily quota. */
export const WEATHER_BATCH = 50;

export async function fetchTempSeries(
  locs: LatLonKey[],
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<Map<string, TempSeries>> {
  const out = new Map<string, TempSeries>();
  for (let i = 0; i < locs.length; i += WEATHER_BATCH) {
    const batch = locs.slice(i, i + WEATHER_BATCH);
    const params = new URLSearchParams({
      latitude: batch.map((l) => l.lat.toFixed(4)).join(","),
      longitude: batch.map((l) => l.lon.toFixed(4)).join(","),
      hourly: "temperature_2m",
      past_days: "1",
      forecast_days: "2",
      timezone: "auto",
      timeformat: "unixtime",
    });
    const res = await fetchFn(`${OPEN_METEO_API}?${params}`);
    if (!res.ok) throw new Error(`open-meteo ${res.status}`);
    const j = (await res.json()) as any;
    // A single location returns an object; several return an array.
    const arr: any[] = Array.isArray(j) ? j : [j];
    arr.forEach((r, idx) => {
      const loc = batch[idx];
      if (!loc || !r?.hourly) return;
      out.set(loc.key, {
        times: r.hourly.time,
        tempsC: r.hourly.temperature_2m,
        tz: r.timezone,
        utcOffsetS: r.utc_offset_seconds,
        fetchedAt: Math.floor(now() / 1000),
      });
    });
  }
  return out;
}

/** Temperature at unix time t, linearly interpolated between hours. null if t is outside the series. */
export function tempAt(series: TempSeries, t: number): number | null {
  const { times, tempsC } = series;
  if (times.length === 0) return null;
  const first = times[0]!;
  const last = times[times.length - 1]!;
  if (t < first || t > last) return null;
  const i = Math.min(times.length - 2, Math.max(0, Math.floor((t - first) / 3600)));
  const t0 = times[i]!;
  const t1 = times[i + 1] ?? t0;
  const v0 = tempsC[i];
  const v1 = tempsC[i + 1] ?? v0;
  if (v0 == null || v1 == null) return v0 ?? v1 ?? null;
  const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
  return Math.round((v0 + (v1 - v0) * f) * 10) / 10;
}

/** Series older than this are refetched; forecasts move a little every hour. */
export const WEATHER_TTL_S = 3600;
