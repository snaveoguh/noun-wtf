// ── NOUN TAXI: the built-in destination sources (pure, deterministic) ────
//
// Towns come straight from TOWN_SPECS (trade/towns.ts): each sits on main
// line `track` at along-track `s` (the top of its pad), so the drop-off is
// main street TOWN_MID m further down. Nothing here names a town: one
// added to TOWN_SPECS is a destination the moment it exists.
// Landmarks come from world/landmarks/sites.ts the same way.

import type { Destination } from './destinations';
import type { TownId } from '../../trade/contract';

import { TOWN_SPECS } from '../../trade/towns';
import { CAMP_TOWER } from '../../world/camp/site';
import { LANDMARKS } from '../../world/landmarks/sites';
import { TRACK_STEP, tracks, type Track } from '../../world/mountain/tracks';

import { registerDestinations } from './destinations';

/** Main street's middle, past the top of a town's pad (pads are ~240 m). */
export const TOWN_MID = 120;

const ICONS: Partial<Record<string, string>> = {
  suburb: '🛹',
  cowboy: '🤠',
  beach: '🏝',
  noggle: '⌐◨-◨',
  shroom: '🍄',
  neon: '🌃',
  crater: '☄️',
};

const _p = { x: 0, z: 0, h: 0, k: 0 };

/**
 * Whether asking for a destination may grow its line (tests, the map). In
 * the game it's off: a line grows ~5 ms a km, so TaxiSystem grows them in
 * slices (`growSome`) and only lines already grown that far are offered.
 */
let growAllowed = true;
export function setGrowAllowed(on: boolean) {
  growAllowed = on;
}

/** Has main `track` been grown out to s? */
export function grownTo(track: number, s: number): boolean {
  const t = mainTrack(track);
  return t !== null && (t.done || t.s0 + (t.xs.length - 1) * TRACK_STEP >= s + TRACK_STEP * 2);
}

/**
 * Grow the town lines toward their furthest destination by at most
 * `metres` (all lines together). True once everything's grown.
 */
export function growSome(metres: number): boolean {
  let budget = metres;
  for (const spec of Object.values(TOWN_SPECS)) {
    if (spec.track === 0) continue;
    const t = mainTrack(spec.track);
    if (t === null || t.done) continue;
    const want = spec.s + TOWN_MID + TRACK_STEP * 3;
    const have = t.s0 + (t.xs.length - 1) * TRACK_STEP;
    if (have >= want) continue;
    const step = Math.min(budget, want - have);
    tracks.ensureS(t, have + step);
    budget -= step;
    if (budget <= 0) return false;
  }
  return budget > 0;
}

export function mainTrack(id: number): Track | null {
  return tracks.tracks.find(t => t.id === id && t.depth === 0) ?? null;
}

/** World point on main `track` at along-track s (grows the line that far). */
export function onLine(track: number, s: number): { x: number; z: number; h: number } | null {
  const t = mainTrack(track);
  if (t === null || (!growAllowed && !grownTo(track, s))) return null;
  const p = tracks.pointAt(t, s, _p);
  return { x: p.x, z: p.z, h: p.h };
}

const townCache = new Map<TownId, Destination>();

export function townDestinations(): Destination[] {
  const out: Destination[] = [];
  for (const spec of Object.values(TOWN_SPECS)) {
    if (spec.track === 0) continue;
    let d = townCache.get(spec.id);
    if (d === undefined) {
      const s = spec.s + TOWN_MID;
      const p = onLine(spec.track, s);
      if (p === null) continue;
      d = {
        id: `town:${spec.id}`,
        name: spec.name.toUpperCase(),
        icon: ICONS[spec.style] ?? '🏘',
        kind: 'town',
        x: p.x,
        z: p.z,
        area: spec.id,
        track: spec.track,
        s,
        r: 22,
      };
      townCache.set(spec.id, d);
    }
    out.push(d);
  }
  return out;
}

const landCache = new Map<string, Destination>();

export function landmarkDestinations(): Destination[] {
  const out: Destination[] = [];
  for (const def of LANDMARKS) {
    let d = landCache.get(def.id);
    if (d === undefined) {
      const at = def.at;
      if ('town' in at) {
        // In a town: the drop-off is main street beside it
        const spec = TOWN_SPECS[at.town];
        if (spec === undefined || spec.track === 0) continue;
        const s = spec.s + Math.max(10, Math.min(230, at.u));
        const p = onLine(spec.track, s);
        if (p === null) continue;
        d = {
          id: `land:${def.id}`,
          name: def.name.toUpperCase(),
          icon: def.icon,
          kind: 'landmark',
          x: p.x,
          z: p.z,
          area: at.town,
          track: spec.track,
          s,
          r: 20,
        };
      } else {
        // In the wilds: the line beside it (it stands `off` m away, facing the line)
        const p = onLine(at.track, at.s);
        if (p === null) continue;
        d = {
          id: `land:${def.id}`,
          name: def.name.toUpperCase(),
          icon: def.icon,
          kind: 'landmark',
          x: p.x,
          z: p.z,
          area: 'wild',
          track: at.track,
          s: at.s,
          r: 20,
        };
      }
      landCache.set(def.id, d);
    }
    out.push(d);
  }
  return out;
}

/**
 * Named plaza spots on the ring road's kerb (the ring is the box between
 * |x|/|z| = 58 and 70; traffic keeps right, see cars/lanes.ts).
 */
export const PLAZA_SPOTS: readonly Destination[] = [
  spot('fountain-n', 'THE FOUNTAIN', '⛲', 0, -61),
  spot('fountain-s', 'DOWNHILL ALLEY', '⬇', -6, 66),
  spot('camp', 'NOUNS CAMP TOWER', '🏚', CAMP_TOWER.x, 68),
  spot('mountain', 'MOUNTAIN ALLEY', '⛰', 66, -24),
  spot('godown', 'GO DOWN ALLEY', '🕳', -66, 24),
  spot('east-kerb', 'EAST SIDE', '🏙', 63, 40),
  spot('west-kerb', 'WEST SIDE', '🌇', -63, -40),
];

function spot(id: string, name: string, icon: string, x: number, z: number): Destination {
  return {
    id: `spot:${id}`,
    name,
    icon,
    kind: 'spot',
    x,
    z,
    area: 'city',
    track: null,
    s: null,
    r: 12,
  };
}

let registered = false;

/** Register the towns, landmarks and plaza spots (idempotent). */
export function registerBuiltins() {
  if (registered) return;
  registered = true;
  registerDestinations('towns', townDestinations);
  registerDestinations('landmarks', landmarkDestinations);
  registerDestinations('spots', () => PLAZA_SPOTS);
}
