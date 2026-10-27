import { describe, expect, it } from 'vitest';

import { inParallel, nearestFirst, wallCentre } from './loadOrder';

const W = 6;
const H = 3;

describe('wallCentre', () => {
  it('a wall facing +z: x from cu, y from cv, z = d', () => {
    // n = +z: u = up × n = +x, v = n × u = +y
    const c = wallCentre('plaza|0.00,0.00,1.00|-67.95|-8|0', W, H)!;
    expect(c.z).toBeCloseTo(-67.95);
    expect(c.x).toBeCloseTo(-7.5 * W);
    expect(c.y).toBeCloseTo(0.5 * H);
  });
  it('rejects junk', () => {
    expect(wallCentre('plaza|x|1|2|3', W, H)).toBeNull();
    expect(wallCentre('nope', W, H)).toBeNull();
  });
});

describe('nearestFirst', () => {
  it('puts the walls round the rider first, junk last', () => {
    const far = 'plaza|0.00,0.00,1.00|-200.00|0|0';
    const near = 'plaza|0.00,0.00,1.00|-5.00|0|0';
    const mid = 'plaza|0.00,0.00,1.00|-60.00|0|0';
    expect(nearestFirst([far, 'bad', mid, near], { x: 3, y: 1.5, z: 0 }, W, H)).toEqual([
      near,
      mid,
      far,
      'bad',
    ]);
  });
  it('keeps the store order when the rider is unknown', () => {
    expect(nearestFirst(['b', 'a'], null, W, H)).toEqual(['b', 'a']);
  });
});

describe('inParallel', () => {
  it('runs every job, at most `limit` at once, and survives a failure', async () => {
    let live = 0;
    let peak = 0;
    const done: number[] = [];
    await inParallel([1, 2, 3, 4, 5, 6, 7], 3, async j => {
      live++;
      peak = Math.max(peak, live);
      await new Promise(r => setTimeout(r, 5));
      live--;
      if (j === 4) throw new Error('boom');
      done.push(j);
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(done.sort()).toEqual([1, 2, 3, 5, 6, 7]);
  });
});
