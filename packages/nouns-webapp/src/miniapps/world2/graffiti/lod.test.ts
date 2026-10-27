import { describe, expect, it } from 'vitest';

import { FAR_M, lodChanges, NEAR_M } from './lod';

const cell = (id: string, dist: number, near = false, pinned = false) => ({
  id,
  dist,
  near,
  pinned,
});

describe('lodChanges', () => {
  it('sharpens the nearest far cells first, within the budget', () => {
    const { promote, demote } = lodChanges(
      [cell('c', 20), cell('a', 2), cell('far', NEAR_M + 1), cell('b', 9)],
      2,
    );
    expect(promote).toEqual(['a', 'b']);
    expect(demote).toEqual([]);
  });

  it('keeps a sharp cell until it is past FAR_M (no flicker at the edge)', () => {
    const mid = (NEAR_M + FAR_M) / 2;
    expect(lodChanges([cell('x', mid, true)], 4)).toEqual({ promote: [], demote: [] });
    expect(lodChanges([cell('x', mid, false)], 4)).toEqual({ promote: [], demote: [] });
    expect(lodChanges([cell('x', FAR_M + 1, true)], 4).demote).toEqual(['x']);
  });

  it('lets the furthest sharp cells go first', () => {
    const { demote } = lodChanges(
      [cell('a', 60, true), cell('b', 300, true), cell('c', 90, true)],
      2,
    );
    expect(demote).toEqual(['b', 'c']);
  });

  it('a cell being painted stays sharp at any distance', () => {
    expect(lodChanges([cell('p', 500, false, true)], 1).promote).toEqual(['p']);
    expect(lodChanges([cell('p', 500, true, true)], 1).demote).toEqual([]);
  });
});
