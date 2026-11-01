import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { fcAssets } from './fcAssets';

const DIR = join(__dirname, '../../public/fc');

/** A PNG's size and raw (inflated) pixel rows: zlib versions may deflate differently. */
function pixels(png: Buffer) {
  let off = 8;
  const idat: Buffer[] = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    if (png.toString('ascii', off + 4, off + 8) === 'IDAT')
      idat.push(png.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  return {
    w: png.readUInt32BE(16),
    h: png.readUInt32BE(20),
    colour: png[25],
    raw: inflateSync(Buffer.concat(idat)),
  };
}

describe('Farcaster mini app images (public/fc)', () => {
  const assets = fcAssets();
  if (process.env.WRITE_FC === '1') {
    for (const [name, png] of Object.entries(assets)) writeFileSync(join(DIR, name), png);
  }

  it.each([
    ['icon.png', 1024, 1024],
    ['splash.png', 200, 200],
    ['world-card.png', 1200, 800],
    ['world-og.png', 1200, 630],
  ])('%s is %i × %i, opaque RGB, and matches what the code draws', (name, w, h) => {
    const want = pixels(assets[name]!);
    expect([want.w, want.h]).toEqual([w, h]);
    // Farcaster wants the icon without alpha: colour type 2 (RGB)
    expect(want.colour).toBe(2);
    const file = join(DIR, name);
    expect(existsSync(file)).toBe(true);
    const got = pixels(readFileSync(file));
    expect(got.raw.equals(want.raw)).toBe(true);
  });
});
