// The replay controls, in the top bar's place while a past flight is replayed: play/pause, a
// scrubber from take-off to landing painted with the flight's gradient, speed, and back to live.

import { Pause, Play, X } from "@phosphor-icons/react";
import { useEffect } from "react";
import { defaultRate } from "../data/replay";
import { useNowS } from "../lib/clock";
import { formatDuration, formatLocalTime } from "../lib/format";
import { flightGradientCss } from "../lib/gradient";
import { useStore, type Replay } from "../store";

/** Multiples of the default speed (a whole flight in REPLAY_SECONDS). */
const SPEEDS = [1, 2, 4];

export function ReplayBar({ replay }: { replay: Replay }) {
  const setClock = useStore((s) => s.setReplayClock);
  const stop = useStore((s) => s.stopReplay);
  const t = useNowS(100);
  const f = replay.flight;
  const ended = t >= f.eta;
  const base = defaultRate(f);
  const speed = SPEEDS.reduce((a, b) => (Math.abs(b * base - replay.rate) < Math.abs(a * base - replay.rate) ? b : a));

  // Stop at landing rather than sit playing at the end.
  useEffect(() => {
    if (replay.playing && ended) setClock({ playing: false });
  }, [replay.playing, ended, setClock]);

  const toggle = () => (ended ? setClock({ atS: f.depTime, playing: true }) : setClock({ playing: !replay.playing }));

  return (
    <header className="glass pointer-events-auto mx-3 mt-3 flex items-center gap-3 px-3 py-2 sm:mx-auto sm:mt-4 sm:w-[560px]">
      <button
        type="button"
        onClick={toggle}
        aria-label={replay.playing ? "Pause replay" : ended ? "Replay from take-off" : "Play replay"}
        className="pill focus-ring flex h-9 w-9 shrink-0 items-center justify-center text-ink-1"
      >
        {replay.playing ? <Pause size={16} weight="fill" aria-hidden /> : <Play size={16} weight="fill" aria-hidden />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[11px] text-ink-2">
          <span className="truncate">
            Replay <span className="num text-ink-1">{f.flightNo ?? f.callsign}</span>
          </span>
          <span className="num shrink-0">
            <span className="hidden sm:inline">
              {formatLocalTime(t, f.origin.tz, f.origin.utcOffsetS)} {f.origin.iata ?? f.origin.icao} time ·{" "}
            </span>
            {formatDuration(Math.max(0, t - f.depTime))} in
          </span>
        </div>
        <input
          type="range"
          min={f.depTime}
          max={f.eta}
          step={60}
          value={Math.round(t)}
          onChange={(e) => setClock({ atS: Number(e.target.value) })}
          aria-label="Replay time"
          aria-valuetext={`${formatDuration(Math.max(0, t - f.depTime))} after take-off`}
          className="scrub block w-full"
          style={{ background: flightGradientCss(f) }}
        />
      </div>
      <button
        type="button"
        onClick={() => setClock({ rate: base * SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]! })}
        aria-label={`Replay speed ${speed}×, change`}
        className="pill focus-ring num h-9 w-11 shrink-0 text-[12px] text-ink-1"
      >
        {speed}×
      </button>
      <button type="button" onClick={stop} aria-label="Back to live" className="pill focus-ring flex h-9 w-9 shrink-0 items-center justify-center text-ink-2 hover:text-ink-1">
        <X size={16} weight="light" aria-hidden />
      </button>
    </header>
  );
}
