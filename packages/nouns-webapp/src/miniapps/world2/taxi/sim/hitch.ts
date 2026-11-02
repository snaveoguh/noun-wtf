// ── Hitchhikers on the long roads (pure, deterministic) ───────────────────
//
// Along every main line, slots every HITCH.spacing m (jittered) may hold a
// hitchhiker, thumb out at the side of the dirt line. Whether a slot is
// filled, which side, who it is and where they want to go are hashes of
// (track, slot), so every client sees the same hitchhikers in the same
// places. Never in a town's stretch (that's a town, with fares), never
// before HITCH.first m out. They want the next town further down the line,
// or (a few) a lift back up to the city.
//
// Any car will do, not just the cab. The view builds one only while you're
// within HITCH.spawnR, one a frame, and frees it past HITCH.despawnR.

import type { TownId } from '../../trade/contract';

import { TOWN_SPECS } from '../../trade/towns';
import { hashInts } from '../../world/mountain/config';

import { TOWN_MID } from './builtin';

export const HITCH = {
  first: 1600,
  spacing: 900,
  jitter: 220,
  /** Share of slots with someone in them. */
  chance: 0.6,
  /** Clear of a town's stretch (m either side of its middle). */
  townClear: 420,
  /** Off the line's centre (m). */
  side: 7.5,
  spawnR: 260,
  despawnR: 330,
  /** Built at once, at most. */
  max: 2,
  /** Share who want the city instead of the next town down. */
  backToCity: 0.25,
  /** Stop within this (m) under this speed (m/s) and they hop in. */
  pickupR: 8,
  pickupSpeed: 3,
} as const;

export interface HitchSlot {
  track: number;
  k: number;
  s: number;
  /** +1: left of travel (outward), −1: right. */
  side: 1 | -1;
  /** Hash for their look and name. */
  hash: number;
  /** Where they're headed: a trade town or 'city'. */
  to: TownId;
}

/** Towns on a main line, in along-track order (from TOWN_SPECS, so new ones count). */
export function townsOn(track: number): { id: TownId; mid: number }[] {
  return Object.values(TOWN_SPECS)
    .filter(t => t.track === track)
    .map(t => ({ id: t.id, mid: t.s + TOWN_MID }))
    .sort((a, b) => a.mid - b.mid);
}

/** Slot k on main `track`, or null when it's empty. */
export function hitchSlot(track: number, k: number): HitchSlot | null {
  if (k < 0) return null;
  if (hashInts(track, k, 9101) >= HITCH.chance) return null;
  const s = HITCH.first + k * HITCH.spacing + (hashInts(track, k, 9102) - 0.5) * 2 * HITCH.jitter;
  const towns = townsOn(track);
  if (towns.some(t => Math.abs(t.mid - s) < HITCH.townClear)) return null;
  const side: 1 | -1 = hashInts(track, k, 9103) < 0.5 ? 1 : -1;
  const next = towns.find(t => t.mid > s + HITCH.townClear);
  const back = next === undefined || hashInts(track, k, 9104) < HITCH.backToCity;
  return {
    track,
    k,
    s,
    side,
    hash: Math.floor(hashInts(track, k, 9105) * 2 ** 31),
    to: back ? 'city' : next.id,
  };
}

/** Filled slots on `track` within `r` m (along-track) of s, nearest first. */
export function slotsNear(track: number, s: number, r: number): HitchSlot[] {
  const k0 = Math.max(0, Math.floor((s - r - HITCH.first - HITCH.jitter) / HITCH.spacing));
  const k1 = Math.ceil((s + r - HITCH.first + HITCH.jitter) / HITCH.spacing);
  const out: HitchSlot[] = [];
  for (let k = k0; k <= k1; k++) {
    const h = hitchSlot(track, k);
    if (h !== null && Math.abs(h.s - s) <= r) out.push(h);
  }
  return out.sort((a, b) => Math.abs(a.s - s) - Math.abs(b.s - s));
}

export const slotId = (h: Pick<HitchSlot, 'track' | 'k'>) => `hitch:${h.track}:${h.k}`;

/** Stopped beside them? (any car; `taken`: a hitchhiker already aboard). */
export function canPickUp(d: number, speed: number, freeSeat: boolean, taken: boolean): boolean {
  return freeSeat && !taken && d < HITCH.pickupR && speed < HITCH.pickupSpeed;
}
