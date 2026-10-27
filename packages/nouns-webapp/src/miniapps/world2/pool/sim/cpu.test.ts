import type { FrameState } from '../contract';

import { describe, expect, it } from 'vitest';

import { candidates, plan, powerFor, SKILL } from './cpu';
import { rng } from './rack';
import { canPlace, newFrame, playShot, validInput } from './rules';
import { L, W } from './table';

/** A spread-out mid-frame layout: groups decided, seat 0 on solids. */
function layout(seed: number): FrameState {
  const r = rng(seed);
  const st = newFrame(seed, 0);
  st.phase = 'play';
  st.inHand = null;
  st.groups = ['solids', 'stripes'];
  st.balls = st.balls.map(() => null);
  const ids = [0, 1, 2, 3, 8, 9, 10, 11, 12];
  for (const id of ids) {
    for (let k = 0; k < 50; k++) {
      const p = { x: (r() - 0.5) * (L - 0.2), y: (r() - 0.5) * (W - 0.2) };
      if (canPlace({ ...st, inHand: 'anywhere' }, p)) {
        st.balls[id] = p;
        break;
      }
    }
  }
  return st;
}

describe('pool CPU', { timeout: 120_000 }, () => {
  it('finds ghost-ball lines and sensible powers', () => {
    const st = layout(4);
    const c = candidates(st, 0, st.balls[0]!);
    expect(c.length).toBeGreaterThan(0);
    for (const k of c) {
      expect([1, 2, 3]).toContain(k.target);
      const p = powerFor(k);
      expect(p).toBeGreaterThan(0.05);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it('always plays a legal input (break, ball in hand, on the 8)', () => {
    const brk = newFrame(9, 1);
    const b = plan(brk, 1, SKILL.normal, { seed: 3 });
    expect(validInput(brk, b)).toBe(true);
    const inHand = { ...layout(5), inHand: 'anywhere' as const };
    const h = plan(inHand, 0, SKILL.hard, { seed: 3 });
    expect(h.cue).toBeDefined();
    expect(validInput(inHand, h)).toBe(true);
    const eight = layout(6);
    eight.balls[1] = eight.balls[2] = eight.balls[3] = null;
    const e = plan(eight, 0, SKILL.hard, { seed: 1 });
    expect(e.call).toBeDefined();
  });

  it('pots more often the better it is (easy < normal < hard)', () => {
    const rate = (skill: number) => {
      let ok = 0;
      for (let s = 1; s <= 40; s++) {
        const st = layout(100 + s);
        const r = playShot(st, plan(st, 0, skill, { seed: s }));
        if (r.outcome.again || r.state.winner === 0) ok++;
      }
      return ok / 40;
    };
    const easy = rate(SKILL.easy);
    const normal = rate(SKILL.normal);
    const hard = rate(SKILL.hard);
    expect(easy).toBeLessThan(normal);
    expect(normal).toBeLessThan(hard);
    expect(hard).toBeGreaterThan(0.5);
  });

  it('hard beats easy over a few frames, and every frame finishes', () => {
    const wins = [0, 0];
    for (let f = 0; f < 6; f++) {
      let st = newFrame(f + 1, (f % 2) as 0 | 1);
      let n = 0;
      while (st.phase !== 'over' && n++ < 200) {
        const skill = st.turn === 0 ? SKILL.hard : SKILL.easy;
        st = playShot(st, plan(st, st.turn, skill, { seed: f * 31 + n })).state;
      }
      expect(st.phase).toBe('over');
      wins[st.winner!]++;
    }
    expect(wins[0]).toBeGreaterThan(wins[1]);
  });
});
