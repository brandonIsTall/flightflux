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

One Durable Object (`SkyState`, name `global`) runs an alarm every 30 s. Each run stays within the
Workers free plan (10 ms CPU, ~50 outbound requests) and makes at most one OpenSky call:

- **track** (every 5 min): one icao24-filtered call refreshes the ~150 flights on the globe
- **discover** (one region box per run, full sweep ~75 min): finds new long-haul flights; boxes
  that come back with more than 900 aircraft split in two (`src/core/tiles.ts`)
- **enrich** (every run): fills caches a batch at a time (Open-Meteo weather, adsbdb routes)
- **rebuild** (when something changed): projects every known flight along its route to now,
  curates the best 150 and builds the snapshot. No network, ~2 ms

Between fixes, positions are extrapolated along each flight's great circle at its last ground
speed (`pos.t` is the projected time, `pos.fixT` the last real fix). Scheduler timestamps are
persisted, so an evicted object can never call OpenSky faster than planned. A cron trigger every
5 minutes restarts the alarm loop if it ever stops.

OpenSky budget: ~1,150 credits/day tracking + ~2,100 discovery, of 4,000. Below 800 remaining,
everything slows 3x.

## Develop

```sh
cp .dev.vars.example .dev.vars     # add OpenSky API client credentials
npm test                           # unit + engine tests with fake upstreams
npm run live -- 30                 # real engine against live APIs from Node: a warm-up sweep + one tracked refresh
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
