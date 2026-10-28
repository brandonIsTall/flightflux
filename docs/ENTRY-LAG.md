# Entry lag: how fast new flights reach the globe

Working notes for the effort to shorten the time between a long-haul flight taking off and it
appearing on the globe. They record what was changed, what each change measured, how to read
the numbers, and what to try next. The design itself is in `PLAN.md` §2.5 (discovery) and §4
(curation).

## The problem

A flight can be in the air and still missing from the globe. Before this work, a search for
SAS936 an hour after it left SFO said it wasn't found. It wasn't one of the 150 flights on the
globe, and the server hadn't seen it yet: its region of the world sweep hadn't come round since
it reached cruise. The live snapshot showed few flights early in their trip: 1 of 150 under 10%
flown, where about 15 would mean no lag.

Delays from take-off to the globe:

1. **Climb to cruise.** A flight is a candidate only at 6,000 m or above and 150 m/s or faster (`MIN_CANDIDATE_*`, `engine.ts`).
2. **Waiting for its region to be fetched.** This is the discovery sweep (`sched.ts`).
3. **Route and weather lookup.** Usually seconds.
4. **Waiting for a place on the globe.** This is curation (`curate.ts`).
5. **Coverage.** Flights that take off where there are no ADS-B receivers are only seen hours later. No polling change can fix that.

## What changed, in order

| PR | Change |
|---|---|
| #27 | **Swaps:** a newcomer may replace the weakest shown flight (margin 5°, at least 45 min shown, at most 6 swaps an hour). **Ocean memory:** an unseen long-haul flight is kept until its route says it landed (up to 18 h), not forgotten after 100 min. **Metric:** `meta.entry`. Also moved the search bar. |
| #28 | Swap cap 6 → **12** an hour. |
| #29 | `meta.entry` split by how a flight joined (`swap`/`slot`) and where it was first seen (`near`: within 1,000 km of its origin). |
| #30 | **Weighted sweep:** same number of boxes (same credits), but boxes that keep turning up new flights are visited more often. Weight is `sqrt(rate / mean)` held to 0.4–2.5, and no box waits more than 225 min. |
| #31 | A box's yield counts only new **long-haul** flights (callsign with a cached route ≥ 2,500 km). Counting every airliner had made the weights noise. |
| #32 | **Departure watch.** 15–35 min after a remembered flight's usual take-off, poll a 1-credit box around its origin. Budget: ≤ 600 boxes a day, ≤ 8 per poller run, none below 1,200 credits. |
| #35 | Watch cap 600 → **900** a day. At ~34 boxes an hour, 600 ran out by about 17:30 UTC, leaving the evening departure wave (US East Coast transatlantic, 22:00–02:00 UTC) unwatched. |

## Measurements

`near` = flights first seen within 1,000 km of their origin. That is the part polling can affect.

| Reading (UTC) | After | near first seen, P50 / P90 | swap wait | slot wait | swaps/h | Notes |
|---|---|---|---|---|---|---|
| Oct 18 04:06 | #27 | 29 / 78 (all flights) | — | — | 6 (cap) | first reading |
| Oct 18 08:56 | #28 | 47 / 162 (all flights) | — | — | 12 (cap) | inconclusive, so #29 split the metric |
| Oct 18 17:26 | #29 | **39 / 79** (n=109) | 14 | 42 | 5 | the sweep is the limit |
| Oct 18 21:40 | #30 | 31 / 75 (n=167) | 0 | 21 | 12 | visit gaps 27–164 min; avg fresh **159**/visit (noise) |
| Oct 19 02:20 | #31 | 36 / 76 (n=149) | 4 | 18 | 12 | avg fresh **19**/visit (clean); visit gaps 32/111/204 min |
| Oct 19 06:05 | #32 (+70 min) | 30 / 70 (n=149) | 4 | 19 | 11 | watch n=0, schedule 109; no plan-watch lines yet; avg fresh 19/visit; visit gaps 49/81/215 min; credits 3,613 (~101/h since 02:18); no errors. Early check only |
| Oct 20 06:30 | #32 (+25.5 h) | **22 / 66** (n=174) | 4 | 9 | 12 | **watch n=14, P50 28 min**, schedule 1,500 (at `MAX_SCHEDULE`); 29 watch boxes last hour, 159 today (~24/h, on pace for the 600 cap); credits 3,428 (~88/h since 00:00 incl. watch); avg fresh **10**/visit (watch finds flights before the sweep does); visit gaps 36/95/203 min; no errors |

Conclusion before #32: the weighted sweep works and curation is no longer the bottleneck. The
`near` P90 stays at about 75 min whatever the sweep does. Only extra polling around take-off
(#32) can push it down.

**Credits.** OpenSky allows 4,000 a day. The sweep and tracked refresh use about 103 an hour
(about 2,500 a day): 3,803 at 04:06, 3,265 at 08:56, 2,364 at 17:26, 1,931 at 21:40, 3,994 at
02:18 the next day. The allowance renews around 00:00 UTC, so compare hourly rates, not levels.
#32 adds at most 900 a day (600 until #35).

## How to read the numbers

- **Snapshot:** `GET https://flightflux-api.brandonisaacjames.workers.dev/api/snapshot`. The field is `meta.entry`:
  - `n`: recorded arrivals, the last 300. `windowMin` is how far back they reach.
  - `discoverP50Min` / `discoverP90Min`: take-off → first seen in cruise, all arrivals. Flights first seen far from origin (coverage gaps) dominate these.
  - `onGlobeP50Min` / `onGlobeP90Min`: take-off → shown on the globe.
  - `swap` / `slot`: `{ n, gapP50Min }`, first seen → shown, for flights that replaced one versus filled a free slot.
  - `near`: `{ n, discoverP50Min, discoverP90Min }`, flights first seen within 1,000 km of their origin. **The headline number.**
  - `watch` (#32): `{ n, discoverP50Min, schedule }`. Arrivals first seen by a departure-watch box, their lag, and how many departures are remembered.
  - `swapsLastHour` (cap 12), plus `meta.creditsRemaining` and `meta.known`.
- **Worker logs** (Cloudflare Workers Observability). Use the **calculations** view. The events view fails to parse Durable Object events.
  - Ingest lines carry `fresh` (new long-haul flights per box) and `boxGapsMin.{minMin,medianMin,maxMin}` (spread of visit gaps).
  - Plan lines `step: "plan watch"` carry `boxes` and `today` (watch boxes handed out today).
  - Filter on `boxGapsMin.maxMin exists`, then take the median or max, and avg `fresh`.

## Departure watch (#32): what to check

- It learns as flights make the globe and starts watching **the day after**. Expect `watch.schedule` in the hundreds within hours, with `watch.n` near 0 until about 24 h after deploy.
- **After about 24–27 h, success is:**
  - `watch.n` in the dozens with `watch.discoverP50Min` about 20–30 min;
  - `near.discoverP90Min` below 75;
  - watch spend ≤ 900 a day (600 before #35): `today` in the plan-watch log lines, and credits falling no faster than about 103/h + 38/h.
- **If watch boxes go out but find little:** take-off times may be off. They are estimated from distance flown, with a median error of about 6 min. Or the window (15–35 min) may be wrong for big hubs. Check a few watched callsigns against the logs.
- **If credits run hot:** lower `WATCH_BOXES_PER_DAY` or `WATCH_PER_PLAN` in `sched.ts`.

## Tunables

| Constant | File | Value |
|---|---|---|
| `SWAP_MARGIN`, `SWAPS_PER_HOUR`, `MIN_DWELL_S` | `core/curate.ts` | 5, 12, 45 min |
| `SWEEP_MS`, `MAX_TILE_GAP_MS`, `MIN/MAX_TILE_WEIGHT`, `TILE_RATE_ALPHA` | `core/sched.ts` | 75 min, 225 min, 0.4/2.5, 0.3 |
| `WATCH_BOXES_PER_DAY`, `WATCH_MIN_CREDITS`, `WATCH_PER_PLAN` | `core/sched.ts` | 900, 1,200, 8 |
| `WATCH_FROM_S`, `WATCH_UNTIL_S`, `WATCH_HALF_DEG`, `MAX_SCHEDULE`, `SCHEDULE_TTL_S` | `core/engine.ts` | 15 min, 35 min, 2.4°, 1,500, 3 days |
| `KNOWN_TTL_S`, `MAX_DEAD_RECKON_S`, `SEEN_FAR_KM` | `core/engine.ts` | 100 min, 18 h, 1,000 km |

## Working conventions

- Changes go through a PR from a branch restarted from `main`. The repo squash-merges, and merging to `main` deploys automatically (`.github/workflows/deploy.yml`, which runs typecheck and tests first). No checks run on PRs themselves.
- Before pushing, run `npm test -w worker`, `npm run typecheck` and `npm run build -w web`.
- After each deploy, read `meta.entry` about 3 h later (24–27 h for the departure watch) and compare against the table above. Add the new row here.
