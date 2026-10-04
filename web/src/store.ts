import { create } from "zustand";

export type Units = "C" | "F";

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
  select: (id: string | null) => void;
  /** Globe auto-spin is paused while the user interacts and for 30 s after. */
  spinPaused: boolean;
  setSpinPaused: (v: boolean) => void;
}

export const useStore = create<State>((set) => ({
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
  select: (selectedId) => set({ selectedId }),
  spinPaused: false,
  setSpinPaused: (spinPaused) => set({ spinPaused }),
}));
