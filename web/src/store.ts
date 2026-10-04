import { create } from "zustand";
import type { Flight } from "../../shared/types";

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
    else set({ selectedId: null, cameraMode: cameraMode === "orbit" ? "orbit" : "to-orbit" });
  },
  cameraMode: "orbit",
  setCameraMode: (cameraMode) => set({ cameraMode }),
  spinPaused: false,
  setSpinPaused: (spinPaused) => set({ spinPaused }),
  sheet: "none",
  setSheet: (sheet) => set({ sheet }),
  extraFlights: [],
  addFlight: (f) => set((s) => ({ extraFlights: [...s.extraFlights.filter((x) => x.id !== f.id), f].slice(-20) })),
}));
