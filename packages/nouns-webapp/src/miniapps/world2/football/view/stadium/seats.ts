// ── NOUN STADIUM's seats: where every fan sits (pure) ───────────────────
//
// One seat every SEAT_W along every row of every tier, skipping the stair
// aisles and the rows cut away by the players' tunnel. The list is
// shuffled by a fixed hash (the same on every client), so the first N are
// an even spread over the whole bowl: the crowd shows the first `count`
// (InstancedMesh.count) and a quiet stadium just shows fewer.

import { SITE } from '../../site';

import {
  SEAT_W,
  STANDS,
  TUNNEL,
  TUNNEL_ROW0,
  fanEnd,
  inAisle,
  rowR,
  rowY,
  standToPitch,
  waveCoord,
} from './layout';

export interface SeatList {
  count: number;
  /** Pitch-local x, y (tread), z per seat. */
  pos: Float32Array;
  /** Facing (pitch-local yaw: forward = (sin, cos)). */
  yaw: Float32Array;
  /** fan (0 / 1 / 2 neutral), rnd, wave coord, rnd2. */
  data: Float32Array;
}

function hash(i: number, salt: number): number {
  let h = Math.imul(i ^ (salt * 0x9e3779b1), 0x85ebca6b) ^ 0x6e6f756e;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

let cached: SeatList | null = null;

/** Every seat in the bowl (shuffled, deterministic). Cached. */
export function seatList(): SeatList {
  if (cached !== null) return cached;
  const xs: number[] = [];
  const _p = { x: 0, z: 0 };
  for (const s of STANDS) {
    // facing the pitch: toward −side along the stand's axis
    const yaw =
      s.axis === 'x' ? (s.side > 0 ? -Math.PI / 2 : Math.PI / 2) : s.side > 0 ? Math.PI : 0;
    for (const t of s.tiers)
      for (let i = 0; i < t.rows; i++) {
        const r = rowR(t, i) + t.depth * 0.55;
        const y = rowY(t, i);
        const n = Math.floor((2 * s.half - 1) / SEAT_W);
        for (let k = 0; k < n; k++) {
          const a = -s.half + 0.5 + (k + 0.5) * SEAT_W;
          if (inAisle(a, s.half)) continue;
          if (
            s.id === 'main' &&
            t === s.tiers[0] &&
            i < TUNNEL_ROW0 &&
            Math.abs(a) < TUNNEL.half + TUNNEL.wall + 0.3
          )
            continue;
          standToPitch(s, r, a, _p);
          xs.push(_p.x, y, _p.z, yaw);
        }
      }
  }
  const count = xs.length / 4;
  // shuffle (Fisher–Yates on a fixed hash)
  const order = new Int32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(hash(i, SITE.x * 7 + 11) * (i + 1));
    const t = order[i]!;
    order[i] = order[j]!;
    order[j] = t;
  }
  const pos = new Float32Array(count * 3);
  const yaw = new Float32Array(count);
  const data = new Float32Array(count * 4);
  for (let n = 0; n < count; n++) {
    const i = order[n]!;
    const x = xs[i * 4]!;
    const z = xs[i * 4 + 2]!;
    pos[n * 3] = x;
    pos[n * 3 + 1] = xs[i * 4 + 1]!;
    pos[n * 3 + 2] = z;
    yaw[n] = xs[i * 4 + 3]!;
    const rnd = hash(i, 3);
    data[n * 4] = fanEnd(x, z, hash(i, 5));
    data[n * 4 + 1] = rnd;
    data[n * 4 + 2] = waveCoord(x, z);
    data[n * 4 + 3] = hash(i, 7);
  }
  cached = { count, pos, yaw, data };
  return cached;
}

/** How many fans to build for a device. */
export function crowdBudget(quality: 'low' | 'medium' | 'high', diet: boolean): number {
  if (diet) return 2000;
  return quality === 'high' ? 11000 : quality === 'medium' ? 7000 : 3500;
}

/** Fans shown when the stadium's quiet (no match): a sprinkle. */
export const QUIET_SHARE = 0.08;
