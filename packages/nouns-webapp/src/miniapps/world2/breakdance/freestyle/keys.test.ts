import type { BreakKey, MoveId } from '../contract';

import { describe, expect, it } from 'vitest';

import { MOVE_LIST, MOVES } from '../sim/moves';

import { heldLong } from './input';
import { candidates, MAX_GAP, MoveKeys } from './keys';

const SPB = 60 / 95;

/** Type a move's pattern on its beat grid from `start`; returns what came out at each key. */
function play(k: MoveKeys, move: MoveId, start: number, jitter = 0) {
  const m = MOVES[move];
  const g = m.half === true ? 0.5 : 1;
  return m.pattern.map((key, i) => k.press(key, start + i * g + jitter, SPB));
}

describe('freestyle key patterns', () => {
  it('every move in the battle table is triggered by its pattern, on its last key', () => {
    for (const m of MOVE_LIST) {
      const k = new MoveKeys();
      const out = play(k, m.id, 10);
      expect(
        out.slice(0, -1).every(o => o === null),
        m.id,
      ).toBe(true);
      expect(out.at(-1)?.move, m.id).toBe(m.id);
      expect(out.at(-1)?.clean, m.id).toBe(true);
    }
  });

  it('windmill and headspin', () => {
    const k = new MoveKeys();
    const wm = (['down', 'left', 'up', 'right'] as BreakKey[]).map((key, i) =>
      k.press(key, i, SPB),
    );
    expect(wm[3]?.move).toBe('windmill');
    const hs = (['up', 'right', 'down', 'left'] as BreakKey[]).map((key, i) =>
      k.press(key, 8 + i, SPB),
    );
    // the "right, down" inside a headspin never fires a spin down
    expect(hs.slice(0, 3)).toEqual([null, null, null]);
    expect(hs[3]?.move).toBe('headspin');
  });

  it('off the beat it still triggers, but not clean', () => {
    const k = new MoveKeys();
    const out = play(k, 'windmill', 4, 0.3);
    expect(out[3]?.move).toBe('windmill');
    // the first key anchors the grid: shift the rest instead
    const k2 = new MoveKeys();
    k2.press('down', 4, SPB);
    k2.press('left', 5.35, SPB);
    k2.press('up', 6, SPB);
    expect(k2.press('right', 7, SPB)?.clean).toBe(false);
  });

  it('a stray key starts a fresh attempt from itself', () => {
    const k = new MoveKeys();
    k.press('down', 0, SPB);
    k.press('left', 1, SPB);
    // "a" continues nothing that starts ↓ ←: start over from "a" (turtle, swipe, airflare)
    expect(k.press('a', 2, SPB)).toBe(null);
    expect(k.pending).toEqual(['a']);
    expect(new Set(k.open)).toEqual(new Set(['turtle', 'swipe', 'airflare']));
  });

  it('a long gap drops the attempt', () => {
    const k = new MoveKeys();
    k.press('down', 0, SPB);
    k.press('left', 1, SPB);
    k.press('up', 2, SPB);
    expect(k.press('right', 2 + MAX_GAP + 0.5, SPB)).toBe(null);
    expect(k.pending).toEqual(['right']);
  });

  it('candidates', () => {
    expect(candidates([])).toEqual([]);
    expect(candidates(['down', 'down'])).toEqual(['drop']);
    expect(candidates(['up', 'up'])).toEqual(['get_up']);
  });

  it('a held direction means walk away; taps do not', () => {
    const down = new Map<string, number>([['KeyW', 1000]]);
    expect(heldLong(down, 1200)).toBe(false);
    expect(heldLong(down, 1400)).toBe(true);
    expect(heldLong(new Map([['KeyJ', 0]]), 5000)).toBe(false); // a button, not a direction
    expect(heldLong(new Map([['ArrowLeft', 0]]), 5000)).toBe(true);
  });
});
