import { MagnifyingGlass } from "@phosphor-icons/react";
import { useState } from "react";
import type { Flight } from "../../../shared/types";
import { useStore } from "../store";

export function TopBar({ flights }: { flights: Flight[] }) {
  const units = useStore((s) => s.units);
  const setUnits = useStore((s) => s.setUnits);
  const select = useStore((s) => s.select);
  const [q, setQ] = useState("");
  const [miss, setMiss] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const key = q.toUpperCase().replace(/\s+/g, "");
    if (!key) return;
    const hit = flights.find((f) => f.callsign === key || f.flightNo === key);
    if (hit) {
      select(hit.id);
      setMiss(null);
    } else {
      setMiss(key);
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
          className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-2"
        />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setMiss(null);
          }}
          placeholder="Search flight, e.g. BA117"
          aria-label="Search flight by number"
          autoComplete="off"
          spellCheck={false}
          className="pill num h-9 w-full pl-9 pr-4 text-[13px] text-ink-1 placeholder:font-sans placeholder:text-ink-3"
        />
        {miss && (
          <p role="status" className="absolute top-full mt-2 pl-3.5 text-[12px] text-ink-2">
            No flight on the globe matches <span className="num text-ink-1">{miss}</span>.
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
