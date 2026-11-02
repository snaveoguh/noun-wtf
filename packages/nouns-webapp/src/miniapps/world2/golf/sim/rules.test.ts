import type { GolfConfig, Hole, Lie, RoundState, ShotEvent, ShotResult, V3 } from '../contract';

import { describe, expect, it } from 'vitest';

import {
  applyShot,
  holeInfoFrom,
  honours,
  maxStrokes,
  newRound,
  nextHole,
  pickUp,
  scoreName,
  toPar,
  toParText,
  totals,
  waterDrop,
  whoseTurn,
  winners,
  type HoleInfo,
} from './rules';
import { testHoles } from './testCourse';

const { surface, holes } = testHoles();
const H1 = holes[0]; // par 4, 360, pin (0, 0, 360)
const H2 = holes[1]; // par 3 over a pond at z 75

function shot(rest: V3, lie: Lie, extra: Partial<ShotResult> = {}): ShotResult {
  const kind: ShotEvent['kind'] =
    extra.holed === true ? 'holed' : lie === 'water' ? 'water' : lie === 'ob' ? 'ob' : 'rest';
  return {
    path: [rest],
    events: [{ t: 1, kind, at: rest }],
    rest,
    lie: extra.holed === true ? 'green' : lie,
    holed: false,
    carry: 0,
    total: 0,
    apex: 0,
    ...extra,
  };
}
const holed = (pin: V3) => shot(pin, 'green', { holed: true });

function round(n: number, holeNums = [1, 2, 3, 4]): RoundState {
  const config: GolfConfig = {
    gid: 'g',
    seed: 9,
    players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, human: true })),
    holes: holeNums,
    wind: 0.5,
  };
  return newRound(config, holes);
}

describe('rules', () => {
  it('starts on the 1st tee with an empty card and the seeded wind', () => {
    const s = round(3);
    expect(s.phase).toBe('tee');
    expect(s.hole).toBe(0);
    expect(s.turn).toBe(0);
    expect(s.card).toEqual([
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
    ]);
    expect(s.cur.every(p => p.ball === null && p.strokes === 0)).toBe(true);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(newRound({ ...s.config, holes: [] }, holes).config.holes).toEqual([1, 2, 3, 4]);
  });

  it('turn order: everyone tees off, then farthest from the pin', () => {
    let s = round(3);
    s = applyShot(s, 0, shot({ x: 0, y: 0, z: 250 }, 'fairway'), H1);
    expect(s.phase).toBe('tee');
    expect(s.turn).toBe(1);
    s = applyShot(s, 1, shot({ x: 0, y: 0, z: 200 }, 'rough'), H1);
    expect(s.turn).toBe(2);
    s = applyShot(s, 2, shot({ x: 5, y: 0, z: 280 }, 'fairway'), H1);
    expect(s.phase).toBe('play');
    expect(s.turn).toBe(1); // 160 out
    s = applyShot(s, 1, shot({ x: 0, y: 0, z: 350 }, 'green'), H1);
    expect(s.last?.call).toBe('ON THE GREEN');
    expect(s.turn).toBe(0); // 110 out
    expect(s.n).toBe(4);
    // Inputs are never mutated
    expect(round(3).cur[0].strokes).toBe(0);
  });

  it('a holed player is skipped; the hole ends when all are in; scores and calls', () => {
    let s = round(2);
    s = applyShot(s, 0, shot({ x: 0, y: 0, z: 250 }, 'fairway'), H1);
    s = applyShot(s, 1, shot({ x: 0, y: 0, z: 240 }, 'fairway'), H1);
    s = applyShot(s, 1, holed(H1.pin), H1); // eagle 2
    expect(s.last?.call).toBe('EAGLE');
    expect(s.cur[1].holed).toBe(true);
    expect(s.turn).toBe(0);
    s = applyShot(s, 0, shot({ x: 0, y: 0, z: 355 }, 'green'), H1);
    expect(s.turn).toBe(0);
    s = applyShot(s, 0, holed(H1.pin), H1);
    expect(s.last?.call).toBe('BIRDIE');
    expect(s.phase).toBe('holed');
    expect(s.card.map(r => r[0])).toEqual([3, 2]);
    // Next hole: honours to the eagle
    const n = nextHole(s, holes);
    expect(n.phase).toBe('tee');
    expect(n.hole).toBe(1);
    expect(n.turn).toBe(1);
    expect(honours(n, 1)).toEqual([1, 0]);
    expect(n.cur.every(p => p.strokes === 0 && !p.holed)).toBe(true);
  });

  it('water: one stroke, dropped on dry ground back toward where it was played from', () => {
    let s = round(1, [2]);
    const entry = { x: H2.pin.x, y: 0, z: 80 };
    s = applyShot(s, 0, shot(entry, 'water'), H2);
    expect(s.cur[0].strokes).toBe(2);
    expect(s.last?.penalty).toBe(1);
    expect(s.last?.call).toBe('IN THE WATER');
    const b = s.cur[0].ball!;
    expect(surface.lie(b.x, b.z)).not.toBe('water');
    expect(surface.waterLevel(b.x, b.z)).toBeNull();
    expect(b.z).toBeLessThan(50); // the pond spans z 50..100
    expect(b.z).toBeGreaterThan(40);
    expect(b.x).toBeCloseTo(H2.pin.x, 6);
    expect(b.y).toBeCloseTo(surface.height(b.x, b.z), 9);
    expect(s.cur[0].lie).toBe(surface.lie(b.x, b.z));
    expect(s.last?.next).toEqual(b);
  });

  it('water with no dry ground to drop on: replay from the previous spot', () => {
    const custom: HoleInfo = { ...H2, dropFor: () => null };
    let s = round(1, [2]);
    s = applyShot(s, 0, shot({ x: 0, y: 0, z: 80 }, 'water'), custom);
    expect(s.cur[0].ball).toEqual(H2.teeSpot);
    expect(s.cur[0].lie).toBe('tee');
    expect(s.cur[0].strokes).toBe(2);
    // And waterDrop itself says null when everything is wet
    const wet = { ...surface, lie: () => 'water' as Lie };
    expect(waterDrop(wet, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 20 })).toBeNull();
  });

  it('OB: stroke and distance', () => {
    let s = round(1);
    s = applyShot(s, 0, shot({ x: 0, y: 0, z: 230 }, 'fairway'), H1);
    s = applyShot(s, 0, shot({ x: 90, y: 0, z: 300 }, 'ob'), H1);
    expect(s.last?.call).toBe('OUT OF BOUNDS');
    expect(s.cur[0].strokes).toBe(3);
    expect(s.cur[0].ball).toEqual({ x: 0, y: 0, z: 230 });
    expect(s.cur[0].lie).toBe('fairway');
    // OB off the tee: back on the tee, 3 off the tee next
    let t = round(1);
    t = applyShot(t, 0, shot({ x: 90, y: 0, z: 200 }, 'ob'), H1);
    expect(t.cur[0].ball).toEqual(H1.teeSpot);
    expect(t.cur[0].lie).toBe('tee');
    expect(t.cur[0].strokes).toBe(2);
  });

  it('picks up at min(par + 5, 10)', () => {
    expect(maxStrokes(3)).toBe(8);
    expect(maxStrokes(5)).toBe(10);
    let s = round(2);
    for (let i = 0; i < 4; i++) s = applyShot(s, 0, shot({ x: 0, y: 0, z: 1 }, 'ob'), H1); // 8 strokes
    expect(s.cur[0].strokes).toBe(8);
    s = applyShot(s, 0, shot({ x: 0, y: 0, z: 10 }, 'rough'), H1); // 9 = par + 5
    expect(s.cur[0].picked).toBe(true);
    expect(s.cur[0].strokes).toBe(9);
    expect(s.last?.call).toBe('PICKED UP');
    expect(s.turn).toBe(1);
    // A penalty can't push past the cap
    let p = round(1);
    for (let i = 0; i < 5; i++) p = applyShot(p, 0, shot({ x: 0, y: 0, z: 1 }, 'ob'), H1);
    expect(p.cur[0].strokes).toBe(9);
    expect(p.phase).toBe('holed');
  });

  it('a conceded putt counts one more stroke', () => {
    let s = round(2);
    s = applyShot(s, 0, shot({ x: 0, y: 0, z: 359 }, 'green'), H1);
    s = pickUp(s, 0, H1, true);
    expect(s.cur[0].holed).toBe(true);
    expect(s.cur[0].strokes).toBe(2);
    expect(s.turn).toBe(1);
  });

  it('the round ends after the last hole; totals, to par, winners', () => {
    let s = round(2, [1, 2]);
    // Hole 1: 4 and 5
    s = applyShot(s, 0, shot({ x: 0, y: 0, z: 250 }, 'fairway'), H1);
    s = applyShot(s, 1, shot({ x: 0, y: 0, z: 200 }, 'fairway'), H1);
    s = applyShot(s, 1, shot({ x: 0, y: 0, z: 340 }, 'fairway'), H1);
    s = applyShot(s, 0, shot({ x: 0, y: 0, z: 355 }, 'green'), H1);
    s = applyShot(s, 1, shot({ x: 0, y: 0, z: 352 }, 'green'), H1);
    s = applyShot(s, 1, shot({ x: 0, y: 0, z: 357 }, 'green'), H1);
    expect(s.turn).toBe(0);
    s = applyShot(s, 0, shot({ x: 0, y: 0, z: 358 }, 'green'), H1);
    s = applyShot(s, 0, holed(H1.pin), H1);
    s = applyShot(s, 1, holed(H1.pin), H1);
    expect(s.card.map(r => r[0])).toEqual([4, 5]);
    s = nextHole(s, holes);
    expect(s.turn).toBe(0); // honours
    s = applyShot(s, 0, holed(H2.pin), H2);
    expect(s.last?.call).toBe('HOLE IN ONE');
    s = applyShot(s, 1, shot({ x: 0, y: 0, z: 148 }, 'green'), H2);
    s = applyShot(s, 1, holed(H2.pin), H2);
    expect(s.phase).toBe('over');
    expect(totals(s)).toEqual([5, 7]);
    expect(toPar(s, holes)).toEqual([-2, 0]);
    expect(toParText(-2)).toBe('−2');
    expect(toParText(0)).toBe('E');
    expect(winners(s)).toEqual([0]);
    // Nothing more counts
    expect(applyShot(s, 0, holed(H2.pin), H2)).toBe(s);
    expect(nextHole(s, holes)).toBe(s);
  });

  it('ties share the win', () => {
    const s = { ...round(3, [1]), card: [[4], [4], [5]], phase: 'over' as const };
    expect(winners(s)).toEqual([0, 1]);
  });

  it('score names', () => {
    expect(scoreName(1, 3)).toBe('HOLE IN ONE');
    expect(scoreName(2, 5)).toBe('ALBATROSS');
    expect(scoreName(3, 5)).toBe('EAGLE');
    expect(scoreName(3, 4)).toBe('BIRDIE');
    expect(scoreName(4, 4)).toBe('PAR');
    expect(scoreName(5, 4)).toBe('BOGEY');
    expect(scoreName(6, 4)).toBe('DOUBLE BOGEY');
    expect(scoreName(7, 4)).toBe('TRIPLE BOGEY');
    expect(scoreName(9, 4)).toBe('+5');
  });

  it('in the bunker call; whoseTurn with nobody left', () => {
    let s = round(1);
    s = applyShot(s, 0, shot({ x: 22, y: 0, z: 354 }, 'sand'), H1);
    expect(s.last?.call).toBe('IN THE BUNKER');
    s = applyShot(s, 0, holed(H1.pin), H1);
    expect(whoseTurn(s, H1)).toBe(-1);
  });

  it('holeInfoFrom maps a contract Hole', () => {
    const hole = {
      n: 7,
      par: 3,
      name: 'X',
      hcp: 5,
      tee: { kind: 'rect', x: 0, z: 0, hw: 3, hl: 3, yaw: 0, round: 1 },
      teeSpot: { x: 1, y: 2, z: 3 },
      line: [
        { x: 1, z: 3 },
        { x: 1, z: 150 },
      ],
      length: 147,
      fairway: null,
      green: [],
      pin: { x: 1, y: 2, z: 150 },
      greenPlane: { cx: 1, cz: 150, y0: 2, gx: 0, gz: 0 },
      bunkers: [],
      water: [],
      roughHalf: 20,
    } satisfies Hole;
    const info = holeInfoFrom(hole, surface);
    expect(info).toMatchObject({
      n: 7,
      par: 3,
      hcp: 5,
      teeSpot: hole.teeSpot,
      pin: hole.pin,
      line: hole.line,
    });
    expect(info.surface).toBe(surface);
  });
});
