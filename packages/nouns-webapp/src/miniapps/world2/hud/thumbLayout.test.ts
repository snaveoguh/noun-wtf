import { describe, expect, it } from 'vitest';

import { clip, playZone, unionArea } from './coverage';
import { isLandscapePhone, thumbPad, touchRects } from './thumbLayout';

const SCREENS: [string, number, number][] = [
  ['iPhone 14', 390, 844],
  ['small Android', 360, 740],
  ['iPhone SE', 375, 667],
  ['Pro Max', 430, 932],
  ['landscape', 844, 390],
  ['landscape SE', 667, 375],
];

describe('touch layout', () => {
  it('knows a phone on its side', () => {
    expect(isLandscapePhone(844, 390)).toBe(true);
    expect(isLandscapePhone(390, 844)).toBe(false);
    expect(isLandscapePhone(1440, 900)).toBe(false);
  });

  for (const [name, W, H] of SCREENS) {
    describe(`${name} ${W}x${H}`, () => {
      const rects = touchRects(W, H);
      it('keeps every control out of the middle 70%', () => {
        const zone = playZone(W, H);
        for (const { id, r } of rects) expect([id, clip(r, zone)]).toEqual([id, null]);
      });
      it('keeps every control on screen', () => {
        for (const { id, r } of rects) {
          expect([id, r.x >= 0 && r.y >= 0]).toEqual([id, true]);
          expect([id, r.x + r.w <= W && r.y + r.h <= H]).toEqual([id, true]);
        }
      });
      it('never stacks two controls', () => {
        const total = rects.reduce((a, { r }) => a + r.w * r.h, 0);
        expect(unionArea(rects.map(x => x.r))).toBeCloseTo(total, 6);
      });
      it('keeps thumb targets at least 44 px', () => {
        for (const { r } of rects) expect(Math.min(r.w, r.h)).toBeGreaterThanOrEqual(44);
      });
    });
  }

  it('puts OLLIE, the main button, in the corner and biggest', () => {
    for (const [, W, H] of SCREENS) {
      const pad = thumbPad(W, H);
      const ollie = pad.find(b => b.id === 'ollie')!;
      expect(Math.max(...pad.map(b => b.size))).toBe(ollie.size);
      expect(ollie.right).toBeLessThanOrEqual(12);
    }
  });
});
