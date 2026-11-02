import { describe, expect, it } from 'vitest';

import { createMockMatch } from './mock';
import { blankState, copyState, lerpState, ReplayBuffer, ReplayDirector } from './replay';

describe('ReplayBuffer', () => {
  it('keeps the last 10 s, once per tick, and samples between frames', () => {
    const m = createMockMatch();
    const buf = new ReplayBuffer(10);
    for (let i = 0; i < 60 * 14; i++) {
      m.step(1 / 60);
      const s = m.state();
      buf.push(s);
      buf.push(s); // same tick: ignored
    }
    const [t0, t1] = buf.span();
    expect(t1 - t0).toBeGreaterThan(9.9);
    expect(t1 - t0).toBeLessThanOrEqual(10.01);
    expect(buf.size).toBeLessThanOrEqual(buf.cap);
    const out = blankState();
    const mid = (t0 + t1) / 2;
    const s = buf.sample(mid, out)!;
    expect(s.time).toBeCloseTo(mid, 3);
    expect(s.players.length).toBe(22);
    // Sampling copies: the buffer's frames don't alias the output
    s.players[0].x = 9999;
    expect(buf.sample(mid, blankState())!.players[0].x).not.toBe(9999);
  });

  it('records from 15 Hz snapshots too (time-based window)', () => {
    const m = createMockMatch();
    const buf = new ReplayBuffer(10);
    for (let i = 0; i < 15 * 20; i++) {
      m.step(1 / 15);
      buf.push(m.state());
    }
    const [t0, t1] = buf.span();
    expect(t1 - t0).toBeGreaterThan(9.8);
    expect(t1 - t0).toBeLessThanOrEqual(10.01);
  });

  it('resets when time runs backwards (a new match)', () => {
    const buf = new ReplayBuffer(10);
    const a = blankState();
    a.tick = 1;
    a.time = 50;
    buf.push(a);
    const b = blankState();
    b.tick = 2;
    b.time = 1;
    buf.push(b);
    expect(buf.size).toBe(1);
  });
});

describe('ReplayDirector', () => {
  it('plays each angle at half speed, then ends; skip ends it', () => {
    const m = createMockMatch();
    const buf = new ReplayBuffer(10);
    for (let i = 0; i < 60 * 10; i++) {
      m.step(1 / 60);
      buf.push(m.state());
    }
    const d = new ReplayDirector();
    expect(d.start(buf, 3, ['goalcam', 'tele'], 0.5)).toBe(true);
    expect(d.duration).toBeCloseTo(12, 1);
    const angles: string[] = [];
    let cuts = 0;
    let real = 0;
    while (d.active && real < 30) {
      angles.push(d.segment!.angle);
      if (d.update(1 / 60)) cuts++;
      real += 1 / 60;
    }
    expect(real).toBeCloseTo(12, 0);
    expect(cuts).toBe(2);
    expect(new Set(angles)).toEqual(new Set(['goalcam', 'tele']));
    d.start(buf, 3);
    d.skip();
    expect(d.active).toBe(false);
    expect(new ReplayDirector().start(new ReplayBuffer(10), 3)).toBe(false);
  });
});

describe('state interpolation', () => {
  it('lerps positions, keeps discrete fields from the newer state, never aliases', () => {
    const m = createMockMatch();
    m.step(1);
    const a = copyState(blankState(), m.state());
    m.step(1 / 60);
    const b = copyState(blankState(), m.state());
    const out = lerpState(a, b, 0.5, blankState());
    const p = out.players[9];
    expect(p.x).toBeCloseTo((a.players[9].x + b.players[9].x) / 2, 6);
    expect(out.tick).toBe(b.tick);
    expect(out.ball).not.toBe(b.ball);
    expect(out.players[0]).not.toBe(b.players[0]);
  });
});
