// The leaderboard: the biggest temperature swings over the last 24 h, 7 d and 30 d.
//
// Rolling windows all end now, so a flight can be forgotten as soon as LEADER_TOP others land no
// earlier than it does and swing more: every window that still holds it holds them too, so it can
// never rank again. What's left is small (about LEADER_TOP x ln(flights a month), ~100) and gives
// exact top lists for every window up to KEEP_S, from one stored document.
//
// Flights in the air are folded in on every rebuild with their latest values, so a forecast change
// moves them up or down; once a flight stops being scored (it landed) its last values stand.

import type { LeaderFlight, Leaders, LeaderWindow } from "../../../shared/types";

export const LEADER_TOP = 10;
export const LEADER_WINDOWS: Record<LeaderWindow, number> = { "24h": 86_400, "7d": 7 * 86_400, "30d": 30 * 86_400 };
/** Flights are kept until they landed this long ago: the longest window. */
export const KEEP_S = 30 * 86_400;
/** Two sightings of an aircraft under one callsign with take-offs this close are the same flight. */
const SAME_FLIGHT_S = 6 * 3600;
/** An ETA moving by less than this isn't worth a write. */
const ETA_SLACK_S = 10 * 60;

export const swingOf = (f: { depTempC: number; arrTempC: number }) => Math.abs(f.arrTempC - f.depTempC);

/** What ranking needs from a scored flight, before (and unless) its full record is built. */
export interface Scored {
  icao24: string;
  callsign: string;
  depTime: number;
  eta: number;
  depTempC: number;
  arrTempC: number;
}

/**
 * The items that can still rank in some window: no older than KEEP_S, and not beaten by LEADER_TOP
 * others with an ETA no earlier and a strictly bigger swing.
 */
export function undominated<T extends Pick<Scored, "eta" | "depTempC" | "arrTempC">>(items: T[], nowS: number): T[] {
  const sorted = items.filter((x) => x.eta >= nowS - KEEP_S).sort((a, b) => b.eta - a.eta || swingOf(b) - swingOf(a));
  /** The LEADER_TOP biggest swings among items landing no earlier, ascending. */
  const best: number[] = [];
  const out: T[] = [];
  for (const x of sorted) {
    const s = swingOf(x);
    if (best.length < LEADER_TOP || s >= best[0]!) out.push(x);
    if (best.length < LEADER_TOP || s > best[0]!) {
      const i = best.findIndex((b) => b >= s);
      best.splice(i < 0 ? best.length : i, 0, s);
      if (best.length > LEADER_TOP) best.shift();
    }
  }
  return out;
}

export class Leaderboard {
  private byId = new Map<string, LeaderFlight>();
  /** Changed since the last save. */
  dirty = false;

  load(json: string) {
    this.byId = new Map((JSON.parse(json) as LeaderFlight[]).map((f) => [f.id, f]));
    this.dirty = false;
  }

  toJSON(): string {
    return JSON.stringify([...this.byId.values()]);
  }

  get size() {
    return this.byId.size;
  }

  /**
   * Fold in this rebuild's scored flights. `describe` builds the record of one that stays on the
   * board; it isn't called for the rest, so scoring every eligible flight stays cheap.
   */
  update<C extends Scored>(scored: C[], idOf: (c: C) => string, describe: (c: C) => LeaderFlight, nowS: number) {
    // A flight scored again replaces its stored record, even if its id moved (a take-off estimate
    // crossing midnight UTC changes the id's day).
    const stored = new Map<string, LeaderFlight[]>();
    for (const f of this.byId.values()) {
      const k = `${f.icao24}:${f.callsign}`;
      stored.set(k, [...(stored.get(k) ?? []), f]);
    }
    const replaced = new Set<string>();
    for (const c of scored) {
      for (const f of stored.get(`${c.icao24}:${c.callsign}`) ?? []) {
        if (Math.abs(f.depTime - c.depTime) < SAME_FLIGHT_S) replaced.add(f.id);
      }
    }
    type Item = { eta: number; depTempC: number; arrTempC: number; kept?: LeaderFlight; fresh?: C };
    const items: Item[] = [
      ...[...this.byId.values()].filter((f) => !replaced.has(f.id)).map((f) => ({ eta: f.eta, depTempC: f.depTempC, arrTempC: f.arrTempC, kept: f })),
      ...scored.map((c) => ({ eta: c.eta, depTempC: c.depTempC, arrTempC: c.arrTempC, fresh: c })),
    ];
    const next = new Map<string, LeaderFlight>();
    for (const x of undominated(items, nowS)) {
      const f = x.kept ?? describe(x.fresh!);
      if (!next.has(f.id) || x.fresh) next.set(f.id, f);
    }
    if (!this.dirty) this.dirty = changed(this.byId, next);
    this.byId = next;
  }

  /** The top LEADER_TOP of each window, biggest swing first. */
  top(nowS: number): Leaders {
    const all = [...this.byId.values()].sort((a, b) => swingOf(b) - swingOf(a) || b.eta - a.eta);
    const windows = Object.fromEntries(
      Object.entries(LEADER_WINDOWS).map(([w, s]) => [w, all.filter((f) => f.eta >= nowS - s).slice(0, LEADER_TOP)]),
    ) as Record<LeaderWindow, LeaderFlight[]>;
    return { v: 1, generatedAt: nowS, windows };
  }
}

function changed(prev: Map<string, LeaderFlight>, next: Map<string, LeaderFlight>): boolean {
  if (prev.size !== next.size) return true;
  for (const [id, f] of next) {
    const p = prev.get(id);
    if (!p || p.depTempC !== f.depTempC || p.arrTempC !== f.arrTempC || Math.abs(p.eta - f.eta) >= ETA_SLACK_S) return true;
    if (p.aircraftType !== f.aircraftType) return true;
  }
  return false;
}
