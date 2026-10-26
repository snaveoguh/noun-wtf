// @vitest-environment node
// What the judges reward: clean timing, variety, a freeze on the last beat;
// what they punish: sloppiness, repeats, crashes.

import { describe, expect, it } from 'vitest';

import { catsTotal } from './scoring';
import { duelConfig, eventsOf, playScript, recordOf, SET_A, SET_B, seq } from './testkit';

const sloppyJitter = (i: number) => [0.085, -0.07, 0.11, -0.1, 0.06][i % 5];

describe('timing', () => {
  it('a perfect input stream scores higher than a sloppy one', () => {
    const perfect = playScript(duelConfig(1), { h0: { turns: [SET_A] } });
    const sloppy = playScript(duelConfig(1), {
      h0: { turns: [SET_A], jitter: sloppyJitter, swap: i => (i === 9 ? 'a' : null) },
    });
    const p = recordOf(perfect.sim, 'h0');
    const s = recordOf(sloppy.sim, 'h0');
    expect(p.cats.technique).toBeGreaterThan(s.cats.technique + 2);
    expect(catsTotal(p.cats)).toBeGreaterThan(catsTotal(s.cats));
    expect(p.score).toBeGreaterThan(s.score);
    expect(eventsOf(perfect.events, 'hit').every(h => h.grade === 'perfect')).toBe(true);
    expect(eventsOf(sloppy.events, 'hit').some(h => h.grade !== 'perfect')).toBe(true);
  });

  it('head to head, the clean dancer takes every judge', () => {
    const { state } = playScript(duelConfig(1), {
      h0: { turns: [SET_B], jitter: sloppyJitter },
      h1: { turns: [SET_A] },
    });
    expect(state.cards[0].votes).toEqual([1, 1, 1]);
    expect(state.winner).toBe(1);
    expect(state.totals).toEqual([0, 3]);
  });

  it('off-beat keys are misses, and three in a row is a crash', () => {
    const offbeat = seq(['indian_step', 0]).map(p => ({ ...p, start: p.start + 0.5 }));
    const { events, sim } = playScript(duelConfig(1), { h0: { turns: [offbeat] } });
    const hits = eventsOf(events, 'hit').filter(h => h.id === 'h0');
    expect(hits.map(h => h.grade)).toEqual(['miss', 'miss', 'miss', 'miss']);
    expect(eventsOf(events, 'crash').filter(c => c.id === 'h0')).toHaveLength(1);
    expect(recordOf(sim, 'h0').landed).toHaveLength(0);
  });
});

describe('flow', () => {
  it('a power move straight from standing is a crash; drop in first and it lands', () => {
    const bad = playScript(duelConfig(1), { h0: { turns: [seq(['windmill', 0])] } });
    expect(eventsOf(bad.events, 'move')).toEqual([
      { e: 'move', id: 'h0', move: 'windmill', landed: false, points: 0 },
    ]);
    expect(eventsOf(bad.events, 'crash')).toHaveLength(1);
    const good = playScript(duelConfig(1), { h0: { turns: [seq(['drop', 0], ['windmill', 2])] } });
    expect(eventsOf(good.events, 'move').map(m => m.landed)).toEqual([true, true]);
    expect(eventsOf(good.events, 'crash')).toHaveLength(0);
  });

  it('bailing out of a power move halfway is a crash', () => {
    const { events } = playScript(duelConfig(1), {
      h0: { turns: [seq(['drop', 0], ['windmill', 2])], swap: i => (i === 5 ? 'a' : null) },
    });
    expect(eventsOf(events, 'crash')).toHaveLength(1);
    expect(eventsOf(events, 'move').find(m => m.move === 'windmill')?.landed).toBe(false);
  });
});

describe('originality', () => {
  it('the same move over and over scores lower than a varied run', () => {
    const same = playScript(duelConfig(1), {
      h0: {
        turns: [
          seq(['indian_step', 0], ['indian_step', 4], ['indian_step', 8], ['indian_step', 12]),
        ],
      },
    });
    const varied = playScript(duelConfig(1), {
      h0: {
        turns: [seq(['indian_step', 0], ['salsa_rock', 4], ['cross_step', 8], ['kick_step', 12])],
      },
    });
    expect(recordOf(varied.sim, 'h0').cats.originality).toBeGreaterThan(
      recordOf(same.sim, 'h0').cats.originality + 2,
    );
  });

  it('repeating your own set in a later round is penalised across the battle', () => {
    const repeat = playScript(duelConfig(2), { h0: { turns: [SET_A, SET_A] } });
    const fresh = playScript(duelConfig(2), { h0: { turns: [SET_A, SET_B] } });
    const r1 = recordOf(repeat.sim, 'h0', 1).cats.originality;
    const f1 = recordOf(fresh.sim, 'h0', 1).cats.originality;
    expect(recordOf(repeat.sim, 'h0', 0).cats.originality).toBe(
      recordOf(fresh.sim, 'h0', 0).cats.originality,
    );
    expect(f1).toBeGreaterThan(r1 + 3);
  });

  it("biting the other crew's moves costs a little", () => {
    const bite = playScript(duelConfig(1), { h0: { turns: [SET_A] }, h1: { turns: [SET_A] } });
    expect(recordOf(bite.sim, 'h1').cats.originality).toBeLessThan(
      recordOf(bite.sim, 'h0').cats.originality,
    );
  });
});

describe('musicality', () => {
  // Same moves; one holds the freeze on the turn's last beat, one freezes early.
  const upTo = seq(['indian_step', 0], ['drop', 4], ['three_step', 6], ['windmill', 8]);
  const late = [...upTo, ...seq(['baby_freeze', 14])];
  const early = [...upTo, ...seq(['baby_freeze', 12])];

  it('a freeze held on the last beat gets a musicality bonus', () => {
    const a = playScript(duelConfig(1), { h0: { turns: [late] } });
    const b = playScript(duelConfig(1), { h0: { turns: [early] } });
    expect(recordOf(a.sim, 'h0').cats.musicality).toBeGreaterThan(
      recordOf(b.sim, 'h0').cats.musicality + 0.5,
    );
    expect(eventsOf(a.events, 'freeze')[0].onBeat).toBe(true);
    expect(eventsOf(b.events, 'freeze')[0].onBeat).toBe(false);
    const pts = (r: typeof a) =>
      eventsOf(r.events, 'move').find(m => m.move === 'baby_freeze')?.points ?? 0;
    expect(pts(a)).toBeGreaterThan(pts(b));
  });
});

describe('power', () => {
  it('power moves and air freezes score power; toprock does not', () => {
    const rock = playScript(duelConfig(1), {
      h0: {
        turns: [seq(['indian_step', 0], ['salsa_rock', 4], ['cross_step', 8], ['kick_step', 12])],
      },
    });
    const power = playScript(duelConfig(1), {
      h0: {
        turns: [seq(['drop', 0], ['flare', 2], ['airflare', 4], ['headspin', 8], ['airchair', 13])],
      },
    });
    expect(recordOf(rock.sim, 'h0').cats.power).toBe(0);
    expect(recordOf(power.sim, 'h0').cats.power).toBeGreaterThan(8);
  });
});
