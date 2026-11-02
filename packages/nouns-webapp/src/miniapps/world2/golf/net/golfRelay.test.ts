// The Noun Golf relay (packages/nouns-party/src/golfRelay.ts): who gets
// which golf:* message.

import { describe, expect, it } from 'vitest';

import { GolfRelay, type RelayConn } from '../../../../../../nouns-party/src/golfRelay';

function room(ids: string[]) {
  const got = new Map<string, Record<string, unknown>[]>();
  const conns = new Map<string, RelayConn>();
  for (const id of ids) {
    got.set(id, []);
    conns.set(id, { id, send: s => got.get(id)!.push(JSON.parse(s)) });
  }
  const relay = new GolfRelay();
  const send = (from: string, m: Record<string, unknown>) =>
    relay.handle(m, conns.get(from)!, conns.values());
  const clear = () => got.forEach(g => (g.length = 0));
  return { relay, got, send, clear };
}

const config = {
  gid: 'g1',
  seed: 1,
  holes: [1, 2],
  wind: 0.5,
  players: [
    { id: 'h', name: 'H', human: true },
    { id: 'c', name: 'C', human: true },
    { id: 'cpu:1', name: 'CPU', human: false },
  ],
};

describe('golf relay', () => {
  it('lobby to everyone else; invite / reply to one; ids rewritten', () => {
    const r = room(['h', 'c', 'x']);
    r.send('h', { type: 'golf:lobby', from: 'forged' });
    expect(r.got.get('c')![0]).toMatchObject({ type: 'golf:lobby', from: 'h' });
    expect(r.got.get('x')!.length).toBe(1);
    expect(r.got.get('h')!.length).toBe(0);
    r.clear();
    r.send('h', { type: 'golf:invite', to: 'c', gid: 'g1' });
    expect(r.got.get('c')![0]).toMatchObject({ type: 'golf:invite', from: 'h' });
    expect(r.got.get('x')!.length).toBe(0);
  });

  it('a round: start to members, shots via the host, results from the host only', () => {
    const r = room(['h', 'c', 'x']);
    r.send('h', { type: 'golf:start', config });
    expect(r.got.get('c')![0]).toMatchObject({ type: 'golf:start', host: 'h' });
    expect(r.got.get('x')!.length).toBe(0);
    r.clear();
    r.send('c', { type: 'golf:shot', gid: 'g1', n: 0, swing: {} });
    expect(r.got.get('h')![0]).toMatchObject({ type: 'golf:shot', from: 'c' });
    expect(r.got.get('x')!.length).toBe(0);
    r.clear();
    r.send('h', { type: 'golf:shot', gid: 'g1', n: 0, swing: {} });
    expect(r.got.get('c')!.length).toBe(1);
    r.clear();
    r.send('c', { type: 'golf:result', gid: 'g1', n: 0 });
    expect(r.got.get('h')!.length).toBe(0); // only the host sends results
    r.send('x', { type: 'golf:shot', gid: 'g1', n: 1, swing: {} });
    expect(r.got.get('h')!.length).toBe(0); // not a member
  });

  it('the host leaving ends the round; a socket closing leaves it', () => {
    const r = room(['h', 'c']);
    r.send('h', { type: 'golf:start', config });
    r.clear();
    r.relay.close('c', [{ id: 'h', send: s => r.got.get('h')!.push(JSON.parse(s)) }]);
    expect(r.got.get('h')![0]).toMatchObject({ type: 'golf:leave', gid: 'g1', id: 'c' });
    r.send('h', { type: 'golf:leave', gid: 'g1' });
    expect(r.relay.frames.size).toBe(0);
  });
});
