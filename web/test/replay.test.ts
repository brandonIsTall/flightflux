import { describe, expect, it } from "vitest";
import type { LeaderFlight } from "../../shared/types";
import { defaultRate, REPLAY_SECONDS, replayFlight } from "../src/data/replay";
import { progressAt, tempAtProgress } from "../src/data/snapshot";
import { flightGradientStops } from "../src/lib/gradient";
import { replayTime, useStore, type Replay } from "../src/store";

const T = 1_791_080_000;
const leader = {
  id: "abc123-20261028",
  icao24: "abc123",
  callsign: "BAW1",
  flightNo: "BA1",
  airline: null,
  aircraftType: null,
  origin: { icao: "EGLL", iata: "LHR", name: "", city: "London", country: "", lat: 51.47, lon: -0.46 },
  dest: { icao: "KJFK", iata: "JFK", name: "", city: "New York", country: "", lat: 40.64, lon: -73.78 },
  distKm: 5540,
  depTime: T,
  eta: T + 8 * 3600,
  depTempC: 12,
  arrTempC: 25,
  flags: { depTimeSource: "estimated" },
} satisfies LeaderFlight;

describe("replay", () => {
  it("flies the replayed flight from take-off to landing, linearly in time", () => {
    const f = replayFlight(leader);
    expect(progressAt(f, T)).toBe(0);
    expect(progressAt(f, T + 4 * 3600)).toBeCloseTo(0.5, 2);
    expect(progressAt(f, T + 8 * 3600)).toBeCloseTo(0.995, 3); // held just short, like live flights
    expect(f.pos.altM).toBe(0); // unknown until a track arrives
    expect(defaultRate(f)).toBe(Math.round((8 * 3600) / REPLAY_SECONDS));
  });

  it("runs a virtual clock that pauses, seeks and changes speed without jumping", () => {
    const r: Replay = { flight: replayFlight(leader), track: null, atS: T, anchorMs: 1_000_000, rate: 600, playing: true };
    expect(replayTime(r, 1_010_000)).toBe(T + 6000); // 10 s at 600x
    expect(replayTime({ ...r, playing: false }, 1_010_000)).toBe(T);
    expect(replayTime(r, 1_000_000 + 3600_000)).toBe(T + 8 * 3600); // held at landing

    const s = useStore.getState();
    s.startReplay(r.flight, 600);
    expect(useStore.getState().selectedId).toBe(leader.id);
    s.setReplayClock({ atS: T + 3600, playing: false });
    expect(replayTime(useStore.getState().replay!)).toBe(T + 3600);
    s.setReplayTrack(leader.id, [
      [T + 600, 51, -5, 10_000],
      [T + 1200, 52, -10, 11_000],
      [T + 1800, 52, -15, 11_500],
    ]);
    expect(useStore.getState().replay!.flight.pos.altM).toBe(11_000);
    s.select(null); // leaving the flight ends the replay
    expect(useStore.getState().replay).toBeNull();
  });

  it("follows the en-route profile when the replay has one, the straight blend otherwise", () => {
    const f = replayFlight(leader);
    expect(tempAtProgress(f, 0.5)).toBe(18.5);
    const profiled = { ...f, profile: [12, 4, 30, 25] }; // a cold front, then the tropics
    expect(tempAtProgress(profiled, 0)).toBe(12);
    expect(tempAtProgress(profiled, 1 / 3)).toBe(4);
    expect(tempAtProgress(profiled, 0.5)).toBeCloseTo(17, 5);
    expect(tempAtProgress(profiled, 1)).toBe(25);
    expect(flightGradientStops({ ...f, profile: Array.from({ length: 17 }, () => 0) })).toHaveLength(17);

    useStore.getState().startReplay(f, 600);
    useStore.getState().setReplayTrack(f.id, null, [12, 4, 30, 25]);
    expect(useStore.getState().replay!.flight.profile).toEqual([12, 4, 30, 25]);
    useStore.getState().stopReplay();
  });
});
