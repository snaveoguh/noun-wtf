// The Noun Football relay (packages/nouns-party/src/footballRelay.ts): who
// gets which football:* message.

import { describe, expect, it } from 'vitest';

import {
  FOOTBALL_MAX_GAMES,
  FOOTBALL_MAX_WATCHERS,
  FootballRelay,
  type RelayConn,
} from '../../../../../../nouns-party/src/footballRelay';

function room(ids: string[]) {
  const got = new Map<string, Record<string, unknown>[]>();
  const conns = new Map<string, RelayConn>();
  for (const id of ids) {
    got.set(id, []);
    conns.set(id, { id, send: s => got.get(id)!.push(JSON.parse(s)) });
  }
  const relay = new FootballRelay();
  const send = (from: string, m: Record<string, unknown>) =>
    relay.handle(m, conns.get(from)!, conns.values());
  const clear = () => got.forEach(g => (g.length = 0));
  const types = (id: string) => got.get(id)!.map(m => m.type);
  const close = (id: string) => {
    conns.delete(id);
    relay.close(id, conns.values());
  };
  return { relay, got, send, clear, types, close, conns };
}

const config = (humans: string[]) => ({
  size: 5,
  players: [],
  humans: humans.map((id, i) => ({ id, name: id, team: i % 2 })),
});

describe('football relay', () => {
  it('lobby to everyone else with the real host id; challenge / reply / join to `to` only', () => {
    const r = room(['h', 'c', 'x']);
    r.send('h', { type: 'football:lobby', gid: 'g1', host: 'forged', players: [] });
    expect(r.got.get('c')![0]).toMatchObject({ type: 'football:lobby', host: 'h' });
    expect(r.got.get('x')!.length).toBe(1);
    expect(r.got.get('h')!.length).toBe(0);
    r.clear();
    for (const type of ['football:challenge', 'football:reply', 'football:join']) {
      r.send('h', { type, gid: 'g1', from: 'forged', to: 'c' });
      expect(r.got.get('c')!.at(-1)).toMatchObject({ type, from: 'h' });
    }
    expect(r.got.get('x')!.length).toBe(0);
  });

  it('start registers the game for connected humans; input → host; snapshots → members + watchers', () => {
    const r = room(['h', 'c', 'w', 'x']);
    r.send('h', {
      type: 'football:start',
      gid: 'g1',
      host: 'forged',
      config: config(['h', 'c', 'gone']),
    });
    expect(r.types('c')).toEqual(['football:start']);
    expect(r.got.get('c')![0].host).toBe('h');
    expect(r.got.get('x')!.length).toBe(0);
    r.send('w', { type: 'football:watch', gid: 'g1', from: 'forged' });
    expect(r.got.get('h')![0]).toMatchObject({ type: 'football:watch', from: 'w' });
    r.clear();
    // Inputs from a member reach the host only, with the real id
    r.send('c', { type: 'football:input', gid: 'g1', id: 'h', seq: 1, pad: {} });
    expect(r.got.get('h')![0]).toMatchObject({ type: 'football:input', id: 'c' });
    expect(r.got.get('w')!.length).toBe(0);
    // Non-members can't send inputs; the host's own are dropped
    r.send('x', { type: 'football:input', gid: 'g1', id: 'x', seq: 1, pad: {} });
    r.send('w', { type: 'football:input', gid: 'g1', id: 'w', seq: 1, pad: {} });
    expect(r.got.get('h')!.length).toBe(1);
    r.clear();
    r.send('h', { type: 'football:s', gid: 'g1', d: 'AAAA' });
    expect(r.types('c')).toEqual(['football:s']);
    expect(r.types('w')).toEqual(['football:s']);
    expect(r.got.get('x')!.length).toBe(0);
    // Only the host may send snapshots
    r.clear();
    r.send('c', { type: 'football:s', gid: 'g1', d: 'AAAA' });
    expect(r.got.get('w')!.length).toBe(0);
  });

  it('ping → host, pong → that one; start with `to` to that member / watcher only', () => {
    const r = room(['h', 'c', 'w', 'late']);
    r.send('h', { type: 'football:start', gid: 'g1', config: config(['h', 'c', 'late2']) });
    r.send('w', { type: 'football:watch', gid: 'g1' });
    r.clear();
    r.send('c', { type: 'football:ping', gid: 'g1', from: 'x', c: 5 });
    expect(r.got.get('h')![0]).toMatchObject({ type: 'football:ping', from: 'c' });
    r.send('h', { type: 'football:pong', gid: 'g1', to: 'c', c: 5, a: 9 });
    expect(r.types('c')).toEqual(['football:pong']);
    expect(r.got.get('w')!.length).toBe(0);
    r.clear();
    r.send('h', { type: 'football:start', gid: 'g1', to: 'w', config: config(['h', 'c']) });
    expect(r.types('w')).toEqual(['football:start']);
    expect(r.got.get('c')!.length).toBe(0);
    // Someone neither listed nor watching gets nothing
    r.send('h', { type: 'football:start', gid: 'g1', to: 'late', config: config(['h', 'c']) });
    expect(r.got.get('late')!.length).toBe(0);
  });

  it('a late joiner listed in config.humans becomes a member on a start with `to`', () => {
    const r = room(['h', 'c']);
    r.send('h', { type: 'football:start', gid: 'g1', config: config(['h', 'c', 'late']) });
    // late connects after the start
    const got: Record<string, unknown>[] = [];
    r.conns.set('late', { id: 'late', send: s => got.push(JSON.parse(s)) });
    r.send('h', {
      type: 'football:start',
      gid: 'g1',
      to: 'late',
      config: config(['h', 'c', 'late']),
    });
    expect(got.map(m => m.type)).toEqual(['football:start']);
    r.send('late', { type: 'football:input', gid: 'g1', id: 'late', seq: 1, pad: {} });
    expect(r.got.get('h')!.at(-1)).toMatchObject({ type: 'football:input', id: 'late' });
    r.send('h', { type: 'football:s', gid: 'g1', d: 'AA' });
    expect(got.at(-1)!.type).toBe('football:s');
  });

  it('end goes to everyone then forgets the game; a stranger cannot hijack a gid', () => {
    const r = room(['h', 'c', 'x']);
    r.send('h', { type: 'football:start', gid: 'g1', config: config(['h', 'c']) });
    r.send('x', { type: 'football:start', gid: 'g1', config: config(['x', 'c']) });
    expect(r.relay.games.get('g1')!.host).toBe('h');
    r.clear();
    r.send('h', { type: 'football:end', gid: 'g1', winner: 0, score: [1, 0] });
    expect(r.types('c')).toEqual(['football:end']);
    expect(r.relay.games.has('g1')).toBe(false);
  });

  it('leave / socket close: members hear it; the host leaving ends the game', () => {
    const r = room(['h', 'c', 'd', 'w']);
    r.send('h', { type: 'football:start', gid: 'g1', config: config(['h', 'c', 'd']) });
    r.send('w', { type: 'football:watch', gid: 'g1' });
    r.clear();
    r.send('d', { type: 'football:leave', gid: 'g1', id: 'forged' });
    expect(r.got.get('h')![0]).toEqual({ type: 'football:leave', gid: 'g1', id: 'd' });
    expect(r.got.get('w')![0]).toEqual({ type: 'football:leave', gid: 'g1', id: 'd' });
    expect(r.relay.games.has('g1')).toBe(true);
    r.clear();
    r.close('h');
    expect(r.got.get('c')![0]).toEqual({ type: 'football:leave', gid: 'g1', id: 'h' });
    expect(r.got.get('w')![0]).toEqual({ type: 'football:leave', gid: 'g1', id: 'h' });
    expect(r.relay.games.size).toBe(0);
  });

  it('caps games and watchers', () => {
    const ids = ['h', ...Array.from({ length: FOOTBALL_MAX_WATCHERS + 2 }, (_, i) => `w${i}`)];
    const r = room(ids);
    for (let i = 0; i < FOOTBALL_MAX_GAMES + 3; i++)
      r.send('h', { type: 'football:start', gid: `g${i}`, config: config(['h']) });
    expect(r.relay.games.size).toBe(FOOTBALL_MAX_GAMES);
    for (const id of ids.slice(1)) r.send(id, { type: 'football:watch', gid: 'g0' });
    expect(r.relay.games.get('g0')!.watchers.size).toBe(FOOTBALL_MAX_WATCHERS);
  });

  it('ignores junk', () => {
    const r = room(['h', 'c']);
    r.send('h', { type: 'football:s', d: 'x' });
    r.send('h', { type: 7 } as unknown as Record<string, unknown>);
    r.send('h', { type: 'football:start', gid: 'g1', config: { humans: 'no' } });
    expect(r.got.get('c')!.length).toBe(0);
    expect(r.relay.games.size).toBe(0);
  });
});
