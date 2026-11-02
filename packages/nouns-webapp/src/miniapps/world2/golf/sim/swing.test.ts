import { describe, expect, it } from 'vitest';

import { CLUBS, clubOrder, suggestClub } from './clubs';
import { gaussian, hashInts, mulberry32 } from './rng';
import {
  dragSwing,
  launchOf,
  METER,
  meterAt,
  meterIdle,
  meterPress,
  meterStart,
  SwingMeter,
} from './swing';
import { windFor, windInfo } from './wind';

const speedOf = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z);

describe('launchOf', () => {
  it('a pure strike launches along the aim at the club speed and launch angle', () => {
    const l = launchOf({ club: '7i', aim: 0.4, power: 1, accuracy: 0 }, 'fairway');
    expect(speedOf(l.vel)).toBeCloseTo(CLUBS['7i'].speed, 6);
    expect(Math.atan2(l.vel.x, l.vel.z)).toBeCloseTo(0.4, 6);
    const ang = (Math.atan2(l.vel.y, Math.hypot(l.vel.x, l.vel.z)) * 180) / Math.PI;
    expect(ang).toBeCloseTo(CLUBS['7i'].launch, 6);
    // Pure backspin: about the right axis (−cos aim, 0, sin aim), no tilt
    const w = speedOf(l.spin);
    expect(w).toBeCloseTo((CLUBS['7i'].spin * 2 * Math.PI) / 60, 3);
    expect(l.spin.x / w).toBeCloseTo(-Math.cos(0.4), 6);
    expect(l.spin.z / w).toBeCloseTo(Math.sin(0.4), 6);
    expect(Math.abs(l.spin.y)).toBeLessThan(1e-9);
  });

  it('+accuracy starts right with a slice axis; −accuracy left with a hook axis', () => {
    const push = launchOf({ club: 'D', aim: 0, power: 1, accuracy: 0.5 }, 'tee');
    const pull = launchOf({ club: 'D', aim: 0, power: 1, accuracy: -0.5 }, 'tee');
    // Facing +z, right is −x
    expect(push.vel.x).toBeLessThan(0);
    expect(pull.vel.x).toBeGreaterThan(0);
    expect(push.spin.y).toBeLessThan(0);
    expect(pull.spin.y).toBeGreaterThan(0);
  });

  it('power scales speed; overswing adds a little and amplifies the error', () => {
    const half = launchOf({ club: '8i', aim: 0, power: 0.5, accuracy: 0 }, 'fairway');
    const over = launchOf({ club: '8i', aim: 0, power: 1.1, accuracy: 0.2 }, 'fairway');
    const full = launchOf({ club: '8i', aim: 0, power: 1, accuracy: 0.2 }, 'fairway');
    expect(speedOf(half.vel)).toBeCloseTo(CLUBS['8i'].speed * 0.5, 6);
    expect(speedOf(over.vel)).toBeGreaterThan(speedOf(full.vel));
    expect(speedOf(over.vel)).toBeLessThan(speedOf(full.vel) * 1.08);
    expect(Math.abs(over.vel.x)).toBeGreaterThan(Math.abs(full.vel.x) * 1.5);
  });

  it('lies: rough takes spin, sand chunks a long iron, a wedge works from sand', () => {
    const fw = launchOf({ club: '7i', aim: 0, power: 1, accuracy: 0 }, 'fairway');
    const rough = launchOf({ club: '7i', aim: 0, power: 1, accuracy: 0 }, 'rough');
    const sand = launchOf({ club: '5i', aim: 0, power: 1, accuracy: 0 }, 'sand');
    const sw = launchOf({ club: 'SW', aim: 0, power: 1, accuracy: 0 }, 'sand');
    expect(speedOf(rough.spin)).toBeLessThan(speedOf(fw.spin) * 0.8);
    expect(speedOf(sand.vel)).toBeLessThan(CLUBS['5i'].speed * 0.6);
    expect(speedOf(sw.vel)).toBeGreaterThan(CLUBS.SW.speed * 0.8);
  });

  it('the putter rolls along the slope plane with no air', () => {
    const n = { x: 0.1, y: Math.sqrt(1 - 0.01 - 0.0025), z: 0.05 };
    const l = launchOf({ club: 'P', aim: 0, power: 0.5, accuracy: 0 }, 'green', n);
    expect(l.vel.x * n.x + l.vel.y * n.y + l.vel.z * n.z).toBeCloseTo(0, 9);
    expect(speedOf(l.vel)).toBeCloseTo(4, 6);
    const flat = launchOf({ club: 'P', aim: 1, power: 0.25, accuracy: 0 }, 'green');
    expect(flat.vel.y).toBe(0);
  });
});

describe('swing meter', () => {
  it('three clicks: power from the fill, accuracy from the needle', () => {
    let m = meterStart(10);
    expect(meterAt(m, 10.5).fill).toBeCloseTo(0.5, 9);
    m = meterPress(m, 10.9); // power 0.9
    expect(m.phase).toBe('down');
    expect(m.power).toBeCloseTo(0.9, 9);
    // Needle at 0 after 0.9 / downRate s: a perfect strike
    const tZero = 10.9 + 0.9 / METER.downRate;
    expect(meterAt(m, tZero).needle).toBeCloseTo(0, 9);
    const pure = meterPress(m, tZero);
    expect(pure.phase).toBe('done');
    expect(pure.accuracy).toBeCloseTo(0, 9);
    // Late = past the line = + (push / slice); early = − (pull / hook)
    const late = meterPress(m, tZero + (0.5 * METER.zone) / METER.downRate);
    const early = meterPress(m, tZero - (0.5 * METER.zone) / METER.downRate);
    expect(late.accuracy).toBeCloseTo(0.5, 9);
    expect(early.accuracy).toBeCloseTo(-0.5, 9);
    expect(meterAt(late, 99).result).toEqual({ power: late.power, accuracy: late.accuracy });
  });

  it('auto-locks at overswing and at a missed third click', () => {
    const m = meterStart(0);
    const v = meterAt(m, 5);
    expect(v.phase).toBe('done');
    expect(v.result?.power).toBeCloseTo(METER.over, 9);
    expect(v.result?.accuracy).toBe(1);
    // Locked at the top: down phase from there
    expect(meterAt(m, METER.over * METER.backTime + 0.01).phase).toBe('down');
    // Extra presses after done change nothing
    const d = meterPress(meterPress(meterPress(m, 0.5), 0.5 + 0.5 / METER.downRate), 3);
    expect(meterPress(d, 4)).toEqual(d);
  });

  it('the class wraps the same thing', () => {
    const s = new SwingMeter();
    s.press(1);
    s.press(2); // full power
    const r = s.press(2 + 1 / METER.downRate);
    expect(s.done).toBe(true);
    expect(r.result?.power).toBeCloseTo(1, 9);
    expect(r.result?.accuracy).toBeCloseTo(0, 9);
    s.reset();
    expect(s.state).toEqual(meterIdle());
  });

  it('drag: pull length is power, the through-stroke angle is accuracy', () => {
    const straight = dragSwing({ x: 0, y: 200 }, { x: 0, y: -300 }, 200);
    expect(straight.power).toBeCloseTo(1, 9);
    expect(straight.accuracy).toBeCloseTo(0, 9);
    const right = dragSwing({ x: 0, y: 100 }, { x: 60, y: -300 }, 200);
    expect(right.power).toBeCloseTo(0.5, 9);
    expect(right.accuracy).toBeGreaterThan(0.5);
    const left = dragSwing({ x: 0, y: 100 }, { x: -60, y: -300 }, 200);
    expect(left.accuracy).toBeLessThan(-0.5);
    expect(dragSwing({ x: 0, y: 500 }, { x: 0, y: -500 }, 200).power).toBeCloseTo(METER.over, 9);
    // A decelerating through-stroke loses power
    expect(dragSwing({ x: 0, y: 200 }, { x: 0, y: -40 }, 200).power).toBeLessThan(0.8);
  });
});

describe('clubs, wind, rng', () => {
  it('suggests sensible clubs', () => {
    expect(suggestClub(240, 'tee')).toBe('D');
    expect(suggestClub(240, 'fairway')).toBe('3W');
    expect(suggestClub(150, 'fairway')).toBe('7i');
    expect(suggestClub(60, 'fairway')).toBe('LW');
    expect(suggestClub(8, 'green')).toBe('P');
    expect(suggestClub(8, 'fringe')).toBe('P');
    expect(CLUBS[suggestClub(200, 'sand')].wood).toBeFalsy();
    expect(clubOrder.length).toBe(14);
  });

  it('wind is seeded per hole, calm at 0, within the max', () => {
    expect(windFor(1, 0, 0)).toEqual({ x: 0, z: 0 });
    expect(windFor(5, 3, 0.7)).toEqual(windFor(5, 3, 0.7));
    expect(windFor(5, 3, 1)).not.toEqual(windFor(5, 4, 1));
    for (let i = 0; i < 50; i++) {
      const w = windInfo(windFor(9, i, 1));
      expect(w.speed).toBeGreaterThan(0);
      expect(w.speed).toBeLessThanOrEqual(10);
    }
  });

  it('the PRNG repeats', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
    expect(hashInts(1, 2)).not.toBe(hashInts(2, 1));
    const r = mulberry32(7);
    let s = 0;
    let s2 = 0;
    for (let i = 0; i < 4000; i++) {
      const g = gaussian(r);
      s += g;
      s2 += g * g;
    }
    expect(Math.abs(s / 4000)).toBeLessThan(0.06);
    expect(Math.abs(s2 / 4000 - 1)).toBeLessThan(0.08);
  });
});
