import { describe, expect, it } from 'vitest';

import {
  ASCENT_S,
  ascentPose,
  BASIN,
  CodeMatcher,
  darkness,
  DESCENT_S,
  descentPose,
  divePoses,
  drainAt,
  HOLE,
  Knock,
  sparkle,
  TILE,
  tileDist,
  type Pose,
} from './secret';

describe('the code', () => {
  it('opens on N-O-U-N-S, case-insensitive, with junk before it', () => {
    const m = new CodeMatcher();
    const hits = [...'xxnouNs'].map((k, i) => m.push(k, i * 100));
    expect(hits).toEqual([false, false, false, false, false, false, true]);
  });

  it('ignores non-letters, resets after a pause, and needs the whole word again', () => {
    const m = new CodeMatcher('NOUNS', 1000);
    for (const [i, k] of [...'NOUN'].entries()) m.push(k, i * 100);
    expect(m.push('Shift', 450)).toBe(false);
    expect(m.push('S', 5000)).toBe(false); // too late
    let t = 6000;
    expect([...'NOUNS'].map(k => m.push(k, (t += 100))).at(-1)).toBe(true);
    expect(m.push('S', (t += 100))).toBe(false);
  });
});

describe('knocks', () => {
  it('opens on the third knock inside the window', () => {
    const k = new Knock(3, 2000);
    expect(k.tap(0)).toBe(false);
    expect(k.tap(500)).toBe(false);
    expect(k.tap(1000)).toBe(true);
    expect(k.count).toBe(0);
  });
  it('slow knocks never add up', () => {
    const k = new Knock(3, 2000);
    expect([0, 1500, 3200, 4900].map(t => k.tap(t))).toEqual([false, false, false, false]);
  });
});

describe('placement and sparkle', () => {
  it('the tile is on the rim, the hole in the basin', () => {
    expect(Math.hypot(TILE.x, TILE.z)).toBeGreaterThan(BASIN.outer);
    expect(Math.hypot(HOLE.x, HOLE.z)).toBeGreaterThan(BASIN.inner);
    expect(Math.hypot(HOLE.x, HOLE.z)).toBeLessThan(BASIN.outer);
    expect(tileDist(TILE.x, TILE.z)).toBe(0);
  });
  it('sparkles only up close', () => {
    expect(sparkle(10)).toBe(0);
    expect(sparkle(3.5)).toBe(0);
    expect(sparkle(2)).toBeGreaterThan(0);
    expect(sparkle(0.5)).toBe(1);
  });
});

const start: Pose = { pos: { x: 3, y: 4, z: 25 }, look: { x: 0, y: 1, z: 20 } };

describe('the descent and the way back up', () => {
  it('starts at the gameplay camera and ends under the basin', () => {
    expect(descentPose(0, start)).toEqual(start);
    const end = descentPose(DESCENT_S, start);
    expect(end.pos.y).toBeLessThan(-5);
    expect(Math.hypot(end.pos.x - HOLE.x, end.pos.z - HOLE.z)).toBeLessThan(0.5);
    expect(end).toEqual(divePoses()[2]);
  });

  it('moves smoothly (no jumps between frames)', () => {
    let prev = descentPose(0, start);
    for (let t = 0.02; t <= DESCENT_S; t += 0.02) {
      const p = descentPose(t, start);
      expect(
        Math.hypot(p.pos.x - prev.pos.x, p.pos.y - prev.pos.y, p.pos.z - prev.pos.z),
      ).toBeLessThan(0.8);
      prev = p;
    }
  });

  it('comes back up from below into the live camera', () => {
    const first = ascentPose(0, start);
    expect(first.pos.y).toBeLessThan(0);
    expect(ascentPose(ASCENT_S, start)).toEqual(start);
  });

  it('the water drains before the dive, the screen darkens at the end', () => {
    expect(drainAt(0)).toBe(0);
    expect(drainAt(1.7)).toBe(1);
    expect(darkness('down', 1)).toBe(0);
    expect(darkness('down', DESCENT_S)).toBe(1);
    expect(darkness('up', 0)).toBe(1);
    expect(darkness('up', 1)).toBe(0);
  });
});
