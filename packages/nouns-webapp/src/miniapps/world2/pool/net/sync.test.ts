// A whole frame of pool between two players and a spectator, through the
// real room relay (packages/nouns-party/src/poolRelay.ts) and the codec.

import type { PoolConfig, PoolMsg } from '../contract';

import { describe, expect, it } from 'vitest';

import { PoolRelay, type RelayConn } from '../../../../../../nouns-party/src/poolRelay';
import { plan, SKILL } from '../sim/cpu';

import { readMsg } from './codec';
import { PoolSession, type Role } from './session';

class Room {
  relay = new PoolRelay();
  conns = new Map<string, RelayConn>();
  inbox = new Map<string, PoolMsg[]>();
  join(id: string) {
    this.inbox.set(id, []);
    this.conns.set(id, {
      id,
      send: (s: string) => {
        const m = readMsg(JSON.parse(s));
        if (m !== null) this.inbox.get(id)!.push(m);
      },
    });
  }
  /** What a client sends (through JSON, like the socket). */
  sendFrom(id: string, m: PoolMsg) {
    this.relay.handle(JSON.parse(JSON.stringify(m)), this.conns.get(id)!, this.conns.values());
  }
  deliver(id: string, s: PoolSession) {
    const box = this.inbox.get(id)!;
    while (box.length > 0) s.onMessage(box.shift()!);
  }
}

const CONFIG: PoolConfig = {
  gid: 'g1',
  seed: 77,
  breaker: 0,
  players: [
    { id: 'host', name: 'A', human: true },
    { id: 'cli', name: 'B', human: true },
  ],
};

function setup(config = CONFIG) {
  const room = new Room();
  for (const id of ['host', 'cli', 'spec']) room.join(id);
  const mk = (id: string, role: Role) =>
    new PoolSession({ config, role, me: id, send: m => room.sendFrom(id, m), cpuDelay: 0 });
  const host = mk('host', 'host');
  const cli = mk('cli', 'client');
  const spec = mk('spec', 'spectator');
  cli.setHost('host');
  spec.setHost('host');
  // The host registers the frame; the spectator asks in
  room.sendFrom('host', { type: 'pool:start', host: 'host', config });
  room.sendFrom('spec', { type: 'pool:watch', gid: config.gid });
  room.inbox.forEach(b => (b.length = 0));
  const all: [string, PoolSession][] = [
    ['host', host],
    ['cli', cli],
    ['spec', spec],
  ];
  const tick = (dt = 1 / 30) => {
    for (const [id, s] of all) {
      room.deliver(id, s);
      s.update(dt);
    }
  };
  return { room, host, cli, spec, tick, all };
}

describe('pool sync (host-refereed lockstep)', { timeout: 120_000 }, () => {
  it('plays a whole frame: every client ends every shot in the host state, bit for bit', () => {
    const { host, cli, spec, tick } = setup();
    let guard = 0;
    let shots = 0;
    while (host.ended === null && guard++ < 40000) {
      for (const s of [host, cli])
        if (s.canShoot()) {
          s.shoot(plan(s.state, s.mySeat!, SKILL.hard, { seed: shots + 1 }));
          shots++;
        }
      tick();
      if (host.play === null && cli.play === null && spec.play === null) {
        expect(cli.state).toEqual(host.state);
        expect(spec.state).toEqual(host.state);
      }
    }
    for (let i = 0; i < 20; i++) tick();
    expect(host.ended).not.toBeNull();
    expect(cli.ended).toEqual(host.ended);
    expect(spec.ended).toEqual(host.ended);
    expect(cli.state).toEqual(host.state);
    expect(shots).toBeGreaterThan(3);
    expect(host.refused).toBe(0);
  });

  it('refuses a shot out of turn, and a forged sender', () => {
    const { room, host, cli, tick } = setup();
    // It's the host's break: the client tries anyway (bypassing canShoot)
    room.sendFrom('cli', {
      type: 'pool:shot',
      gid: 'g1',
      n: 0,
      input: { shot: { dx: 1, dy: 0, power: 1, side: 0, top: 0 }, cue: { x: -0.6, y: 0 } },
    });
    tick();
    expect(host.refused).toBe(1);
    expect(host.play).toBeNull();
    expect(cli.canShoot()).toBe(false);
    // The spectator can't shoot at all (the relay drops it)
    room.sendFrom('spec', {
      type: 'pool:shot',
      gid: 'g1',
      n: 0,
      input: { shot: { dx: 1, dy: 0, power: 1, side: 0, top: 0 }, cue: { x: -0.6, y: 0 } },
    });
    tick();
    expect(host.refused).toBe(1);
    expect(host.play).toBeNull();
  });

  it('a client leaving mid-frame hands the host the win', () => {
    const { room, host, cli, spec, tick } = setup();
    cli.leave();
    room.relay.close('cli', room.conns.values());
    tick();
    expect(host.ended).toEqual({ winner: 0, reason: 'the other player left' });
    tick();
    expect(spec.ended?.winner).toBe(0);
  });

  it('vs CPU: the host plays the CPU itself', () => {
    const config: PoolConfig = {
      ...CONFIG,
      gid: 'g2',
      breaker: 1,
      players: [
        { id: 'host', name: 'A', human: true },
        { id: 'cpu', name: 'CPU', human: false, skill: SKILL.normal },
      ],
    };
    const sent: PoolMsg[] = [];
    const s = new PoolSession({
      config,
      role: 'host',
      me: 'host',
      send: m => sent.push(m),
      cpuDelay: 0.2,
    });
    expect(s.cpuTurn).toBe(true);
    for (let i = 0; i < 600 && s.state.shots === 0; i++) s.update(1 / 30);
    expect(s.state.shots).toBe(1);
    expect(sent.some(m => m.type === 'pool:shot')).toBe(true);
    expect(sent.some(m => m.type === 'pool:result')).toBe(true);
  });
});
