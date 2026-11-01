import { inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { OG_H, OG_W, encodePng, nounGrid, renderNounCard } from './nounOg';

// Trait images in the descriptor's RLE: palette byte, top / right / bottom /
// left, then (run, colour) pairs. Palette: 0 transparent, 1 red, 2 black.
const PALETTE = ['', 'ff0e0e', '000000'];
// A 14-wide red bar on row 21 (x 9..22)
const BAR = { data: '0x00' + '15' + '17' + '16' + '09' + '0e01' };
// A black pixel at (0, 0) then a transparent one, in a 2-wide box
const DOT = { data: '0x00' + '00' + '02' + '01' + '00' + '0102' + '0100' };
const GRID = () => nounGrid([BAR, DOT], PALETTE, 'd5d7e1');

/** Pixel (x, y) of a PNG this module wrote (RGB, filter 0). */
function pixel(png: Buffer, x: number, y: number): number[] {
  const w = png.readUInt32BE(16);
  let off = 8;
  const idat: Buffer[] = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idat.push(png.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const i = y * (w * 3 + 1) + 1 + x * 3;
  return [raw[i]!, raw[i + 1]!, raw[i + 2]!];
}

describe('Noun share card', () => {
  it('decodes the trait images into the 32 × 32 grid', () => {
    const g = GRID();
    expect(g.bg).toEqual([0xd5, 0xd7, 0xe1]);
    expect(g.px[21 * 32 + 9]).toEqual([255, 14, 14]); // the run's first pixel
    expect(g.px[21 * 32 + 22]).toEqual([255, 14, 14]); // and its last (14 wide)
    expect(g.px[21 * 32 + 23]).toBeNull();
    expect(g.px[0]).toEqual([0, 0, 0]);
    expect(g.px[1]).toBeNull(); // colour 0 is transparent
  });

  it('is a 1200 × 630 PNG with the Noun big, centred, standing on the bottom edge', () => {
    const png = renderNounCard(GRID());
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(OG_W);
    expect(png.readUInt32BE(20)).toBe(OG_H);
    // corners are background; the Noun's pixel (9, 21) lands at 18× scale
    expect(pixel(png, 0, 0)).toEqual([0xd5, 0xd7, 0xe1]);
    const ox = (OG_W - 576) / 2;
    const oy = OG_H - 576;
    expect(pixel(png, ox + 9 * 18 + 5, oy + 21 * 18 + 5)).toEqual([255, 14, 14]);
    expect(pixel(png, ox + 2, oy + 2)).toEqual([0, 0, 0]);
  });

  it('encodes any RGB buffer', () => {
    const png = encodePng(new Uint8Array([1, 2, 3, 4, 5, 6]), 2, 1);
    expect(pixel(png, 1, 0)).toEqual([4, 5, 6]);
  });
});
