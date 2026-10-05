# flightflux-api

Cloudflare Worker + Durable Object that joins live flight data and serves the curated snapshot
the globe renders. Positions come from a small external poller, because Cloudflare's network
cannot reach OpenSky (`docs/PLAN.md` §1). Design: `docs/PLAN.md` §1-§4.

## Endpoints

| Route | Returns |
|---|---|
| `GET /api/snapshot` | `Snapshot`: up to 150 curated flights with positions, routes, departure/arrival temps. Edge-cached 30 s. |
| `GET /api/flight/:id` | `FlightDetail`: one flight plus aircraft type, registration and photo. `:id` is a flight id or icao24. |
| `GET /api/search?q=BA117` | `Flight` for any airborne flight by flight number or callsign. 10 searches/min per IP. |
| `GET /api/_plan` | Poller only (bearer `INGEST_SECRET`): the tracked icao24s if due, and the region boxes due now. Marks them issued. `?restart` begins a fresh sweep at first-sweep pace. |
| `POST /api/_ingest` | Poller only: one OpenSky response, pre-filtered compact rows (`src/core/ingest.ts`). |

Types live in `shared/types.ts`.

## How it runs

One Durable Object (`SkyState`, name `global-weur`) owns the OpenSky schedule (`src/core/sched.ts`):

- **track** (every 5 min): one icao24-filtered call refreshes the ~150 flights on the globe
- **discover** (29 region boxes, full sweep ~75 min; every 28 s while nothing is known yet): finds
  new long-haul flights; boxes that come back with more than 900 aircraft split in two
  (`src/core/tiles.ts`)

The calls are made by the poller, `scripts/poll-once.ts`, which `.github/workflows/poll.yml` runs
every 5 min: it asks `/api/_plan` what is due, fetches it from OpenSky, keeps only the rows the
engine uses (cruising and climbing-out airliners) and POSTs them to `/api/_ingest`, one request
per box. The cadence only sets freshness; the plan paces the credit spend, so a slower cron just
gets more boxes per run. If no poller has asked for a plan in 20 min, the object falls back to
calling OpenSky itself, one call per tick (which fails from Cloudflare today, harmlessly).

The object's own alarm runs every 30 s, within the Workers free plan (10 ms CPU, ~50 outbound
requests):

- **enrich** (every run): fills caches a batch at a time (Open-Meteo weather, adsbdb routes)
- **rebuild** (when something changed): projects every known flight along its route to now,
  curates the best 150 and builds the snapshot. No network, ~2 ms

Between fixes, positions are extrapolated along each flight's great circle at its last ground
speed (`pos.t` is the projected time, `pos.fixT` the last real fix). Scheduler timestamps are
persisted, so an evicted object can never hand out OpenSky calls faster than planned. A cron
trigger every 5 minutes restarts the alarm loop if it ever stops.

OpenSky budget: ~1,150 credits/day tracking + ~2,100 discovery, of 4,000. Below 800 remaining,
everything slows 3x.

## Develop

```sh
cp .dev.vars.example .dev.vars     # add OpenSky API client credentials
npm test                           # unit + engine tests with fake upstreams
npm run live -- 30                 # real engine against live APIs from Node: a warm-up sweep + one tracked refresh
npm run poll                       # one poller run against the Worker named by FLIGHTFLUX_API in .dev.vars
npm run dev                        # wrangler dev (workerd)
```

`npm run live` writes the resulting snapshot to `.live-snapshot.json` (git-ignored). Useful as
fixture data for the web client.

## Deploy

```sh
npx wrangler secret put OPENSKY_CLIENT_ID
npx wrangler secret put OPENSKY_CLIENT_SECRET
npx wrangler secret put INGEST_SECRET          # any long random string, e.g. `openssl rand -hex 32`
npx wrangler deploy
```

Then give the poller the same values as GitHub Actions secrets (`OPENSKY_CLIENT_ID`,
`OPENSKY_CLIENT_SECRET`, `INGEST_SECRET`) and the Worker URL as the repository variable
`FLIGHTFLUX_API`. Run the "Poll positions" workflow once by hand to check; the globe fills within
a few runs.
