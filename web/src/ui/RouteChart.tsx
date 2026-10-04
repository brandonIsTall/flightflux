// Temperature along the route: one series, stroked with the flight's own gradient, with a
// "now" marker. Follows the dataviz mark specs: 2px line, >= 8px marker with a surface ring,
// recessive axes, crosshair on hover, and a hidden table for screen readers.

import { useId, useState } from "react";
import type { Flight } from "../../../shared/types";
import { progressAt, tempAtProgress } from "../data/snapshot";
import { tempToCss } from "../lib/color";
import { formatDistance, formatTemp } from "../lib/format";
import { flightGradientStops } from "../lib/gradient";
import type { Units } from "../store";

const W = 352;
const H = 120;
const PAD = { l: 34, r: 10, t: 14, b: 22 };

export function RouteChart({ flight: f, nowS, units }: { flight: Flight; nowS: number; units: Units }) {
  const gid = useId();
  const [hover, setHover] = useState<number | null>(null);
  const p = progressAt(f, nowS);

  const lo = Math.min(f.depTempC, f.arrTempC);
  const hi = Math.max(f.depTempC, f.arrTempC);
  const pad = Math.max(2, (hi - lo) * 0.15);
  const yMin = lo - pad;
  const yMax = hi + pad;
  const x = (q: number) => PAD.l + q * (W - PAD.l - PAD.r);
  const y = (t: number) => PAD.t + (1 - (t - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b);
  const ticks = [yMin, (yMin + yMax) / 2, yMax];
  const nowT = tempAtProgress(f, p);
  const hoverT = hover === null ? null : tempAtProgress(f, hover);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const q = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.min(1, Math.max(0, (q - PAD.l) / (W - PAD.l - PAD.r))));
  };

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full touch-none select-none"
        role="img"
        aria-label={`Temperature along the route from ${formatTemp(f.depTempC, units)} at ${f.origin.city} to ${formatTemp(f.arrTempC, units)} at ${f.dest.city}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gid} x1="0" x2="1" y1="0" y2="0">
            {flightGradientStops(f).map(([o, c]) => (
              <stop key={o} offset={o} stopColor={c} />
            ))}
          </linearGradient>
        </defs>

        {ticks.map((t) => (
          <text key={t} x={PAD.l - 8} y={y(t) + 3.5} textAnchor="end" className="fill-ink-3 font-mono text-[10px]">
            {formatTemp(t, units)}
          </text>
        ))}
        <text x={x(0)} y={H - 6} className="fill-ink-2 font-mono text-[10px]">
          {f.origin.iata ?? f.origin.icao}
        </text>
        <text x={x(1)} y={H - 6} textAnchor="end" className="fill-ink-2 font-mono text-[10px]">
          {f.dest.iata ?? f.dest.icao}
        </text>

        <line x1={x(0)} y1={y(f.depTempC)} x2={x(1)} y2={y(f.arrTempC)} stroke={`url(#${gid})`} strokeWidth={2} strokeLinecap="round" />

        {hover !== null && hoverT !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} className="stroke-ink-3" strokeWidth={1} strokeDasharray="2 3" />
            <circle cx={x(hover)} cy={y(hoverT)} r={4} fill={tempToCss(hoverT)} className="stroke-space" strokeWidth={2} />
          </g>
        )}

        <circle cx={x(p)} cy={y(nowT)} r={5} fill={tempToCss(nowT)} className="stroke-space" strokeWidth={2} />
        <text
          x={x(p) + (p > 0.8 ? -9 : 9)}
          y={y(nowT) + (nowT > (yMin + yMax) / 2 ? 14 : -8)}
          textAnchor={p > 0.8 ? "end" : "start"}
          className="fill-ink-1 font-mono text-[11px]"
        >
          {formatTemp(nowT, units)}
        </text>
      </svg>
      <figcaption className="num mt-1 h-4 text-[11px] text-ink-2" aria-live="polite">
        {hover !== null && hoverT !== null
          ? `${formatDistance(hover * f.distKm, units)} from ${f.origin.iata ?? f.origin.icao}: ${formatTemp(hoverT, units, 1)}`
          : `Now: ${formatTemp(nowT, units, 1)}, ${formatDistance(p * f.distKm, units)} flown`}
      </figcaption>
      <table className="sr-only">
        <caption>Temperature along the route</caption>
        <thead>
          <tr>
            <th>Progress</th>
            <th>Temperature</th>
          </tr>
        </thead>
        <tbody>
          {[0, 0.25, 0.5, 0.75, 1].map((q) => (
            <tr key={q}>
              <td>{Math.round(q * 100)}%</td>
              <td>{formatTemp(tempAtProgress(f, q), units, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
