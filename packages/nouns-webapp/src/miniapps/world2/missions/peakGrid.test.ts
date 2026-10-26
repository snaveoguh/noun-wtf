import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { type GridSampler, GridMesh, gridOffsets } from './peakGrid';

const sampler: GridSampler = {
  height: (x, z) => -1.15 * z + 3 * Math.sin(x / 40),
  color: (_x, _z, ny, out) => {
    out.setRGB(ny, ny, 1);
  },
};
const mat = new THREE.MeshBasicMaterial();

describe('peak terrain grids', () => {
  it('spaces rows densely at the centre out to the edge, symmetrically', () => {
    const off = gridOffsets(61, 1.5, 400);
    expect(off[30]).toBe(0);
    expect(off[31]).toBeCloseTo(1.5, 6);
    expect(off[60]).toBeCloseTo(400, 1);
    expect(off[0]).toBeCloseTo(-400, 1);
    for (let i = 1; i < 61; i++) expect(off[i]!).toBeGreaterThan(off[i - 1]!);
  });

  it('builds the same mesh in slices as all at once', () => {
    const a = new GridMesh(41, 10, 3000, mat);
    const b = new GridMesh(41, 10, 3000, mat);
    a.buildNow(100, -50, 2000, sampler);
    b.begin(100, -50, 2000);
    let frames = 0;
    while (!b.step(7, sampler)) frames++;
    expect(frames).toBeGreaterThan(3);
    expect(b.building).toBe(false);
    expect(b.at.toArray()).toEqual([100, -50, 2000]);
    const pa = a.mesh.geometry.getAttribute('position').array;
    const pb = b.mesh.geometry.getAttribute('position').array;
    expect(Array.from(pb)).toEqual(Array.from(pa));
    // Heights are relative to the base
    const mid = (20 * 41 + 20) * 3;
    expect(pa[mid + 1]).toBeCloseTo(sampler.height(100, 2000) + 50, 3);
  });

  it('sinks the far grid under the near one, and only there', () => {
    const g = new GridMesh(41, 10, 3000, mat, { half: 300, depth: 12 });
    g.buildNow(0, 0, 0, sampler);
    const p = g.mesh.geometry.getAttribute('position').array;
    const centre = (20 * 41 + 20) * 3;
    expect(p[centre + 1]).toBeCloseTo(sampler.height(0, 0) - 12, 3);
    const edge = (20 * 41 + 40) * 3;
    expect(p[edge + 1]).toBeCloseTo(sampler.height(3000, 0), 2);
  });
});
