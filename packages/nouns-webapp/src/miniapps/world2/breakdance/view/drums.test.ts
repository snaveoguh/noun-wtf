import { describe, expect, it } from 'vitest';

import {
  breakStep,
  peak,
  renderBass,
  renderHat,
  renderKick,
  renderScratch,
  renderSnare,
  renderStab,
  renderVox,
  stepTime,
} from './drums';

describe('break pattern', () => {
  it('kick on every downbeat, backbeat snares on 2 and 4', () => {
    for (let bar = 0; bar < 8; bar++) {
      expect(breakStep(bar, 0).kick, `bar ${bar}`).toBeGreaterThan(0.9);
      expect(breakStep(bar, 4).snare).toBeGreaterThan(0.9);
      if (bar % 4 !== 3) expect(breakStep(bar, 12).snare).toBeGreaterThan(0.9);
    }
  });

  it('every fourth bar ends in a snare fill', () => {
    const fill = [12, 13, 14, 15].map(s => breakStep(3, s).snare);
    expect(fill.every(v => v > 0.5)).toBe(true);
    expect(breakStep(3, 13).hat).toBe(0);
  });

  it('handles negative bars (the intro count-in)', () => {
    expect(breakStep(-1, 0).kick).toBeGreaterThan(0.9);
    expect(breakStep(-2, 4).snare).toBeGreaterThan(0.9);
  });
});

describe('stepTime', () => {
  it('puts every downbeat exactly on its beat, swing only on the odd 16ths', () => {
    const spb = 60 / 104;
    for (let bar = -2; bar < 6; bar++) {
      const t = stepTime(10, 0, bar * 16, spb, 0.58);
      expect(t).toBeCloseTo(10 + bar * 4 * spb, 12);
    }
    // Even 16ths unswung, odd ones late
    expect(stepTime(0, 0, 2, 0.5, 0.6)).toBeCloseTo(0.25, 12);
    expect(stepTime(0, 0, 1, 0.5, 0.6)).toBeGreaterThan(0.125);
    expect(stepTime(0, 0, 1, 0.5, 0.5)).toBeCloseTo(0.125, 12);
  });

  it('follows the anchor', () => {
    expect(stepTime(3, 8, 32, 0.5)).toBeCloseTo(3);
  });
});

describe('samples', () => {
  const sr = 22050;
  it('render finite, in range, non-silent', () => {
    const vox = renderVox(sr);
    for (const [name, a] of [
      ['kick', renderKick(sr)],
      ['snare', renderSnare(sr)],
      ['hat', renderHat(sr, false)],
      ['open', renderHat(sr, true)],
      ['bass', renderBass(sr)],
      ['stab', renderStab(sr)],
      ['vox', vox],
      ['scratch', renderScratch(sr, vox, 1, 2)],
    ] as const) {
      expect(a.length, name).toBeGreaterThan(100);
      expect(Array.from(a).every(Number.isFinite), name).toBe(true);
      const p = peak(a);
      expect(p, name).toBeLessThanOrEqual(1);
      expect(p, name).toBeGreaterThan(0.05);
    }
  });

  it('is deterministic (same samples every time)', () => {
    expect(Array.from(renderSnare(8000))).toEqual(Array.from(renderSnare(8000)));
  });

  it('a scratch has the length asked for', () => {
    expect(renderScratch(sr, renderVox(sr), 1.2).length).toBe(Math.floor(sr * 1.2));
  });
});
