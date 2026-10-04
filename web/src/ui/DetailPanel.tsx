// The flight detail panel: temperature pair, route chart, facts, photo. See docs/PLAN.md §6.6.

import { Clock, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Flight } from "../../../shared/types";
import { useFlightDetail } from "../data/detail";
import { formatAltitude, formatDelta, formatLocalTime, formatSpeed, formatTemp } from "../lib/format";
import { useStore } from "../store";
import { RouteChart } from "./RouteChart";

export function DetailPanel({ flights }: { flights: Flight[] }) {
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const flight = selectedId ? (flights.find((f) => f.id === selectedId) ?? null) : null;

  useEffect(() => {
    if (!flight) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && select(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flight, select]);

  return (
    <AnimatePresence>
      {flight && (
        <motion.aside
          key={flight.id}
          aria-label={`Flight ${flight.flightNo ?? flight.callsign}`}
          className="glass pointer-events-auto absolute inset-x-3 bottom-3 z-10 max-h-[52dvh] overflow-y-auto sm:inset-x-auto sm:top-20 sm:right-6 sm:bottom-auto sm:max-h-[calc(100dvh-104px)] sm:w-[400px]"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0, transition: { type: "spring", stiffness: 100, damping: 20 } }}
          exit={{ opacity: 0, x: 24, transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] } }}
        >
          {/* Bottom sheet affordance on phones. */}
          <div aria-hidden className="mx-auto mt-2 h-1 w-9 rounded-full bg-ink-3/60 sm:hidden" />
          <PanelBody flight={flight} onClose={() => select(null)} />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function PanelBody({ flight: f, onClose }: { flight: Flight; onClose: () => void }) {
  const units = useStore((s) => s.units);
  const detail = useFlightDetail(f);
  const aircraft = detail.data?.aircraft ?? null;

  const [nowS, setNowS] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = window.setInterval(() => setNowS(Date.now() / 1000), 5_000);
    return () => window.clearInterval(id);
  }, []);

  const estimated = f.flags.depTimeSource === "estimated";

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="num text-[15px] font-medium leading-tight text-ink-1">{f.flightNo ?? f.callsign}</h2>
          <p className="mt-0.5 truncate text-[13px] text-ink-2">
            {f.airline?.name ?? f.callsign}
            {aircraft?.type ? `, ${aircraft.type}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to globe"
          className="pill focus-ring -mt-1 -mr-1 flex h-8 w-8 shrink-0 items-center justify-center text-ink-2 hover:text-ink-1"
        >
          <X size={16} weight="light" aria-hidden />
        </button>
      </header>

      {/* The headline: the two temperatures, with the change between them. */}
      <div className="flex items-end justify-between gap-4">
        <Big temp={f.depTempC} code={f.origin.iata ?? f.origin.icao} city={f.origin.city} units={units} />
        <span className="num mb-6 shrink-0 rounded-full border border-hairline px-2.5 py-1 text-[12px] text-ink-1">
          {formatDelta(f.arrTempC - f.depTempC, units)}
        </span>
        <Big temp={f.arrTempC} code={f.dest.iata ?? f.dest.icao} city={f.dest.city} units={units} right />
      </div>

      <RouteChart flight={f} nowS={nowS} units={units} />

      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-[13px]">
        <Fact
          label="Departed"
          value={`${formatLocalTime(f.depTime, f.origin.tz, f.origin.utcOffsetS)} local`}
          note={estimated ? "estimated" : undefined}
        />
        <Fact label="Lands" value={`${formatLocalTime(f.eta, f.dest.tz, f.dest.utcOffsetS)} local`} note="estimated" />
        <Fact label="Altitude" value={formatAltitude(f.pos.altM, units)} />
        <Fact label="Ground speed" value={formatSpeed(f.pos.gsMs, units)} />
        <Fact label="Aircraft" value={aircraft?.icaoType ?? (detail.isLoading ? "…" : "Unknown")} />
        <Fact label="Registration" value={aircraft?.registration ?? (detail.isLoading ? "…" : "Unknown")} />
      </dl>

      {aircraft?.photoUrl && (
        <img
          src={aircraft.photoUrl}
          alt={`${aircraft.type ?? "Aircraft"} ${aircraft.registration ?? ""}`.trim()}
          loading="lazy"
          className="aspect-[3/2] w-full rounded-[10px] object-cover"
        />
      )}

      <button type="button" onClick={onClose} className="pill focus-ring h-10 w-full text-[13px] font-medium">
        Back to globe
      </button>
    </div>
  );
}

function Big({ temp, code, city, units, right }: { temp: number; code: string; city: string; units: "C" | "F"; right?: boolean }) {
  return (
    <div className={`min-w-0 ${right ? "text-right" : ""}`}>
      <div className="num text-[44px] leading-none font-light tracking-tight text-ink-1">{formatTemp(temp, units)}</div>
      <div className="mt-2 truncate text-[13px] text-ink-2">
        <span className="num text-ink-1">{code}</span> {city}
      </div>
    </div>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className="num mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-ink-1">
        <span className="truncate">{value}</span>
        {note && (
          <span className="flex items-center gap-1 font-sans text-[11px] text-ink-2">
            <Clock size={12} weight="light" aria-hidden />
            {note}
          </span>
        )}
      </dd>
    </div>
  );
}
