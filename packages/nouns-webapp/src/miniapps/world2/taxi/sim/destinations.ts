// ── NOUN TAXI: where fares can go (a registry, pure) ──────────────────────
//
// Every place a fare or a hitchhiker can ask for is a Destination. They
// come from sources registered by key, so new places plug in without the
// taxi knowing about them:
//   'towns'      every trade town in TOWN_SPECS (trade/towns.ts), placed on
//                its main line: a town another session adds there shows up
//                here by itself (builtin.ts);
//   'landmarks'  the Nounish landmarks (world/landmarks/sites.ts);
//   'spots'      a few named plaza spots (builtin.ts);
//   'doors'      building doors (interiors/), registered at runtime by
//                TaxiSystem from `game.interiors.doors()`.
// A source is a function, asked again whenever the taxi needs the list, so
// a source that grows (doors stream in with their areas) needs no events.

import type { TownId } from '../../trade/contract';

export type DestKind = 'town' | 'landmark' | 'door' | 'spot';

export interface Destination {
  /** Stable id, unique across sources (`town:cowboy`, `door:<id>` …). */
  id: string;
  name: string;
  icon: string;
  kind: DestKind;
  /** Where to stop (world x / z): the kerb in front of it. */
  x: number;
  z: number;
  /** 'city' (the plaza), a TownId, or 'wild' (out on a line between towns). */
  area: 'city' | 'wild' | TownId;
  /** On a main line (tracks.ts id) at along-track s, or null in the city. */
  track: number | null;
  s: number | null;
  /** Drop-off zone radius (m). */
  r: number;
}

export type DestSource = () => readonly Destination[];

const sources = new Map<string, DestSource>();

/** Add (or replace) a source of destinations. Returns an unregister. */
export function registerDestinations(key: string, src: DestSource): () => void {
  sources.set(key, src);
  return () => {
    if (sources.get(key) === src) sources.delete(key);
  };
}

export function sourceKeys(): string[] {
  return [...sources.keys()];
}

/** Every destination from every source, first id wins; a failing source is skipped. */
export function allDestinations(): Destination[] {
  const out: Destination[] = [];
  const seen = new Set<string>();
  for (const src of sources.values()) {
    let list: readonly Destination[];
    try {
      list = src();
    } catch {
      continue;
    }
    for (const d of list) {
      if (seen.has(d.id) || !Number.isFinite(d.x) || !Number.isFinite(d.z)) continue;
      seen.add(d.id);
      out.push(d);
    }
  }
  return out;
}

export function destinationById(id: string): Destination | null {
  return allDestinations().find(d => d.id === id) ?? null;
}

/** The trade town a destination is in (city / wild count as the plaza for pay). */
export function payTown(d: Pick<Destination, 'area'>): TownId {
  return d.area === 'wild' ? 'city' : d.area;
}
