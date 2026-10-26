import { describe, expect, it } from 'vitest';

import {
  centerX,
  featuresIn,
  nearestTrack,
  SECTIONS,
  sectionAt,
  TRACK,
  trackAt,
  widthAt,
} from './track';

describe('the Big Drop track', () => {
  it('runs unbroken from the summit pad to the snowfield', () => {
    expect(SECTIONS[0]!.s0).toBe(TRACK.start);
    expect(SECTIONS[SECTIONS.length - 1]!.s1).toBeCloseTo(TRACK.end, 3);
    for (let i = 1; i < SECTIONS.length; i++) {
      expect(SECTIONS[i]!.s0).toBe(SECTIONS[i - 1]!.s1);
      expect(SECTIONS[i]!.kind).not.toBe(SECTIONS[i - 1]!.kind);
    }
    expect(SECTIONS.map(s => s.kind).slice(0, 4)).toEqual(['cruise', 'jumps', 'slalom', 'loop']);
    expect(new Set(SECTIONS.map(s => s.kind)).size).toBe(5);
  });

  it('leaves the pad dead straight and stays gentle enough to follow', () => {
    expect(centerX(TRACK.start)).toBeCloseTo(0, 6);
    let steepest = 0;
    for (let s = TRACK.start; s < 200_000; s += 7) {
      const slope = Math.abs(centerX(s + 0.5) - centerX(s - 0.5));
      steepest = Math.max(steepest, slope);
    }
    expect(steepest).toBeLessThan(1.4);
  });

  it('finds the nearest point of the line', () => {
    const p = trackAt(5000, { x: 0, y: 0, z: 0, dirX: 0, dirZ: 1, width: 0, section: 'cruise' });
    const n = nearestTrack(p.x + 10 * p.dirZ, p.z - 10 * p.dirX, { s: 0, lateral: 0, dist: 0 });
    expect(Math.abs(n.lateral - 10)).toBeLessThan(0.5);
    expect(sectionAt(5000).kind).toBe(p.section);
    expect(widthAt(5000)).toBeGreaterThan(25);
  });

  it('puts the features on their sections', () => {
    const all = featuresIn(TRACK.start, 40_000);
    const kinds = new Set(all.map(f => f.kind));
    for (const k of ['gate', 'kicker', 'loop', 'berm', 'marker'])
      expect(kinds.has(k as never)).toBe(true);
    for (const f of all) {
      if (f.kind === 'kicker') expect(sectionAt(f.s).kind).toBe('jumps');
      if (f.kind === 'loop') expect(sectionAt(f.s).kind).toBe('loop');
      if (f.kind === 'berm') expect(sectionAt(f.s + f.len / 2).kind).toBe('slalom');
    }
  });
});
