// The flight list: every curated flight, sorted by temperature change, as a keyboard-navigable
// list. It's the table-view counterpart to the globe and the only way to reach a flight without a
// pointer. On phones it also holds the search box.

import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Flight } from "../../../shared/types";
import { searchFlight, SearchError } from "../data/detail";
import { progressAt, USING_FIXTURE } from "../data/snapshot";
import { formatDelta, formatTemp } from "../lib/format";
import { flightGradientCss } from "../lib/gradient";
import { useStore } from "../store";

export function FlightList({ flights }: { flights: Flight[] }) {
  const open = useStore((s) => s.sheet === "list");
  const setSheet = useStore((s) => s.setSheet);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="list"
          role="dialog"
          aria-modal="true"
          aria-label="All flights"
          className="glass pointer-events-auto absolute inset-x-3 top-3 bottom-3 z-30 flex flex-col overflow-hidden sm:inset-auto sm:top-20 sm:left-6 sm:bottom-6 sm:w-[420px]"
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0, transition: { type: "spring", stiffness: 100, damping: 20 } }}
          exit={{ opacity: 0, x: -24, transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] } }}
        >
          <ListBody flights={flights} onClose={() => setSheet("none")} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ListBody({ flights, onClose }: { flights: Flight[]; onClose: () => void }) {
  const units = useStore((s) => s.units);
  const select = useStore((s) => s.select);
  const setSheet = useStore((s) => s.setSheet);
  const addFlight = useStore((s) => s.addFlight);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const nowS = Date.now() / 1000;

  const sorted = useMemo(() => [...flights].sort((a, b) => Math.abs(b.arrTempC - b.depTempC) - Math.abs(a.arrTempC - a.depTempC)), [flights]);
  const key = q.toUpperCase().replace(/\s+/g, "");
  const shown = key
    ? sorted.filter((f) => [f.callsign, f.flightNo, f.origin.iata, f.dest.iata, f.origin.city, f.dest.city, f.airline?.name].some((v) => v?.toUpperCase().includes(key)))
    : sorted;

  // Esc closes; arrows move between rows.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const rows = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-row]") ?? []);
        const i = rows.indexOf(document.activeElement as HTMLButtonElement);
        const next = rows[e.key === "ArrowDown" ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1)];
        if (next) {
          e.preventDefault();
          next.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const choose = (f: Flight) => {
    setSheet("none");
    select(f.id);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key || busy) return;
    if (shown.length > 0) return choose(shown[0]!);
    if (USING_FIXTURE) return setMessage(`No flight on the globe matches ${key}.`);
    setBusy(true);
    try {
      const f = await searchFlight(key);
      addFlight(f);
      choose(f);
    } catch (err) {
      const kind = err instanceof SearchError ? err.kind : "down";
      setMessage(
        kind === "none"
          ? `No airborne flight matches ${key}. Check the number, or it may have landed.`
          : kind === "rate"
            ? "Too many searches. Try again in a minute."
            : "Search is unavailable right now.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
        <h2 className="text-[15px] font-medium text-ink-1">
          Flights <span className="num ml-1 text-ink-3">{flights.length}</span>
        </h2>
        <button type="button" onClick={onClose} aria-label="Close" className="pill focus-ring flex h-8 w-8 items-center justify-center text-ink-2 hover:text-ink-1">
          <X size={16} weight="light" aria-hidden />
        </button>
      </header>

      <form onSubmit={submit} role="search" className="relative px-5 pb-3">
        <MagnifyingGlass size={16} weight="light" aria-hidden className={`pointer-events-none absolute top-1/2 left-8.5 -translate-y-1/2 text-ink-2 ${busy ? "animate-pulse" : ""}`} />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setMessage(null);
          }}
          placeholder="Flight, airline or airport"
          aria-label="Filter flights or search by flight number"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          className="pill num h-9 w-full pr-4 pl-9 text-[13px] text-ink-1 placeholder:font-sans placeholder:text-ink-3"
        />
        {message && (
          <p role="status" className="mt-2 pl-3.5 text-[12px] text-ink-2">
            {message}
          </p>
        )}
      </form>

      <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Flights by temperature change">
        {shown.length === 0 && !message && <li className="px-3 py-6 text-[13px] text-ink-2">No flight on the globe matches. Press Enter to search every airborne flight.</li>}
        {shown.map((f) => {
          const p = progressAt(f, nowS);
          return (
            <li key={f.id}>
              <button
                type="button"
                data-row
                onClick={() => choose(f)}
                className="focus-ring grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-3 rounded-[10px] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04]"
              >
                <span className="num w-14 text-[13px] text-ink-1">{f.flightNo ?? f.callsign}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-ink-2">
                    <span className="num text-ink-1">{f.origin.iata ?? f.origin.icao}</span> {f.origin.city} →{" "}
                    <span className="num text-ink-1">{f.dest.iata ?? f.dest.icao}</span> {f.dest.city}
                  </span>
                  <span className="relative mt-1.5 block h-0.5 w-full rounded-full" style={{ background: flightGradientCss(f) }}>
                    <span className="absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-1" style={{ left: `${p * 100}%` }} />
                  </span>
                </span>
                <span className="num text-right text-[12px] leading-tight text-ink-2">
                  {formatTemp(f.depTempC, units)} → {formatTemp(f.arrTempC, units)}
                  <span className="block text-ink-1">{formatDelta(f.arrTempC - f.depTempC, units)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <footer className="border-t border-hairline px-5 py-3 text-[12px] text-ink-2">
        <button type="button" onClick={() => setSheet("sources")} className="focus-ring rounded-sm underline decoration-hairline underline-offset-4 hover:text-ink-1">
          Data sources
        </button>
      </footer>
    </>
  );
}
