import { MagnifyingGlass } from "@phosphor-icons/react";
import { useState } from "react";
import type { Flight } from "../../../shared/types";
import { searchFlight, SearchError } from "../data/detail";
import { USING_FIXTURE } from "../data/snapshot";
import { useStore } from "../store";

export function TopBar({ flights }: { flights: Flight[] }) {
  const units = useStore((s) => s.units);
  const setUnits = useStore((s) => s.setUnits);
  const select = useStore((s) => s.select);
  const addFlight = useStore((s) => s.addFlight);
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
    <header className="pointer-events-auto flex h-16 items-center justify-between gap-4 px-4 sm:px-6">
      <a href="/" className="focus-ring shrink-0 rounded-sm text-[15px] font-medium tracking-tight text-ink-1">
        Flight Flux
      </a>

      <form onSubmit={submit} className="relative hidden w-full max-w-sm sm:block" role="search">
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
          className="pill num h-9 w-full pr-4 pl-9 text-[13px] text-ink-1 placeholder:font-sans placeholder:text-ink-3"
        />
        {message && (
          <p role="status" className="absolute top-full mt-2 pl-3.5 text-[12px] text-ink-2">
            {message}
          </p>
        )}
      </form>

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
    </header>
  );
}
