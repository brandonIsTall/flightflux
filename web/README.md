# flightflux-web

The globe. Vite + React 19 + react-three-fiber. Design language: `docs/PLAN.md` §6.

## Run

```sh
npm run dev -w web                       # http://localhost:5173, uses the bundled sample snapshot
VITE_API_BASE=https://<worker-url> npm run dev -w web   # live data from the Worker
npm run build -w web && npm run preview -w web
npm test -w web
```

Without `VITE_API_BASE`, the app loads `public/fixture/snapshot.json` (a real snapshot captured by
`npm run live -w worker`) and the status indicator says "Sample data".

Append `?noeffects` to the URL to skip bloom and vignette (useful on weak GPUs or when profiling).

## Layout

| Path | What |
|---|---|
| `src/lib/color.ts` | The temperature scale (OKLab-interpolated, validated stops) |
| `src/lib/geo.ts` | Great circles and lat/lon → globe coordinates |
| `src/lib/earthTexture.ts` | Draws the stylized land texture from Natural Earth polygons in the app's tokens |
| `src/data/snapshot.ts` | Loads the snapshot and projects flights along their routes to now |
| `src/globe/` | Scene (camera, auto-spin, bloom), Globe (shader: texture, terminator, horizon rim), Routes (gradient lines), Planes (instanced markers), CameraRig (orbit ↔ cockpit flight) |
| `src/lib/sun.ts` | Subsolar point for the day/night terminator |
| `src/ui/` | Top bar with search and unit toggle, legend, freshness indicator, tooltip, detail panel, route chart, cockpit HUD |
| `src/lib/format.ts`, `src/lib/gradient.ts` | Unit-aware formatting; a flight's gradient as CSS/SVG stops |
| `src/styles.css` | Design tokens, fonts, glass and pill primitives |

## Loading and caching

The **Thermal Boot** (`src/boot.ts`, `globe/BootDirector.tsx`, `globe/BootLayer.tsx`,
`ui/BootOverlay.tsx`) plays while the real loading happens: a sweep line in the temperature scale,
the graticule drawing itself, land fading in as dots and cross-fading to the texture, transponder
pings as the snapshot lands, routes tracing in grey, then warming into color, then the wordmark.
Each beat waits for the stage it represents (texture, snapshot), so it never finishes before the
data. When both are cached it plays at 3× (about a second). Any click or key after 1 s skips it;
`prefers-reduced-motion` gets a static globe and a progress hairline. If the feed is slow the
status line says so after 8 s; if it's dead, the boot ends on whatever is cached.

Caching: a service worker (vite-plugin-pwa) precaches the shell, fonts and the land atlas and
keeps the last `/api/snapshot` (network-first, 5 s timeout) and `/api/flight/*` answers; the
snapshot is also persisted in IndexedDB (TanStack persister, 6 h) so a repeat visit draws flights,
dead-reckoned forward, before the network answers.

## Behavior

- The globe spins at 2°/s. Dragging or zooming pauses it; it eases back in 30 s after the last
  interaction. Hovering a flight also pauses it so the target doesn't drift.
- Each route is two lines: the flown part solid at full brightness, the part ahead dimmer with a
  dash flowing toward the destination. Colors blend from departure to arrival temperature.
- Planes advance along their routes every frame from the snapshot's position and ground speed,
  matching the server's extrapolation.
- Hovering a route shows a glass tooltip that appears at the cursor and follows it on a spring.
  Clicking opens the detail panel: the two temperatures, the along-route chart, flight facts and
  the aircraft photo (from `/api/flight/:id`, so only with the live API). Esc or "Back to globe"
  closes it.
- Clicking a route also flies the camera (2.4 s, along a great arc) down to a seat on the plane.
  The seat moves with the flight; drag to look around (springs back). The HUD shows heading, speed
  and altitude tapes, and a gradient strip with the outside temperature and time to go. Esc or
  "Back to globe" flies back. The globe shades day and night from the real sun position.
- The list button (top right) opens every flight on the globe sorted by temperature change, with
  arrow-key navigation, a filter box that also searches the live API on Enter, and the Data
  sources sheet. On phones it is also where search lives.
- Flights more than 20 min past their arrival leave the globe. The bundled sample is time-shifted
  to now on load so it stays mid-flight for development.
- Search looks on the globe first (callsign or flight number), then asks `/api/search`, which can
  find any airborne flight. Found flights are drawn alongside the curated set.
- `prefers-reduced-motion`: no spin, no dash flow. `prefers-reduced-transparency`: solid surfaces.
