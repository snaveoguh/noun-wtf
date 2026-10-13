// Noun Warfare online: codec round-trips, the relay (registry, limits,
// names) and whole matches over an in-memory loopback that runs the real
// PartyKit relay (packages/nouns-party/src/warfareRelay.ts) with latency.
// Nothing here opens a socket.

import { beforeEach, describe, expect, it } from 'vitest';

import { WarfareRelay } from '../../../../../nouns-party/src/warfareRelay';
import { headY, eyeHeight } from '../sim/physics';
import { WarfareSim, isEnemy } from '../sim/sim';
import { DT, emptyInput, type PlayerInput, type PlayerState } from '../sim/types';

import {
  applySnapshot,
  decodeSnapshot,
  encodeSnapshot,
  packBirths,
  packEvents,
  packInput,
  unpackBirths,
  unpackEvents,
  unpackInputs,
} from './codec';
import { WarfareLobby } from './lobby';
import { type HumanInfo, type NetMatchCfg, type WfMsg, type WfTransport } from './protocol';
import { WarfareSession } from './session';

// ── Loopback: transports → relay → transports, one-way latency ───────

let clock = 0;

class Hub {
  relay = new WarfareRelay(
    () => clock,
    (() => {
      let s = 7;
      return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    })(),
  );
  conns = new Map<string, Loop>();
  q: { at: number; fn: () => void }[] = [];
  bytes = new Map<string, number>();
  constructor(public lat = 35) {}
  connect(id: string) {
    const c = new Loop(this, id);
    this.conns.set(id, c);
    return c;
  }
  private wire() {
    return [...this.conns.values()].map(c => ({
      id: c.id,
      send: (s: string) => this.later(() => c.deliver(s)),
    }));
  }
  later(fn: () => void) {
    this.q.push({ at: clock + this.lat, fn });
  }
  fromClient(id: string, m: WfMsg) {
    const s = JSON.stringify(m);
    this.bytes.set(m.type, (this.bytes.get(m.type) ?? 0) + s.length);
    this.later(() => {
      if (!this.conns.has(id)) return;
      const all = this.wire();
      this.relay.message(s, all.find(c => c.id === id)!, all);
    });
  }
  close(id: string) {
    this.conns.delete(id);
    this.later(() => this.relay.close(id, this.wire()));
  }
  pump() {
    this.q.sort((a, b) => a.at - b.at);
    while (this.q.length > 0 && this.q[0].at <= clock) this.q.shift()!.fn();
  }
}

class Loop implements WfTransport {
  onMessage: ((m: WfMsg) => void) | null = null;
  online = true;
  constructor(
    private hub: Hub,
    readonly id: string,
  ) {}
  send(m: WfMsg) {
    if (this.hub.conns.has(this.id)) this.hub.fromClient(this.id, m);
  }
  deliver(s: string) {
    if (this.hub.conns.has(this.id)) this.onMessage?.(JSON.parse(s));
  }
}

const now = () => clock;

interface Peer {
  id: string;
  lobby: WarfareLobby;
  /** Input for this tick (defaults to idle). */
  input?: (s: WarfareSession) => PlayerInput;
  stopped?: boolean;
}

function peer(hub: Hub, id: string, input?: Peer['input']): Peer {
  return { id, lobby: new WarfareLobby(hub.connect(id), now), input };
}

/** Advance real time by `frames` 60 Hz frames: deliver, update, tick. */
function run(hub: Hub, peers: Peer[], frames: number) {
  for (let f = 0; f < frames; f++) {
    clock += DT * 1000;
    hub.pump();
    for (const p of peers) {
      const s = p.lobby.session;
      if (s === null || p.stopped === true) continue;
      s.update();
      if (!s.canStep) continue;
      if (s.role === 'client') s.pump();
      const me = s.sim.state.players[s.mySlot];
      s.tick(p.input?.(s) ?? emptyInput(me.yaw, me.pitch));
    }
  }
}

/** Walk at and paint the nearest enemy (good enough to land hits on easy bots). */
function aimbot(s: WarfareSession): PlayerInput {
  const ps = s.sim.state.players;
  const me = ps[s.mySlot];
  const inp = emptyInput(me.yaw, me.pitch);
  let best: PlayerState | null = null;
  let bd = Infinity;
  for (const o of ps) {
    if (!o.alive || !isEnemy(me, o)) continue;
    const d = Math.hypot(o.x - me.x, o.z - me.z);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  if (best === null || !me.alive) return inp;
  const dx = best.x - me.x;
  const dz = best.z - me.z;
  const dy = headY(best) - 0.5 - (me.y + eyeHeight(me));
  inp.yaw = Math.atan2(-dx, -dz);
  inp.pitch = Math.atan2(dy, Math.hypot(dx, dz)) + 0.01;
  inp.moveY = bd > 12 ? 1 : 0;
  inp.fire = s.sim.state.tick % 2 === 0 || true;
  return inp;
}

const ME = (name: string): HumanInfo => ({
  name,
  look: '0-12-40-123-7',
  weapons: ['splatter', 'hopper'],
});

const CFG = (o: Partial<NetMatchCfg> = {}): NetMatchCfg => ({
  mode: 'tdm',
  map: 'warehouse',
  teamSize: 2,
  difficulty: 0,
  seed: 4242,
  ...o,
});

beforeEach(() => {
  clock = 1000;
});

/** Host + N clients joined by code (waiting room), then started. */
function setup(nClients: number, cfg = CFG(), lat = 35) {
  const hub = new Hub(lat);
  const host = peer(hub, 'host', aimbot);
  const hs = host.lobby.host(cfg, ME('HOSTY'), false);
  const peers: Peer[] = [host];
  run(hub, peers, 6);
  expect(hs.code).toMatch(/^[2-9A-Z]{5}$/);
  for (let i = 0; i < nClients; i++) {
    const c = peer(hub, `c${i}`, aimbot);
    void c.lobby.join({ code: hs.code }, ME(`PLAYER${i}`)).catch(() => undefined);
    peers.push(c);
    run(hub, peers, 12);
    expect(c.lobby.session?.role).toBe('client');
  }
  return { hub, host, hs, peers };
}

describe('codec', () => {
  it('round-trips a live state within quantisation and stays compact', () => {
    const sim = new WarfareSim({
      mode: 'turf',
      map: 'nouncity',
      teamSize: 4,
      difficulty: 2,
      seed: 99,
      humans: [{ name: 'A', look: '0-1-2-3-4', weapons: ['splatter', 'hopper', 'shotgun'] }],
    });
    for (let i = 0; i < 60 * 20; i++) sim.step({});
    const acks = new Map([[0, 321]]);
    const d = encodeSnapshot(sim, [0, 3], acks);
    const s = decodeSnapshot(JSON.parse(JSON.stringify(d)))!;
    expect(s).not.toBeNull();
    expect(s.tick).toBe(sim.state.tick);
    expect(s.match.phase).toBe(sim.state.match.phase);
    expect(s.match.scores).toEqual(sim.state.match.scores);
    expect(s.rngState).toBe(sim.state.rngState);
    expect(s.humans.get(0)!.ack).toBe(321);
    for (let i = 0; i < sim.state.players.length; i++) {
      const p = sim.state.players[i];
      const q = s.players[i];
      expect(Math.abs(q.x - p.x)).toBeLessThan(0.006);
      expect(Math.abs(q.y - p.y)).toBeLessThan(0.006);
      expect(Math.abs(q.z - p.z)).toBeLessThan(0.006);
      expect(Math.abs(Math.atan2(Math.sin(q.yaw - p.yaw), Math.cos(q.yaw - p.yaw)))).toBeLessThan(
        0.001,
      );
      expect(q.alive).toBe(p.alive);
      expect(q.bot).toBe(p.bot);
      expect(q.kills).toBe(p.stats.kills);
      expect(q.deaths).toBe(p.stats.deaths);
      expect(Math.abs(q.hp - p.hp)).toBeLessThan(0.051);
      expect(q.weapon).toBe(p.weapon);
    }
    for (let i = 0; i < sim.state.zones.length; i++) {
      expect(s.zones[i].owner).toBe(sim.state.zones[i].owner);
      expect(Math.abs(s.zones[i].progress - sim.state.zones[i].progress)).toBeLessThan(0.001);
    }
    // Full-state write-back keeps a second sim in step
    const copy = new WarfareSim(sim.cfg);
    applySnapshot(copy.state, s);
    expect(copy.state.match.scores).toEqual(sim.state.match.scores);
    expect(copy.state.players[0].mags).toEqual(sim.state.players[0].mags);
    // 4v4: comfortably under 1.5 KB
    expect(JSON.stringify(d).length).toBeLessThan(1500);
  });

  it('round-trips events, projectile births and inputs', () => {
    const sim = new WarfareSim({
      mode: 'tdm',
      map: 'warehouse',
      teamSize: 4,
      difficulty: 2,
      seed: 5,
      humans: [],
    });
    const all = [];
    const back = [];
    const prs = [];
    for (let i = 0; i < 60 * 25; i++) {
      const evs = sim.step({});
      all.push(...evs);
      back.push(...unpackEvents(JSON.parse(JSON.stringify(packEvents(evs))), 8));
      for (const p of sim.state.projectiles)
        if (p.born >= sim.state.time - 1e-9) prs.push({ ...p });
    }
    const kinds = new Set(all.map(e => e.type));
    expect(kinds.has('kill')).toBe(true);
    expect(kinds.has('splat')).toBe(true);
    const net = all.filter(e => !['reload', 'swap', 'jump', 'land', 'throw'].includes(e.type));
    expect(back.length).toBe(net.length);
    for (let i = 0; i < net.length; i++) {
      expect(back[i].type).toBe(net[i].type);
      const a = net[i];
      const b = back[i];
      if (a.type === 'kill' && b.type === 'kill') {
        expect([b.attacker, b.victim, b.source, b.head, b.assist]).toEqual([
          a.attacker,
          a.victim,
          a.source,
          a.head,
          a.assist,
        ]);
      }
      if (a.type === 'splat' && b.type === 'splat') {
        expect(Math.abs(b.x - a.x)).toBeLessThan(0.006);
        expect(b.color).toBe(a.color);
        expect(b.on).toBe(a.on);
      }
    }
    const births = unpackBirths(JSON.parse(JSON.stringify(packBirths(prs))), sim.state.players, 10);
    expect(births.length).toBe(prs.length);
    expect(Math.abs(births[0].vx - prs[0].vx)).toBeLessThan(0.006);
    expect(births[0].kind).toBe(prs[0].kind);
    expect(births[0].born).toBe(10);
    // Inputs
    const inp: PlayerInput = {
      ...emptyInput(12.345, -0.4),
      moveX: -0.5,
      moveY: 1,
      fire: true,
      grenade: true,
      weapon: 'shotgun',
    };
    const flat: number[] = [];
    packInput(inp, flat);
    packInput(emptyInput(), flat);
    const ins = unpackInputs(JSON.parse(JSON.stringify(flat)));
    expect(ins.length).toBe(2);
    expect(ins[0].moveX).toBe(-0.5);
    expect(ins[0].yaw).toBeCloseTo(12.345, 3);
    expect(ins[0].fire && ins[0].grenade && !ins[0].jump).toBe(true);
    expect(ins[0].weapon).toBe('shotgun');
    expect(ins[1].weapon).toBeNull();
    // Garbage in → nothing (or clamped) out
    expect(unpackInputs([1, 2, 3])).toEqual([]);
    expect(unpackInputs([500, -500, 1e12, 9999, 0, 99])[0]).toMatchObject({
      moveX: 1,
      moveY: -1,
      yaw: 0,
      pitch: 1.45,
      weapon: null,
    });
    expect(decodeSnapshot([1, 2, 3])).toBeNull();
    expect(decodeSnapshot('nope')).toBeNull();
  });
});

describe('relay', () => {
  it('lists public matches only, clamps names, rate- and size-limits', () => {
    const hub = new Hub(0);
    const a = hub.connect('a');
    const b = hub.connect('b');
    const got: WfMsg[] = [];
    b.onMessage = m => got.push(m);
    a.onMessage = () => undefined;
    a.send({
      type: 'wf:host',
      gid: 'g1',
      pub: true,
      mode: 'tdm',
      map: 'warehouse',
      size: 2,
      name: '<script>alert(1)</script>BIGNAMEBIGNAMEBIGNAME',
    });
    b.send({
      type: 'wf:host',
      gid: 'g2',
      pub: false,
      mode: 'ffa',
      map: 'nouncity',
      size: 4,
      name: 'SECRET',
    });
    hub.pump();
    hub.pump();
    const list = hub.relay.listing();
    expect(list.length).toBe(1);
    expect(list[0].gid).toBe('g1');
    expect(list[0].host).not.toMatch(/[()<>]/);
    expect(list[0].host.length).toBeLessThanOrEqual(16);
    // Size limit: an oversized input never reaches anyone
    expect(hub.relay.admit('x', 'wf:in', 5000)).toBe(false);
    expect(hub.relay.admit('x', 'wf:s', 5000)).toBe(true);
    expect(hub.relay.admit('x', 'wf:s', 50_000)).toBe(false);
    // Rate limit: a flood gets cut off, then refills
    let ok = 0;
    for (let i = 0; i < 1000; i++) if (hub.relay.admit('flood', 'wf:in', 50)) ok++;
    expect(ok).toBeLessThan(200);
    clock += 1000;
    expect(hub.relay.admit('flood', 'wf:in', 50)).toBe(true);
    // Unknown match / non-member inputs go nowhere
    hub.relay.message(
      JSON.stringify({ type: 'wf:in', gid: 'g1', q: 1, i: [] }),
      { id: 'z', send: () => undefined },
      [],
    );
  });
});

describe('online match', () => {
  it('host + 3 clients converge on the same scores, and client paint scores on the host', () => {
    const { hub, hs, peers } = setup(3);
    // Everyone took a bot's slot; teams balanced 2v2 with 4 humans
    expect(hs.humans).toBe(4);
    const slots = peers.map(p => p.lobby.session!.mySlot);
    expect(new Set(slots).size).toBe(4);
    // Names reach every peer
    for (const p of peers)
      expect(p.lobby.session!.sim.state.players.map(q => q.name).sort()).toEqual(
        ['HOSTY', 'PLAYER0', 'PLAYER1', 'PLAYER2'].sort(),
      );
    hs.start();
    run(hub, peers, 60 * 25);
    // Freeze the host on a snapshot boundary, let the wire drain
    peers[0].stopped = true;
    run(hub, peers, 40);
    const st = hs.sim.state;
    expect(st.match.phase === 'live' || st.match.phase === 'matchEnd').toBe(true);
    const totalKills = st.players.reduce((a, p) => a + p.stats.kills, 0);
    expect(totalKills).toBeGreaterThan(0);
    for (const p of peers.slice(1)) {
      const s = p.lobby.session!;
      expect(s.stats.snapsRecv).toBeGreaterThan(400);
      expect(s.sim.state.match.scores).toEqual(st.match.scores);
      for (let i = 0; i < st.players.length; i++) {
        const a = st.players[i];
        const b = s.sim.state.players[i];
        expect([b.stats.kills, b.stats.deaths, b.stats.score]).toEqual([
          a.stats.kills,
          a.stats.deaths,
          a.stats.score,
        ]);
      }
    }
    // A client's paint lands on the host's books
    const c0 = peers[1].lobby.session!;
    expect(st.players[c0.mySlot].stats.hits).toBeGreaterThan(0);
    // Bandwidth stays sane: 20 Hz snapshots around a kilobyte
    expect(hs.stats.snapsSent).toBeGreaterThan(450);
    expect(hs.stats.snapBytesTotal / hs.stats.snapsSent).toBeLessThan(2500);
    expect(c0.stats.inputBytes).toBeLessThan(160);
  });

  it('prediction tracks the host closely and remote players move', () => {
    const { hub, hs, peers } = setup(1, CFG({ mode: 'ffa', teamSize: 2 }), 50);
    const c = peers[1];
    let t = 0;
    // Run in a circle (no shooting)
    c.input = s => {
      const me = s.sim.state.players[s.mySlot];
      t++;
      return {
        ...emptyInput(t * 0.02, 0),
        moveY: 1,
        weapon: null,
        yaw: t * 0.02,
        pitch: me.pitch * 0,
      };
    };
    const host0 = { ...hs.sim.state.players[0] };
    let hostMoveSeen = 0;
    peers[0].input = () => ({ ...emptyInput(1.2, 0), moveY: 1, moveX: 0.3 });
    hs.start();
    run(hub, peers, 60 * 4);
    const cs = c.lobby.session!;
    const errs: number[] = [];
    for (let i = 0; i < 60 * 4; i++) {
      run(hub, peers, 1);
      const mine = cs.sim.state.players[cs.mySlot];
      const auth = hs.sim.state.players[cs.mySlot];
      errs.push(Math.hypot(mine.x - auth.x, mine.z - auth.z));
      const hv = cs.sim.state.players[0];
      hostMoveSeen = Math.max(hostMoveSeen, Math.hypot(hv.x - host0.x, hv.z - host0.z));
    }
    // My prediction runs ~one RTT ahead of the host: a step or two at run speed, never a snap
    errs.sort((a, b) => a - b);
    expect(errs[Math.floor(errs.length / 2)]).toBeLessThan(1.6);
    expect(cs.stats.correction).toBeLessThan(0.5);
    // I see the host move
    expect(hostMoveSeen).toBeGreaterThan(3);
  });

  it('joining mid-match replaces a bot; leaving hands the slot back to a bot', () => {
    const hub = new Hub(30);
    const host = peer(hub, 'host');
    const hs = host.lobby.host(CFG({ teamSize: 4 }), ME('HOSTY'), true);
    const peers = [host];
    run(hub, peers, 5);
    hs.start();
    run(hub, peers, 60 * 6);
    expect(hub.relay.listing()[0]).toMatchObject({ status: 'live', humans: 1, max: 8 });
    const late = peer(hub, 'late', aimbot);
    peers.push(late);
    // Joins straight from the public list by gid
    void late.lobby.join({ gid: hs.gid }, ME('LATE')).catch(() => undefined);
    run(hub, peers, 15);
    const ls = late.lobby.session!;
    expect(ls).not.toBeNull();
    const slot = ls.mySlot;
    expect(slot).not.toBe(0);
    expect(hs.sim.state.players[slot].bot).toBe(false);
    expect(hs.sim.bots.has(slot)).toBe(false);
    expect(hs.sim.state.players[slot].name).toBe('LATE');
    // Team balance: the newcomer sits on the team without humans
    expect(hs.sim.state.players[slot].team).toBe(1);
    run(hub, peers, 60 * 3);
    expect(ls.stats.snapsRecv).toBeGreaterThan(50);
    expect(hub.relay.listing()[0].humans).toBe(2);
    // Leaves (socket drops): a bot takes over the same slot, name kept
    hub.close('late');
    peers.pop();
    run(hub, peers, 10);
    expect(hs.sim.state.players[slot].bot).toBe(true);
    expect(hs.sim.bots.has(slot)).toBe(true);
    expect(hs.roster[slot].bot).toBe(true);
    expect(hs.toasts.some(t => t.text.includes('LATE left'))).toBe(true);
    run(hub, peers, 60);
    expect(hub.relay.listing()[0].humans).toBe(1);
  });

  it('host leaving: the earliest joiner takes over from the last snapshot', () => {
    const { hub, hs, peers } = setup(2);
    hs.start();
    run(hub, peers, 60 * 10);
    const [h, c0, c1] = peers;
    const s0 = c0.lobby.session!;
    const s1 = c1.lobby.session!;
    const tickBefore = hs.sim.state.tick;
    const killsBefore = hs.sim.state.players.reduce((a, p) => a + p.stats.kills, 0);
    const oldHostSlot = hs.mySlot;
    // Host closes the tab
    hub.close('host');
    h.stopped = true;
    run(hub, peers, 20);
    expect(s0.role).toBe('host');
    expect(s1.role).toBe('client');
    expect(s1.hostId).toBe('c0');
    // Old host's slot is a bot now, the match keeps going on c0
    expect(s0.sim.state.players[oldHostSlot].bot).toBe(true);
    expect(s0.sim.bots.has(oldHostSlot)).toBe(true);
    expect(s0.sim.state.players[s1.mySlot].bot).toBe(false);
    expect(s0.sim.state.tick).toBeGreaterThanOrEqual(tickBefore - 6);
    expect(s0.sim.state.players.reduce((a, p) => a + p.stats.kills, 0)).toBeGreaterThanOrEqual(
      killsBefore - 1,
    );
    run(hub, peers, 60 * 8);
    c0.stopped = true;
    run(hub, peers, 40);
    // The other client follows the new host
    expect(s1.sim.state.match.scores).toEqual(s0.sim.state.match.scores);
    expect(s1.sim.state.players.map(p => p.stats.kills)).toEqual(
      s0.sim.state.players.map(p => p.stats.kills),
    );
    expect(s0.sim.state.tick).toBeGreaterThan(tickBefore + 60 * 7);
    expect(s1.toasts.some(t => t.text.includes('host left'))).toBe(true);
    expect(hub.relay.matches.get(hs.gid)?.host).toBe('c0');
  });

  it('private codes join, wrong codes and full matches are refused', async () => {
    const hub = new Hub(10);
    const host = peer(hub, 'host');
    const hs = host.lobby.host(CFG({ teamSize: 2, mode: 'ffa' }), ME('H'), false);
    const peers = [host];
    run(hub, peers, 3);
    expect(hub.relay.listing().length).toBe(0);
    const bad = peer(hub, 'bad');
    let err = '';
    const p = bad.lobby.join({ code: 'ZZZZZ' }, ME('B')).catch(e => (err = (e as Error).message));
    run(hub, [...peers, bad], 5);
    await p;
    expect(err).toMatch(/no such match/);
    // Fill all 4 slots (host + 3), the 5th is refused
    const joiners = [1, 2, 3].map(i => peer(hub, `j${i}`));
    for (const j of joiners)
      void j.lobby.join({ code: hs.code.toLowerCase() }, ME(`J`)).catch(() => undefined);
    run(hub, [...peers, ...joiners], 10);
    expect(joiners.every(j => j.lobby.session !== null)).toBe(true);
    const extra = peer(hub, 'extra');
    let err2 = '';
    const p2 = extra.lobby
      .join({ code: hs.code }, ME('X'))
      .catch(e => (err2 = (e as Error).message));
    run(hub, [...peers, ...joiners, extra], 10);
    await p2;
    expect(err2).toMatch(/full/);
  });
});
