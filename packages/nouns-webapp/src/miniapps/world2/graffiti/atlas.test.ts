import { describe, expect, it } from 'vitest';

import { collapseQuad, slotAt, slotGlY, slotUv, tilesPerPage, writeQuad } from './atlas';

const WEAK = { tileW: 64, pageW: 1024 };

describe('graffiti atlas', () => {
  it('fits a weak phone plaza (~2,500 cells) in 5 pages of 64×32 tiles', () => {
    expect(tilesPerPage(WEAK)).toBe(512);
    expect(slotAt(2527, WEAK).page).toBe(4);
  });

  it('lays tiles out row by row, aligned to their size (mips stay inside a tile)', () => {
    expect(slotAt(0, WEAK)).toEqual({ page: 0, index: 0, x: 0, y: 0 });
    expect(slotAt(15, WEAK)).toEqual({ page: 0, index: 15, x: 960, y: 0 });
    expect(slotAt(16, WEAK)).toEqual({ page: 0, index: 16, x: 0, y: 32 });
    expect(slotAt(512, WEAK)).toEqual({ page: 1, index: 0, x: 0, y: 0 });
    for (const n of [0, 37, 511, 900]) {
      const s = slotAt(n, WEAK);
      expect(s.x % 64).toBe(0);
      expect(s.y % 32).toBe(0);
      expect(s.x + 64).toBeLessThanOrEqual(1024);
      expect(s.y + 32).toBeLessThanOrEqual(1024);
    }
  });

  it('UVs and the sub-upload row agree for a flipY texture', () => {
    const s = slotAt(16, WEAK); // canvas rows 32..63
    const [u0, v0, u1, v1] = slotUv(s, WEAK);
    expect([u0, u1]).toEqual([0, 64 / 1024]);
    // v1 (the cell's top) is canvas row 32 → 1 - 32/1024; v0 its bottom, row 64
    expect(v1).toBeCloseTo(1 - 32 / 1024);
    expect(v0).toBeCloseTo(1 - 64 / 1024);
    // GL rows count from the bottom: the tile starts at row 1024 - 64
    expect(slotGlY(s, WEAK)).toBe(1024 - 64);
    expect(slotGlY(s, WEAK) / 1024).toBeCloseTo(v0);
  });

  it('places a quad like the cell mesh (origin, +u, +v, lifted off the wall) and collapses it', () => {
    const pos = new Float32Array(12);
    const o = { x: 1, y: 2, z: 3 };
    writeQuad(
      pos,
      0,
      o,
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
      6,
      3,
      0.01,
    );
    expect([...pos].map(x => +x.toFixed(3))).toEqual([
      1, 2, 3.01, 7, 2, 3.01, 7, 5, 3.01, 1, 5, 3.01,
    ]);
    collapseQuad(pos, 0, { x: 4, y: 3.5, z: 3 });
    expect([...pos]).toEqual([4, 3.5, 3, 4, 3.5, 3, 4, 3.5, 3, 4, 3.5, 3]);
  });
});
