import { create } from "zustand";
import type { Flight, TrackPoint } from "../../shared/types";

export type Units = "C" | "F";

/** orbit: the globe view. to-cockpit / to-orbit: the camera flight. cockpit: riding the plane. */
export type CameraMode = "orbit" | "to-cockpit" | "cockpit" | "to-orbit";

function defaultUnits(): Units {
  try {
    const saved = localStorage.getItem("ff:units");
    if (saved === "C" || saved === "F") return saved;
  } catch {
    /* storage unavailable */
  }
  // Fahrenheit for US, Liberia and Myanmar locales; Celsius for everyone else.
  const region = new Intl.Locale(navigator.language).region ?? navigator.language.split("-")[1] ?? "";
  return ["US", "LR", "MM"].includes(region.toUpperCase()) ? "F" : "C";
}

/**
 * A past flight played back on a virtual clock (lib/clock.ts): time runs from `atS` at real time
 * `anchorMs`, at `rate` virtual seconds per real second while playing.
 */
export interface Replay {
  /** The flight, timed so that it flies from depTime to eta (data/replay.ts). */
  flight: Flight;
  /** Its recorded positions, once fetched; null while loading or if none were recorded. */
  track: TrackPoint[] | null;
  atS: number;
  anchorMs: number;
  rate: number;
  playing: boolean;
}

/** Virtual unix seconds of a replay at real time `nowMs`, held within its flight. */
export function replayTime(r: Replay, nowMs = Date.now()): number {
  const t = r.playing ? r.atS + ((nowMs - r.anchorMs) / 1000) * r.rate : r.atS;
  return Math.min(r.flight.eta, Math.max(r.flight.depTime, t));
}

interface State {
  units: Units;
  setUnits: (u: Units) => void;
  hoveredId: string | null;
  setHovered: (id: string | null) => void;
  selectedId: string | null;
  /** Selecting a flight opens its panel and flies the camera to it; null flies back. */
  select: (id: string | null) => void;
  cameraMode: CameraMode;
  setCameraMode: (m: CameraMode) => void;
  /** Globe auto-spin is paused while the user interacts and for 30 s after. */
  spinPaused: boolean;
  setSpinPaused: (v: boolean) => void;
  /** Flights found by search that aren't in the curated snapshot; drawn alongside it. */
  extraFlights: Flight[];
  addFlight: (f: Flight) => void;
  /** The flight being replayed, or null for the live globe. */
  replay: Replay | null;
  startReplay: (flight: Flight, rate: number) => void;
  /** Change the replay's clock: seek (`atS`), play or pause, change speed. Re-anchors it to now. */
  setReplayClock: (c: Partial<Pick<Replay, "atS" | "rate" | "playing">>) => void;
  setReplayTrack: (id: string, track: Replay["track"]) => void;
  stopReplay: () => void;
  /** Which overlay sheet is open. */
  sheet: "none" | "list" | "sources";
  setSheet: (s: "none" | "list" | "sources") => void;
}

export const useStore = create<State>((set, get) => ({
  units: defaultUnits(),
  setUnits: (units) => {
    try {
      localStorage.setItem("ff:units", units);
    } catch {
      /* ignore */
    }
    set({ units });
  },
  hoveredId: null,
  setHovered: (hoveredId) => set({ hoveredId }),
  selectedId: null,
  select: (selectedId) => {
    const { cameraMode } = get();
    if (selectedId) set({ selectedId, hoveredId: null, cameraMode: "to-cockpit" });
    // Leaving the flight being replayed ends the replay, back to the live globe.
    else set({ selectedId: null, replay: null, cameraMode: cameraMode === "orbit" ? "orbit" : "to-orbit" });
  },
  cameraMode: "orbit",
  setCameraMode: (cameraMode) => set({ cameraMode }),
  spinPaused: false,
  setSpinPaused: (spinPaused) => set({ spinPaused }),
  replay: null,
  startReplay: (flight, rate) => {
    set({ replay: { flight, track: null, atS: flight.depTime, anchorMs: Date.now(), rate, playing: true }, sheet: "none" });
    get().select(flight.id);
  },
  setReplayClock: (c) =>
    set((s) => {
      if (!s.replay) return {};
      const r = s.replay;
      const now = Date.now();
      // From where the clock is now, so a speed change or pause doesn't jump.
      const atS = Math.min(r.flight.eta, Math.max(r.flight.depTime, c.atS ?? replayTime(r, now)));
      return { replay: { ...r, ...c, atS, anchorMs: now } };
    }),
  setReplayTrack: (id, track) =>
    set((s) => {
      if (s.replay?.flight.id !== id) return {};
      // The median recorded altitude stands in for the cruise altitude.
      const alts = (track ?? []).map((p) => p[3]).sort((a, b) => a - b);
      const altM = alts.length ? alts[Math.floor(alts.length / 2)]! : 0;
      const flight = { ...s.replay.flight, pos: { ...s.replay.flight.pos, altM } };
      return { replay: { ...s.replay, track, flight } };
    }),
  stopReplay: () => get().select(null),
  sheet: "none",
  setSheet: (sheet) => set({ sheet }),
  extraFlights: [],
  addFlight: (f) => set((s) => ({ extraFlights: [...s.extraFlights.filter((x) => x.id !== f.id), f].slice(-20) })),
}));
