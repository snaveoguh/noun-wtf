// The Noun Breaks relay (packages/nouns-party/src/breakRelay.ts): who gets
// what, sender ids rewritten, battles forgotten when they end.

import { beforeEach, describe, expect, it } from 'vitest';

import { BreakRelay, type RelayConn } from '../../../../../../nouns-party/src/breakRelay';

let inbox: Map<string, Record<string, unknown>[]>;
let conns: RelayConn[];

function connect(...ids: string[]) {
  for (const id of ids) {
    inbox.set(id, []);
    conns.push({ id, send: (s: string) => inbox.get(id)!.push(JSON.parse(s)) });
  }
}
const conn = (id: string) => conns.find(c => c.id === id)!;
const got = (id: string) => inbox.get(id)!;
const clear = () => {
  for (const k of inbox.keys()) inbox.set(k, []);
};

const CONFIG = {
  gid: 'g1',
  seed: 1,
  crewSize: 2,
  rounds: 1,
  turnBars: 4,
  bpm: 100,
  dancers: [
    { id: 'h', name: 'H', crew: 0, human: true },
    { id: 'a', name: 'A', crew: 0, human: true },
    { id: 'b', name: 'B', crew: 1, human: true },
    { id: 'gone', name: 'G', crew: 1, human: true }, // not connected
    { id: 'cpu:0', name: 'C', crew: 1, human: false },
  ],
};

let relay: BreakRelay;
const send = (from: string, m: Record<string, unknown>) => relay.handle(m, conn(from), conns);

beforeEach(() => {
  inbox = new Map();
  conns = [];
  relay = new BreakRelay();
  connect('h', 'a', 'b', 'x', 's');
});

function start() {
  send('h', { type: 'break:start', host: 'spoofed', config: CONFIG, at: -3, lag: 0.15 });
}

describe('BreakRelay', () => {
  it('lobby goes to everyone else, from rewritten', () => {
    send('a', { type: 'break:lobby', at: true, from: 'h', name: 'A' });
    expect(got('a')).toEqual([]);
    for (const id of ['h', 'b', 'x', 's'])
      expect(got(id)).toEqual([{ type: 'break:lobby', at: true, from: 'a', name: 'A' }]);
  });

  it('challenge / reply go only to `to`, from rewritten', () => {
    send('h', { type: 'break:challenge', to: 'b', from: 'x', crewSize: 1, gid: 'g1' });
    expect(got('b')).toEqual([
      { type: 'break:challenge', to: 'b', from: 'h', crewSize: 1, gid: 'g1' },
    ]);
    expect(got('x')).toEqual([]);
    send('b', { type: 'break:reply', to: 'h', ok: true });
    expect(got('h')).toEqual([{ type: 'break:reply', to: 'h', ok: true, from: 'b' }]);
    send('b', { type: 'break:reply', to: 'nobody', ok: true });
    send('b', { type: 'break:reply', ok: true });
    expect(got('h')).toHaveLength(1);
  });

  it('start registers the battle and goes to connected human members only', () => {
    start();
    expect(relay.battles.get('g1')).toMatchObject({ host: 'h' });
    expect([...relay.battles.get('g1')!.members].sort()).toEqual(['a', 'b', 'h']);
    expect(got('a')[0]).toMatchObject({ type: 'break:start', host: 'h' });
    expect(got('b')).toHaveLength(1);
    expect(got('x')).toEqual([]);
    expect(got('h')).toEqual([]);
    // Someone else can't take the battle over
    clear();
    send('x', { type: 'break:start', config: CONFIG });
    expect(relay.battles.get('g1')!.host).toBe('h');
    expect(got('a')).toEqual([]);
  });

  it('inputs and pings go to the host only (from members; pings from spectators too), ids rewritten', () => {
    start();
    clear();
    send('a', { type: 'break:input', gid: 'g1', i: { id: 'b', key: 'up', t: 1.2 } });
    expect(got('h')).toEqual([
      { type: 'break:input', gid: 'g1', i: { id: 'a', key: 'up', t: 1.2 } },
    ]);
    expect(got('b')).toEqual([]);
    send('x', { type: 'break:input', gid: 'g1', i: { id: 'x', key: 'up', t: 1.2 } }); // not in it
    send('a', { type: 'break:input', gid: 'nope', i: { id: 'a', key: 'up', t: 1.2 } });
    send('a', { type: 'break:input', gid: 'g1', i: 'junk' });
    expect(got('h')).toHaveLength(1);
    send('a', { type: 'break:ping', gid: 'g1', c: 5, from: 'b' });
    expect(got('h').at(-1)).toEqual({ type: 'break:ping', gid: 'g1', c: 5, from: 'a' });
    send('x', { type: 'break:ping', gid: 'g1', c: 5 });
    expect(got('h')).toHaveLength(2);
  });

  it('pongs go from the host to that member or spectator only', () => {
    start();
    clear();
    send('h', { type: 'break:pong', gid: 'g1', to: 'a', c: 5, a: 1 });
    expect(got('a')).toEqual([{ type: 'break:pong', gid: 'g1', to: 'a', c: 5, a: 1 }]);
    send('h', { type: 'break:pong', gid: 'g1', to: 'x', c: 5, a: 1 }); // not in it
    send('b', { type: 'break:pong', gid: 'g1', to: 'a', c: 5, a: 99 }); // not the host
    expect(got('x')).toEqual([]);
    expect(got('a')).toHaveLength(1);
  });

  it('watch adds a spectator; the host answers it alone; snapshots reach it', () => {
    start();
    clear();
    send('s', { type: 'break:watch', gid: 'g1', from: 'zzz' });
    expect(got('h')).toEqual([{ type: 'break:watch', gid: 'g1', from: 's' }]);
    send('h', { type: 'break:start', config: CONFIG, to: 's', at: 4 });
    expect(got('s')).toHaveLength(1);
    expect(got('a')).toEqual([]);
    send('h', { type: 'break:start', config: CONFIG, to: 'x' }); // x isn't watching
    expect(got('x')).toEqual([]);
    send('s', { type: 'break:ping', gid: 'g1', c: 1 });
    expect(got('h').at(-1)).toMatchObject({ type: 'break:ping', from: 's' });
    send('h', { type: 'break:s', gid: 'g1', state: {} });
    for (const id of ['a', 'b', 's']) expect(got(id).at(-1)).toMatchObject({ type: 'break:s' });
    expect(got('x')).toEqual([]);
    // Only the host sends snapshots; a watch on nothing does nothing
    clear();
    send('a', { type: 'break:s', gid: 'g1', state: {} });
    send('x', { type: 'break:watch', gid: 'nope' });
    for (const id of ['h', 'b', 's', 'x']) expect(got(id)).toEqual([]);
  });

  it('end goes to everyone in it and forgets the battle', () => {
    start();
    send('s', { type: 'break:watch', gid: 'g1' });
    clear();
    send('h', { type: 'break:end', gid: 'g1', winner: 1, totals: [1, 2] });
    for (const id of ['a', 'b', 's'])
      expect(got(id)).toEqual([{ type: 'break:end', gid: 'g1', winner: 1, totals: [1, 2] }]);
    expect(relay.battles.size).toBe(0);
  });

  it('a member leaving or dropping is announced with its real id; the host leaving ends it', () => {
    start();
    send('s', { type: 'break:watch', gid: 'g1' });
    clear();
    send('a', { type: 'break:leave', gid: 'g1', id: 'h' });
    for (const id of ['h', 'b', 's'])
      expect(got(id)).toEqual([{ type: 'break:leave', gid: 'g1', id: 'a' }]);
    expect(relay.battles.get('g1')!.members.has('a')).toBe(false);
    clear();
    relay.close(
      'b',
      conns.filter(c => c.id !== 'b'),
    );
    expect(got('h')).toEqual([{ type: 'break:leave', gid: 'g1', id: 'b' }]);
    // A spectator leaving is quiet
    clear();
    send('s', { type: 'break:leave', gid: 'g1' });
    expect(got('h')).toEqual([]);
    send('s', { type: 'break:watch', gid: 'g1' });
    clear();
    relay.close(
      'h',
      conns.filter(c => c.id !== 'h'),
    );
    expect(got('s')).toEqual([{ type: 'break:leave', gid: 'g1', id: 'h' }]);
    expect(relay.battles.size).toBe(0);
  });

  it('ignores junk', () => {
    send('a', { type: 'break:start' });
    send('a', { type: 'break:start', config: { gid: 'g2' } });
    send('a', { type: 'break:input', gid: 7 });
    send('a', { nope: true });
    expect(relay.battles.size).toBe(0);
    for (const id of ['h', 'b', 'x', 's']) expect(got(id)).toEqual([]);
  });
});
