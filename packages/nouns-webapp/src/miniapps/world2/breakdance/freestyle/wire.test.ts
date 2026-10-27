import { describe, expect, it } from 'vitest';

import { MOVE_IDS } from '../view/moves';

import { FreeClock, pickBeat } from './beat';
import { blockedBy, CrowdRespect, RESPECT_AFTER_S, RESPECT_COOLDOWN_S } from './rules';
import { decodeFs, encodeFs, WIRE_MOVES } from './wire';

describe('the fs blob key', () => {
  it('covers every move, once', () => {
    expect(new Set(WIRE_MOVES).size).toBe(WIRE_MOVES.length);
    expect(new Set(WIRE_MOVES)).toEqual(new Set(MOVE_IDS));
  });

  it('keeps its indices (append only)', () => {
    expect(WIRE_MOVES.indexOf('indian_step')).toBe(0);
    expect(WIRE_MOVES.indexOf('windmill')).toBe(9);
    expect(WIRE_MOVES.indexOf('headspin')).toBe(11);
    expect(WIRE_MOVES.indexOf('get_up')).toBe(23);
  });

  it('round-trips through JSON, small', () => {
    const w = encodeFs({ move: 'windmill', seq: 41, b: 1.2549, n: 4, bpm: 95.4 });
    expect(w).toEqual([9, 41, 1.25, 4, 95]);
    const json = JSON.stringify({ fs: w });
    expect(json.length).toBeLessThan(30);
    expect(decodeFs(JSON.parse(json).fs)).toEqual({
      move: 'windmill',
      seq: 41,
      b: 1.25,
      n: 4,
      bpm: 95,
    });
  });

  it('wraps seq, clamps the rest', () => {
    expect(encodeFs({ move: 'headspin', seq: 1003, b: -2, n: 99, bpm: 999 })).toEqual([
      11, 3, 0, 16, 200,
    ]);
    expect(encodeFs({ move: 'nope' as never, seq: 0, b: 0, n: 1, bpm: 95 })).toBe(null);
  });

  it('decodes nothing it should not', () => {
    for (const bad of [
      undefined,
      null,
      'fs',
      {},
      [],
      [9, 1, 1, 4],
      [99, 1, 1, 4, 95],
      [-1, 1, 1, 4, 95],
      [1.5, 1, 1, 4, 95],
      [9, 1000, 1, 4, 95],
      [9, 1, 'x', 4, 95],
      [9, 1, 65, 4, 95],
      [9, 1, 1, 0, 95],
      [9, 1, 1, 4, 30],
      [9, 1, Infinity, 4, 95],
    ])
      expect(decodeFs(bad), JSON.stringify(bad)).toBe(null);
  });
});

describe('the beat', () => {
  const base = { radioMode: 'off' as const, beatsOffline: true, song: null, vanLive: false };

  it('95 bpm with nothing on', () => {
    expect(pickBeat(base)).toEqual({ bpm: 95, anchor: null, from: 'default', music: false });
  });

  it("follows NOUN BEATS' generated song (tempo and downbeat)", () => {
    const b = pickBeat({ ...base, radioMode: 'beats', song: { bpm: 88, at: 1234 } });
    expect(b).toEqual({ bpm: 88, anchor: 1234, from: 'radio', music: true });
  });

  it('real tracks have no tempo: default bpm, but music is on (no loop on top)', () => {
    expect(pickBeat({ ...base, radioMode: 'fm', song: { bpm: 88, at: 0 } })).toMatchObject({
      bpm: 95,
      from: 'default',
      music: true,
    });
    expect(
      pickBeat({ ...base, radioMode: 'beats', beatsOffline: false, song: { bpm: 88, at: 0 } }),
    ).toMatchObject({ bpm: 95, music: true });
    expect(pickBeat({ ...base, vanLive: true }).music).toBe(true);
  });

  it('the clock retimes without jumping, and locks onto an anchor', () => {
    const c = new FreeClock(95, 0);
    const now = 10_000;
    const b0 = c.beat(now);
    c.retime(120, now, null);
    expect(c.beat(now)).toBeCloseTo(b0, 6);
    expect(c.beat(now + 500)).toBeCloseTo(b0 + 1, 6);
    // lock onto a song whose beat lands 100 ms from now
    c.retime(88, now, now + 100);
    const msPer = 60000 / 88;
    expect(Math.abs(c.beat(now) - b0)).toBeLessThan(0.5 + 1e-9);
    const atAnchor = c.beat(now + 100);
    expect(Math.abs(atAnchor - Math.round(atAnchor))).toBeLessThan(1e-9);
    expect(c.matches(88, now + 100 + msPer * 3)).toBe(true);
    expect(c.matches(88, now + 100 + msPer / 2)).toBe(false);
    expect(c.matches(95, null)).toBe(false);
  });
});

describe('where you can freestyle', () => {
  const ok = {
    inside: false,
    bigDrop: false,
    busy: false,
    mode: 'foot' as const,
    state: 'ground',
    speed: 0,
    climbing: false,
    grounded: true,
  };
  it('on foot, or off a slow board', () => {
    expect(blockedBy(ok)).toBe(null);
    expect(blockedBy({ ...ok, mode: 'board', speed: 2 })).toBe(null);
    expect(blockedBy({ ...ok, mode: 'board', speed: 9 })).toBe('fast');
    expect(blockedBy({ ...ok, mode: 'board', state: 'air' })).toBe('air');
    expect(blockedBy({ ...ok, grounded: false })).toBe('air');
    expect(blockedBy({ ...ok, climbing: true })).toBe('air');
  });
  it('never inside, on the Big Drop or mid-something', () => {
    expect(blockedBy({ ...ok, inside: true })).toBe('inside');
    expect(blockedBy({ ...ok, bigDrop: true })).toBe('bigdrop');
    expect(blockedBy({ ...ok, busy: true })).toBe('busy');
  });
});

describe('crowd respect', () => {
  it('a long clean freestyle near people, then a cooldown', () => {
    const c = new CrowdRespect();
    for (let i = 0; i < 3; i++) c.hit();
    let due = 0;
    for (let t = 0; t < RESPECT_AFTER_S + 1; t += 0.5) if (c.tick(0.5, true)) due++;
    expect(due).toBe(1);
    // again straight away: the cooldown holds it
    for (let i = 0; i < 3; i++) c.hit();
    for (let t = 0; t < RESPECT_AFTER_S + 1; t += 0.5) if (c.tick(0.5, true)) due++;
    expect(due).toBe(1);
    for (let t = 0; t < RESPECT_COOLDOWN_S; t += 0.5) if (c.tick(0.5, true)) due++;
    expect(due).toBe(2);
  });
  it('nothing alone, nothing without clean moves', () => {
    const alone = new CrowdRespect();
    for (let i = 0; i < 5; i++) alone.hit();
    const lazy = new CrowdRespect();
    let due = 0;
    for (let t = 0; t < 600; t += 0.5) {
      if (alone.tick(0.5, false)) due++;
      if (lazy.tick(0.5, true)) due++;
    }
    expect(due).toBe(0);
  });
});
