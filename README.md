# Flight Flux

A slowly turning globe of long-haul flights in the air right now, each drawn as a line that blends
from the temperature where it took off to the forecast temperature where it will land. Hover a
route for the numbers; click it to ride along in a stylized cockpit.

- `docs/PLAN.md`: the product and technical plan, with measured results per phase
- `worker/`: Cloudflare Worker + Durable Object that polls OpenSky, adsbdb and Open-Meteo and
  serves the curated snapshot (`/api/snapshot`, `/api/flight/:id`, `/api/search`)
- `web/`: the Vite + React + react-three-fiber app
- `shared/types.ts`: the wire format both sides use

## Run locally

```sh
npm install
npm test                 # worker + web unit tests
npm run dev -w web       # the globe on http://localhost:5173 with a bundled sample snapshot
```

To run against live data you need an OpenSky API client (free account at opensky-network.org):

```sh
cp worker/.dev.vars.example worker/.dev.vars    # fill in OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET
npm run live -w worker -- 30                    # the real engine from Node: one discovery sweep
npm run dev -w worker                           # the Worker locally on http://localhost:8787
VITE_API_BASE=http://localhost:8787 npm run dev -w web
```

## Deploy

Both halves run on Cloudflare's free tier. Flight positions are fetched by a GitHub Actions cron,
because Cloudflare's network cannot reach OpenSky (`docs/PLAN.md` §1).

```sh
# API
cd worker
npx wrangler secret put OPENSKY_CLIENT_ID
npx wrangler secret put OPENSKY_CLIENT_SECRET
npx wrangler secret put INGEST_SECRET            # any long random string
npx wrangler deploy                              # prints https://flightflux-api.<account>.workers.dev

# Globe (Workers static assets; web/.env.production holds the API URL)
cd ../web
npm run build
npx wrangler deploy
```

Then, in the GitHub repository settings, add Actions secrets `OPENSKY_CLIENT_ID`,
`OPENSKY_CLIENT_SECRET` and `INGEST_SECRET` (same values as the Worker's) and the variable
`FLIGHTFLUX_API` (the API URL). The "Poll positions" workflow (`.github/workflows/poll.yml`) runs
every 5 minutes and fills the globe within a few runs. Note the Actions minutes: a 5 minute cron
is free on a public repository but exceeds a private repository's 2,000 free minutes a month;
there, use `*/30` (same OpenSky credits, positions dead-reckoned between fixes).

## Data and licenses

OpenSky Network (non-commercial), adsbdb, Open-Meteo (CC BY 4.0, non-commercial), Natural Earth
via world-atlas (public domain), Geist (SIL OFL). The app credits them in its "Data sources"
sheet. Because of the OpenSky and Open-Meteo terms, Flight Flux is non-commercial as built; the
plan lists commercial replacements if that ever changes.
