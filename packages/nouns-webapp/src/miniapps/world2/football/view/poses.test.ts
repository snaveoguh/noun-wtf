import { describe, expect, it } from 'vitest';

import { specNumbers } from '../../breakdance/view/pose';

import {
  ALL_ACTIONS,
  advanceStride,
  CELEBRATIONS,
  footballPose,
  gaitOf,
  holdsBall,
  kickSide,
  showSpeed,
  SKILLS,
  strideLength,
  type PoseIn,
} from './poses';
import { at, makeRig } from './testRig';

const base = (o: Partial<PoseIn>): PoseIn => ({
  action: 'idle',
  t: 0,
  dir: 0,
  speed: 0,
  phase: 0,
  side: 1,
  time: 1.3,
  variant: 0,
  ...o,
});

describe('football poses', () => {
  it('every action, side, variant and dir stays finite and never sinks into the floor', () => {
    for (const action of ALL_ACTIONS) {
      for (const side of [1, -1] as const)
        for (const variant of [0, 1, 2, 3, 5, 9])
          for (const dir of [-1, 0, 1, 2, 3]) {
            const rig = makeRig();
            for (const t of [0, 0.12, 0.3, 0.45, 0.6, 0.8, 0.99]) {
              const p = base({
                action,
                t,
                side,
                variant,
                dir,
                speed: showSpeed(action),
                phase: t * 3,
              });
              const out = footballPose(p);
              expect(specNumbers(out).every(Number.isFinite), `${action} spec`).toBe(true);
              rig.driver.drive(1, [{ out, w: 1 }], 1);
              expect(rig.driver.finite(), `${action} t${t} v${variant}`).toBe(true);
              expect(rig.driver.lowest(), `${action} t${t} lowest`).toBeGreaterThan(-0.05);
            }
          }
    }
  });

  it('the kicking foot is the side the ball is on: wound back, then through and up', () => {
    for (const action of ['pass', 'shoot', 'lob'] as const)
      for (const side of [1, -1] as const) {
        const kick = side === 1 ? 'foot.L' : 'foot.R';
        const plant = side === 1 ? 'foot.R' : 'foot.L';
        const rig = makeRig();
        rig.driver.drive(1, [{ out: footballPose(base({ action, t: 0.33, side })), w: 1 }], 1);
        const wound = at(rig, kick);
        const planted = at(rig, plant);
        expect(wound.z, `${action} ${side} wind-up behind`).toBeLessThan(planted.z - 0.1);
        expect(wound.y, `${action} heel up`).toBeGreaterThan(planted.y + 0.1);
        rig.driver.drive(1, [{ out: footballPose(base({ action, t: 0.72, side })), w: 1 }], 1);
        const thru = at(rig, kick);
        const planted2 = at(rig, plant);
        expect(thru.z, `${action} follow-through ahead`).toBeGreaterThan(planted2.z + 0.12);
        expect(thru.y, `${action} follow-through up`).toBeGreaterThan(planted2.y + 0.1);
      }
  });

  it('a shot follows through higher than a pass', () => {
    const h = (action: 'pass' | 'shoot') => {
      const rig = makeRig();
      rig.driver.drive(1, [{ out: footballPose(base({ action, t: 0.78 })), w: 1 }], 1);
      return at(rig, 'foot.L').y;
    };
    expect(h('shoot')).toBeGreaterThan(h('pass') + 0.05);
  });

  it('a header snaps the head forward', () => {
    const rig = makeRig();
    rig.driver.drive(1, [{ out: footballPose(base({ action: 'header', t: 0.3 })), w: 1 }], 1);
    const back = at(rig, 'head').z - at(rig, 'hips').z;
    rig.driver.drive(1, [{ out: footballPose(base({ action: 'header', t: 0.58 })), w: 1 }], 1);
    const fwd = at(rig, 'head').z - at(rig, 'hips').z;
    expect(fwd).toBeGreaterThan(back + 0.08);
  });

  it('a keeper dives to the side actionDir says, body near flat', () => {
    for (const dir of [1, -1]) {
      const rig = makeRig();
      rig.driver.drive(
        1,
        [{ out: footballPose(base({ action: 'gk_dive', t: 0.6, dir })), w: 1 }],
        1,
      );
      const head = at(rig, 'head');
      const hips = at(rig, 'hips');
      // +1 = the keeper's right = −X
      expect(Math.sign(head.x - hips.x), `dir ${dir}`).toBe(-dir);
      expect(Math.abs(head.x - hips.x)).toBeGreaterThan(0.3);
      expect(Math.abs(head.y - hips.y)).toBeLessThan(0.3);
    }
  });

  it('slides and falls go to the floor; a backflip goes upside down in the air', () => {
    const rig = makeRig();
    rig.driver.drive(1, [{ out: footballPose(base({ action: 'slide', t: 0.5 })), w: 1 }], 1);
    expect(at(rig, 'hips').y).toBeLessThan(0.42);
    rig.driver.drive(1, [{ out: footballPose(base({ action: 'fallen', t: 0.5 })), w: 1 }], 1);
    // Lying flat: the 0.85 m deep head holds the shoulders up, the hips are level with the neck
    expect(Math.abs(at(rig, 'hips').y - at(rig, 'neck').y)).toBeLessThan(0.25);
    expect(at(rig, 'hips').y).toBeLessThan(0.55);
    const flip = CELEBRATIONS.indexOf('backflip');
    rig.driver.drive(
      1,
      [{ out: footballPose(base({ action: 'celebrate', t: 0.5, variant: flip })), w: 1 }],
      1,
    );
    expect(at(rig, 'head').y).toBeLessThan(at(rig, 'hips').y);
    expect(rig.driver.lift).toBeGreaterThan(0.5);
  });

  it('running legs alternate with the stride phase', () => {
    const rig = makeRig();
    rig.driver.drive(
      1,
      [{ out: footballPose(base({ action: 'run', speed: 5, phase: 0.25 })), w: 1 }],
      1,
    );
    const d1 = at(rig, 'foot.L').z - at(rig, 'foot.R').z;
    rig.driver.drive(
      1,
      [{ out: footballPose(base({ action: 'run', speed: 5, phase: 0.75 })), w: 1 }],
      1,
    );
    const d2 = at(rig, 'foot.L').z - at(rig, 'foot.R').z;
    expect(d1).toBeGreaterThan(0.1);
    expect(d2).toBeLessThan(-0.1);
  });

  it('stride, gait, kick side and held-ball helpers', () => {
    expect(gaitOf(0)).toBe('idle');
    expect(gaitOf(2)).toBe('jog');
    expect(gaitOf(5)).toBe('run');
    expect(gaitOf(8.5)).toBe('sprint');
    for (let v = 0; v < 9; v++) expect(strideLength(v + 1)).toBeGreaterThan(strideLength(v));
    // Phase from distance: 10 m at 5 m/s is 10 / stride cycles, whatever the step size
    let a = 0;
    for (let i = 0; i < 100; i++) a = advanceStride(a, 0.1, 5);
    expect(a).toBeCloseTo(10 / strideLength(5), 6);
    expect(advanceStride(0.3, 0, 5)).toBe(0.3);
    // Facing +z (yaw 0), +x is the left
    expect(kickSide(0, 0, 0, 0.3, 0.4)).toBe(1);
    expect(kickSide(0, 0, 0, -0.3, 0.4)).toBe(-1);
    // Facing +x (yaw π/2): left is −z
    expect(kickSide(0, 0, Math.PI / 2, 0.4, -0.3)).toBe(1);
    expect(kickSide(0, 0, 0, 0, 0.4, 1)).toBe(1);
    expect(holdsBall('gk_hold', 0.5)).toBe(true);
    expect(holdsBall('gk_throw', 0.9)).toBe(false);
    expect(holdsBall('throw_in', 0.3)).toBe(true);
    expect(holdsBall('pass', 0.3)).toBe(false);
    expect(SKILLS.length).toBe(4);
  });
});
