// Timing, end to end: a key event stamped exactly on a prompt's beat goes
// through the real path (BreakInputReader → BreakSession.press → the host's
// judge-delayed input queue → the sim) and is graded PERFECT, landing every
// move. Keyboard events carry their own timeStamp; clicks and taps stamp
// performance.now() (the same clock). Also: EASY's wider windows, and the
// calibration offset taken off the stamp.

import type { BattleConfig, BreakInput, SimEvent } from '../contract';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBattleSim } from '../sim/BattleSim';
import { makeClock, timeOf } from '../sim/clock';

import { BreakInputReader } from './input';
import { EASY_WINDOWS } from './lobby';
import { BreakSession, COUNTDOWN, JUDGE_DELAY } from './sync';

const CFG: BattleConfig = {
  gid: 'timing',
  seed: 7,
  crewSize: 1,
  rounds: 1,
  turnBars: 4,
  bpm: 100,
  dancers: [
    { id: 'me', name: 'Me', crew: 0, human: true },
    { id: 'cpu:0', name: 'Lil Flare', crew: 1, human: false, skill: 0.5 },
  ],
};

afterEach(() => vi.restoreAllMocks());

/**
 * Play the whole battle as the host at 60 fps, pressing each of my lane's
 * notes `late` ms after its beat (as a key event with that timeStamp,
 * noticed on the next frame), less `calib` ms of calibration.
 */
function play(config: BattleConfig, late: (i: number) => number, calib = 0) {
  let ms = 50_000;
  vi.spyOn(performance, 'now').mockImplementation(() => ms);
  const sent: unknown[] = [];
  const session = new BreakSession({
    config,
    role: 'host',
    me: 'me',
    hostId: 'me',
    send: m => sent.push(m),
    makeSim: createBattleSim,
    at: -COUNTDOWN,
    lag: JUDGE_DELAY,
    now: () => ms,
  });
  const reader = new BreakInputReader();
  const stamps: { t: number; beat: number }[] = [];
  reader.onPress = (k, at) => session.press(k, at - calib);
  const zero = ms + COUNTDOWN * 1000; // performance.now() when the battle clock reads 0
  const clock = makeClock(config.bpm);
  const pressed = new Set<number>();
  const events: SimEvent[] = [];
  let n = 0;
  for (let f = 0; f < 60 * 120 && !session.over; f++) {
    ms += 1000 / 60;
    session.update(1 / 60);
    const st = session.render();
    if (st === null) continue;
    for (const note of st.lane ?? []) {
      if (st.promptsFor !== 'me' || note.grade !== undefined || note.dead === true) continue;
      if (pressed.has(note.beat)) continue;
      const at = zero + timeOf(clock, note.beat) * 1000 + late(n);
      if (at > ms) continue; // not yet: the key goes down on a later frame
      pressed.add(note.beat);
      n++;
      stamps.push({ t: (at - calib - zero) / 1000, beat: note.beat });
      reader.press(note.key, at); // a KeyboardEvent's timeStamp
    }
    events.push(...session.drainEvents());
  }
  return { events, stamps, clock, n };
}

const mine = (ev: SimEvent[]) => ev.filter(e => 'id' in e && e.id === 'me');

describe('timing: input → session → sim', () => {
  it('a press exactly on each beat is PERFECT, through the real path', () => {
    const { events, n } = play(CFG, () => 0);
    const hits = mine(events).filter(e => e.e === 'hit');
    expect(n).toBeGreaterThanOrEqual(12);
    expect(hits.length).toBe(n);
    expect(hits.every(h => h.e === 'hit' && h.grade === 'perfect')).toBe(true);
    const moves = mine(events).filter(e => e.e === 'move');
    expect(moves.length).toBeGreaterThanOrEqual(4);
    expect(moves.every(m => m.e === 'move' && m.landed)).toBe(true);
    expect(mine(events).some(e => e.e === 'crash')).toBe(false);
  });

  it('stamps land on the battle clock to the millisecond', () => {
    let ms = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => ms);
    const got: BreakInput[] = [];
    const session = new BreakSession({
      config: CFG,
      role: 'client',
      me: 'me',
      hostId: 'host',
      send: m => {
        if (m.type === 'break:input') got.push(m.i);
      },
      makeSim: createBattleSim,
      at: -COUNTDOWN,
      now: () => ms,
    });
    // A pong: the host's clock read 1.000 s when our ping at 10000 ms came back at 10020 ms
    ms = 10_020;
    session.onMessage({ type: 'break:pong', gid: CFG.gid, to: 'me', c: 10_000, a: 1 });
    const reader = new BreakInputReader();
    reader.onPress = (k, at) => session.press(k, at);
    ms = 10_500;
    reader.press('up', 10_480); // the key went down 20 ms before we noticed
    // offset = a + rtt/2 − c_recv = 1 + 0.01 − 10.02 → battle time at 10480 ms = 1.470
    expect(got).toEqual([{ id: 'me', key: 'up', t: 1.47 }]);
  });

  it('late presses grade by how late; EASY widens the windows', () => {
    const offs = [30, 60, 110, 160];
    const grades = (cfg: BattleConfig) =>
      offs.map(late => {
        const { events } = play(cfg, () => late);
        const hits = mine(events).filter(e => e.e === 'hit');
        return hits[0]?.e === 'hit' ? hits[0].grade : 'none';
      });
    expect(grades(CFG)).toEqual(['perfect', 'great', 'ok', 'miss']);
    expect(grades({ ...CFG, windows: EASY_WINDOWS })).toEqual([
      'perfect',
      'perfect',
      'great',
      'ok',
    ]);
  });

  it('the calibration offset is taken off: a player 60 ms late is PERFECT once calibrated', () => {
    const raw = play(CFG, () => 60);
    expect(mine(raw.events).some(e => e.e === 'hit' && e.grade !== 'perfect')).toBe(true);
    const cal = play(CFG, () => 60, 60);
    const hits = mine(cal.events).filter(e => e.e === 'hit');
    expect(hits.length).toBeGreaterThanOrEqual(12);
    expect(hits.every(h => h.e === 'hit' && h.grade === 'perfect')).toBe(true);
    // Every stamp sits on its beat
    for (const s of cal.stamps)
      expect(Math.abs(s.t - timeOf(cal.clock, s.beat))).toBeLessThan(5e-4);
  });
});
