import { inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { riderGrid } from './riderGrid';
import {
  CARD_SIZES,
  INK,
  YELLOW,
  fontText,
  renderRiderCard,
  riderLayout,
  textWidth,
} from './riderOg';
import { handler } from '../functions/og-rider-image';

function decode(png: Buffer) {
  let off = 8;
  const idat: Buffer[] = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    if (png.toString('ascii', off + 4, off + 8) === 'IDAT')
      idat.push(png.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  const raw = inflateSync(Buffer.concat(idat));
  const at = (x: number, y: number) => {
    const i = y * (w * 3 + 1) + 1 + x * 3;
    return [raw[i]!, raw[i + 1]!, raw[i + 2]!];
  };
  return { w, h, at, raw };
}

const count = (img: ReturnType<typeof decode>, rgb: number[]) => {
  let n = 0;
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) if (img.at(x, y).every((v, i) => v === rgb[i])) n++;
  return n;
};

describe('play-as rider card', () => {
  const seed = { background: 1, body: 5, accessory: 9, head: 30, glasses: 15 };

  it('draws the rider in V1 art on its background, at both sizes', () => {
    for (const size of [CARD_SIZES.og, CARD_SIZES.fc]) {
      const img = decode(renderRiderCard(riderGrid(seed), size));
      expect([img.w, img.h]).toEqual([size.width, size.height]);
      expect(img.at(size.width - 2, 2)).toEqual([0xe1, 0xd7, 0xd5]); // bgcolors[1]
      // The Noun's glasses row is where the layout says: red noggles (f3322c) present
      const L = riderLayout(size.width, size.height);
      let red = 0;
      for (let x = L.x; x < L.x + L.size; x++)
        if (img.at(x, L.y + 12 * L.scale + 1).join() === [0xf3, 0x32, 0x2c].join()) red++;
      expect(red).toBeGreaterThanOrEqual(L.scale * 4);
      // The yellow button is drawn
      expect(count(img, [...YELLOW])).toBeGreaterThan(1000);
      expect(count(img, [...INK])).toBeGreaterThan(1000);
    }
  });

  it('keeps everything inside the card at both sizes', () => {
    for (const s of [CARD_SIZES.og, CARD_SIZES.fc]) {
      const L = riderLayout(s.width, s.height);
      expect(L.y).toBeGreaterThanOrEqual(0);
      expect(L.boardTop + 4 * L.scale).toBeLessThan(s.height);
      expect(L.x + L.size).toBeLessThan(s.width * 0.6);
    }
  });

  it('draws a missingnoun as its V2 head with the glitch ghosts, no body', () => {
    const plain = decode(renderRiderCard(riderGrid(seed), CARD_SIZES.og));
    const mn = decode(
      renderRiderCard(riderGrid({ ...seed, missingnoun: true }), {
        ...CARD_SIZES.og,
        missingnoun: true,
      }),
    );
    expect(count(mn, [0x20, 0xd6, 0xff])).toBeGreaterThan(200); // cyan ghost
    expect(count(plain, [0x20, 0xd6, 0xff])).toBeLessThan(count(mn, [0x20, 0xd6, 0xff]));
    expect(mn.raw.equals(plain.raw)).toBe(false);
  });

  it('wraps trait numbers past the art so any valid key draws', () => {
    expect(() =>
      riderGrid({ background: 999, body: 999, accessory: 999, head: 999, glasses: 999 }),
    ).not.toThrow();
  });

  it('font: upper-cases, drops what it can’t draw, measures', () => {
    expect(fontText('play as me ✨')).toBe('PLAY AS ME ');
    expect(textWidth('AB', 2)).toBe(22);
    expect(textWidth('', 5)).toBe(0);
  });

  it('serves /og/world/<key>.png and /og/world/fc/<key>.png, 404 for anything else', async () => {
    const og = await handler({ path: '/og/world/0-1-2-3-4.png' });
    expect(og.statusCode).toBe(200);
    expect(og.headers['Content-Type']).toBe('image/png');
    expect(decode(Buffer.from(og.body, 'base64')).h).toBe(630);
    const fc = await handler({ path: '/og/world/fc/0-1-2-3-4-m.png' });
    expect(decode(Buffer.from(fc.body, 'base64')).h).toBe(800);
    for (const p of [
      '/og/world/0-1-2-3.png',
      '/og/world/../x.png',
      '/og/world/1000-1-2-3-4.png',
      '/og/noun/1.png',
    ]) {
      expect((await handler({ path: p })).statusCode).toBe(404);
    }
  });
});
