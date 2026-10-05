// Reachability check for every upstream, from wherever this runs.

const TARGETS: [string, string, RequestInit?][] = [
  ["opensky-auth", "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials&client_id=x&client_secret=y" }],
  ["opensky-auth-root", "https://auth.opensky-network.org/"],
  ["opensky-api", "https://opensky-network.org/api/states/all?icao24=abc123"],
  ["adsbdb", "https://api.adsbdb.com/v0/callsign/BAW117"],
  ["open-meteo", "https://api.open-meteo.com/v1/forecast?latitude=51.47&longitude=-0.46&hourly=temperature_2m&forecast_days=1"],
  ["adsb-lol", "https://api.adsb.lol/v2/callsign/BAW117"],
  ["airplanes-live", "https://api.airplanes.live/v2/callsign/BAW117"],
  ["adsb-fi", "https://opendata.adsb.fi/api/v2/callsign/BAW117"],
];

export async function probeUpstreams(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    TARGETS.map(async ([name, url, init]) => {
      const t = Date.now();
      try {
        const res = await fetch(url, { ...init, signal: AbortSignal.timeout(12_000) });
        out[name] = `${res.status} in ${Date.now() - t} ms (${res.headers.get("cf-ray") ?? "no cf-ray"}; server ${res.headers.get("server") ?? "?"})`;
      } catch (e) {
        out[name] = `threw ${(e as Error).message} after ${Date.now() - t} ms`;
      }
    }),
  );
  return out;
}
