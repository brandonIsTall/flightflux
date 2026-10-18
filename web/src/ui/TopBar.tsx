import { List, MagnifyingGlass } from "@phosphor-icons/react";
import { useState } from "react";
import type { Flight } from "../../../shared/types";
import { searchErrorMessage, searchFlight, SearchError } from "../data/detail";
import { USING_FIXTURE } from "../data/snapshot";
import { useStore } from "../store";

export function TopBar({ flights }: { flights: Flight[] }) {
  const units = useStore((s) => s.units);
  const setUnits = useStore((s) => s.setUnits);
  const select = useStore((s) => s.select);
  const addFlight = useStore((s) => s.addFlight);
  const setSheet = useStore((s) => s.setSheet);
  const sheet = useStore((s) => s.sheet);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = q.toUpperCase().replace(/\s+/g, "");
    if (!key || busy) return;
    const local = flights.find((f) => f.callsign === key || f.flightNo === key);
    if (local) {
      select(local.id);
      setMessage(null);
      return;
    }
    if (USING_FIXTURE) {
      setMessage(`No flight on the globe matches ${key}.`);
      return;
    }
    setBusy(true);
    try {
      const f = await searchFlight(key);
      addFlight(f);
      select(f.id);
      setMessage(null);
    } catch (err) {
      const kind = err instanceof SearchError ? err.kind : "down";
      setMessage(searchErrorMessage(kind, key, flights.length));
    } finally {
      setBusy(false);
    }
  };

  return (
    <header className="pointer-events-auto flex items-start justify-between gap-4 px-4 pt-3.5 sm:px-6">
      {/* The menu opens the flight list, which slides in on this side. Search sits under the title,
          clear of the globe, and gives way to the list's own search while the list is open. */}
      <div className="flex flex-col gap-3">
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setSheet(sheet === "list" ? "none" : "list")}
            aria-label="All flights"
            aria-expanded={sheet === "list"}
            className="pill focus-ring flex h-9 w-9 items-center justify-center text-ink-2 hover:text-ink-1"
          >
            <List size={18} weight="light" aria-hidden />
          </button>
          <a href="/" className="focus-ring rounded-sm text-[15px] font-medium tracking-tight text-ink-1">
            Flight Flux
          </a>
        </div>

        <form onSubmit={submit} className={`relative hidden w-80 ${sheet === "list" ? "" : "sm:block"}`} role="search">
          <div className="relative">
            <MagnifyingGlass
              size={16}
              weight="light"
              aria-hidden
              className={`pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-2 ${busy ? "animate-pulse" : ""}`}
            />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setMessage(null);
              }}
              placeholder="Search flight, e.g. BA117"
              aria-label="Search flight by number"
              aria-busy={busy}
              autoComplete="off"
              spellCheck={false}
              className="glass focus-ring num h-9 w-full rounded-full! pr-4 pl-9 text-[13px] text-ink-1 placeholder:font-sans placeholder:text-ink-3"
            />
          </div>
          {message && (
            <p role="status" className="glass absolute top-full mt-2 w-full rounded-[10px]! px-3.5 py-2.5 text-[12px] leading-snug text-ink-2">
              {message}
            </p>
          )}
        </form>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setSheet("list")}
          aria-label="Search flights"
          className="pill focus-ring flex h-9 w-9 items-center justify-center text-ink-2 hover:text-ink-1 sm:hidden"
        >
          <MagnifyingGlass size={18} weight="light" aria-hidden />
        </button>
      <div role="radiogroup" aria-label="Temperature unit" className="pill flex h-9 shrink-0 p-0.5">
        {(["C", "F"] as const).map((u) => (
          <button
            key={u}
            type="button"
            role="radio"
            aria-checked={units === u}
            onClick={() => setUnits(u)}
            className={`num focus-ring h-full rounded-full px-3 text-[13px] transition-colors duration-200 ${
              units === u ? "bg-ink-1 text-space" : "text-ink-2 hover:text-ink-1"
            }`}
          >
            °{u}
          </button>
        ))}
      </div>
      </div>
    </header>
  );
}
