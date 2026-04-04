import { describe, expect, it } from 'vitest';

import { applyVisibilityMask, buildVisibilityMask, type NounPixelLayers } from '@/lib/nounDecoder';

function createGrid(fill = ''): string[][] {
  return Array.from({ length: 32 }, () => Array(32).fill(fill));
}

describe('nounDecoder visibility helpers', () => {
  it('keeps coordinates visible when a lower visible layer still occupies that pixel', () => {
    const body = createGrid();
    const accessory = createGrid();
    const head = createGrid();
    const glasses = createGrid();

    body[10][10] = '#body';
    head[10][10] = '#head';
    head[12][12] = '#head-only';

    const layers: NounPixelLayers = {
      background: '#ffffff',
      body,
      accessory,
      head,
      glasses,
    };

    const mask = buildVisibilityMask(layers, {
      body: true,
      accessory: true,
      head: false,
      glasses: true,
    });

    expect(mask[10][10]).toBe(true);
    expect(mask[12][12]).toBe(false);
  });

  it('blanks hidden coordinates without mutating visible ones', () => {
    const pixels = createGrid();
    pixels[4][4] = '#111111';
    pixels[5][5] = '#222222';

    const mask = createGrid().map(row => row.map(() => false));
    mask[4][4] = true;

    expect(applyVisibilityMask(pixels, mask)).toEqual(
      expect.objectContaining({
        4: expect.objectContaining({ 4: '#111111' }),
        5: expect.objectContaining({ 5: '' }),
      }),
    );
  });
});
