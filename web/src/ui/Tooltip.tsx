// Glass tooltip that follows the cursor over a hovered route. See docs/PLAN.md §6.6.

import { AnimatePresence, motion, useMotionValue, useSpring } from "motion/react";
import { useEffect, useState } from "react";
import type { Flight } from "../../../shared/types";
import { progressAt, tempAtProgress } from "../data/snapshot";
import { tempToCss } from "../lib/color";
import { formatDelta, formatLocalTime, formatTemp } from "../lib/format";
import { flightGradientCss } from "../lib/gradient";
import { useStore } from "../store";

const OFFSET = 18;
const WIDTH = 304;
const HEIGHT = 112;

export function Tooltip({ flights }: { flights: Flight[] }) {
  const hoveredId = useStore((s) => s.hoveredId);
  const units = useStore((s) => s.units);
  const flight = hoveredId ? (flights.find((f) => f.id === hoveredId) ?? null) : null;

  // Cursor tracking lives in motion values, never React state, so following costs no renders.
  const x = useMotionValue(-1000);
  const y = useMotionValue(-1000);
  const sx = useSpring(x, { stiffness: 300, damping: 30, mass: 0.6 });
  const sy = useSpring(y, { stiffness: 300, damping: 30, mass: 0.6 });

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      // Flip to the other side of the cursor near the right and bottom edges.
      const px = e.clientX + OFFSET + WIDTH > window.innerWidth ? e.clientX - OFFSET - WIDTH : e.clientX + OFFSET;
      const py = e.clientY + OFFSET + HEIGHT > window.innerHeight ? e.clientY - OFFSET - HEIGHT : e.clientY + OFFSET;
      x.set(px);
      y.set(py);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [x, y]);

  // Appear at the cursor, then follow it; never spring in from wherever it was last.
  const appearing = !!flight;
  useEffect(() => {
    if (appearing) {
      sx.jump(x.get());
      sy.jump(y.get());
    }
  }, [appearing, sx, sy, x, y]);

  const [nowS, setNowS] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (!flight) return;
    const id = window.setInterval(() => setNowS(Date.now() / 1000), 1000);
    return () => window.clearInterval(id);
  }, [flight]);

  return (
    <AnimatePresence>
      {flight && (
        <motion.div
          key={flight.id}
          role="tooltip"
          className="glass pointer-events-none fixed top-0 left-0 z-10 p-3.5"
          style={{ x: sx, y: sy, width: WIDTH }}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
          <TooltipBody flight={flight} nowS={nowS} units={units} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function TooltipBody({ flight: f, nowS, units }: { flight: Flight; nowS: number; units: Units }) {
  const p = progressAt(f, nowS);
  return (
    <>
      <div className="flex items-baseline gap-2 text-[13px]">
        <span className="num font-medium text-ink-1">{f.flightNo ?? f.callsign}</span>
        <span className="truncate text-ink-2">{f.airline?.name ?? f.callsign}</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <Endpoint temp={f.depTempC} code={f.origin.iata ?? f.origin.icao} city={f.origin.city} units={units} />
        <span className="num shrink-0 text-[12px] text-ink-2">{formatDelta(f.arrTempC - f.depTempC, units)}</span>
        <Endpoint temp={f.arrTempC} code={f.dest.iata ?? f.dest.icao} city={f.dest.city} units={units} right />
      </div>
      <div className="relative mt-3 h-1 w-full rounded-full" style={{ background: flightGradientCss(f) }}>
        <span
          className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-space"
          style={{ left: `${p * 100}%`, background: tempToCss(tempAtProgress(f, p)) }}
        />
      </div>
      <div className="num mt-2 flex justify-between text-[11px] text-ink-2">
        <span>{Math.round(p * 100)}% flown</span>
        <span>lands {formatLocalTime(f.eta, f.dest.tz, f.dest.utcOffsetS)} local</span>
      </div>
    </>
  );
}

function Endpoint({ temp, code, city, units, right }: { temp: number; code: string; city: string; units: Units; right?: boolean }) {
  return (
    <div className={`min-w-0 ${right ? "text-right" : ""}`}>
      <span className="num text-[20px] leading-none text-ink-1">{formatTemp(temp, units)}</span>
      <div className="mt-1 truncate text-[12px] text-ink-2">
        <span className="num text-ink-1">{code}</span> {city}
      </div>
    </div>
  );
}

type Units = "C" | "F";
