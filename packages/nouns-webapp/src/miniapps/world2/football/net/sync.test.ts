// Host-authoritative football sync over a LoopbackHub routed through the
// real relay, with a tiny fake sim (stubSim.ts): only the contract matters.

import { describe, expect, it } from 'vitest';

import { FootballRelay } from '../../../../../../nouns-party/src/footballRelay';
import { NO_PAD, type FootballEvent, type FootballMsg, type PadInput } from '../contract';

import { StubSim, stubConfig } from './stubSim';
import { FootballClient, FootballHost, HostClock, createWatcher, type FootballFrame } from './sync';
import { LoopbackHub, type LoopbackOptions } from './transport';

const FRAME = 1000 / 60;

function setup(net: LoopbackOptions = {}, halfSeconds = 5, skew = 5000) {
  const relay = new FootballRelay();
  // The start always arrives (a real socket loses nothing); loss starts after it
  const hub = new LoopbackHub({ relay, ...net, loss: 0 });
  const config = stubConfig(
    11,
    [
      ['h', 0],
      ['c', 1],
    ],
    halfSeconds,
  );
  const he = hub.endpoint('h');
  const ce = hub.endpoint('c');
  const host = new FootballHost({
    gid: 'g1',
    config,
    sim: new StubSim(config),
    transport: he,
    me: 'h',
    now: () => hub.now,
  });
  // The start reaches the client after the latency; it builds its session from it
  let start: Extract<FootballMsg, { type: 'football:start' }> | null = null;
  const offStart = ce.onMessage(m => {
    if (m.type === 'football:start') start = m;
  });
  hub.advance(500);
  offStart();
  hub.loss = net.loss ?? 0;
  expect(start).not.toBeNull();
  const client = new FootballClient({
    gid: start!.gid,
    config: start!.config,
    hostId: start!.host,
    transport: ce,
    me: 'c',
    now: () => hub.now + skew,
  });
  return { hub, relay, config, host, client, he, ce };
}

interface Run {
  hostEvents: FootballEvent[];
  clientEvents: FootballEvent[];
  frames: FootballFrame[];
}

function run(
  t: ReturnType<typeof setup>,
  ms: number,
  hostPad: (i: number) => PadInput = () => NO_PAD,
  clientPad: (i: number) => PadInput | null = () => NO_PAD,
  out: Run = { hostEvents: [], clientEvents: [], frames: [] },
) {
  const n = Math.round(ms / FRAME);
  for (let i = 0; i < n; i++) {
    t.hub.advance(FRAME);
    t.host.frame(FRAME / 1000, hostPad(i));
    out.hostEvents.push(...t.host.drainEvents());
    const p = clientPad(i);
    const f = t.client.frame(FRAME / 1000, p);
    if (f) out.frames.push(f);
    out.clientEvents.push(...t.client.drainEvents());
  }
  return out;
}

const pressEvery =
  (period: number, base: Partial<PadInput> = {}) =>
  (i: number) => ({
    ...NO_PAD,
    ...base,
    pass: i % period < 3,
  });

/** Events as the codec carries them (floats to 2 dp). */
const wireForm = (e: FootballEvent) =>
  JSON.parse(JSON.stringify(e, (_k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)));

describe('football sync', () => {
  it('a client draws the host match: interpolated, behind, monotonic, in bounds', () => {
    const t = setup({ latencyMs: 40, jitterMs: 20, seed: 3 });
    const r = run(
      t,
      3000,
      () => ({ ...NO_PAD, mx: 0.5 }),
      () => ({ ...NO_PAD, mz: -1 }),
    );
    expect(t.host.stats.snapsSent).toBeGreaterThan(40);
    expect(t.client.stats.snapsRecv).toBeGreaterThanOrEqual(t.host.stats.snapsSent - 1);
    expect(r.frames.length).toBeGreaterThan(150);
    let lastTick = 0;
    for (const f of r.frames) {
      expect(f.alpha).toBeGreaterThanOrEqual(0);
      expect(f.alpha).toBeLessThanOrEqual(1);
      expect(f.prev.tick).toBeLessThanOrEqual(f.next.tick);
      const tick = f.prev.tick + (f.next.tick - f.prev.tick) * f.alpha;
      expect(tick).toBeGreaterThanOrEqual(lastTick - 1e-6);
      lastTick = tick;
    }
    // Drawn ~100-200 ms (6-12 ticks) behind the host
    const behind = t.host.sim.state().tick - lastTick;
    expect(behind).toBeGreaterThan(4);
    expect(behind).toBeLessThan(16);
    // The client's pad moved its footballer on the host (−z at 7 m/s)
    const mine = t.host.sim.state().players.find(p => p.human === 'c')!;
    expect(mine.vz).toBeCloseTo(-7, 5);
    // And the client sees roughly where the host has it
    const seen = r.frames.at(-1)!.next.players.find(p => p.human === 'c')!;
    expect(Math.abs(seen.z - mine.z)).toBeLessThan(1.5);
    // Inputs went at ~30 Hz, and the host acked them
    expect(t.client.stats.inputsSent).toBeGreaterThan(80);
    expect(t.client.stats.inputsSent).toBeLessThan(100);
    expect(t.client.acked).toBeGreaterThan(70);

    console.log(
      `football:s 11-a-side: ${t.host.stats.snapBytes} B last, ${t.host.stats.snapBytesMax} B max; input ${t.client.stats.inputBytes} B`,
    );
    expect(t.host.stats.snapBytesMax).toBeLessThan(1500);
  });

  it.each([11, 12, 13, 14, 15])(
    'plays every event exactly once, in order, across 30%% loss, then ends (seed %i)',
    seed => {
      const t = setup({ latencyMs: 60, jitterMs: 40, loss: 0.3, seed }, 4);
      // The host's player kicks often (kick / touch / bounce events), a full match
      const r = run(t, 9000, pressEvery(20, { mz: 1, sprint: true }), pressEvery(17, { mz: -1 }));
      expect(t.hub.dropped).toBeGreaterThan(30);
      expect(t.host.ended).toMatchObject({ reason: 'final' });
      // Let the stragglers through (the end message may have been lost: the final snapshot ends it too)
      run(t, 1500, undefined, undefined, r);
      expect(t.client.ended?.reason).toBe('final');
      expect(t.client.ended?.score).toEqual(t.host.ended!.score);
      expect(r.hostEvents.length).toBeGreaterThan(20);
      expect(r.hostEvents.some(e => e.type === 'kick')).toBe(true);
      expect(r.hostEvents.at(-1)!.type).toBe('final');
      expect(r.clientEvents.map(wireForm)).toEqual(r.hostEvents.map(wireForm));
    },
  );

  it('syncs the host clock by ping / pong (lowest round trip)', () => {
    const t = setup({ latencyMs: 30, jitterMs: 10, seed: 5 }, 30, 123456);
    run(t, 3000);
    const c = t.client.clock;
    expect(c.synced).toBe(true);
    // host = local + offset; the client's clock is 123456 ms ahead
    expect(Math.abs(c.offset + 123456)).toBeLessThan(10);
    expect(c.rtt!).toBeGreaterThanOrEqual(60);
    expect(c.rtt!).toBeLessThan(85);
    const hc = new HostClock();
    hc.arrival(1000, 50);
    hc.arrival(1100, 160);
    expect(hc.offset).toBe(950);
    hc.pong(0, 500, 100);
    expect(hc.offset).toBe(450);
  });

  it('a client whose socket drops is gone: its footballer gets no pad', () => {
    const t = setup({ latencyMs: 20, seed: 2 }, 30);
    run(t, 500, undefined, () => ({ ...NO_PAD, mx: 1 }));
    const me = () => t.host.sim.state().players.find(p => p.human === 'c')!;
    expect(me().vx).toBeCloseTo(7, 5);
    t.hub.disconnect('c');
    run(t, 200);
    expect(me().vx).toBeCloseTo(0, 5);
    expect(t.host.gone.has('c')).toBe(true);
  });

  it('a late pad is held, not zeroed', () => {
    const t = setup({ seed: 2 }, 30);
    run(t, 300, undefined, () => ({ ...NO_PAD, mz: 1 }));
    // The client freezes (no frames) for 300 ms: the host keeps its last pad
    for (let i = 0; i < 18; i++) {
      t.hub.advance(FRAME);
      t.host.frame(FRAME / 1000, NO_PAD);
    }
    const me = t.host.sim.state().players.find(p => p.human === 'c')!;
    expect(me.vz).toBeCloseTo(7, 5);
    // …but past 0.5 s it decays to no input
    for (let i = 0; i < 30; i++) {
      t.hub.advance(FRAME);
      t.host.frame(FRAME / 1000, NO_PAD);
    }
    expect(t.host.sim.state().players.find(p => p.human === 'c')!.vz).toBeCloseTo(0, 5);
  });

  it('the host leaving ends it for the client (host_left); a client leaving is gone', () => {
    const t = setup({ latencyMs: 30, seed: 9 }, 30);
    run(t, 500);
    t.client.leave();
    expect(t.client.ended?.reason).toBe('left');
    run(t, 200);
    expect(t.host.gone.has('c')).toBe(true);

    const u = setup({ latencyMs: 30, seed: 9 }, 30);
    run(u, 500);
    u.host.leave();
    run(u, 200);
    expect(u.client.ended?.reason).toBe('host_left');
    expect(u.relay.games.size).toBe(0);

    // The host's socket just dropping does the same
    const v = setup({ latencyMs: 30, seed: 9 }, 30);
    run(v, 500);
    v.hub.disconnect('h');
    run(v, 200);
    expect(v.client.ended?.reason).toBe('host_left');
  });

  it('times out after 10 s of silence', () => {
    const t = setup({ latencyMs: 30, seed: 4 }, 60);
    run(t, 500);
    // The host stops stepping (frozen tab) but its socket stays up
    for (let i = 0; i < 640; i++) {
      t.hub.advance(FRAME);
      t.client.frame(FRAME / 1000, NO_PAD);
    }
    expect(t.client.ended?.reason).toBe('timeout');
  });

  it('WATCH: a spectator gets football:start {to}, then snapshots; it sends nothing else', () => {
    const t = setup({ latencyMs: 30, seed: 8 }, 30);
    const we = t.hub.endpoint('w');
    let start: Extract<FootballMsg, { type: 'football:start' }> | null = null;
    we.onMessage(m => {
      if (m.type === 'football:start') start = m;
    });
    run(t, 300);
    we.send({ type: 'football:watch', gid: 'g1', from: 'w' });
    run(t, 200);
    expect(start).not.toBeNull();
    expect(start!.to).toBe('w');
    const sentBefore = t.hub.sent;
    const watcher = createWatcher({
      gid: 'g1',
      config: start!.config,
      hostId: start!.host,
      transport: we,
      now: () => t.hub.now,
    });
    const before = t.hub.bytes.get('football:input')?.n ?? 0;
    let frames = 0;
    let evs = 0;
    for (let i = 0; i < 120; i++) {
      run(t, FRAME, pressEvery(15, { mz: 1 }));
      const f = watcher.frame(FRAME / 1000, { ...NO_PAD, mx: 1 });
      if (f) frames++;
      evs += watcher.drainEvents().length;
    }
    expect(frames).toBeGreaterThan(100);
    expect(evs).toBeGreaterThan(0);
    expect(watcher.watching).toBe(true);
    expect(watcher.stats.inputsSent).toBe(0);
    // Every message sent since came from h or c (inputs + pings), none from w
    const pings = t.hub.bytes.get('football:ping')?.n ?? 0;
    expect(pings).toBeGreaterThan(0);
    expect(t.hub.bytes.get('football:input')!.n).toBeGreaterThan(before);
    expect(t.hub.sent).toBeGreaterThan(sentBefore);
    expect(t.host.watchers.has('w')).toBe(true);
  });

  it('a late joiner listed in the config gets football:start {to} and plays', () => {
    const relay = new FootballRelay();
    const hub = new LoopbackHub({ relay, latencyMs: 25 });
    const config = stubConfig(
      5,
      [
        ['h', 0],
        ['late', 1],
      ],
      30,
    );
    const host = new FootballHost({
      gid: 'g2',
      config,
      sim: new StubSim(config),
      transport: hub.endpoint('h'),
      me: 'h',
      now: () => hub.now,
    });
    for (let i = 0; i < 30; i++) {
      hub.advance(FRAME);
      host.frame(FRAME / 1000, NO_PAD);
    }
    // `late` connects after the start, says it's joining
    const le = hub.endpoint('late');
    let start: Extract<FootballMsg, { type: 'football:start' }> | null = null;
    le.onMessage(m => {
      if (m.type === 'football:start') start = m;
    });
    le.send({ type: 'football:join', gid: 'g2', from: 'late', to: 'h', name: 'L', team: 1 });
    hub.advance(100);
    expect(start!.to).toBe('late');
    const cl = new FootballClient({
      gid: 'g2',
      config: start!.config,
      hostId: 'h',
      transport: le,
      me: 'late',
      now: () => hub.now,
    });
    for (let i = 0; i < 60; i++) {
      hub.advance(FRAME);
      host.frame(FRAME / 1000, NO_PAD);
      cl.frame(FRAME / 1000, { ...NO_PAD, mx: -1 });
    }
    expect(cl.stats.snapsRecv).toBeGreaterThan(10);
    expect(host.sim.state().players.find(p => p.human === 'late')!.vx).toBeCloseTo(-7, 5);
    // It doesn't replay what happened before it arrived (the kick-off whistle)
    expect(cl.drainEvents().some(e => e.type === 'whistle')).toBe(false);
  });

  it('selfLead draws my footballer ahead along its velocity', () => {
    const t = setup({ latencyMs: 40, seed: 1 }, 30);
    const led = new FootballClient({
      gid: 'g1',
      config: t.config,
      hostId: 'h',
      transport: t.ce,
      me: 'c',
      now: () => t.hub.now,
      selfLead: 0.15,
    });
    let a: FootballFrame | null = null;
    let b: FootballFrame | null = null;
    for (let i = 0; i < 60; i++) {
      t.hub.advance(FRAME);
      t.host.frame(FRAME / 1000, NO_PAD);
      b = led.frame(FRAME / 1000, { ...NO_PAD, mx: 1 });
      a = t.client.frame(FRAME / 1000, { ...NO_PAD, mx: 1 });
    }
    const pa = a!.next.players.find(p => p.human === 'c')!;
    const pb = b!.next.players.find(p => p.human === 'c')!;
    expect(pb.x - pa.x).toBeCloseTo(pa.vx * 0.15, 1);
    // Everyone else is untouched
    const oa = a!.next.players.find(p => p.human === 'h')!;
    const ob = b!.next.players.find(p => p.human === 'h')!;
    expect(ob.x).toBe(oa.x);
  });
});
