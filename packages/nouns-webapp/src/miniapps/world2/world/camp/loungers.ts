// ── CAMP's loungers: who hangs about in the condemned penthouse (pure) ───
//
// Two Nouns who never left: COIN HEAD on the sofa, counting a fat wad with
// the rest stacked on the sofa arm, and MICROWAVE HEAD sat on the kitchen
// counter, legs dangling, bored out of their mind. Where they sit comes
// from the layout's own sofa and kitchen (so moving those moves them), and
// what their arms, legs and heads do is a pure function of time, so it's
// tested here and LoungerSystem.ts only applies it to the rig.

import type { CampLayout, Piece } from './layout';

export type LoungerId = 'coin' | 'microwave';

export interface LoungerDef {
  id: LoungerId;
  name: string;
  /** Trait filenames in the Nouns art (looked up, never by index: the art's order isn't ours). */
  head: string;
  body: string;
  accessory: string;
  glasses: string;
  /** What they say when you walk up (one at random per visit). */
  lines: string[];
}

export const LOUNGERS: readonly LoungerDef[] = [
  {
    id: 'coin',
    name: 'COIN HEAD',
    head: 'head-goldcoin',
    body: 'body-gold',
    accessory: 'accessory-dollar-bling',
    glasses: 'glasses-square-black',
    lines: [
      '…4,997… 4,998… DON’T TALK, I’LL LOSE COUNT',
      'RENT? THE BUILDING’S CONDEMNED. THIS IS PROFIT',
      'BACK OFF. EVERY NOTE IS SPOKEN FOR',
      'SOLD THE FRIDGE TWICE. STILL HERE',
    ],
  },
  {
    id: 'microwave',
    name: 'MICROWAVE HEAD',
    head: 'head-microwave',
    body: 'body-grayscale-7',
    accessory: 'accessory-stripes-blit',
    glasses: 'glasses-square-smoke',
    lines: [
      '…',
      'BEEN SAT HERE SINCE THE POWER WENT',
      'NOTHING TO HEAT. NOTHING TO DO',
      'DING. …NO. NOTHING',
    ],
  },
];

/** Where a lounger sits (room frame): hips at `seatY`, facing `yaw`. */
export interface LoungerSpot {
  id: LoungerId;
  x: number;
  z: number;
  yaw: number;
  seatY: number;
}

/** Stand this close (m, from the hips) and they talk. */
export const TALK_R = 2.2;

/** A point in a piece's own frame → the room frame (the build's `at`: yaw about +Y). */
export function onPiece(q: Piece, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(q.yaw);
  const s = Math.sin(q.yaw);
  return { x: q.x + lx * c + lz * s, z: q.z - lx * s + lz * c };
}

/** The sofa's cushion top and arm top (its own frame, build.ts / interiors kit). */
export const SOFA_SEAT = 0.5;
export const SOFA_ARM = 0.66;
/** It sits 4 cm into the floor and rolls this much to its left (a leg's gone; build.ts). */
export const SOFA_SINK = 0.04;
export const SOFA_ROLL = 0.05;

/** Height (room frame) of the sofa's top at `lx` along it: the arm or the cushion. */
export function sofaY(lx: number, arm: boolean): number {
  return (arm ? SOFA_ARM : SOFA_SEAT) - SOFA_SINK + lx * Math.sin(SOFA_ROLL);
}
/** Coin head's spot along the sofa (its frame), the arm the cash is on. */
export const COIN_AT = { x: -0.45, z: 0.06 };
/** The cash on the sofa arm and seat (its frame): x, z, stack height in notes. */
export const CASH_STACKS: readonly [number, number, number][] = [
  [-1.05, 0.12, 9],
  [-1.05, -0.12, 6],
  [-1.04, 0.32, 4],
  [-0.92, 0.42, 3],
];
/** Microwave head on the counter (its frame): hips near the front edge. */
export const MICROWAVE_AT = { x: -0.15, z: 0.12 };

export function loungerSpots(l: CampLayout): LoungerSpot[] {
  const out: LoungerSpot[] = [];
  const sofa = l.pieces.find(q => q.type === 'sofa');
  if (sofa !== undefined) {
    const p = onPiece(sofa, COIN_AT.x, COIN_AT.z);
    out.push({ id: 'coin', ...p, yaw: sofa.yaw, seatY: sofaY(COIN_AT.x, false) });
  }
  const kitchen = l.pieces.find(q => q.type === 'kitchen');
  if (kitchen !== undefined) {
    const p = onPiece(kitchen, MICROWAVE_AT.x, MICROWAVE_AT.z);
    out.push({ id: 'microwave', ...p, yaw: kitchen.yaw, seatY: kitchen.h + 0.02 });
  }
  return out;
}

// ── What they're doing (angles in radians, all pure in time) ──

export interface CoinPose {
  /** Head nod down at the wad. */
  headDown: number;
  /** The left arm holds the wad up in front: upper / forearm swing. */
  holdUpper: number;
  holdFore: number;
  /** The right hand flicks a note off the top. */
  flickUpper: number;
  flickFore: number;
  /** A note is in flight between the hands (0…1), or null. */
  note: number | null;
  /** Counting pauses for a lick of the thumb now and then. */
  lick: boolean;
}

/** Notes a second while counting. */
export const COUNT_RATE = 2.6;
/** Every this many seconds, a pause to lick the thumb (s). */
const LICK_EVERY = 7;
const LICK_FOR = 1.1;

export function coinPose(t: number): CoinPose {
  const inCycle = t % LICK_EVERY;
  const lick = inCycle > LICK_EVERY - LICK_FOR;
  if (lick) {
    // Right hand up to the mouth, head up a touch
    const k = Math.sin(((inCycle - (LICK_EVERY - LICK_FOR)) / LICK_FOR) * Math.PI);
    return {
      headDown: 0.25 - 0.2 * k,
      holdUpper: -0.7,
      holdFore: -1.1,
      flickUpper: -0.6 - 0.8 * k,
      flickFore: -0.9 - 1.1 * k,
      note: null,
      lick: true,
    };
  }
  const ph = (t * COUNT_RATE) % 1;
  // Snap across the top of the wad, ease back
  const flick = ph < 0.35 ? ph / 0.35 : 1 - (ph - 0.35) / 0.65;
  return {
    headDown: 0.32 + 0.04 * Math.sin(t * COUNT_RATE * Math.PI * 2),
    holdUpper: -0.7,
    holdFore: -1.1,
    flickUpper: -0.55 - 0.25 * flick,
    flickFore: -0.9 - 0.35 * flick,
    note: ph < 0.35 ? ph / 0.35 : null,
    lick: false,
  };
}

export interface BoredPose {
  /** Each shin's swing about the knee (dangling legs, out of step). */
  shinL: number;
  shinR: number;
  /** Head turned (yaw) and dropped (pitch). */
  headYaw: number;
  headDown: number;
  /** Slumped forward (body pitch), deeper on a sigh. */
  slump: number;
  /** Shoulders up on the in-breath of a sigh. */
  shrug: number;
}

/** A big sigh every this many seconds (s). */
export const SIGH_EVERY = 9;
const SIGH_FOR = 2.2;

export function boredPose(t: number): BoredPose {
  const swing = 0.32;
  const shinL = swing * Math.sin(t * 2.1);
  const shinR = swing * Math.sin(t * 2.1 + 2.4);
  // Look round the room slowly, then stare at the floor
  const look = Math.sin(t * 0.23) * 0.7 + Math.sin(t * 0.61) * 0.15;
  const inCycle = t % SIGH_EVERY;
  const sighK = inCycle < SIGH_FOR ? Math.sin((inCycle / SIGH_FOR) * Math.PI) : 0;
  return {
    shinL,
    shinR,
    headYaw: look,
    headDown: 0.18 + 0.12 * (0.5 + 0.5 * Math.sin(t * 0.37)),
    slump: 0.12 + 0.1 * sighK,
    shrug: 0.25 * Math.max(0, Math.sin((inCycle / SIGH_FOR) * Math.PI * 2)) * (sighK > 0 ? 1 : 0),
  };
}
