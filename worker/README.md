# flightflux-api

Cloudflare Worker + Durable Object that polls live flight data and serves the curated snapshot
the globe renders. Design: `docs/PLAN.md` §1-§4.

## Endpoints

| Route | Returns |
|---|---|
| `GET /api/snapshot` | `Snapshot`: up to 150 curated flights with positions, routes, departure/arrival temps. Edge-cached 30 s. |
| `GET /api/flight/:id` | `FlightDetail`: one flight plus aircraft type, registration and photo. `:id` is a flight id or icao24. |
| `GET /api/search?q=BA117` | `Flight` for any airborne flight by flight number or callsign. 10 searches/min per IP. |

Types live in `shared/types.ts`.

## How it runs

One Durable Object (`SkyState`, name `global`) runs an alarm every 30 s. Each run stays under the
free plan's ~50 outbound requests:

- at most every 120 s (timestamp persisted): one OpenSky worldwide poll, which also records take-offs
- every run: fill caches (Open-Meteo weather, OpenSky departure tracks, adsbdb routes), then
  rebuild the snapshot from cache with no network

A cron trigger every 5 minutes restarts the alarm loop if it ever stops.

## Develop

```sh
cp .dev.vars.example .dev.vars     # add OpenSky API client credentials
npm test                           # unit + engine tests with fake upstreams
npm run live -- 8                  # real engine against live APIs from Node, 8 ticks
npm run dev                        # wrangler dev (workerd)
```

`npm run live` writes the resulting snapshot to `.live-snapshot.json` (git-ignored). Useful as
fixture data for the web client.

## Deploy

```sh
npx wrangler secret put OPENSKY_CLIENT_ID
npx wrangler secret put OPENSKY_CLIENT_SECRET
npx wrangler deploy
```
