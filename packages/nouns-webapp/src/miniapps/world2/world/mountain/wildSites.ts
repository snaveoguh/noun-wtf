// ── Wild things: where the hill houses + oddities go ────────────────────
//
// A pure function of the chunk coordinates + MOUNTAIN.seed (every client
// plans the same sites): now and then a cluster of grassy hill houses, now
// and then one oddity (giant noggles, a phone booth in a field, a telly
// stack…), and a rubber duck on the odd pond. Rare on purpose — they should
// feel like discoveries — and always set back from the riding lines, off
// the water, off the alley ramps and the mega ramp terraces.
//
// Plans are cached per chunk, and double as a keep-out for the dressing's
// trees / bushes / rocks (TerrainQuery.keepOut), so nothing grows through a
// house. Sites may straddle a chunk edge, so keep-out checks the neighbours.

import type { MountainDressing } from './Dressing';

import { mountainTerrainQuery } from './DressingDecorator';
import { Rand, hash3i } from './dressingUtil';
import { WaterField, type Pond } from './DressingWater';
import { CHUNK } from './MountainStream';
import { MOUNTAIN, edgeDistance, terrainHeight } from './terrain';

export type OddKind =
  | 'noggles'
  | 'phonebooth'
  | 'tellies'
  | 'trafficlight'
  | 'sofa'
  | 'mushrooms'
  | 'windmill'
  | 'stones'
  | 'ufo'
  | 'vending'
  | 'nounhead'
  | 'door'
  | 'cone';

export const ODD_KINDS: OddKind[] = [
  'noggles',
  'phonebooth',
  'tellies',
  'trafficlight',
  'sofa',
  'mushrooms',
  'windmill',
  'stones',
  'ufo',
  'vending',
  'nounhead',
  'door',
  'cone',
];

/** Footprint radius (m) per oddity: placement clearance + dressing keep-out. */
const ODD_R: Record<OddKind, number> = {
  noggles: 9,
  phonebooth: 2.5,
  tellies: 3,
  trafficlight: 2,
  sofa: 3,
  mushrooms: 7,
  windmill: 7,
  stones: 9,
  ufo: 8,
  vending: 2.5,
  nounhead: 5,
  door: 2.5,
  cone: 4,
};

export interface WildSite {
  kind: 'houses' | 'duck' | OddKind;
  /** World XZ centre, ground height under it. */
  x: number;
  z: number;
  y: number;
  /** Footprint radius (m). */
  r: number;
  /** Facing (yaw, +Z = 0): toward the nearest line where one is in reach. */
  yaw: number;
  seed: number;
  /** Pond the duck floats on. */
  pond?: Pond;
}

/** Chance per chunk. */
export const WILD_ODDS = { houses: 0.13, oddity: 0.15, duck: 0.45 } as const;

const SALT = 0x77696c64;
const th = MOUNTAIN.trackHalf;
let dressing: MountainDressing | null = null;
const cache = new Map<number, WildSite[]>();
const key = (ix: number, iz: number) => (ix + 32768) * 65536 + (iz + 32768);

/** Hook the planner up to the dressing's streams + install the keep-out. */
export function installWildSites(d: MountainDressing) {
  dressing = d;
  mountainTerrainQuery.keepOut = wildKeepOut;
}

/** The chunk's water (streams + ponds), for placement. */
export function chunkWater(ix: number, iz: number): { field: WaterField; ponds: Pond[] } | null {
  if (dressing === null) return null;
  const x0 = ix * CHUNK;
  const z0 = iz * CHUNK;
  const q = dressing.network.query(x0, z0, x0 + CHUNK, z0 + CHUNK, 24);
  return { field: new WaterField(q, x0, z0, x0 + CHUNK, z0 + CHUNK, 24), ponds: q.ponds };
}

/**
 * True when (x, z) is fair game for something big: not in the city, not
 * blocked, `clear` m (plus `r`) off every line but within sight of one,
 * dry, and not too steep across the footprint.
 */
export function placeable(
  x: number,
  z: number,
  r: number,
  clear: number,
  water: WaterField | null,
  steep = 0.7,
): boolean {
  const T = mountainTerrainQuery;
  if (edgeDistance(x, z) < 40 + r) return false;
  const d = T.trackDist(x, z);
  if (d < th + clear + r || d > 95) return false;
  if (T.blocked?.(x, z) === true) return false;
  if (water !== null && water.dist(x, z) < r + 3) return false;
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const px = x + Math.cos(a) * r;
    const pz = z + Math.sin(a) * r;
    if (T.blocked?.(px, pz) === true) return false;
    if (T.trackDist(px, pz) < th + clear) return false;
    const h = terrainHeight(px, pz);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  return hi - lo < Math.max(1.5, r * steep);
}

/** Yaw facing the nearest line (down the track-distance gradient). */
export function faceTrack(x: number, z: number, fallback: number): number {
  const T = mountainTerrainQuery;
  const gx = T.trackDist(x + 3, z) - T.trackDist(x - 3, z);
  const gz = T.trackDist(x, z + 3) - T.trackDist(x, z - 3);
  if (Math.hypot(gx, gz) < 0.5) return fallback;
  return Math.atan2(-gx, -gz);
}

/** Sites planned for chunk (ix, iz) (cached, deterministic). */
export function chunkSites(ix: number, iz: number): WildSite[] {
  const k = key(ix, iz);
  const hit = cache.get(k);
  if (hit !== undefined) return hit;
  const out = planChunk(ix, iz);
  if (cache.size > 512) {
    // Oldest first (Map keeps insertion order)
    let n = 128;
    for (const old of cache.keys()) {
      cache.delete(old);
      if (--n <= 0) break;
    }
  }
  cache.set(k, out);
  return out;
}

function planChunk(ix: number, iz: number): WildSite[] {
  const sites: WildSite[] = [];
  const x0 = ix * CHUNK;
  const z0 = iz * CHUNK;
  // Nothing under / right beside the city
  if (edgeDistance(x0 + CHUNK / 2, z0 + CHUNK / 2) < 60) return sites;
  const rnd = new Rand(Math.floor(hash3i(ix, iz, 7, SALT ^ MOUNTAIN.seed) * 4294967296));
  const rollHouses = rnd.next();
  const rollOdd = rnd.next();
  const rollDuck = rnd.next();
  const oddKind = ODD_KINDS[Math.floor(rnd.next() * ODD_KINDS.length) % ODD_KINDS.length];
  if (rollHouses >= WILD_ODDS.houses && rollOdd >= WILD_ODDS.oddity && rollDuck >= WILD_ODDS.duck)
    return sites;
  const w = chunkWater(ix, iz);
  const water = w?.field ?? null;
  const clearOf = (x: number, z: number, r: number) =>
    sites.every(s => Math.hypot(s.x - x, s.z - z) > s.r + r + 4);
  const spot = (r: number, clear: number, steep?: number) => {
    for (let t = 0; t < 14; t++) {
      const x = x0 + r + rnd.next() * (CHUNK - 2 * r);
      const z = z0 + r + rnd.next() * (CHUNK - 2 * r);
      if (clearOf(x, z, r) && placeable(x, z, r, clear, water, steep)) return { x, z };
    }
    return null;
  };
  if (rollHouses < WILD_ODDS.houses) {
    const r = 18;
    const p = spot(r * 0.55, 18, 0.9);
    if (p !== null) {
      sites.push({
        kind: 'houses',
        x: p.x,
        z: p.z,
        y: terrainHeight(p.x, p.z),
        r,
        yaw: faceTrack(p.x, p.z, rnd.next() * Math.PI * 2),
        seed: Math.floor(rnd.next() * 4294967296),
      });
    }
  }
  if (rollOdd < WILD_ODDS.oddity) {
    const r = ODD_R[oddKind];
    const p = spot(r, 12);
    if (p !== null) {
      let y = Infinity;
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        y = Math.min(y, terrainHeight(p.x + Math.cos(a) * r * 0.4, p.z + Math.sin(a) * r * 0.4));
      }
      sites.push({
        kind: oddKind,
        x: p.x,
        z: p.z,
        y: Math.min(y, terrainHeight(p.x, p.z)),
        r,
        yaw: faceTrack(p.x, p.z, rnd.next() * Math.PI * 2),
        seed: Math.floor(rnd.next() * 4294967296),
      });
    }
  }
  if (rollDuck < WILD_ODDS.duck && w !== null) {
    const pond = w.ponds.find(
      p => p.r >= 3.5 && p.x >= x0 && p.x < x0 + CHUNK && p.z >= z0 && p.z < z0 + CHUNK,
    );
    if (pond !== undefined) {
      sites.push({
        kind: 'duck',
        x: pond.x,
        z: pond.z,
        y: pond.level,
        r: 0,
        yaw: rnd.next() * Math.PI * 2,
        seed: Math.floor(rnd.next() * 4294967296),
        pond,
      });
    }
  }
  return sites;
}

/** True inside a planned site's footprint (no trees / bushes / rocks there). */
export function wildKeepOut(x: number, z: number): boolean {
  const cx = Math.floor(x / CHUNK);
  const cz = Math.floor(z / CHUNK);
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      for (const s of chunkSites(cx + i, cz + j)) {
        if (s.r > 0 && Math.hypot(s.x - x, s.z - z) < s.r + 1.5) return true;
      }
    }
  }
  return false;
}
