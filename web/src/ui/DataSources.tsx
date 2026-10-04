// Attribution the data licenses require, in one place.

import { X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { useStore } from "../store";

const SOURCES: { name: string; what: string; terms: string; url: string }[] = [
  { name: "OpenSky Network", what: "Live aircraft positions", terms: "Non-commercial use", url: "https://opensky-network.org" },
  { name: "adsbdb", what: "Callsign routes, aircraft types and photos", terms: "Free API", url: "https://www.adsbdb.com" },
  { name: "Open-Meteo", what: "Hourly temperatures at departure and arrival", terms: "CC BY 4.0, non-commercial", url: "https://open-meteo.com" },
  { name: "Natural Earth via world-atlas", what: "The land shapes on the globe", terms: "Public domain", url: "https://github.com/topojson/world-atlas" },
  { name: "Geist by Vercel", what: "Typefaces", terms: "SIL Open Font License", url: "https://vercel.com/font" },
];

export function DataSources() {
  const open = useStore((s) => s.sheet === "sources");
  const setSheet = useStore((s) => s.setSheet);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSheet("none");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setSheet]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="sources"
          role="dialog"
          aria-modal="true"
          aria-label="Data sources"
          className="glass pointer-events-auto absolute inset-x-3 bottom-3 z-30 max-h-[80dvh] overflow-y-auto p-6 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[460px] sm:-translate-x-1/2 sm:-translate-y-1/2"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0, transition: { type: "spring", stiffness: 120, damping: 20 } }}
          exit={{ opacity: 0, y: 16, transition: { duration: 0.2 } }}
        >
          <header className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-medium text-ink-1">Data sources</h2>
              <p className="mt-1 text-[13px] text-ink-2">
                Positions update every few minutes and are projected along each route in between. Temperatures are the
                hourly value at the departure airport when the flight left and the forecast at the arrival airport for
                its landing time. Departure times are observed where possible and estimated otherwise.
              </p>
            </div>
            <button type="button" onClick={() => setSheet("none")} aria-label="Close" className="pill focus-ring flex h-8 w-8 shrink-0 items-center justify-center text-ink-2 hover:text-ink-1">
              <X size={16} weight="light" aria-hidden />
            </button>
          </header>
          <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-[13px]">
            {SOURCES.map((s) => (
              <div key={s.name} className="contents">
                <dt>
                  <a href={s.url} target="_blank" rel="noreferrer" className="focus-ring rounded-sm text-ink-1 underline decoration-hairline underline-offset-4 hover:decoration-ink-2">
                    {s.name}
                  </a>
                </dt>
                <dd className="text-ink-2">
                  {s.what}
                  <span className="block text-[12px] text-ink-3">{s.terms}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-5 text-[12px] text-ink-3">Flight Flux is a non-commercial project. Nothing here is for navigation.</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
