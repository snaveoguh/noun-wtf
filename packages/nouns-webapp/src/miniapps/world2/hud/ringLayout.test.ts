import { describe, expect, it } from 'vitest';

import { clip, playZone, unionArea } from './coverage';
import {
  compactNum,
  DESK_RING,
  hudLayout,
  hudRects,
  PHONE_ICONS,
  rimSlots,
  TRAY_BOTTOM,
} from './ringLayout';
import { touchRects } from './thumbLayout';

const PHONES: [string, number, number][] = [
  ['iPhone 14', 390, 844],
  ['small Android', 360, 740],
  ['iPhone SE', 375, 667],
  ['Pro Max', 430, 932],
  ['landscape', 844, 390],
  ['landscape SE', 667, 375],
];

describe('rim slots', () => {
  it('stack evenly down the left rim without touching', () => {
    const b = rimSlots(DESK_RING, 4, 26, 6, DESK_RING - 6, 190);
    expect(b).toHaveLength(4);
    for (let i = 1; i < b.length; i++) expect(b[i]!.y - b[i - 1]!.y).toBeGreaterThanOrEqual(26 + 4);
    // On the rim: the middle ones hug the edge, the outer ones sit further in
    expect(b[1]!.x).toBeLessThan(b[0]!.x);
    // Never past the map's middle
    for (const x of b) expect(x.x).toBeLessThan(DESK_RING / 2);
  });
  it('centres a lone badge on the rim', () => {
    expect(rimSlots(100, 1, 20, 0, 100, 90)).toEqual([{ x: 8, y: 40 }]);
    expect(rimSlots(100, 0, 20, 0, 100, 90)).toEqual([]);
  });
  it('starts a second column when the range is short', () => {
    const b = rimSlots(86, 4, 18, 32, 92, 96);
    expect(b[3]!.x).toBeLessThan(b[0]!.x - 96);
    expect(b[0]!.y).toBe(32);
  });
});

describe('desktop', () => {
  const L = hudLayout(1440, 900, false);
  it('anchors the map top-right, clear of the top-centre toasts', () => {
    expect(L.size).toBe(DESK_RING);
    const left = Math.min(...hudRects(1440, 900, false, 10).map(x => x.r.x));
    // The toast stack is at most 520 px wide, centred
    expect(left).toBeGreaterThan(720 + 260);
  });
  it('keeps everything on screen', () => {
    for (const { id, r } of hudRects(1440, 900, false, 10))
      expect([id, r.x >= 0 && r.y >= 0 && r.x + r.w <= 1440 && r.y + r.h <= 900]).toEqual([
        id,
        true,
      ]);
  });
});

for (const [name, W, H] of PHONES) {
  describe(`phone ${name} ${W}x${H}`, () => {
    const rects = hudRects(W, H, true, PHONE_ICONS);
    it('keeps the map, badges and icons out of the middle 70%', () => {
      const zone = playZone(W, H);
      for (const { id, r } of rects) expect([id, clip(r, zone)]).toEqual([id, null]);
    });
    it('keeps them on screen', () => {
      for (const { id, r } of rects) {
        expect([id, r.x >= 0 && r.y >= 0]).toEqual([id, true]);
        expect([id, r.x + r.w <= W && r.y + r.h <= H]).toEqual([id, true]);
      }
    });
    it('never covers a touch button', () => {
      const pads = touchRects(W, H);
      for (const { id, r } of rects)
        for (const p of pads) expect([id, p.id, clip(r, p.r)]).toEqual([id, p.id, null]);
    });
    it('keeps badges and icons apart', () => {
      const own = rects.filter(x => x.id !== 'map' && x.id !== 'speed').map(x => x.r);
      const total = own.reduce((a, r) => a + r.w * r.h, 0);
      expect(unionArea(own)).toBeCloseTo(total, 6);
    });
    it('keeps the badges under the site tray', () => {
      for (const { id, r } of rects)
        if (id.startsWith('badge')) expect(r.y).toBeGreaterThanOrEqual(TRAY_BOTTOM - 2);
    });
    it('is a real map, not a dot', () => {
      expect(hudLayout(W, H, true).size).toBeGreaterThanOrEqual(76);
    });
    it('puts the toasts below the corner HUD', () => {
      const L = hudLayout(W, H, true);
      expect(L.toastTop).toBeGreaterThanOrEqual(playZone(W, H).y);
    });
  });
}

describe('compactNum', () => {
  it('keeps small numbers whole and shortens big ones', () => {
    expect(compactNum(0)).toBe('0');
    expect(compactNum(304)).toBe('304');
    expect(compactNum(9999)).toBe('9,999');
    expect(compactNum(12_840)).toBe('12.8K');
    expect(compactNum(328_000)).toBe('328K');
    expect(compactNum(999_499)).toBe('999K');
    expect(compactNum(999_600)).toBe('1M');
    expect(compactNum(12_791_501)).toBe('12.8M');
    expect(compactNum(2_400_000_000)).toBe('2.4B');
    expect(compactNum(-1500)).toBe('-1,500');
  });
});
