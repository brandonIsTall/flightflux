// The temperature scale: the only saturated color in the app. See docs/PLAN.md §6.4.
// Diverging, blue -> neutral gray at 15 C -> red-orange, interpolated in OKLab.

export const SCALE_MIN_C = -25;
export const SCALE_MAX_C = 44;

/** [degC, hex] stops, validated for CVD separation and >= 4:1 contrast on --space. */
export const STOPS: [number, string][] = [
  [-25, "#3B6FD9"],
  [-10, "#6E9BEA"],
  [3, "#A9C3EE"],
  [15, "#C9C8C2"],
  [26, "#F0B48C"],
  [35, "#EC7A50"],
  [44, "#D9412B"],
];

export type RGB = [number, number, number]; // 0..1 linear-ish sRGB components
type Lab = [number, number, number];

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function rgbToOklab([r, g, b]: RGB): Lab {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb([L, a, b]: Lab): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  return [
    clamp(toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    clamp(toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    clamp(toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
  ];
}

const LAB_STOPS = STOPS.map(([t, hex]) => [t, rgbToOklab(hexToRgb(hex))] as [number, Lab]);

/** Color for a temperature, clamped to the scale's ends. */
export function tempToRgb(tC: number): RGB {
  const t = Math.min(SCALE_MAX_C, Math.max(SCALE_MIN_C, tC));
  for (let i = 0; i < LAB_STOPS.length - 1; i++) {
    const [t0, c0] = LAB_STOPS[i]!;
    const [t1, c1] = LAB_STOPS[i + 1]!;
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return oklabToRgb([c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f]);
    }
  }
  return oklabToRgb(LAB_STOPS[LAB_STOPS.length - 1]![1]);
}

export function tempToCss(tC: number): string {
  const [r, g, b] = tempToRgb(tC);
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

/** CSS gradient of the whole scale, for the legend. */
export function scaleGradientCss(): string {
  const n = 24;
  const stops = Array.from({ length: n + 1 }, (_, i) => {
    const t = SCALE_MIN_C + ((SCALE_MAX_C - SCALE_MIN_C) * i) / n;
    return `${tempToCss(t)} ${(i / n) * 100}%`;
  });
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

export const cToF = (c: number) => (c * 9) / 5 + 32;
