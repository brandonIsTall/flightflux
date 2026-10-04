// The Thermal Boot: a loading sequence whose beats are gated on real loading stages, so it never
// lies and ends exactly when the data is ready. See docs/PLAN.md §7.
//
// Beats (each 0..1):
//   sweep      a line in the temperature scale crosses the screen and curls into the equator
//   graticule  latitude and longitude lines draw themselves into a wireframe globe
//   dots       land fades in as a dot field, then cross-fades to the real texture (needs texture)
//   pings      planes appear as transponder pings (needs the snapshot)
//   routes     grey arcs trace from each origin to its plane
//   warm       the lines flood with color from the origin outward
//   handoff    status line becomes the wordmark, chrome fades in, spin eases in
//
// Per-frame values live in a mutable object read inside useFrame, not React state; React only
// sees the coarse `phase` and the status line.

import { create } from "zustand";

export type BootPhase = "booting" | "handoff" | "done";

export const beats = {
  sweep: 0,
  graticule: 0,
  dots: 0,
  /** 0..1 cross-fade from dots to the textured sphere. */
  texture: 0,
  pings: 0,
  routes: 0,
  warm: 0,
  handoff: 0,
};

/** What the real loading has delivered so far. */
export const ready = { texture: false, snapshot: false, flights: 0, known: 0 };

interface BootState {
  phase: BootPhase;
  /** Status line text, e.g. "Acquiring transponders". */
  label: string;
  /** Digits shown after the label with a split-flap roll; null for none. */
  count: number | null;
  /** A temperature readout shown after the label during warm-up, e.g. "DXB 38°". */
  readout: string | null;
  /** Shown when a stage has waited too long, e.g. "OpenSky is slow, using positions from 3 min ago". */
  notice: string | null;
  reduced: boolean;
  skipped: boolean;
  set: (patch: Partial<BootState>) => void;
  skip: () => void;
}

const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const useBoot = create<BootState>((set) => ({
  phase: "booting",
  label: "",
  count: null,
  readout: null,
  notice: null,
  reduced,
  skipped: false,
  set: (patch) => set(patch),
  skip: () => set({ skipped: true }),
}));

/** Jump every beat to its end state. */
export function completeBeats() {
  for (const k of Object.keys(beats) as (keyof typeof beats)[]) beats[k] = 1;
}

// Inspection hook for debugging and scripted tests: `window.__ffBoot`.
declare global {
  interface Window {
    __ffBoot?: { beats: typeof beats; ready: typeof ready; state: () => BootState };
  }
}
if (typeof window !== "undefined") window.__ffBoot = { beats, ready, state: () => useBoot.getState() };
