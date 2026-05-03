import { describe, expect, it } from 'vitest';

import {
  applyVisibilityMask,
  buildVisibilityMask,
  pixelGridToSvg,
  resolveEditableVisibility,
  type NounPixelLayers,
} from '@/lib/nounDecoder';

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

  it('falls back to the next visible base layer when hiding an untouched top layer', () => {
    const body = createGrid();
    const accessory = createGrid();
    const head = createGrid();
    const glasses = createGrid();

    body[8][8] = '#body';
    accessory[8][8] = '#accessory';
    glasses[8][8] = '#glasses';

    const layers: NounPixelLayers = {
      accessory,
      background: '#ffffff',
      body,
      glasses,
      head,
    };

    const pixels = createGrid();
    pixels[8][8] = '#glasses';

    const visible = resolveEditableVisibility(pixels, layers, {
      body: true,
      accessory: false,
      head: true,
      glasses: false,
    });

    expect(visible[8][8]).toBe('#body');
  });

  it('builds an SVG with a background rect when bgColor is provided', () => {
    const pixels = createGrid();
    pixels[0][0] = '#ff0000';
    const svg = pixelGridToSvg(pixels, '#abcdef');
    expect(svg).toContain('<svg');
    expect(svg).toContain('width="320"');
    expect(svg).toContain('height="320"');
    expect(svg).toContain('fill="#abcdef"'); // bg
    expect(svg).toContain('fill="#ff0000"'); // pixel
  });

  it('builds an SVG with no background rect when bgColor is omitted', () => {
    const pixels = createGrid();
    pixels[1][1] = '#00ff00';
    const svg = pixelGridToSvg(pixels);
    expect(svg).toContain('<svg');
    expect(svg).toContain('fill="#00ff00"');
    // The "100%" width rect (the background) shouldn't be present
    expect(svg).not.toContain('width="100%"');
  });

  it('merges adjacent same-color pixels into a single rect', () => {
    const pixels = createGrid();
    pixels[0][0] = '#abcdef';
    pixels[0][1] = '#abcdef';
    pixels[0][2] = '#abcdef';
    const svg = pixelGridToSvg(pixels);
    // Three contiguous pixels → one rect, width 30 (3 × 10)
    expect(svg).toContain('width="30"');
    expect(svg).toContain('x="0"');
    expect(svg).toContain('y="0"');
  });

  it('drops edited top-layer color when that layer gets hidden', () => {
    const body = createGrid();
    const accessory = createGrid();
    const head = createGrid();
    const glasses = createGrid();

    body[6][6] = '#body';
    accessory[6][6] = '#accessory';

    const layers: NounPixelLayers = {
      accessory,
      background: '#ffffff',
      body,
      glasses,
      head,
    };

    const pixels = createGrid();
    pixels[6][6] = '#custom-accessory-edit';

    const visible = resolveEditableVisibility(pixels, layers, {
      body: true,
      accessory: false,
      head: true,
      glasses: true,
    });

    expect(visible[6][6]).toBe('#body');
  });
});
