// The flight list: every curated flight, sorted by temperature change, as a keyboard-navigable
// list. It's the table-view counterpart to the globe and the only way to reach a flight without a
// pointer. On phones it also holds the search box. Curated flights are numbered by rank; flights
// added by search are listed in place but unnumbered, since curation didn't pick them. The other
// tabs are the leaderboard: the top 10 swings of the last 24 h, 7 days and 30 days, landed or not.

import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Flight, LeaderFlight, LeaderWindow } from "../../../shared/types";
import { searchErrorMessage, searchFlight, SearchError } from "../data/detail";
import { LEADER_WINDOWS, useLeaders } from "../data/leaders";
import { hasLanded, progressAt, useSnapshot, USING_FIXTURE } from "../data/snapshot";
import { formatAgo, formatDelta, formatTemp } from "../lib/format";
import { flightGradientCss } from "../lib/gradient";
import { bySwing, rankBySwing } from "../lib/rank";
import { useStore, type Units } from "../store";

type View = "live" | LeaderWindow;
const VIEWS: { key: View; label: string }[] = [{ key: "live", label: "Live" }, ...LEADER_WINDOWS];

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
  const [view, setView] = useState<View>("live");
  const leaders = useLeaders(view !== "live");
  // The curated flights only: `flights` also holds searched ones.
  const curated = useSnapshot().data?.flights;
  const curatedCount = curated?.length ?? 0;
  const listRef = useRef<HTMLUListElement>(null);
  const nowS = Date.now() / 1000;

  const sorted = useMemo(() => bySwing(flights), [flights]);
  // Ranked before filtering, so a flight keeps its number while the list is searched.
  const ranks = useMemo(() => rankBySwing(sorted, new Set(curated?.map((f) => f.id))), [sorted, curated]);
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
      setMessage(searchErrorMessage(kind, key, curatedCount));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
        <h2 className="text-[15px] font-medium text-ink-1">
          Flights {view === "live" && <span className="num ml-1 text-ink-3">{flights.length}</span>}
        </h2>
        <button type="button" onClick={onClose} aria-label="Close" className="pill focus-ring flex h-8 w-8 items-center justify-center text-ink-2 hover:text-ink-1">
          <X size={16} weight="light" aria-hidden />
        </button>
      </header>

      <div role="radiogroup" aria-label="Biggest temperature changes" className="pill mx-5 mb-3 flex h-9 p-0.5">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            role="radio"
            aria-checked={view === v.key}
            onClick={() => setView(v.key)}
            className={`focus-ring h-full flex-1 rounded-full text-[13px] transition-colors duration-200 ${
              view === v.key ? "bg-ink-1 text-space" : "text-ink-2 hover:text-ink-1"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view !== "live" && <Leaderboard view={view} leaders={leaders} flights={flights} units={units} nowS={nowS} listRef={listRef} onChoose={choose} />}

      {view === "live" && (
        <>
          <form onSubmit={submit} role="search" className="relative px-5 pb-3">
            <div className="relative">
              <MagnifyingGlass size={16} weight="light" aria-hidden className={`pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-2 ${busy ? "animate-pulse" : ""}`} />
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
            </div>
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
              const rank = ranks.get(f.id);
              return (
                <li key={f.id}>
                  <Row f={f} rank={rank} progress={p} units={units} onClick={() => choose(f)} />
                </li>
              );
            })}
          </ul>
        </>
      )}

      <footer className="border-t border-hairline px-5 py-3 text-[12px] text-ink-2">
        <button type="button" onClick={() => setSheet("sources")} className="focus-ring rounded-sm underline decoration-hairline underline-offset-4 hover:text-ink-1">
          Data sources
        </button>
      </footer>
    </>
  );
}

function Leaderboard({
  view,
  leaders,
  flights,
  units,
  nowS,
  listRef,
  onChoose,
}: {
  view: LeaderWindow;
  leaders: ReturnType<typeof useLeaders>;
  flights: Flight[];
  units: Units;
  nowS: number;
  listRef: React.RefObject<HTMLUListElement | null>;
  onChoose: (f: Flight) => void;
}) {
  const top = leaders.data?.windows[view] ?? [];
  const label = LEADER_WINDOWS.find((w) => w.key === view)!.label;
  const onGlobe = new Map(flights.map((f) => [f.id, f]));
  return (
    <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label={`Biggest temperature changes, last ${label}`}>
      {leaders.isLoading && <li className="px-3 py-6 text-[13px] text-ink-2">Loading the leaderboard…</li>}
      {leaders.isError && !leaders.data && <li className="px-3 py-6 text-[13px] text-ink-2">The leaderboard isn't available right now.</li>}
      {leaders.data && top.length === 0 && <li className="px-3 py-6 text-[13px] text-ink-2">No flights recorded in the last {label} yet.</li>}
      {top.map((f, i) => {
        // Still on the globe: open it there. Landed or never curated: nothing to fly to yet.
        const live = onGlobe.get(f.id);
        const landed = live ? hasLanded(live, nowS) : f.eta < nowS;
        return (
          <li key={f.id}>
            <Row
              f={f}
              rank={i + 1}
              progress={live ? progressAt(live, nowS) : null}
              status={landed ? `Landed ${formatAgo(nowS - f.eta)}` : live ? null : "In the air, not on the globe"}
              units={units}
              onClick={live ? () => onChoose(live) : undefined}
            />
          </li>
        );
      })}
    </ul>
  );
}

/** One flight: rank, number, route with its gradient, temperatures. A button when it can be opened. */
function Row({
  f,
  rank,
  progress,
  status = null,
  units,
  onClick,
}: {
  f: LeaderFlight;
  rank: number | undefined;
  /** Where the plane is along the route, or null to draw no marker. */
  progress: number | null;
  status?: string | null;
  units: Units;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="num w-6 text-right text-[12px] text-ink-3">
        {rank !== undefined && (
          <>
            <span className="sr-only">Rank </span>
            {rank}
          </>
        )}
      </span>
      <span className="num w-14 text-[13px] text-ink-1">{f.flightNo ?? f.callsign}</span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] text-ink-2">
          <span className="num text-ink-1">{f.origin.iata ?? f.origin.icao}</span> {f.origin.city} →{" "}
          <span className="num text-ink-1">{f.dest.iata ?? f.dest.icao}</span> {f.dest.city}
        </span>
        <span className="relative mt-1.5 block h-0.5 w-full rounded-full" style={{ background: flightGradientCss(f) }}>
          {progress !== null && (
            <span className="absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-1" style={{ left: `${progress * 100}%` }} />
          )}
        </span>
        {status && <span className="mt-1.5 block text-[11px] text-ink-3">{status}</span>}
      </span>
      <span className="num text-right text-[12px] leading-tight text-ink-2">
        {formatTemp(f.depTempC, units)} → {formatTemp(f.arrTempC, units)}
        <span className="block text-ink-1">{formatDelta(f.arrTempC - f.depTempC, units)}</span>
      </span>
    </>
  );
  const cls = "grid w-full grid-cols-[auto_auto_1fr_auto] items-center gap-x-3 rounded-[10px] px-3 py-2.5 text-left";
  return onClick ? (
    <button type="button" data-row onClick={onClick} className={`focus-ring ${cls} transition-colors hover:bg-white/[0.04]`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}
