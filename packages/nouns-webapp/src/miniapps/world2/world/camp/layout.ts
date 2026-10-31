// ── CAMP's layout: the mess, the books, where you wake up (pure, tested) ──
//
// Room frame (site.ts): x across (−w/2 … w/2), z in from the window wall
// (0 … d), y up from the floor. Everything is placed by hand round a
// broken living room facing the window, then scattered clutter from a
// fixed seed, so every client sees the same room.

import { mulberry32 } from '../../interiors/rng';

import { CAMP_RAMP } from './miniramp';

export type PieceType =
  | 'coffee_table'
  | 'sofa'
  | 'armchair_tipped'
  | 'mattress'
  | 'whiteboard'
  | 'poster'
  | 'boarded_door'
  | 'notice'
  | 'tag'
  | 'kitchen'
  | 'fridge'
  | 'bookshelf_down'
  | 'lamp_down'
  | 'bulb'
  | 'ceiling_panel'
  | 'chair_tipped'
  | 'trash'
  | 'tub'
  | 'book_stack'
  | 'book_open'
  | 'debris'
  | 'can'
  | 'bottle'
  | 'tape'
  | 'pool_table'
  | 'miniramp'
  | 'print'
  | 'rug'
  | 'sheet';

export interface Piece {
  type: PieceType;
  x: number;
  z: number;
  /** Height of its base (things on a table, things on a wall). */
  y: number;
  yaw: number;
  /** Footprint across / deep (its own frame), height. */
  w: number;
  d: number;
  h: number;
  /** Blocks walking (a collider box). */
  solid: boolean;
  /** Variant / seed (which book page, which colour). */
  v: number;
}

export interface CampLayout {
  w: number;
  d: number;
  h: number;
  pieces: Piece[];
  /** Where riders wake up (room frame), facing the window. */
  spawns: { x: number; z: number; yaw: number }[];
  /** Stand near this to read MEME VALUE (the copy open on the coffee table). */
  book: { x: number; z: number; y: number };
  /** The pool table (room frame; its length runs along local x, turned by yaw). */
  pool: { x: number; z: number; yaw: number; length: number; width: number };
  /** The mini ramp's centre (room frame; it runs along x). */
  ramp: { x: number; z: number };
  /** The window's span along x (room frame) — the only way out. */
  window: { x0: number; x1: number };
}

/** The MEME VALUE pages lying open round the room (left page of each spread). */
export const OPEN_PAGES = [12, 38, 67, 104, 141, 188] as const;

const p = (
  type: PieceType,
  x: number,
  z: number,
  w: number,
  d: number,
  h: number,
  o: Partial<Pick<Piece, 'y' | 'yaw' | 'solid' | 'v'>> = {},
): Piece => ({
  type,
  x,
  z,
  w,
  d,
  h,
  y: o.y ?? 0,
  yaw: o.yaw ?? 0,
  solid: o.solid ?? false,
  v: o.v ?? 0,
});

/** The room for a w × d × h space whose window spans [winX0, winX1] (room frame). */
export function campLayout(
  w: number,
  d: number,
  h: number,
  winX0: number,
  winX1: number,
): CampLayout {
  const W = w / 2;
  const pieces: Piece[] = [
    // The living room: a busted sofa facing the view, the coffee table
    p('sofa', 0.7, 5.15, 2.3, 0.95, 0.86, { yaw: Math.PI + 0.08, solid: true, v: 1 }),
    p('coffee_table', 0.5, 3.7, 1.3, 0.7, 0.42, { yaw: 0.12, solid: true }),
    p('book_stack', 0.85, 3.62, 0.36, 0.26, 0.2, { y: 0.42, yaw: 0.3, v: 6 }),
    p('book_open', 0.2, 3.78, 0.52, 0.36, 0.03, { y: 0.42, yaw: -0.2, v: 0 }),
    // Square to the room and as big as its collider (solid boxes are axis
    // aligned), so spray lands on the chair, not on the air beside it
    p('armchair_tipped', -2.7, 4.6, 1.29, 1.28, 0.9, { solid: true }),
    p('chair_tipped', -1.7, 1.5, 0.48, 0.48, 0.9, { yaw: 2.2, solid: true }),
    p('lamp_down', -0.6, 6.85, 1.7, 0.3, 0.3, { yaw: 0.2 }),
    p('bookshelf_down', -4.0, 2.3, 0.9, 1.9, 0.4, { yaw: 0.12, solid: true }),
    // Upstage: the whiteboard (the van plans), the kitchen, the mattress
    p('whiteboard', -W + 0.18, 6.4, 1.9, 0.12, 1.25, { y: 0.85, yaw: Math.PI / 2, solid: true }),
    p('kitchen', -2.6, d - 0.33, 2.4, 0.62, 0.92, { yaw: Math.PI, solid: true }),
    p('fridge', -4.35, d - 0.4, 0.75, 0.7, 1.8, { yaw: Math.PI - 0.25, solid: true }),
    p('mattress', 3.55, 2.1, 1.5, 2.0, 0.24, { yaw: 0.3 }),
    // The one thing still standing: the pool table (long axis toward the window)
    p('pool_table', 2.75, 5.85, 2.3, 1.3, 0.86, { yaw: Math.PI / 2, solid: true }),
    // Across the back: a mini ramp (its own collision; not a box)
    p('miniramp', 0, 8.55, CAMP_RAMP.length, CAMP_RAMP.width, CAMP_RAMP.height),
    // The way you didn't come in: boarded up, condemned, taped
    p('boarded_door', 2.3, d - 0.06, 1.1, 0.1, 2.15, { yaw: Math.PI }),
    p('notice', 2.3, d - 0.12, 0.42, 0.02, 0.56, { y: 1.25, yaw: Math.PI }),
    p('tape', 2.3, d - 0.08, 1.5, 0.02, 1.6, { y: 0.3, yaw: Math.PI }),
    p('tag', -0.4, d - 0.045, 3.4, 0.02, 1.25, { y: 1.35, yaw: Math.PI }),
    // The book on the walls, pinned up crooked and hanging clear of the dado
    // rail (its face is ~5 cm off the wall): NOUNS EATS EVERYTHING by the
    // window, the zebra on the west wall, DUNA SEASON (the biggest) on the east
    p('print', (-W + winX0) / 2, 0.07, 0.72, 0.02, 1.44, { y: 0.85, v: 0 }),
    p('print', -W + 0.07, 3.0, 0.8, 0.02, 1.6, { y: 0.8, yaw: Math.PI / 2, v: 1 }),
    p('print', W - 0.07, 6.45, 2.6, 0.02, 1.3, { y: 1.2, yaw: -Math.PI / 2, v: 2 }),
    // The esports rug under the coffee table; every page of the book,
    // crumpled on the floor in front of the window
    p('rug', 0.5, 3.75, 2.4, 1.6, 0.04, { yaw: 0.12 }),
    p('sheet', -0.2, 1.55, 4.2, 1.35, 0.1, { yaw: -0.09 }),
    p('poster', W - 0.07, 3.4, 0.9, 0.02, 1.3, { y: 1.15, yaw: -Math.PI / 2, v: 1 }),
    // Overhead: a bare bulb on its flex, a ceiling tile come down
    p('bulb', 0.5, 3.9, 0.16, 0.16, 0.9, { y: h - 0.9 }),
    p('ceiling_panel', -3.9, 3.7, 1.2, 1.2, 0.04, { y: h - 1.1, yaw: 0.3 }),
    // Bags
    p('trash', -4.25, 7.1, 0.7, 0.6, 0.55),
    p('trash', -3.9, 0.85, 0.8, 0.6, 0.55),
    p('trash', 4.3, 7.0, 0.7, 0.6, 0.5),
  ];
  // The other copies: open on the floor at their pages, a stack by the sofa
  const floorBooks: [number, number, number][] = [
    [-1.2, 2.9, 0.7],
    [2.1, 4.6, -1.1],
    [-3.3, 5.9, 2.4],
    [3.8, 4.95, 0.3],
    [-2.0, 3.2, -0.6],
  ];
  floorBooks.forEach(([x, z, yaw], i) =>
    pieces.push(p('book_open', x, z, 0.52, 0.36, 0.03, { yaw, v: i + 1 })),
  );
  pieces.push(p('book_stack', -0.85, 5.3, 0.36, 0.26, 0.16, { yaw: -0.4, v: 4 }));
  // Clutter from a fixed seed: empty ice cream tubs, cans, bottles, plaster
  const rnd = mulberry32(0xca4b);
  const blocked = (x: number, z: number, r: number) =>
    pieces.some(q => {
      if (!q.solid && q.type !== 'miniramp') return false;
      const b = solidBox(q);
      return x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r;
    });
  const scatter = (type: PieceType, n: number, size: number, h: number) => {
    let placed = 0;
    for (let tries = 0; placed < n && tries < n * 30; tries++) {
      const x = (rnd() * 2 - 1) * (W - 0.4);
      const z = 0.6 + rnd() * (d - 1.2);
      if (blocked(x, z, size)) continue;
      pieces.push(p(type, x, z, size, size, h, { yaw: rnd() * Math.PI * 2, v: placed }));
      placed++;
    }
  };
  scatter('tub', 9, 0.18, 0.14);
  scatter('can', 14, 0.07, 0.12);
  scatter('bottle', 6, 0.08, 0.28);
  scatter('debris', 16, 0.22, 0.1);
  const spawns = [
    { x: -0.9, z: 2.2 },
    { x: 1.6, z: 1.6 },
    { x: 2.3, z: 3.3 },
    { x: -1.2, z: 6.6 },
    { x: 1.0, z: 6.75 },
    { x: -3.6, z: 6.6 },
    { x: 4.05, z: 4.3 },
    { x: -0.2, z: 1.0 },
  ].map(s => ({ ...s, yaw: Math.atan2((winX0 + winX1) / 2 - s.x, -s.z) }));
  return {
    w,
    d,
    h,
    pieces,
    spawns,
    book: { x: 0.2, z: 3.78, y: 0.45 },
    ramp: { x: 0, z: 8.55 },
    pool: { x: 2.75, z: 5.85, yaw: Math.PI / 2, length: 2.3, width: 1.3 },
    window: { x0: winX0, x1: winX1 },
  };
}

/** A solid piece's collision box (room frame, axis-aligned round its turned footprint). */
export function solidBox(q: Piece): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  h: number;
} {
  const c = Math.abs(Math.cos(q.yaw));
  const s = Math.abs(Math.sin(q.yaw));
  const hx = (q.w * c + q.d * s) / 2;
  const hz = (q.w * s + q.d * c) / 2;
  return { minX: q.x - hx, maxX: q.x + hx, minZ: q.z - hz, maxZ: q.z + hz, h: q.y + q.h };
}
