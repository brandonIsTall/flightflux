// The CSS/SVG form of a flight's gradient: the same OKLab blend the globe lines use.

import type { Flight } from "../../../shared/types";
import { tempAtProgress } from "../data/snapshot";
import { tempToCss } from "./color";

export const GRADIENT_STOPS = 12;

/** [offset 0..1, css color] pairs along the route. */
export function flightGradientStops(f: Flight): [number, string][] {
  return Array.from({ length: GRADIENT_STOPS + 1 }, (_, i) => {
    const p = i / GRADIENT_STOPS;
    return [p, tempToCss(tempAtProgress(f, p))];
  });
}

export function flightGradientCss(f: Flight, angle = "90deg"): string {
  return `linear-gradient(${angle}, ${flightGradientStops(f)
    .map(([p, c]) => `${c} ${(p * 100).toFixed(1)}%`)
    .join(", ")})`;
}
