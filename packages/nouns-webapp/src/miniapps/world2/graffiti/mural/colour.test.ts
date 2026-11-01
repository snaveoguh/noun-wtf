import { describe, expect, it } from 'vitest';

import { hsvToRgb, parseHex, rgbToHsv } from './colour';

describe('colour', () => {
  it('round-trips every palette-ish colour', () => {
    for (const c of [
      0xf3322c, 0xffc110, 0x068940, 0x254efb, 0xffffff, 0x000000, 0x807f7e, 0x1f1d29,
    ])
      expect(hsvToRgb(rgbToHsv(c))).toBe(c);
  });
  it('knows the primaries', () => {
    expect(rgbToHsv(0xff0000)).toEqual({ h: 0, s: 1, v: 1 });
    expect(hsvToRgb({ h: 120, s: 1, v: 1 })).toBe(0x00ff00);
    expect(hsvToRgb({ h: 240, s: 1, v: 1 })).toBe(0x0000ff);
    expect(hsvToRgb({ h: 360, s: 1, v: 1 })).toBe(0xff0000);
  });
  it('parses typed hex', () => {
    expect(parseHex('#F3322C')).toBe(0xf3322c);
    expect(parseHex('f33')).toBe(0xff3333);
    expect(parseHex(' 00ff00 ')).toBe(0x00ff00);
    expect(parseHex('zzz')).toBeNull();
    expect(parseHex('#12345')).toBeNull();
  });
});
