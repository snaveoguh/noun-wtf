// The hide & seek lobby on its own: open games, hiding lists, hosting,
// joining, CPU fill, a full game, expiry.

import type { HsMsg } from '../contract';

import { beforeEach, describe, expect, it } from 'vitest';

import { LIMITS } from '../contract';

import { HideSeekLobby, JOIN_MS, PRESENCE_MS } from './lobby';

let now = 0;
let sent: HsMsg[];

function lobby(id = 'me') {
  return new HideSeekLobby({
    myId: () => id,
    myName: () => 'Me',
    mySeed: () => '1-2-3-4-5',
    nameOf: x => `name-${x}`,
    seedOf: () => undefined,
    cpuSeed: i => `${i}-0-0-0-0`,
    send: m => sent.push(m),
    now: () => now,
  });
}

beforeEach(() => {
  now = 0;
  sent = [];
});

const openMsg = (
  gid: string,
  host: string,
  state: 'lobby' | 'live' = 'lobby',
  hide?: string[],
): HsMsg => ({
  type: 'hideseek:lobby',
  from: host,
  open: { gid, host, hostName: host.toUpperCase(), n: 1, max: 12, state, names: [host] },
  ...(hide ? { hide } : {}),
});

describe('hide & seek lobby', () => {
  it('lists open games and forgets them', () => {
    const l = lobby();
    l.onMessage(openMsg('g', 'h'));
    expect([...l.open.keys()]).toEqual(['g']);
    now += PRESENCE_MS + 1;
    l.tick();
    expect(l.open.size).toBe(0);
  });

  it("keeps a live game's hiders (for name tags) until the next word", () => {
    const l = lobby();
    l.onMessage(openMsg('g', 'h', 'live', ['a', 'b']));
    expect([...l.hiding.keys()].sort()).toEqual(['a', 'b']);
    l.onMessage(openMsg('g', 'h', 'live', ['b']));
    expect([...l.hiding.keys()]).toEqual(['b']);
    l.onMessage({ type: 'hideseek:lobby', from: 'h', open: null });
    expect(l.open.size).toBe(0);
    now += PRESENCE_MS + 1;
    l.tick();
    expect(l.hiding.size).toBe(0);
  });

  it('hosts: joins fill the roster, CPU fill gives way to real players', () => {
    const l = lobby('h');
    l.host({ cpu: 11, seekers: 1, rounds: 3, gid: 'g' });
    expect(sent.map(m => m.type)).toEqual(['hideseek:roster', 'hideseek:lobby']);
    l.onMessage({ type: 'hideseek:join', gid: 'g', from: 'a' });
    expect(l.hosting!.players.map(p => p.id)).toEqual(['h', 'a']);
    expect(l.hosting!.players[1]!.name).toBe('name-a');
    expect(l.hosting!.cpu).toBe(10);
    // Twice is still once
    l.onMessage({ type: 'hideseek:join', gid: 'g', from: 'a' });
    expect(l.hosting!.players).toHaveLength(2);
    // Leaving takes them off
    l.onMessage({ type: 'hideseek:leave', gid: 'g', id: 'a' });
    expect(l.hosting!.players).toHaveLength(1);
  });

  it('starts with the roster plus CPU players, and says so', () => {
    const l = lobby('h');
    l.host({ cpu: 2, seekers: 2, rounds: 3, gid: 'g' });
    l.onMessage({ type: 'hideseek:join', gid: 'g', from: 'a' });
    sent = [];
    const c = l.start({ seed: 1, skill: 0.5 })!;
    expect(c.players.map(p => p.id)).toEqual(['h', 'a', 'cpu:0', 'cpu:1']);
    expect(c.players[2]!.seed).toBe('0-0-0-0-0');
    expect(c.seekers).toBe(2);
    expect(sent[0]).toMatchObject({ type: 'hideseek:start', gid: 'g' });
    expect(sent[1]).toMatchObject({ type: 'hideseek:lobby', open: { state: 'live' } });
    // Joining a live game: refused (the roster comes back without them)
    sent = [];
    l.onMessage({ type: 'hideseek:join', gid: 'g', from: 'b' });
    expect(l.hosting!.players).toHaveLength(2);
  });

  it("won't start alone", () => {
    const l = lobby('h');
    l.host({ cpu: 0, seekers: 1, rounds: 1, gid: 'g' });
    expect(l.start({ seed: 1, skill: 0.5 })).toBeNull();
  });

  it('caps the game at 12', () => {
    const l = lobby('h');
    l.host({ cpu: 0, seekers: 1, rounds: 1, gid: 'g' });
    for (let i = 0; i < 15; i++) l.onMessage({ type: 'hideseek:join', gid: 'g', from: `p${i}` });
    expect(l.hosting!.players).toHaveLength(LIMITS.maxPlayers);
  });

  it('joins: on the roster → joined; a full roster without me → full', () => {
    const a = lobby('a');
    a.onMessage(openMsg('g', 'h'));
    expect(a.join('g')).toBe(true);
    expect(sent.at(-1)).toEqual({ type: 'hideseek:join', gid: 'g' });
    // A roster from before my join landed: keep waiting
    expect(
      a.onMessage({
        type: 'hideseek:roster',
        gid: 'g',
        host: 'h',
        players: [{ id: 'h', name: 'H', cpu: false }],
        cpu: 0,
      }),
    ).toBeNull();
    const r = a.onMessage({
      type: 'hideseek:roster',
      gid: 'g',
      host: 'h',
      players: [
        { id: 'h', name: 'H', cpu: false },
        { id: 'a', name: 'A', cpu: false },
      ],
      cpu: 0,
    });
    expect(r).toEqual({ kind: 'joined', gid: 'g', host: 'h' });
    const b = lobby('b');
    b.onMessage(openMsg('g', 'h'));
    b.join('g');
    const full = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: 'x', cpu: false }));
    expect(
      b.onMessage({ type: 'hideseek:roster', gid: 'g', host: 'h', players: full, cpu: 0 }),
    ).toEqual({ kind: 'full', gid: 'g' });
  });

  it('takes a start only from the host it joined, with me in it', () => {
    const a = lobby('a');
    a.onMessage(openMsg('g', 'h'));
    a.join('g');
    const cfg = {
      gid: 'g',
      seed: 1,
      arena: 'plaza' as const,
      players: [
        { id: 'h', name: 'H', cpu: false },
        { id: 'a', name: 'A', cpu: false },
      ],
      seekers: 1,
      rounds: 1,
      hideS: 45,
      seekS: 210,
      order: ['h', 'a'],
      skill: 0.5,
    };
    expect(a.onMessage({ type: 'hideseek:start', gid: 'g', host: 'x', config: cfg })).toBeNull();
    expect(a.onMessage({ type: 'hideseek:start', gid: 'g', host: 'h', config: cfg })).toMatchObject(
      { kind: 'start' },
    );
  });

  it('a join that never hears back falls through', () => {
    const a = lobby('a');
    a.onMessage(openMsg('g', 'h'));
    a.join('g');
    now += JOIN_MS + 1;
    a.onMessage(openMsg('g', 'h'));
    expect(a.tick()).toEqual({ kind: 'fellThrough' });
  });

  it("can't join a game that's already playing", () => {
    const a = lobby('a');
    a.onMessage(openMsg('g', 'h', 'live'));
    expect(a.join('g')).toBe(false);
  });
});
