import { describe, expect, it } from 'vitest';

import { FAR_M, LOD_DEFAULT, lodChanges, lodTuning, NEAR_M } from './lod';

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

  it('desktop keeps its radii and no cap; phones draw fewer cells sharp, closer in', () => {
    expect(lodTuning('high', false)).toBe(LOD_DEFAULT);
    expect(lodTuning('medium', true)).toBe(LOD_DEFAULT);
    const weak = lodTuning('low', true);
    const phone = lodTuning('low', false);
    expect(weak.nearM).toBeLessThan(phone.nearM);
    expect(phone.nearM).toBeLessThan(NEAR_M);
    expect(weak.maxNear).toBeLessThan(phone.maxNear);
  });

  it('caps how many cells are sharp: the nearest win, the rest stay small', () => {
    const t = { nearM: 12, farM: 18, maxNear: 2 };
    const { promote } = lodChanges([cell('a', 3), cell('b', 9), cell('c', 6), cell('d', 11)], 9, t);
    expect(promote).toEqual(['a', 'c']);
  });

  it('over the cap, a sharp cell further off makes way for a nearer one', () => {
    const t = { nearM: 12, farM: 18, maxNear: 1 };
    const r = lodChanges([cell('old', 11, true), cell('new', 2)], 9, t);
    expect(r).toEqual({ promote: ['new'], demote: ['old'] });
  });

  it('at the cap edge a sharp cell holds against one only a bit nearer (no swapping)', () => {
    const t = { nearM: 12, farM: 18, maxNear: 1 };
    expect(lodChanges([cell('old', 8, true), cell('new', 6)], 9, t)).toEqual({
      promote: [],
      demote: [],
    });
  });

  it('the cell being painted is sharp even past the cap', () => {
    const t = { nearM: 12, farM: 18, maxNear: 1 };
    const r = lodChanges([cell('a', 1, true), cell('p', 40, false, true)], 9, t);
    expect(r.promote).toEqual(['p']);
    expect(r.demote).toEqual(['a']);
  });
});
