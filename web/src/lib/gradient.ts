// The CSS/SVG form of a flight's gradient: the same OKLab blend the globe lines use.

import type { Flight } from "../../../shared/types";
import { tempAtProgress } from "../data/snapshot";
import { tempToCss } from "./color";

export const GRADIENT_STOPS = 12;

type Temps = Pick<Flight, "depTempC" | "arrTempC" | "profile">;

/** [offset 0..1, css color] pairs along the route: one per profile point when it has more. */
export function flightGradientStops(f: Temps): [number, string][] {
  const n = Math.max(GRADIENT_STOPS, (f.profile?.length ?? 0) - 1);
  return Array.from({ length: n + 1 }, (_, i) => {
    const p = i / n;
    return [p, tempToCss(tempAtProgress(f, p))];
  });
}

export function flightGradientCss(f: Temps, angle = "90deg"): string {
  return `linear-gradient(${angle}, ${flightGradientStops(f)
    .map(([p, c]) => `${c} ${(p * 100).toFixed(1)}%`)
    .join(", ")})`;
}
