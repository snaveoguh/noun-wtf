// The move library (data). Every MoveId in the contract has a MoveSpec here.
//
// Patterns are one key per beat (half beat when `half`), and read like the
// move: a windmill rolls down / left / up / right, a headspin circles the
// other way from the top, flares swing left and right with a hand plant
// between, footwork lives on `down` and the buttons, toprock steps
// left / right / up, and every freeze ends on a button, held on the move's
// last beat. Difficulty and points climb from toprock through footwork to
// power moves and air freezes.
//
// Rules the recogniser relies on (checked in moves.test.ts):
//   - no pattern is a prefix of another (so a completed pattern is final);
//   - every move's length on the grid is a whole number of beats;
//   - every freeze ends on a button.

import type { BreakKey, MoveFamily, MoveId, MoveSpec } from '../contract';

const GROUND: readonly MoveFamily[] = ['footwork', 'power', 'freeze', 'transition'];

function spec(
  id: MoveId,
  name: string,
  family: MoveFamily,
  pattern: readonly BreakKey[],
  difficulty: number,
  points: number,
  flowsTo: readonly MoveFamily[],
  half = false,
): MoveSpec {
  const beats = pattern.length * (half ? 0.5 : 1);
  return half
    ? { id, name, family, pattern, half, beats, difficulty, points, flowsTo }
    : { id, name, family, pattern, beats, difficulty, points, flowsTo };
}

const TOPROCK_FLOW: readonly MoveFamily[] = ['toprock', 'transition'];
const DOWN_FLOW: readonly MoveFamily[] = ['footwork', 'power', 'freeze'];
const POWER_FLOW: readonly MoveFamily[] = ['power', 'freeze', 'transition'];
const FREEZE_FLOW: readonly MoveFamily[] = ['footwork', 'transition'];

/** Every move, in table order (toprock → transitions → footwork → power → freezes). */
export const MOVE_LIST: readonly MoveSpec[] = [
  // toprock: on your feet, one bar each
  spec(
    'indian_step',
    'Indian Step',
    'toprock',
    ['left', 'right', 'left', 'right'],
    1,
    8,
    TOPROCK_FLOW,
  ),
  spec('salsa_rock', 'Salsa Rock', 'toprock', ['left', 'up', 'right', 'up'], 1, 9, TOPROCK_FLOW),
  spec('cross_step', 'Cross Step', 'toprock', ['right', 'left', 'right', 'b'], 2, 12, TOPROCK_FLOW),
  spec('kick_step', 'Kick Step', 'toprock', ['up', 'a', 'up', 'b'], 2, 12, TOPROCK_FLOW),
  // transitions: down to the floor, and back up
  spec('drop', 'Drop', 'transition', ['down', 'down'], 1, 5, DOWN_FLOW),
  spec('spin_down', 'Spin Down', 'transition', ['right', 'down'], 2, 7, DOWN_FLOW),
  spec('get_up', 'Get Up', 'transition', ['up', 'up'], 1, 5, TOPROCK_FLOW),
  // footwork / downrock
  spec('three_step', '3-Step', 'footwork', ['b', 'left', 'b', 'right'], 2, 14, GROUND, true),
  spec('kick_out', 'Kick Out', 'footwork', ['down', 'right', 'a'], 2, 12, GROUND),
  spec(
    'six_step',
    '6-Step',
    'footwork',
    ['down', 'left', 'b', 'right', 'down', 'a'],
    2,
    18,
    GROUND,
  ),
  spec('cc', 'CC', 'footwork', ['down', 'a', 'down', 'b'], 3, 17, GROUND, true),
  spec('pretzel', 'Pretzel', 'footwork', ['b', 'down', 'left', 'right', 'a'], 3, 22, GROUND),
  // power
  spec('backspin', 'Backspin', 'power', ['right', 'b', 'left', 'b'], 2, 18, GROUND),
  spec('turtle', 'Turtle', 'power', ['a', 'b', 'a', 'b', 'a', 'b'], 3, 22, POWER_FLOW, true),
  spec('windmill', 'Windmill', 'power', ['down', 'left', 'up', 'right'], 3, 25, POWER_FLOW),
  spec('swipe', 'Swipe', 'power', ['a', 'down', 'b', 'up'], 3, 24, GROUND),
  spec('headspin', 'Headspin', 'power', ['up', 'right', 'down', 'left'], 4, 30, POWER_FLOW),
  spec('flare', 'Flare', 'power', ['left', 'b', 'right', 'b'], 4, 30, POWER_FLOW, true),
  spec(
    'airflare',
    'Airflare',
    'power',
    ['a', 'up', 'b', 'up', 'a', 'up', 'b', 'up'],
    5,
    44,
    POWER_FLOW,
    true,
  ),
  // freezes: the last key is the hold, on the move's last beat
  spec('baby_freeze', 'Baby Freeze', 'freeze', ['down', 'b'], 1, 10, FREEZE_FLOW),
  spec('chair_freeze', 'Chair Freeze', 'freeze', ['left', 'down', 'b'], 2, 14, FREEZE_FLOW),
  spec('headstand', 'Headstand', 'freeze', ['up', 'down', 'a'], 2, 15, FREEZE_FLOW),
  spec('airchair', 'Airchair', 'freeze', ['right', 'up', 'a'], 4, 28, FREEZE_FLOW),
  spec('hollowback', 'Hollowback', 'freeze', ['b', 'up', 'left', 'up', 'a'], 5, 34, FREEZE_FLOW),
];

export const MOVES: Readonly<Record<MoveId, MoveSpec>> = Object.fromEntries(
  MOVE_LIST.map(m => [m.id, m]),
) as Record<MoveId, MoveSpec>;

/** Grid step of a move (beats between its keys). */
export function grid(m: MoveSpec): number {
  return m.half === true ? 0.5 : 1;
}

/** Beat (relative to the move's start) of key `i`. */
export function keyBeat(m: MoveSpec, i: number): number {
  return i * grid(m);
}

/**
 * Where the dancer is coming from: a move, `null` (on their feet at the
 * start of a turn) or 'any' (just picked themselves up after a crash: any
 * move goes).
 */
export type FlowFrom = MoveId | null | 'any';

/** Can `next` follow `prev` without a transition in between? */
export function canFlow(prev: FlowFrom, next: MoveSpec): boolean {
  if (prev === 'any') return true;
  if (prev === null) {
    // standing: toprock, or go down (not "get up", you're already up)
    return next.family === 'toprock' || next.id === 'drop' || next.id === 'spin_down';
  }
  const p = MOVES[prev];
  return !p.flowsTo || p.flowsTo.includes(next.family);
}

/** Air freezes / power: what the power judge looks for. */
export function isPowerish(m: MoveSpec): boolean {
  return m.family === 'power' || (m.family === 'freeze' && m.difficulty >= 4);
}
