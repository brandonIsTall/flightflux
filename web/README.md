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
| `src/globe/` | Scene (camera, auto-spin, bloom), Globe, Routes (gradient lines), Planes (instanced markers) |
| `src/ui/` | Top bar with search and unit toggle, legend, freshness indicator |
| `src/styles.css` | Design tokens, fonts, glass and pill primitives |

## Behavior

- The globe spins at 2°/s. Dragging or zooming pauses it; it eases back in 30 s after the last
  interaction. Hovering a flight also pauses it so the target doesn't drift.
- Each route is two lines: the flown part solid at full brightness, the part ahead dimmer with a
  dash flowing toward the destination. Colors blend from departure to arrival temperature.
- Planes advance along their routes every frame from the snapshot's position and ground speed,
  matching the server's extrapolation.
- `prefers-reduced-motion`: no spin, no dash flow. `prefers-reduced-transparency`: solid surfaces.
