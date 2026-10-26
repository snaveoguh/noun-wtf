// @vitest-environment node
// The rhythm lane (SimState.lane): a chart that stays put when you miss,
// and is only redrawn when you land (or commit to) a different move.

import type { BreakKey, LaneNote, MoveId, SimState } from '../contract';

import { describe, expect, it } from 'vitest';

import { BreakBattle, REPLAN_LEAD } from './BattleSim';
import { timeOf } from './clock';
import { keyBeat, MOVES } from './moves';
import { duelConfig, eventsOf } from './testkit';

const DT = 1 / 120;

/** Run h0's first turn; `press` decides, for each upcoming lane note, whether to hit it (and with which key). */
function playTurn(
  press: (n: LaneNote, st: SimState) => BreakKey | null | 'skip',
  opts: { until?: number; extra?: { key: BreakKey; beat: number }[] } = {},
) {
  const sim = new BreakBattle(duelConfig(1));
  const done = new Set<string>();
  const snaps: SimState[] = [];
  const events = [];
  for (const x of opts.extra ?? [])
    sim.input({ id: 'h0', key: x.key, t: timeOf(sim.clock, x.beat) });
  for (let k = 0; k < 20_000; k++) {
    const st = sim.state();
    snaps.push(st);
    if (st.turn !== null && st.turn.id !== 'h0') break;
    if (opts.until !== undefined && st.beat > opts.until) break;
    if (st.promptsFor === 'h0')
      for (const n of st.lane ?? []) {
        const tag = `${n.beat}`;
        const at = timeOf(sim.clock, n.beat);
        if (done.has(tag) || n.grade !== undefined || at > st.t + DT) continue;
        done.add(tag);
        const key = press(n, st);
        if (key !== null && key !== 'skip') sim.input({ id: 'h0', key, t: at });
      }
    events.push(...sim.step(DT));
  }
  return { sim, snaps, events: events.flat() };
}

const upcoming = (st: SimState, after: number, upTo = Infinity) =>
  (st.lane ?? [])
    .filter(n => n.beat > after && n.beat <= upTo)
    .map(n => `${n.id}:${n.key}@${n.beat}`);
const lastBeat = (st: SimState) => Math.max(...(st.lane ?? []).map(n => n.beat));

describe('rhythm lane', () => {
  it('shows each note with its key, judged as you hit it, PERFECT on the beat', () => {
    const { snaps, events } = playTurn(n => n.key, { until: 6 });
    const st = snaps.find(s => s.beat > 3.2 && s.beat < 3.4)!;
    const hit = (st.lane ?? []).filter(n => n.beat <= 3);
    expect(hit.length).toBeGreaterThanOrEqual(2);
    expect(hit.every(n => n.grade === 'perfect' && Math.abs(n.off ?? 1) < 1e-6)).toBe(true);
    expect(eventsOf(events, 'hit').every(h => h.grade === 'perfect')).toBe(true);
    // The move forming: name + progress
    const mid = snaps.find(s => s.beat > 1.2 && s.beat < 1.4)!;
    expect(mid.forming).toMatchObject({ id: 'h0', got: 2 });
  });

  it("a miss doesn't change the upcoming prompts: it scrolls past marked MISS", () => {
    // Plan as charted at the start of the turn
    const ref = playTurn(n => n.key, { until: 0.05 });
    const st0 = ref.snaps[ref.snaps.length - 1];
    const first = (st0.lane ?? [])[0];
    expect(first.beat).toBe(0);
    // Skip the second note of the first move
    const skipBeat = keyBeat(MOVES[first.move], 1);
    const run = playTurn(n => (n.beat === skipBeat ? 'skip' : n.key), { until: 9 });
    const before = run.snaps.find(s => s.beat > skipBeat - 0.5 && s.beat < skipBeat - 0.3)!;
    const after = run.snaps.find(s => s.beat > skipBeat + 0.5 && s.beat < skipBeat + 0.7)!;
    // The missed note is still on the lane, past the line, marked a miss…
    const missed = (after.lane ?? []).find(n => n.beat === skipBeat)!;
    expect(missed).toBeDefined();
    expect(missed.grade).toBe('miss');
    // …and every note after it is exactly where it was (same ids, keys, beats)
    expect(upcoming(after, skipBeat, lastBeat(before))).toEqual(upcoming(before, skipBeat));
    const later = run.snaps.find(s => s.beat > 4.2 && s.beat < 4.4)!;
    expect(upcoming(later, 4.3, lastBeat(before))).toEqual(upcoming(before, 4.3));
  });

  it('a wrong key mid-move leaves the plan alone too (the move just breaks)', () => {
    const ref = playTurn(n => n.key, { until: 0.05 });
    const first = (ref.snaps[ref.snaps.length - 1].lane ?? [])[0];
    const b1 = keyBeat(MOVES[first.move], 1);
    // A key that spells no other move either (else that's the move you're doing)
    const k0 = MOVES[first.move].pattern[0];
    const wrong = (['up', 'down', 'left', 'right', 'a', 'b'] as BreakKey[]).find(k =>
      Object.values(MOVES).every(m => m.pattern[0] !== k0 || m.pattern[1] !== k),
    )!;
    expect(wrong).toBeDefined();
    const run = playTurn(n => (n.beat === b1 ? wrong : n.key), { until: 6 });
    const before = run.snaps.find(s => s.beat > b1 - 0.5 && s.beat < b1 - 0.3)!;
    const after = run.snaps.find(s => s.beat > b1 + 0.3 && s.beat < b1 + 0.5)!;
    const next = MOVES[first.move].beats;
    expect(upcoming(after, next - 0.01, lastBeat(before))).toEqual(upcoming(before, next - 0.01));
    // The rest of the broken move is dead (no point pressing it), not re-charted
    expect(
      (after.lane ?? [])
        .filter(n => n.move === first.move && n.beat > b1)
        .every(n => n.dead === true),
    ).toBe(true);
  });

  it('a different landed move replans, and the new plan scrolls in from ahead', () => {
    const ref = playTurn(n => n.key, { until: 0.05 });
    const st0 = ref.snaps[ref.snaps.length - 1];
    const planned = (st0.lane ?? [])[0].move;
    // A different toprock that flows from standing
    const other = (['salsa_rock', 'indian_step', 'cross_step', 'kick_step'] as MoveId[]).find(
      m => m !== planned && MOVES[m].pattern[0] !== MOVES[planned].pattern[0],
    )!;
    const m = MOVES[other];
    const extra = m.pattern.map((key, i) => ({ key, beat: keyBeat(m, i) }));
    const run = playTurn(() => null, { until: 12, extra });
    const landed = eventsOf(run.events, 'move').filter(e => e.id === 'h0');
    expect(landed[0]).toMatchObject({ move: other, landed: true });
    // After landing: the lane shows the move actually danced (all hit) and a new plan after it
    const st = run.snaps.find(s => s.beat > m.beats - 0.6 && s.beat < m.beats - 0.4)!;
    const danced = (st.lane ?? []).filter(n => n.move === other && n.beat < m.beats);
    expect(danced.map(n => n.key)).toEqual(m.pattern.slice(4 - danced.length));
    expect(danced.every(n => n.grade === 'perfect')).toBe(true);
    const ahead = (st.lane ?? []).filter(n => n.beat >= m.beats);
    expect(ahead.length).toBeGreaterThan(0);
    expect(ahead[0].beat).toBeGreaterThanOrEqual(m.beats);
    // Committing (two keys in) is when it redrew: never closer than REPLAN_LEAD to the commit beat
    expect(ahead[0].beat - 1).toBeGreaterThanOrEqual(REPLAN_LEAD - 1e-9);
    expect(upcoming(st, m.beats - 0.01)).not.toEqual(upcoming(st0, m.beats - 0.01));
  });

  it('following the redrawn plan after a crash still lands the set clean', () => {
    // Crash on purpose: windmill from standing (can't flow), then follow the lane
    const wm = MOVES.windmill;
    const extra = wm.pattern.map((key, i) => ({ key, beat: keyBeat(wm, i) }));
    const run = playTurn((n, st) => (n.beat >= 4 && st.beat >= 3.9 ? n.key : null), { extra });
    const mine = run.events.filter(e => 'id' in e && e.id === 'h0');
    expect(eventsOf(mine, 'crash').length).toBe(1);
    const moves = eventsOf(mine, 'move').filter(e => e.landed);
    expect(moves.length).toBeGreaterThanOrEqual(2);
    expect(eventsOf(mine, 'freeze').pop()?.onBeat).toBe(true);
  });
});
