import type { PoolMsg } from '../contract';

import { describe, expect, it } from 'vitest';

import { newFrame } from '../sim/rules';

import { q, quantize, readMsg, writeMsg } from './codec';
import { PoolLobby } from './lobby';

const through = (m: PoolMsg) => readMsg(JSON.parse(JSON.stringify(writeMsg(m))));

describe('pool codec', () => {
  const state = newFrame(5, 1);
  const config = {
    gid: 'g9',
    seed: 1234,
    breaker: 1 as const,
    players: [
      { id: 'a', name: 'Ann', human: true, seedKey: '1-2-3-4-5' },
      { id: 'cpu', name: 'CPU', human: false, skill: 0.6 },
    ] as [never, never],
    pro: true,
    table: 'hall',
    place: { x: 1, y: 3600, z: -2, yaw: 0.5, length: 2.3, width: 1.3, height: 0.8, id: 'hall' },
  };

  it('round-trips every message type', () => {
    const msgs: PoolMsg[] = [
      {
        type: 'pool:lobby',
        at: 'hall',
        name: 'Ann',
        seedKey: 'k',
        live: { gid: 'g9', host: 'a', names: ['Ann', 'Bo'] },
      },
      { type: 'pool:lobby', at: null },
      {
        type: 'pool:challenge',
        to: 'b',
        gid: 'g9',
        name: 'Ann',
        table: 'hall',
        place: config.place,
      },
      { type: 'pool:reply', to: 'a', gid: 'g9', ok: true },
      { type: 'pool:start', host: 'a', config, state, n: 0 },
      {
        type: 'pool:shot',
        gid: 'g9',
        n: 3,
        input: {
          shot: { dx: 0.6, dy: 0.8, power: 0.5, side: -0.2, top: 0.3 },
          cue: { x: -0.6, y: 0.1 },
          call: 4,
        },
      },
      { type: 'pool:aim', gid: 'g9', dx: 0.6, dy: 0.8, p: 0.25 },
      {
        type: 'pool:result',
        gid: 'g9',
        n: 3,
        input: { shot: { dx: 1, dy: 0, power: 1, side: 0, top: 0 } },
        state,
      },
      { type: 'pool:end', gid: 'g9', winner: 1, reason: '8 in the called pocket' },
      { type: 'pool:watch', gid: 'g9' },
      { type: 'pool:leave', gid: 'g9', id: 'a' },
    ];
    for (const m of msgs) {
      const back = through(m);
      expect(back, m.type).not.toBeNull();
      expect(back!.type).toBe(m.type);
    }
    const start = through(msgs[4]!) as Extract<PoolMsg, { type: 'pool:start' }>;
    expect(start.config).toEqual(config);
    expect(start.state).toEqual(quantize(state));
  });

  it('rounds positions to 10 µm, the same way twice', () => {
    expect(q(0.123456789)).toBe(0.12346);
    const s = quantize(state);
    expect(quantize(s)).toEqual(s);
    const r = through({
      type: 'pool:result',
      gid: 'g',
      n: 0,
      input: { shot: { dx: 1, dy: 0, power: 1, side: 0, top: 0 } },
      state,
    }) as Extract<PoolMsg, { type: 'pool:result' }>;
    expect(r.state.balls).toEqual(s.balls);
  });

  it('turns away junk', () => {
    const bad: unknown[] = [
      null,
      42,
      { type: 'pool:nope' },
      {
        type: 'pool:shot',
        gid: 'g',
        n: 1,
        input: { shot: { dx: NaN, dy: 0, power: 1, side: 0, top: 0 } },
      },
      {
        type: 'pool:shot',
        gid: 'g',
        n: 1,
        input: { shot: { dx: 1, dy: 0, power: 3, side: 0, top: 0 } },
      },
      {
        type: 'pool:shot',
        gid: 'g',
        n: 1,
        input: { shot: { dx: 1, dy: 0, power: 1, side: 0, top: 0 }, call: 9 },
      },
      {
        type: 'pool:result',
        gid: 'g',
        n: 1,
        input: { shot: { dx: 1, dy: 0, power: 1, side: 0, top: 0 } },
        state: { ...state, balls: [] },
      },
      {
        type: 'pool:result',
        gid: 'g',
        n: 1,
        input: { shot: { dx: 1, dy: 0, power: 1, side: 0, top: 0 } },
        state: { ...state, phase: 'party' },
      },
      { type: 'pool:start', config: { ...config, players: [config.players[0]] } },
      { type: 'pool:challenge', to: '', gid: 'g' },
      { type: 'pool:end', gid: 'g', winner: 7 },
      { type: 'pool:aim', gid: 'g', dx: 1, dy: 0, p: 2 },
    ];
    for (const b of bad) expect(readMsg(b), JSON.stringify(b)).toBeNull();
  });
});

describe('pool lobby', () => {
  const mk = (id: string, sent: PoolMsg[], clock: { t: number }) =>
    new PoolLobby({
      myId: () => id,
      myName: () => id.toUpperCase(),
      mySeedKey: () => undefined,
      send: m => sent.push(m),
      now: () => clock.t,
      busy: () => false,
    });

  it('challenge → accept → the challenger hosts; a decline says so; invites expire', () => {
    const clock = { t: 0 };
    const aSent: PoolMsg[] = [];
    const bSent: PoolMsg[] = [];
    const a = mk('a', aSent, clock);
    const b = mk('b', bSent, clock);
    const gid = a.challenge('b', 'Bo');
    const ch = { ...(aSent.pop() as Extract<PoolMsg, { type: 'pool:challenge' }>), from: 'a' };
    expect(b.onMessage(ch)).toEqual({ kind: 'invite', from: 'a', name: 'A' });
    b.accept();
    const reply = { ...(bSent.pop() as Extract<PoolMsg, { type: 'pool:reply' }>), from: 'b' };
    expect(a.onMessage(reply)).toEqual({ kind: 'accepted', to: 'b', name: 'Bo', gid });
    expect(
      b.wants({
        type: 'pool:start',
        host: 'a',
        config: {
          gid,
          seed: 1,
          breaker: 0,
          players: [
            { id: 'a', name: 'A', human: true },
            { id: 'b', name: 'B', human: true },
          ],
        },
      }),
    ).toBe('member');
    // A second one, declined
    a.challenge('b', 'Bo');
    b.onMessage({ ...(aSent.pop() as Extract<PoolMsg, { type: 'pool:challenge' }>), from: 'a' });
    b.decline();
    expect(
      a.onMessage({ ...(bSent.pop() as Extract<PoolMsg, { type: 'pool:reply' }>), from: 'b' }),
    ).toEqual({
      kind: 'declined',
      name: 'Bo',
    });
    // A third, left hanging
    a.challenge('b', 'Bo');
    b.onMessage({ ...(aSent.pop() as Extract<PoolMsg, { type: 'pool:challenge' }>), from: 'a' });
    clock.t = 60_000;
    expect(b.tick()).toBe(true);
    expect(b.incoming).toBeNull();
    expect(a.tick()).toBe(true);
    expect(a.outgoing).toBeNull();
  });

  it('tracks who is at which table and the live frames', () => {
    const clock = { t: 0 };
    const a = mk('a', [], clock);
    a.onMessage({
      type: 'pool:lobby',
      from: 'c',
      at: 'hall',
      name: 'Cy',
      live: { gid: 'g1', host: 'c', names: ['Cy', 'CPU'] },
    });
    expect(a.here.get('c')?.at).toBe('hall');
    expect(a.live.get('g1')?.host).toBe('c');
    a.onMessage({ type: 'pool:lobby', from: 'c', at: null });
    expect(a.here.has('c')).toBe(false);
    expect(a.live.has('g1')).toBe(false);
  });
});
