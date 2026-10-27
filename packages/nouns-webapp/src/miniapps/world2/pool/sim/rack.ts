// ── The rack, the spots, and a seeded RNG ───────────────────────────────
//
// 8-ball rack: the 1 on the foot spot at the apex, the 8 in the middle of
// the third row, a solid and a stripe in the back corners, the rest
// shuffled from the frame's seed. Balls sit a hair apart with a tiny seeded
// jiggle, so no two breaks are the same but every client racks the same.

import type { BallId, Vec2 } from '../contract';

import { makeBall, type Ball } from './physics';
import { FOOT_X, HEAD_X, R, onCloth } from './table';

/** mulberry32: integer-only, so it's identical everywhere. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SQ3 = Math.sqrt(3);
const GAP = 0.00012;

/** The 15 rack positions, apex first, row by row (row r has r + 1 balls). */
export function rackSpots(): Vec2[] {
  const d = 2 * R + GAP;
  const out: Vec2[] = [];
  for (let row = 0; row < 5; row++)
    for (let i = 0; i <= row; i++)
      out.push({ x: FOOT_X + (row * d * SQ3) / 2, y: (i - row / 2) * d });
  return out;
}

/** Which ball goes where (index = rack spot), from the seed. */
export function rackOrder(seed: number): BallId[] {
  const r = rng(seed ^ 0x5bd1e995);
  const solids = [2, 3, 4, 5, 6, 7];
  const stripes = [9, 10, 11, 12, 13, 14, 15];
  const shuffle = (a: number[]) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
  };
  shuffle(solids);
  shuffle(stripes);
  // Back corners (spots 10 and 14): one of each, either way round
  const flip = r() < 0.5;
  const order: (BallId | null)[] = new Array(15).fill(null);
  order[0] = 1;
  order[4] = 8;
  order[10] = flip ? stripes.pop()! : solids.pop()!;
  order[14] = flip ? solids.pop()! : stripes.pop()!;
  const rest = [...solids, ...stripes];
  shuffle(rest);
  for (let i = 0; i < 15; i++) if (order[i] === null) order[i] = rest.pop()!;
  return order as BallId[];
}

/** The break position: cue ball in the kitchen, the rack on the foot spot. */
export function rackBalls(seed: number): Ball[] {
  const r = rng(seed);
  const spots = rackSpots();
  const order = rackOrder(seed);
  const balls: Ball[] = new Array(16);
  balls[0] = makeBall(0, HEAD_X - 0.05, 0);
  spots.forEach((s, i) => {
    const id = order[i]!;
    const jx = (r() - 0.5) * GAP * 0.8;
    const jy = (r() - 0.5) * GAP * 0.8;
    balls[id] = makeBall(id, s.x + jx, s.y + jy);
  });
  return balls;
}

/** Put a ball back on the foot spot (or the nearest free spot behind it, then in front). */
export function respot(balls: readonly Ball[], id: BallId): Vec2 {
  const free = (x: number, y: number) =>
    onCloth(x, y) &&
    balls.every(
      b => !b.on || b.id === id || (b.x - x) * (b.x - x) + (b.y - y) * (b.y - y) >= 4 * R * R,
    );
  for (let k = 0; k < 200; k++) {
    const x = FOOT_X + k * R * 0.25;
    if (free(x, 0)) return { x, y: 0 };
  }
  for (let k = 1; k < 400; k++) {
    const x = FOOT_X - k * R * 0.25;
    if (free(x, 0)) return { x, y: 0 };
  }
  return { x: FOOT_X, y: 0 };
}
