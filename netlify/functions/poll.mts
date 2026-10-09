// Netlify scheduled function: the Flight Flux position poller, every 5 minutes.
// Netlify runs it on AWS, which can reach OpenSky (Cloudflare Workers can't). All the logic lives
// in worker/src/poller.ts, shared with the GitHub Actions / command-line poller.
//
// Environment variables (Netlify: Site configuration -> Environment variables, scope Functions):
//   FLIGHTFLUX_API, INGEST_SECRET, OPENSKY_CLIENT_ID, OPENSKY_CLIENT_SECRET

import { requireEnv, runPoll } from "../../worker/src/poller";

export default async (): Promise<Response> => {
  const env = process.env;
  const lines: string[] = [];
  try {
    const r = await runPoll({
      api: requireEnv(env, "FLIGHTFLUX_API"),
      ingestSecret: requireEnv(env, "INGEST_SECRET"),
      openskyClientId: requireEnv(env, "OPENSKY_CLIENT_ID"),
      openskyClientSecret: requireEnv(env, "OPENSKY_CLIENT_SECRET"),
      concurrency: 4,
      // Scheduled functions are stopped at 30 s; leave room for the requests in flight.
      deadlineMs: 20_000,
      log: (l) => {
        lines.push(l);
        console.log(l);
      },
    });
    console.log(JSON.stringify({ summary: r }));
    return new Response(JSON.stringify(r), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error(`poll failed: ${(e as Error).message}`);
    return new Response(JSON.stringify({ error: (e as Error).message, lines }), { status: 500 });
  }
};

export const config = { schedule: "*/5 * * * *" };
