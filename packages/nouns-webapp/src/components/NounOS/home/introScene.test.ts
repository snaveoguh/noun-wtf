import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PNG } from 'pngjs';

import { NOGGLES, PIXELS, pixelAt, stageAt, streakAt, STREAK_COUNT, T } from './introScene';

describe('intro timeline', () => {
  it('matches glasses-square-red.png pixel for pixel', () => {
    const png = PNG.sync.read(
      readFileSync(
        resolve(__dirname, '../../../../../nouns-assets/images/v0/4-glasses/glasses-square-red.png'),
      ),
    );
    const rows: string[] = [];
    for (let y = 0; y < png.height; y++) {
      let row = '';
      for (let x = 0; x < png.width; x++) {
        const i = (y * png.width + x) * 4;
        const [r, g, b, a] = [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
        row += a === 0 ? '.' : r === 255 && g === 255 && b === 255 ? 'W' : r === 0 && g === 0 && b === 0 ? 'B' : 'R';
      }
      rows.push(row);
    }
    // crop to the drawn pixels
    const ys = rows.map((r, y) => (/[^.]/.test(r) ? y : -1)).filter(y => y >= 0);
    const xs = rows.flatMap(r => [...r].map((c, x) => (c === '.' ? -1 : x))).filter(x => x >= 0);
    const crop = rows
      .slice(Math.min(...ys), Math.max(...ys) + 1)
      .map(r => r.slice(Math.min(...xs), Math.max(...xs) + 1));
    expect(crop).toEqual(NOGGLES);
  });

  it('starts empty', () => {
    expect(PIXELS.every(p => pixelAt(p, 0).alpha === 0)).toBe(true);
  });

  it('every pixel has fully landed before the dive starts', () => {
    for (const p of PIXELS) {
      const s = pixelAt(p, T.dive - 1);
      expect(s.alpha).toBe(1);
      expect(s.scale).toBeCloseTo(1, 5);
      expect(s.dy).toBeCloseTo(0, 9);
    }
  });

  it('the frame builds left to right before the eyes punch in', () => {
    const lastFrame = Math.max(
      ...PIXELS.filter(p => p.k === 'R').map(p => T.frameStart + p.x * T.frameStepX + p.y * T.frameStepY + T.frameDur),
    );
    expect(lastFrame).toBeLessThanOrEqual(T.eyes + 200);
  });

  it('dives into the pupil at the end, and the streaks have faded by then', () => {
    expect(stageAt(T.dive - 1).scale).toBe(1);
    expect(stageAt(T.total).scale).toBeGreaterThan(30);
    for (let i = 0; i < STREAK_COUNT; i++) expect(streakAt(i, T.total + 500).a).toBe(0);
  });
});
