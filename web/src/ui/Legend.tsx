import { cToF, SCALE_MAX_C, SCALE_MIN_C, scaleGradientCss } from "../lib/color";
import { useStore } from "../store";

const TICKS_C = [-25, 0, 20, 44];

export function Legend() {
  const units = useStore((s) => s.units);
  const fmt = (c: number) => Math.round(units === "F" ? cToF(c) : c);
  return (
    <figure className="pointer-events-auto m-0 w-40 sm:w-60" aria-label="Temperature color scale">
      <div className="h-1.5 w-full rounded-full" style={{ background: scaleGradientCss() }} />
      <div className="relative mt-1.5 h-4">
        {TICKS_C.map((c) => {
          const x = ((c - SCALE_MIN_C) / (SCALE_MAX_C - SCALE_MIN_C)) * 100;
          return (
            <span
              key={c}
              className="num absolute -translate-x-1/2 text-[11px] leading-none text-ink-2 first:translate-x-0 last:-translate-x-full"
              style={{ left: `${x}%` }}
            >
              {fmt(c)}°
            </span>
          );
        })}
      </div>
    </figure>
  );
}
