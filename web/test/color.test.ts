import { describe, expect, it } from "vitest";
import { cToF, SCALE_MAX_C, SCALE_MIN_C, STOPS, tempToCss, tempToRgb } from "../src/lib/color";

const lum = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

describe("temperature scale", () => {
  it("hits each stop exactly", () => {
    for (const [t, hex] of STOPS) {
      const [r, g, b] = tempToRgb(t).map((c) => Math.round(c * 255));
      expect(`#${[r, g, b].map((c) => c!.toString(16).padStart(2, "0")).join("")}`.toUpperCase()).toBe(hex);
    }
  });

  it("clamps outside the scale", () => {
    expect(tempToRgb(-80)).toEqual(tempToRgb(SCALE_MIN_C));
    expect(tempToRgb(60)).toEqual(tempToRgb(SCALE_MAX_C));
  });

  it("is a neutral gray at 15 C", () => {
    const [r, g, b] = tempToRgb(15);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(0.04);
  });

  it("gets lighter toward the midpoint on both arms, so magnitude reads in grayscale", () => {
    for (let t = SCALE_MIN_C; t < 15; t += 1) expect(lum(tempToRgb(t + 1))).toBeGreaterThanOrEqual(lum(tempToRgb(t)) - 1e-6);
    for (let t = 15; t < SCALE_MAX_C; t += 1) expect(lum(tempToRgb(t + 1))).toBeLessThanOrEqual(lum(tempToRgb(t)) + 1e-6);
  });

  it("formats css and converts units", () => {
    expect(tempToCss(15)).toMatch(/^rgb\(\d+ \d+ \d+\)$/);
    expect(cToF(100)).toBe(212);
  });
});
