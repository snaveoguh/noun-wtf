// ── Noun Breaks view: what the view knows about each move ───────────────
//
// The sim owns the rules (MoveSpec); the view only needs a name for the
// HUD, the family (fallback animation, camera, crowd reaction) and a
// default length for when DancerPose.moveBeats is missing.

import type { MoveFamily, MoveId } from '../contract';

export interface ViewMove {
  name: string;
  family: MoveFamily;
  /** Default length on the beat grid (beats). */
  beats: number;
  /** Crowd goes "ohhh" when it lands (power moves, the hard freezes). */
  big?: boolean;
}

export const VIEW_MOVES: Record<MoveId, ViewMove> = {
  indian_step: { name: 'Indian Step', family: 'toprock', beats: 4 },
  salsa_rock: { name: 'Salsa Rock', family: 'toprock', beats: 4 },
  cross_step: { name: 'Cross Step', family: 'toprock', beats: 4 },
  kick_step: { name: 'Kick Step', family: 'toprock', beats: 4 },
  six_step: { name: 'Six-Step', family: 'footwork', beats: 3 },
  three_step: { name: 'Three-Step', family: 'footwork', beats: 2 },
  cc: { name: "CC's", family: 'footwork', beats: 2 },
  pretzel: { name: 'Pretzel', family: 'footwork', beats: 4 },
  kick_out: { name: 'Kick Out', family: 'footwork', beats: 2 },
  windmill: { name: 'Windmill', family: 'power', beats: 4, big: true },
  flare: { name: 'Flare', family: 'power', beats: 4, big: true },
  headspin: { name: 'Headspin', family: 'power', beats: 4, big: true },
  backspin: { name: 'Backspin', family: 'power', beats: 2 },
  swipe: { name: 'Swipe', family: 'power', beats: 2, big: true },
  turtle: { name: 'Turtle', family: 'power', beats: 4 },
  airflare: { name: 'Airflare', family: 'power', beats: 4, big: true },
  baby_freeze: { name: 'Baby Freeze', family: 'freeze', beats: 2 },
  chair_freeze: { name: 'Chair Freeze', family: 'freeze', beats: 2 },
  headstand: { name: 'Headstand', family: 'freeze', beats: 2 },
  airchair: { name: 'Airchair', family: 'freeze', beats: 2, big: true },
  hollowback: { name: 'Hollowback', family: 'freeze', beats: 2, big: true },
  drop: { name: 'Drop', family: 'transition', beats: 1 },
  spin_down: { name: 'Spin Down', family: 'transition', beats: 2 },
  get_up: { name: 'Get Up', family: 'transition', beats: 1 },
};

export const MOVE_IDS = Object.keys(VIEW_MOVES) as MoveId[];

export function moveInfo(id: MoveId | string): ViewMove | null {
  return (VIEW_MOVES as Record<string, ViewMove | undefined>)[id] ?? null;
}

export function moveName(id: MoveId | string): string {
  return moveInfo(id)?.name ?? String(id).replace(/_/g, ' ');
}

export function moveFamily(id: MoveId | string | null): MoveFamily | null {
  if (id === null) return null;
  return moveInfo(id)?.family ?? null;
}

/** Is this a floor move (the dancer's down: footwork, power, freezes)? */
export function isDown(id: MoveId | string | null): boolean {
  const f = moveFamily(id);
  return f === 'footwork' || f === 'power' || f === 'freeze';
}
