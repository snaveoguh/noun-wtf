import type { MoveId } from '../contract';

import { describe, expect, it } from 'vitest';

import { canFlow, MOVES } from '../sim/moves';

import { bridgeFor, FreestyleSet, isUp, nextAuto, seeded, type FreeStep } from './planner';

/** Every step the set plays from beat 0 to `beats`. */
function run(set: FreestyleSet, beats: number, dt = 0.05): FreeStep[] {
  const out: FreeStep[] = [];
  for (let b = 0; b <= beats; b += dt) {
    const s = set.at(b);
    if (out.at(-1)?.seq !== s.seq) out.push({ ...s });
  }
  return out;
}

describe('freestyle auto set', () => {
  it('always flows, by the sim table', () => {
    for (let seed = 1; seed < 40; seed++) {
      const steps = run(new FreestyleSet(seeded(seed)), 400, 0.25);
      let prev: MoveId | null = null;
      for (const s of steps) {
        expect(canFlow(prev, MOVES[s.move]), `${prev} → ${s.move} (seed ${seed})`).toBe(true);
        prev = s.move;
      }
    }
  });

  it('builds a round: toprock, down, footwork, power, a freeze, and back up', () => {
    const steps = run(new FreestyleSet(seeded(7)), 600, 0.25);
    const fams = new Set(steps.map(s => MOVES[s.move].family));
    for (const f of ['toprock', 'transition', 'footwork', 'power', 'freeze'] as const)
      expect(fams.has(f), f).toBe(true);
    expect(steps.some(s => s.move === 'get_up')).toBe(true);
    // starts on its feet
    expect(MOVES[steps[0].move].family).toBe('toprock');
  });

  it('starts on a whole beat, back to back, every move held a whole number of beats', () => {
    const steps = run(new FreestyleSet(seeded(3)), 300, 0.25);
    expect(steps[0].start).toBe(0);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].start).toBe(steps[i - 1].start + steps[i - 1].dur);
      expect(Number.isInteger(steps[i].dur)).toBe(true);
      expect(steps[i].n).toBe(MOVES[steps[i].move].beats);
    }
  });

  it('does not loop toprock forever', () => {
    for (let seed = 1; seed < 30; seed++) {
      const rng = seeded(seed);
      let prev: MoveId | null = null;
      let run = 0;
      let longest = 0;
      for (let i = 0; i < 200; i++) {
        const next = nextAuto(prev, run, rng);
        run = prev !== null && MOVES[prev].family === MOVES[next].family ? run + 1 : 0;
        longest = MOVES[next].family === 'toprock' ? Math.max(longest, run) : longest;
        prev = next;
      }
      expect(longest).toBeLessThanOrEqual(2);
    }
  });
});

describe('keyed moves', () => {
  it('cut in on the next whole beat', () => {
    const set = new FreestyleSet(seeded(1));
    set.at(0);
    set.at(5); // somewhere into the set
    const wasDown = !isUp(set.at(5.4).move);
    const q = set.request(wasDown ? 'windmill' : 'indian_step', 5.4);
    expect(q.at(-1)!.keyed).toBe(true);
    expect(q[0].start).toBe(6);
    expect(set.at(6).seq).toBe(q[0].seq);
  });

  it('from your feet, a floor move gets a one-beat drop first', () => {
    const set = new FreestyleSet(seeded(2));
    expect(isUp(set.at(0.5).move)).toBe(true);
    const q = set.request('windmill', 0.5);
    expect(q.map(s => s.move)).toEqual(['drop', 'windmill']);
    expect(q[0]).toMatchObject({ start: 1, dur: 1, n: 1 });
    expect(q[1].start).toBe(2);
    expect(set.at(1.5).move).toBe('drop');
    expect(set.at(2.1).move).toBe('windmill');
    expect(set.at(3.9).move).toBe('windmill');
  });

  it('from the floor, toprock gets a get-up first; a drop while down is ignored', () => {
    const set = new FreestyleSet(seeded(2));
    set.at(0.5);
    set.request('headspin', 0.5);
    expect(set.at(2.5).move).toBe('headspin');
    expect(set.request('drop', 2.5)).toEqual([]);
    const q = set.request('salsa_rock', 2.5);
    expect(q.map(s => s.move)).toEqual(['get_up', 'salsa_rock']);
    expect(set.at(3.5).move).toBe('get_up');
    expect(set.at(4.5).move).toBe('salsa_rock');
  });

  it('after a keyed move the auto set carries on, flowing from it', () => {
    const set = new FreestyleSet(seeded(4));
    set.at(0.2);
    const q = set.request('windmill', 0.2);
    const wm = q.at(-1)!;
    const after = set.at(wm.start + wm.dur + 0.1);
    expect(after.keyed).toBe(false);
    expect(canFlow('windmill', MOVES[after.move])).toBe(true);
  });

  it('bridges', () => {
    expect(bridgeFor(null, 'windmill')).toBe('drop');
    expect(bridgeFor('indian_step', 'baby_freeze')).toBe('drop');
    expect(bridgeFor('windmill', 'kick_step')).toBe('get_up');
    expect(bridgeFor('windmill', 'flare')).toBe(null);
    expect(bridgeFor('indian_step', 'cross_step')).toBe(null);
    expect(bridgeFor('six_step', 'get_up')).toBe(null);
  });
});

describe('finishing', () => {
  it('gets up quickly from the floor, then holds', () => {
    const set = new FreestyleSet(seeded(5));
    set.at(0.2);
    set.request('airchair', 0.2);
    expect(set.at(3).move).toBe('airchair');
    const end = set.finish(3, 0.6);
    expect(end).toBeCloseTo(3.6);
    expect(set.at(3.1).move).toBe('get_up');
    expect(set.at(3.1).n).toBeCloseTo(0.6);
    // and stays up (no more auto moves)
    for (let b = 3.7; b < 20; b += 0.5) expect(set.at(b).move).toBe('get_up');
  });

  it('on your feet it is done at once', () => {
    const set = new FreestyleSet(seeded(5));
    expect(isUp(set.at(0.5).move)).toBe(true);
    expect(set.finish(0.5)).toBe(0.5);
  });
});
