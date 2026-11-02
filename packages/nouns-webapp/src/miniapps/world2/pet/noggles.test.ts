import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

import { hipRoseNoggles } from './noggles';

describe("MOCHI's noggles", () => {
  it('are glasses-hip-rose.png pixel for pixel', () => {
    const png = PNG.sync.read(
      readFileSync(
        resolve(__dirname, '../../../../../nouns-assets/images/v0/4-glasses/glasses-hip-rose.png'),
      ),
    );
    const want: string[] = [];
    let x0 = 99;
    let y0 = 99;
    for (let y = 0; y < png.height; y++)
      for (let x = 0; x < png.width; x++)
        if (png.data[(y * png.width + x) * 4 + 3]! > 0) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
        }
    for (let y = 0; y < png.height; y++)
      for (let x = 0; x < png.width; x++) {
        const i = (y * png.width + x) * 4;
        if (png.data[i + 3]! === 0) continue;
        const hex = (png.data[i]! << 16) | (png.data[i + 1]! << 8) | png.data[i + 2]!;
        want.push(`${x - x0},${y - y0},${hex.toString(16)}`);
      }
    const got = hipRoseNoggles().px.map(p => `${p.x},${p.y},${p.hex.toString(16)}`);
    expect(got.sort()).toEqual(want.sort());
    expect(hipRoseNoggles().w).toBe(16);
    expect(hipRoseNoggles().h).toBe(6);
  });
});
