import { describe, expect, it } from 'vitest';

import { CAVE_KICKER, COURSE, COURSE_SECTIONS, courseCap } from './courseSpec';
import {
  centerX,
  featuresIn,
  lineAt,
  nearestTrack,
  SECTIONS,
  sectionAt,
  TRACK,
  trackAt,
  widthAt,
} from './track';
import { expectedSpeed, trackScale } from './trackSpeed';

describe('the Big Drop track', () => {
  it('runs unbroken from the summit pad to the snowfield', () => {
    expect(SECTIONS[0]!.s0).toBe(TRACK.start);
    expect(SECTIONS[SECTIONS.length - 1]!.s1).toBeCloseTo(TRACK.end, 3);
    for (let i = 1; i < SECTIONS.length; i++) {
      expect(SECTIONS[i]!.s0).toBe(SECTIONS[i - 1]!.s1);
      expect(SECTIONS[i]!.kind).not.toBe(SECTIONS[i - 1]!.kind);
    }
    // The SSX course as designed, then a cruise and a loop
    const n = COURSE_SECTIONS.length;
    expect(SECTIONS.slice(0, n).map(s => s.kind)).toEqual(COURSE_SECTIONS.map(c => c.kind));
    expect(SECTIONS[n - 1]!.s1).toBe(COURSE.end);
    expect(SECTIONS.map(s => s.kind).slice(n, n + 2)).toEqual(['cruise', 'loop']);
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
      if (f.kind === 'kicker' && f.s !== CAVE_KICKER.s) expect(sectionAt(f.s).kind).toBe('jumps');
      if (f.kind === 'loop') expect(sectionAt(f.s).kind).toBe('loop');
      if (f.kind === 'berm' && !f.id.endsWith('.split'))
        expect(sectionAt(f.s + f.len / 2).kind).toBe('slalom');
    }
  });

  it('holds the SSX course to its governor, then reaches 500 km/h within a minute and keeps going', () => {
    for (let s = TRACK.start; s < COURSE.end - 100; s += 50)
      expect(expectedSpeed(s)).toBeLessThanOrEqual(courseCap(s) + 0.1);
    expect(expectedSpeed(COURSE.end - 100) * 3.6).toBeGreaterThan(180);
    expect(expectedSpeed(COURSE.end + 1000) * 3.6).toBeGreaterThan(400);
    expect(expectedSpeed(COURSE.end + 3000) * 3.6).toBeGreaterThan(600);
    expect(expectedSpeed(60_000) * 3.6).toBeGreaterThan(2000);
    expect(trackScale(TRACK.start)).toBe(1);
    expect(trackScale(200_000)).toBe(5);
  });

  it('draws the track bigger as the speed builds', () => {
    const early = SECTIONS.slice(1, 6);
    const deep = SECTIONS.filter(s => s.s0 > 100_000).slice(0, 6);
    const mean = (a: readonly { s0: number; s1: number }[]) =>
      a.reduce((m, s) => m + (s.s1 - s.s0), 0) / a.length;
    expect(mean(deep)).toBeGreaterThan(3 * mean(early));
    // Jump lines come round at least once every six sections
    for (let i = 4; i + 6 < SECTIONS.length; i++)
      expect(SECTIONS.slice(i, i + 7).some(s => s.kind === 'jumps')).toBe(true);
  });

  it('reads the same line off its fast table', () => {
    const ln = { cx: 0, dcx: 0, w: 0, gully: 0, cruise: 0, feats: [] as never[] };
    for (let s = 30; s < 120_000; s += 377.7) {
      lineAt(s, ln);
      expect(Math.abs(ln.cx - centerX(s))).toBeLessThan(0.005);
      expect(Math.abs(ln.dcx - (centerX(s + 0.25) - centerX(s - 0.25)) / 0.5)).toBeLessThan(0.01);
      expect(Math.abs(ln.w - widthAt(s))).toBeLessThan(0.05);
    }
  });
});
