# flightflux-api

Cloudflare Worker + Durable Object that joins live flight data and serves the curated snapshot
the globe renders. Positions come from a small external poller, because Cloudflare's network
cannot reach OpenSky (`docs/PLAN.md` §1). Design: `docs/PLAN.md` §1-§4.

## Endpoints

| Route | Returns |
|---|---|
| `GET /api/snapshot` | `Snapshot`: up to 150 curated flights with positions, routes, departure/arrival temps. Edge-cached 60 s. |
| `GET /api/flight/:id` | `FlightDetail`: one flight plus aircraft type, registration and photo. `:id` is a flight id or icao24. |
| `GET /api/search?q=BA117` | `Flight` for any airborne flight by flight number or callsign. Malformed queries get 400 without waking the object; 10 searches a minute per visitor IP (Workers rate-limit binding); 1,000 a day in total (tallied in the object). |
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
calling OpenSky itself, one call per alarm (which fails from Cloudflare today, harmlessly).

The object's alarm does the rest, with at most ~44 outbound requests per run:

- **enrich**: fills caches a batch at a time (Open-Meteo weather, adsbdb routes)
- **rebuild**: projects every known flight along its route to now, curates the best 150, builds
  the snapshot and stores it. No network, ~2 ms

It fires 5 s after an ingest, then every 30 s while route or weather lookups are queued, then
every 15 min (`src/core/wake.ts`). An hourly cron replaces the alarm if it is missing or stuck.

Between fixes, positions are extrapolated along each flight's great circle at its last ground
speed (`pos.t` is the projected time, `pos.fixT` the last real fix). Scheduler timestamps are
persisted, so an evicted object can never hand out OpenSky calls faster than planned.

### Storage budget

The free plan allows 5M SQLite rows read and 100k rows written a day, and Cloudflare evicts the
object between events (often between two alarms), so every event is treated as a cold start
(`src/sql-store.ts`):

- No table is ever loaded whole. A route or weather series is a primary-key lookup (1 row) the
  first time it is needed, then held in memory, misses included.
- A read-only request (snapshot, flight detail, plan) reads 2 rows: scheduler and stored snapshot.
- Work (alarm, ingest, search) also restores one document: the known aircraft plus the cached
  routes and weather they need (~0.9 MB). New aircraft cost 1 lookup each.
- Cache tables are `WITHOUT ROWID` with no secondary index, since Cloudflare counts a written row
  per index entry. Expired rows are deleted in one scan a day.
- Rows read and written are tallied per UTC day in the scheduler state. Past 4M read or 80k
  written, ingests and lookups pause until midnight; the stored snapshot keeps being served.

Each alarm and ingest logs `rowsRead`, the document size and the day's tally. Measured: 2-5 rows
read per cold alarm, ~1.1 rows written per route lookup.

The first version loaded both tables on every wake and read ~10M rows a day, twice the limit.

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
