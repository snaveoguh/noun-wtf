// ── Nounish landmarks: where they stand (pure, no three.js, no terrain) ──
//
// Three stand in the weird towns (their town builds place them from this
// table), five out in the wilds beside a main line, `off` m to one side of
// the line at along-track `s` — past the line's terrain influence, facing
// back to it so you see their fronts riding by. Wild positions come from the
// main line alone (grown sequentially, so every client agrees); their
// height comes from the terrain when the wild decorator builds them.

import type { GrownTown } from '../../towns/site';

import { townFrame, townFrameNow, townToWorld, townYaw } from '../../towns/site';
import { TRACK_STEP, tracks } from '../mountain/tracks';

import { LANDMARK_R, type LandmarkModel } from './models';

export type LandmarkSite =
  | { town: GrownTown; vp: number; u: number; dvp: number; du: number }
  | { track: number; s: number; side: 1 | -1; off: number };

export interface LandmarkDef {
  id: string;
  name: string;
  icon: string;
  model: LandmarkModel;
  at: LandmarkSite;
}

export const LANDMARKS: LandmarkDef[] = [
  {
    id: 'noggle-arch',
    name: 'The Noggle Arch',
    icon: '⌐◨-◨',
    model: 'noggleArch',
    at: { town: 'noggle', vp: 0, u: 34, dvp: 0, du: -1 },
  },
  {
    id: 'boom-tower',
    name: 'Boom Tower',
    icon: '📻',
    model: 'boomboxTower',
    at: { town: 'neon', vp: -50, u: 150, dvp: 1, du: 0 },
  },
  {
    id: 'landed-ufo',
    name: 'The Landed Saucer',
    icon: '🛸',
    model: 'landedUfo',
    at: { town: 'crater', vp: 62, u: 122, dvp: -1, du: 0 },
  },
  {
    id: 'big-noun',
    name: 'The Big Noun',
    icon: '🗿',
    model: 'headStatue',
    at: { track: 1, s: 3400, side: 1, off: 150 },
  },
  {
    id: 'meltdown',
    name: 'Meltdown',
    icon: '🍦',
    model: 'meltingIceCream',
    at: { track: 2, s: 6200, side: -1, off: 150 },
  },
  {
    id: 'noggle-wheel',
    name: 'The Noggle Wheel',
    icon: '🎡',
    model: 'noggleWheel',
    at: { track: 3, s: 8000, side: 1, off: 160 },
  },
  {
    id: 'slice-tower',
    name: 'Slice Tower',
    icon: '🍕',
    model: 'pizzaTower',
    at: { track: 1, s: 12500, side: -1, off: 170 },
  },
  {
    id: 'crabby-light',
    name: 'Crabby Light',
    icon: '🦀',
    model: 'crabLighthouse',
    at: { track: 2, s: 32000, side: 1, off: 170 },
  },
];

export interface LandmarkPlace {
  def: LandmarkDef;
  x: number;
  z: number;
  /** World yaw its front (+Z) faces. */
  yaw: number;
  /** Footprint radius (m). */
  r: number;
  /** Town pad level for town landmarks (null in the wilds: ask the terrain). */
  y: number | null;
}

const placed = new Map<string, LandmarkPlace>();
const mains = new Map<number, (typeof tracks.tracks)[number]>();
const _p = { x: 0, z: 0, h: 0, k: 0 };
const _w = { x: 0, z: 0 };

/**
 * Where a landmark stands, or null while its spot isn't known yet. `grow`:
 * grow its line / resolve its town as far as needed (map, decorator); else
 * only answer from what's already there (cheap, per frame).
 */
export function landmarkPlace(def: LandmarkDef, grow = false): LandmarkPlace | null {
  const hit = placed.get(def.id);
  if (hit !== undefined) return hit;
  const r = LANDMARK_R[def.model];
  let out: LandmarkPlace;
  const at = def.at;
  if ('town' in at) {
    const f = grow ? townFrameNow(at.town) : townFrame(at.town);
    if (f === null) return null;
    townToWorld(f, at.vp, at.u, _w);
    out = { def, x: _w.x, z: _w.z, yaw: townYaw(f, at.dvp, at.du), r, y: f.P };
  } else {
    let t = mains.get(at.track);
    if (t === undefined) {
      t = tracks.tracks.find(q => q.id === at.track);
      if (t === undefined) return null;
      mains.set(at.track, t);
    }
    const grown = t.done || t.s0 + (t.xs.length - 1) * TRACK_STEP >= at.s + TRACK_STEP;
    if (!grown && !grow) return null;
    const p = tracks.pointAt(t, at.s, _p);
    // Left of travel: r = (cos h, −sin h)
    const rx = Math.cos(p.h) * at.side;
    const rz = -Math.sin(p.h) * at.side;
    out = {
      def,
      x: p.x + rx * at.off,
      z: p.z + rz * at.off,
      yaw: Math.atan2(-rx, -rz),
      r,
      y: null,
    };
  }
  placed.set(def.id, out);
  return out;
}

/** Keep-out for the mountain dressing (trees, rocks): wild landmarks + a margin. */
export function landmarkBlocked(x: number, z: number): boolean {
  for (const def of LANDMARKS) {
    if ('town' in def.at) continue;
    const p = landmarkPlace(def);
    if (p === null) continue;
    const R = p.r + 14;
    const dx = x - p.x;
    const dz = z - p.z;
    if (dx * dx + dz * dz < R * R) return true;
  }
  return false;
}
