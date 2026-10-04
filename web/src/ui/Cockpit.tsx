// The glass-cockpit display: an HTML overlay shown while the camera rides a flight.
// Density is deliberately instrument-like: mono numerals, hairlines, no cards. See PLAN §6.6.

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Flight } from "../../../shared/types";
import { progressAt, tempAtProgress } from "../data/snapshot";
import { tempToCss } from "../lib/color";
import { formatDuration, formatTemp } from "../lib/format";
import { bearingDeg, interpolate } from "../lib/geo";
import { flightGradientCss } from "../lib/gradient";
import { useStore, type Units } from "../store";

export function Cockpit({ flights }: { flights: Flight[] }) {
  const mode = useStore((s) => s.cameraMode);
  const selectedId = useStore((s) => s.selectedId);
  const flight = selectedId ? (flights.find((f) => f.id === selectedId) ?? null) : null;
  const show = mode === "cockpit" && !!flight;
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="hud"
          className="pointer-events-none absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
        >
          <Hud flight={flight} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Hud({ flight: f }: { flight: Flight }) {
  const units = useStore((s) => s.units);
  const [nowS, setNowS] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = window.setInterval(() => setNowS(Date.now() / 1000), 250);
    return () => window.clearInterval(id);
  }, []);

  const p = progressAt(f, nowS);
  const here = interpolate(f.origin, f.dest, p);
  const heading = bearingDeg(here, interpolate(f.origin, f.dest, Math.min(1, p + 0.002)));
  const oat = tempAtProgress(f, p);
  const speed = units === "F" ? f.pos.gsMs * 1.94384 : f.pos.gsMs * 3.6; // kt with F, km/h with C
  const speedUnit = units === "F" ? "kt" : "km/h";
  const alt = units === "F" ? f.pos.altM * 3.28084 : f.pos.altM;
  const altUnit = units === "F" ? "ft" : "m";
  const remainingS = Math.max(0, f.eta - nowS);

  return (
    <>
      <HeadingRibbon heading={heading} />
      <Tape side="left" label="IAS" value={speed} unit={speedUnit} step={units === "F" ? 20 : 40} />
      <Tape side="right" label="ALT" value={alt} unit={altUnit} step={units === "F" ? 1000 : 250} />
      <BottomStrip flight={f} p={p} oat={oat} remainingS={remainingS} units={units} />
    </>
  );
}

function HeadingRibbon({ heading }: { heading: number }) {
  const ticks = [];
  for (let d = -60; d <= 60; d += 10) {
    const h = ((Math.round(heading / 10) * 10 + d) % 360 + 360) % 360;
    const x = 50 + ((h - heading + 540) % 360 - 180) * 0.75; // 0.75% per degree
    if (x < 2 || x > 98) continue;
    const label = h === 0 ? "N" : h === 90 ? "E" : h === 180 ? "S" : h === 270 ? "W" : h % 30 === 0 ? String(h) : "";
    ticks.push({ h, x, label });
  }
  return (
    <div className="absolute top-16 left-1/2 w-[min(520px,70vw)] -translate-x-1/2">
      <div className="relative h-8 overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-px bg-hairline" />
        {ticks.map((t) => (
          <div key={t.h} className="absolute top-0 -translate-x-1/2" style={{ left: `${t.x}%` }}>
            <div className={`mx-auto w-px bg-ink-3 ${t.label ? "h-2.5" : "h-1.5"}`} />
            {t.label && <div className="num mt-0.5 text-[10px] text-ink-2">{t.label}</div>}
          </div>
        ))}
        <div className="absolute top-0 left-1/2 h-3 w-px -translate-x-1/2 bg-ink-1" />
      </div>
      <div className="num mx-auto mt-1 w-fit rounded-full border border-hairline bg-surface-1 px-2.5 py-0.5 text-[12px] text-ink-1">
        <span className="mr-1.5 text-[10px] tracking-[0.12em] text-ink-3">HDG</span>
        {String(Math.round(heading) % 360).padStart(3, "0")}°
      </div>
    </div>
  );
}

/** A vertical scale that scrolls past a fixed pointer, like a primary flight display. */
function Tape({ side, label, value, unit, step }: { side: "left" | "right"; label: string; value: number; unit: string; step: number }) {
  const PX_PER_UNIT = 72 / step; // one step = 72 px
  const H = 220;
  const ticks = [];
  const base = Math.floor(value / step) * step;
  for (let v = base - 2 * step; v <= base + 3 * step; v += step) {
    const y = H / 2 - (v - value) * PX_PER_UNIT;
    if (y < -8 || y > H + 8 || v < 0) continue;
    ticks.push({ v, y });
  }
  const edge = side === "left" ? "left-4 sm:left-6" : "right-4 sm:right-6 sm:[.has-panel_&]:right-[440px]";
  const align = side === "left" ? "items-start" : "items-end";
  return (
    <div className={`absolute top-1/2 hidden -translate-y-1/2 sm:block ${edge}`} style={{ height: H }}>
      <div className={`relative flex h-full w-20 flex-col ${align}`}>
        <div className={`absolute top-0 bottom-0 w-px bg-hairline ${side === "left" ? "right-0" : "left-0"}`} />
        {ticks.map((t) => (
          <div
            key={t.v}
            className={`num absolute flex items-center gap-1.5 text-[11px] text-ink-3 ${side === "left" ? "right-0 flex-row-reverse" : "left-0"}`}
            style={{ top: t.y, transform: "translateY(-50%)" }}
          >
            <span className="block h-px w-2 bg-ink-3" />
            {t.v.toLocaleString()}
          </div>
        ))}
        <div
          className={`num absolute top-1/2 flex -translate-y-1/2 items-baseline gap-1 rounded-full border border-hairline bg-surface-1 px-2.5 py-1 text-[13px] text-ink-1 ${
            side === "left" ? "right-2" : "left-2"
          }`}
        >
          <span className="text-[10px] tracking-[0.12em] text-ink-3">{label}</span>
          {Math.round(value).toLocaleString()}
          <span className="text-[10px] text-ink-2">{unit}</span>
        </div>
      </div>
    </div>
  );
}

function BottomStrip({ flight: f, p, oat, remainingS, units }: { flight: Flight; p: number; oat: number; remainingS: number; units: Units }) {
  return (
    <div className="absolute inset-x-4 bottom-12 [.has-panel_&]:bottom-[calc(52dvh+28px)] sm:inset-x-6 sm:bottom-14 sm:[.has-panel_&]:right-[440px] sm:[.has-panel_&]:bottom-14">
      <div className="num mb-2 flex items-end justify-between text-[12px] text-ink-2">
        <span>
          <span className="text-ink-1">{f.origin.iata ?? f.origin.icao}</span> {formatTemp(f.depTempC, units)}
        </span>
        <span className="flex items-baseline gap-3 text-ink-1">
          <span>
            <span className="mr-1.5 text-[10px] tracking-[0.12em] text-ink-3">OAT</span>
            {formatTemp(oat, units, 1)}
          </span>
          <span className="text-ink-2">{formatDuration(remainingS)} to go</span>
        </span>
        <span>
          {formatTemp(f.arrTempC, units)} <span className="text-ink-1">{f.dest.iata ?? f.dest.icao}</span>
        </span>
      </div>
      <div className="relative h-1 w-full rounded-full" style={{ background: flightGradientCss(f) }}>
        <span
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-space"
          style={{ left: `${p * 100}%`, background: tempToCss(oat) }}
        />
      </div>
    </div>
  );
}
