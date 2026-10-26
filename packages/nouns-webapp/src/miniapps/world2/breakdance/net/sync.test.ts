// Noun Breaks sync: the battle clock estimate, the host's input gate,
// snapshot interpolation, and whole battles over an in-memory loopback
// running the real PartyKit relay (packages/nouns-party/src/breakRelay.ts)
// with simulated latency.

import type { BattleConfig, BreakMsg, HitGrade, SimEvent, SimState } from '../contract';

import { describe, expect, it } from 'vitest';

import { BreakRelay } from '../../../../../../nouns-party/src/breakRelay';

import { readMsg } from './codec';
import { StubSim } from './stubSim';
import {
  BattleClock,
  BreakSession,
  COUNTDOWN,
  InputGate,
  JUDGE_DELAY,
  MoveRates,
  advanceState,
  lerpState,
  sampleSnaps,
  type BreakRole,
} from './sync';

// ── Clock ──

describe('BattleClock', () => {
  it('converges on the host clock from pongs (lowest round trip wins)', () => {
    // Host battle clock: A = hostMs / 1000 − 100. Client local ms = hostMs + 5000.
    const hostA = (hostMs: number) => hostMs / 1000 - 100;
    const c = new BattleClock();
    let hostMs = 200_000;
    c.seed(hostA(hostMs), hostMs + 5000); // a start with an unknown one-way
    const rnd = mulberry(7);
    for (let i = 0; i < 10; i++) {
      // Out 40 ms (+ queueing up to 120), back 40 ms (+ queueing)
      const up = 40 + rnd() * 120;
      const down = 40 + rnd() * 120;
      const sent = hostMs;
      const a = hostA(sent + up);
      hostMs = sent + up + down;
      c.pong(sent + 5000, a, hostMs + 5000);
      hostMs += 250;
    }
    // Let any slew finish
    for (let k = 0; k < 40; k++) {
      hostMs += 100;
      c.now(hostMs + 5000);
    }
    const err = Math.abs(c.now(hostMs + 5000) - hostA(hostMs));
    // Worst case is half the asymmetry of the best sample; queueing is random
    expect(err).toBeLessThan(0.04);
    expect(c.synced).toBe(true);
    expect(c.rtt!).toBeGreaterThanOrEqual(0.08);
  });

  it('snaps to the first pong, then slews (never jumps) and keeps the lowest round trip', () => {
    const c = new BattleClock();
    c.seed(-3, 1000, 0); // believes A = −3 at local 1000 ms
    // rtt 100 ms: the host read −2.99 halfway, so A = −2.94 now: the first pong snaps
    c.pong(900, -2.99, 1000);
    expect(c.now(1000)).toBeCloseTo(-2.94, 6);
    c.now(1990);
    // A better sample (rtt 80 ms) says we're 30 ms behind: slewed in at 10%
    c.pong(1920, -1.95, 2000);
    expect(c.now(2000)).toBeCloseTo(2 - 3.94 + 0.001, 6);
    expect(c.now(2300)).toBeCloseTo(2.3 - 3.91, 6);
    // A worse sample (rtt 400 ms, its queueing makes it look 150 ms off) is ignored
    c.pong(2600, 3 - 3.91 - 0.2 + 0.15, 3000);
    expect(c.now(3500)).toBeCloseTo(3.5 - 3.91, 6);
    expect(c.rtt).toBeCloseTo(0.08, 6);
  });

  it('runs on snapshot hints before any pong, never backwards', () => {
    const c = new BattleClock();
    c.seed(-3, 0, 0);
    c.hint(-2.5, 0); // the host was already further on
    expect(c.now(0)).toBeCloseTo(-2.5, 6);
    c.hint(-2.9, 0); // an older one is ignored
    expect(c.now(0)).toBeCloseTo(-2.5, 6);
  });
});

// ── Gate ──

describe('InputGate', () => {
  it('accepts stamps within the window, in order, rate-limited', () => {
    const g = new InputGate();
    expect(g.check({ id: 'c', key: 'a', t: 9.95 }, 10)).toBe('ok'); // 50 ms of latency
    expect(g.check({ id: 'c', key: 'b', t: 10.05 }, 10)).toBe('ok'); // clock a little ahead
    expect(g.check({ id: 'c', key: 'a', t: 10.2 }, 10)).toBe('future');
    expect(g.check({ id: 'c', key: 'a', t: 9.5 }, 10)).toBe('late');
    expect(g.check({ id: 'c', key: 'a', t: 9.9 }, 10)).toBe('order'); // behind its last
    expect(g.check({ id: 'c', key: 'a', t: 10.04 }, 10)).toBe('ok'); // a chord crossing on the wire
    // Another dancer is judged on its own
    expect(g.check({ id: 'd', key: 'a', t: 9.7 }, 10)).toBe('ok');
    let rate = 0;
    for (let i = 0; i < 30; i++)
      if (g.check({ id: 'e', key: 'a', t: 10 + i * 0.01 }, 10 + i * 0.01) === 'rate') rate++;
    expect(rate).toBe(14);
  });
});

// ── Interpolation ──

function st(t: number, moveT: number, extra: Partial<SimState> = {}): SimState {
  return {
    gid: 'g',
    phase: 'turn',
    t,
    beat: t * (100 / 60),
    round: 0,
    turn: { id: 'a', from: 4, to: 20 },
    poses: [{ id: 'a', move: 'windmill', moveT, centre: true }],
    turnScore: t * 100,
    combo: 3,
    prompts: [{ key: 'up', beat: 12 }],
    totals: [0, 0],
    cards: [],
    ...extra,
  };
}

describe('snapshot interpolation', () => {
  it('lerps the clock, score and move progress; discrete fields from b', () => {
    const o = lerpState(st(1, 0.2), st(1.1, 0.4, { combo: 4 }), 0.5);
    expect(o.t).toBeCloseTo(1.05);
    expect(o.turnScore).toBeCloseTo(105);
    expect(o.poses[0].moveT).toBeCloseTo(0.3);
    expect(o.combo).toBe(4);
  });

  it("doesn't blend across a move change or a new turn", () => {
    const b = st(1.1, 0.1);
    b.poses[0].move = 'baby_freeze';
    expect(lerpState(st(1, 0.9), b, 0.5).poses[0].moveT).toBeCloseTo(0.1);
    const c = st(1.1, 0.5, { turn: { id: 'b', from: 22, to: 38 }, turnScore: 0 });
    expect(lerpState(st(1, 0.4), c, 0.5).turnScore).toBe(0);
  });

  it('samples between snapshots and clamps at the ends', () => {
    const snaps = [st(1, 0), st(1.1, 0.25), st(1.2, 0.5)];
    expect(sampleSnaps(snaps, 1.15)!.poses[0].moveT).toBeCloseTo(0.375);
    expect(sampleSnaps(snaps, 0.5)!.t).toBe(1);
    expect(sampleSnaps(snaps, 9)!.t).toBe(1.2);
    expect(sampleSnaps([], 1)).toBeNull();
  });

  it('brings a state forward to the live clock (beat + moves, bounded)', () => {
    const rates = new MoveRates();
    rates.update(st(1, 0.2));
    rates.update(st(1.1, 0.3)); // 1 per second
    const o = advanceState(st(1.1, 0.3), 1.3, 100, rates.rate);
    expect(o.t).toBe(1.3);
    expect(o.beat).toBeCloseTo(1.1 * (100 / 60) + 0.2 * (100 / 60));
    expect(o.poses[0].moveT).toBeCloseTo(0.5);
    // Never further than MAX_AHEAD, never past the end of the move
    expect(advanceState(st(1.1, 0.3), 3, 100, rates.rate).poses[0].moveT).toBeCloseTo(0.65);
    expect(advanceState(st(1.1, 0.9), 1.5, 100, rates.rate).poses[0].moveT).toBe(1);
  });
});

// ── Loopback: sessions → relay → sessions, one-way latency per player ──

let clock = 0;

class Hub {
  relay = new BreakRelay();
  sessions = new Map<string, BreakSession>();
  inbox = new Map<string, BreakMsg[]>();
  queue: { at: number; to: string; msg: string }[] = [];
  timers: { at: number; fn: () => void }[] = [];
  open = new Set<string>();
  constructor(public lat: Record<string, number>) {}
  wire() {
    return [...this.open].map(id => ({
      id,
      send: (msg: string) => this.queue.push({ at: clock + (this.lat[id] ?? 40), to: id, msg }),
    }));
  }
  send(id: string, m: BreakMsg) {
    if (!this.open.has(id)) return;
    const s = JSON.stringify(m);
    this.timers.push({
      at: clock + (this.lat[id] ?? 40),
      fn: () => {
        const from = this.wire().find(c => c.id === id);
        if (from) this.relay.handle(JSON.parse(s), from, this.wire());
      },
    });
  }
  close(id: string) {
    this.open.delete(id);
    this.relay.close(id, this.wire());
  }
  pump() {
    this.timers.sort((a, b) => a.at - b.at);
    while (this.timers.length > 0 && this.timers[0].at <= clock) this.timers.shift()!.fn();
    const due = this.queue.filter(q => q.at <= clock);
    this.queue = this.queue.filter(q => q.at > clock);
    for (const q of due) {
      if (!this.open.has(q.to)) continue;
      const m = readMsg(JSON.parse(q.msg));
      if (m === null) continue;
      const list = this.inbox.get(q.to) ?? [];
      list.push(m);
      this.inbox.set(q.to, list);
      this.sessions.get(q.to)?.onMessage(m);
    }
  }
}

const CONFIG = (dancers: BattleConfig['dancers']): BattleConfig => ({
  gid: 'battle1',
  seed: 1234,
  crewSize: dancers.length === 2 ? 1 : 2,
  dancers,
  rounds: 1,
  turnBars: 4,
  bpm: 100,
});

interface Rig {
  hub: Hub;
  host: BreakSession;
  others: Map<string, BreakSession>;
  grades: Map<string, HitGrade[]>;
  run(ms: number, play?: Set<string>): void;
}

/** Host `h` and humans at `lat` ms one way; local clocks skewed by `skew` ms. */
function rig(
  cfg: BattleConfig,
  lat: Record<string, number>,
  roles: Record<string, BreakRole> = {},
): Rig {
  clock = 0;
  const hub = new Hub(lat);
  const skew: Record<string, number> = { h: 0, c: 98_765, d: -4_321, s: 777 };
  for (const id of Object.keys(lat)) hub.open.add(id);
  const now = (id: string) => () => clock + (skew[id] ?? 0);
  const host = new BreakSession({
    config: cfg,
    role: 'host',
    me: 'h',
    hostId: 'h',
    send: m => hub.send('h', m),
    makeSim: c => new StubSim(c),
    at: -COUNTDOWN,
    now: now('h'),
  });
  hub.sessions.set('h', host);
  // The relay registers the battle from the start message
  hub.send('h', { type: 'break:start', host: 'h', config: cfg, at: -COUNTDOWN, lag: host.lag });
  const others = new Map<string, BreakSession>();
  const grades = new Map<string, HitGrade[]>();
  const startOthers = () => {
    for (const id of Object.keys(lat)) {
      if (id === 'h' || others.has(id)) continue;
      const got = hub.inbox.get(id)?.find(m => m.type === 'break:start');
      if (got?.type !== 'break:start') continue;
      const role = roles[id] ?? 'client';
      const s = new BreakSession({
        config: got.config,
        role,
        me: role === 'spectator' ? null : id,
        hostId: 'h',
        send: m => hub.send(id, m),
        makeSim: c => new StubSim(c),
        at: got.at!,
        lag: got.lag,
        now: now(id),
      });
      others.set(id, s);
      hub.sessions.set(id, s);
    }
  };
  const pressed = new Map<string, Set<number>>();
  return {
    hub,
    host,
    others,
    grades,
    run(ms, play = new Set()) {
      const dt = 4;
      for (let k = 0; k < ms; k += dt) {
        clock += dt;
        hub.pump();
        startOthers();
        host.update(dt / 1000);
        for (const s of others.values()) s.update(dt / 1000);
        // Players press each prompt the moment their own clock reaches its beat
        for (const id of play) {
          const s = id === 'h' ? host : others.get(id);
          const view = s?.render();
          if (!s || !view || view.turn?.id !== id) continue;
          const done = pressed.get(id) ?? new Set<number>();
          pressed.set(id, done);
          for (const p of view.prompts) {
            const bt = (p.beat * 60) / cfg.bpm;
            if (done.has(p.beat) || s.battleNow() < bt) continue;
            done.add(p.beat);
            // The exact local ms the clock read the beat (a key event's timeStamp)
            const ms0 = clock + (skew[id] ?? 0);
            s.press(p.key, ms0 - (s.battleNow(ms0) - bt) * 1000);
          }
        }
        host.render();
        for (const e of host.drainEvents() as SimEvent[])
          if (e.e === 'hit') grades.set(e.id, [...(grades.get(e.id) ?? []), e.grade]);
        for (const s of others.values()) {
          s.render();
          s.drainEvents();
        }
      }
    },
  };
}

const share = (g: HitGrade[] | undefined, ok: HitGrade[]) =>
  g === undefined || g.length === 0 ? 0 : g.filter(x => ok.includes(x)).length / g.length;

describe('BreakSession over the relay', { timeout: 30_000 }, () => {
  const ONE_V_ONE = CONFIG([
    { id: 'h', name: 'Host', crew: 0, human: true },
    { id: 'c', name: 'Client', crew: 1, human: true },
  ]);

  for (const lat of [20, 80, 140])
    it(`judges a remote player fairly at ${lat} ms one way`, () => {
      const r = rig(ONE_V_ONE, { h: 15, c: lat });
      expect(r.host.lag).toBe(JUDGE_DELAY);
      r.run(40_000, new Set(['h', 'c']));
      const c = r.others.get('c')!;
      // Synced from pings: within a few ms of the host clock
      expect(Math.abs(c.battleNow() - r.host.battleNow())).toBeLessThan(0.02);
      expect(r.host.stats.rejected).toEqual({ future: 0, late: 0, order: 0, rate: 0 });
      // Both players pressed on the beat: both judged (almost all) perfect
      expect(share(r.grades.get('h'), ['perfect'])).toBeGreaterThan(0.95);
      expect(share(r.grades.get('c'), ['perfect'])).toBeGreaterThan(0.9);
      expect(r.grades.get('c')!.length).toBe(16);
      // The battle finished for both, with the same result
      expect(r.host.ended).not.toBeNull();
      expect(c.ended).toEqual(r.host.ended);
      // ~10 Hz snapshots, small
      expect(r.host.stats.snapBytesMax).toBeLessThan(2000);
      expect(c.stats.snapsRecv).toBeGreaterThan(250);
    });

  it('without the clock sync, presses on the beat stamped on arrival would be judged late', () => {
    // What a naive host would do: judge a remote press at the time it arrives
    // (here 135 ms after the beat). The synced stamps above land perfect.
    const sim = new StubSim(ONE_V_ONE);
    const grades: HitGrade[] = [];
    const take = (evs: SimEvent[]) => {
      for (const e of evs) if (e.e === 'hit' && e.id === 'c') grades.push(e.grade);
    };
    // c's turn is the second: beats 22..37
    for (let b = 22; b < 38; b++) {
      const t = (b * 60) / 100 + 0.135;
      while (sim.state().t < t) take(sim.step(1 / 60));
      sim.input({ id: 'c', key: sim.state().prompts.find(p => p.beat === b)?.key ?? 'up', t });
    }
    take(sim.step(2));
    expect(grades.length).toBe(16);
    expect(grades.filter(g => g === 'perfect' || g === 'great').length).toBe(0);
  });

  it('a client renders on the live clock: the beat runs on between snapshots', () => {
    const r = rig(ONE_V_ONE, { h: 15, c: 60 });
    r.run(12_000);
    const c = r.others.get('c')!;
    const a = c.render()!;
    const t0 = c.battleNow();
    expect(a.t).toBeCloseTo(t0, 2);
    expect(a.beat).toBeCloseTo((t0 * 100) / 60, 1);
    // Beat events are made locally from that clock: one per beat, none on the wire
    r.run(3000);
    c.render();
    expect(
      r.hub.inbox
        .get('c')!
        .some(m => m.type === 'break:s' && m.e?.some(e => e.e === 'beat') === true),
    ).toBe(false);
  });

  it('a member dropping: a CPU dances their turn; the host leaving ends it', () => {
    const r = rig(ONE_V_ONE, { h: 15, c: 50 });
    r.run(6000, new Set(['h', 'c']));
    r.hub.close('c');
    r.run(40_000, new Set(['h']));
    expect(r.host.dropped.has('c')).toBe(true);
    // StubSim has setCpu: the CPU hit c's prompts
    expect(r.grades.get('c')!.filter(g => g !== 'miss').length).toBeGreaterThan(8);
    expect(r.host.ended).not.toBeNull();

    const r2 = rig(ONE_V_ONE, { h: 15, c: 50 });
    r2.run(6000);
    r2.hub.close('h');
    r2.run(200);
    expect(r2.others.get('c')!.hostLeft).toBe(true);
    expect(r2.others.get('c')!.over).toBe(true);
  });

  it("a dropped human without the sim's setCpu: net/ plays their prompts", () => {
    const r = rig(ONE_V_ONE, { h: 15, c: 50 });
    // A sim without setCpu
    (r.host.sim as unknown as { setCpu?: unknown }).setCpu = undefined;
    r.run(6000, new Set(['h']));
    r.hub.close('c');
    r.run(40_000, new Set(['h']));
    expect(share(r.grades.get('c'), ['perfect', 'great'])).toBeGreaterThan(0.8);
  });

  it('crews: two clients + a spectator, CPU fill, all in sync', () => {
    const cfg = CONFIG([
      { id: 'h', name: 'Host', crew: 0, human: true },
      { id: 'cpu:0', name: 'Lil Flare', crew: 0, human: false, skill: 0.5 },
      { id: 'c', name: 'C', crew: 1, human: true },
      { id: 'd', name: 'D', crew: 1, human: true },
    ]);
    const r = rig(cfg, { h: 10, c: 40, d: 110, s: 70 }, { s: 'spectator' });
    r.run(200);
    // The spectator asks to watch; the host answers with a start just for it
    r.hub.send('s', { type: 'break:watch', gid: cfg.gid });
    r.run(200);
    expect(r.hub.inbox.get('h')?.some(m => m.type === 'break:watch' && m.from === 's')).toBe(true);
    r.hub.send('h', {
      type: 'break:start',
      host: 'h',
      config: cfg,
      to: 's',
      at: r.host.battleNow(),
      lag: r.host.lag,
    });
    r.run(400);
    const spec = r.others.get('s')!;
    expect(spec.role).toBe('spectator');
    r.run(80_000, new Set(['h', 'c', 'd']));
    expect(r.host.ended).not.toBeNull();
    expect(spec.ended).toEqual(r.host.ended);
    expect(share(r.grades.get('d'), ['perfect'])).toBeGreaterThan(0.85);
    expect(r.grades.get('cpu:0')!.length).toBe(16);
    expect(Math.abs(spec.battleNow() - r.host.battleNow())).toBeLessThan(0.03);
    // Spectators can't send inputs
    spec.press('a');
    expect(spec.stats.inputsSent).toBe(0);
  });
});

function mulberry(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
