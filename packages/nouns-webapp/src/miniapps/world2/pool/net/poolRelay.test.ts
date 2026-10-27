// The Noun Pool relay (packages/nouns-party/src/poolRelay.ts): who gets
// which pool:* message.

import { describe, expect, it } from 'vitest';

import { PoolRelay, type RelayConn } from '../../../../../../nouns-party/src/poolRelay';

function room(ids: string[]) {
  const got = new Map<string, Record<string, unknown>[]>();
  const conns = new Map<string, RelayConn>();
  for (const id of ids) {
    got.set(id, []);
    conns.set(id, { id, send: s => got.get(id)!.push(JSON.parse(s)) });
  }
  const relay = new PoolRelay();
  const send = (from: string, m: Record<string, unknown>) =>
    relay.handle(m, conns.get(from)!, conns.values());
  const clear = () => got.forEach(g => (g.length = 0));
  return { relay, got, send, clear, conns };
}

const config = {
  gid: 'g1',
  seed: 1,
  breaker: 0,
  players: [
    { id: 'h', name: 'H', human: true },
    { id: 'c', name: 'C', human: true },
  ],
};

describe('pool relay', () => {
  it('lobby to everyone else; challenge / reply to one player; sender ids rewritten', () => {
    const r = room(['h', 'c', 'x']);
    r.send('h', { type: 'pool:lobby', at: 'hall', from: 'forged' });
    expect(r.got.get('c')![0]).toMatchObject({ type: 'pool:lobby', from: 'h' });
    expect(r.got.get('x')!.length).toBe(1);
    expect(r.got.get('h')!.length).toBe(0);
    r.clear();
    r.send('h', { type: 'pool:challenge', to: 'c', gid: 'g1' });
    expect(r.got.get('c')![0]).toMatchObject({ type: 'pool:challenge', from: 'h' });
    expect(r.got.get('x')!.length).toBe(0);
  });

  it('start registers the frame; shots go player → host, host → everyone; aim to the frame', () => {
    const r = room(['h', 'c', 'w', 'x']);
    r.send('h', { type: 'pool:start', config });
    expect(r.got.get('c')!.map(m => m.type)).toEqual(['pool:start']);
    expect(r.got.get('x')!.length).toBe(0);
    r.send('w', { type: 'pool:watch', gid: 'g1' });
    expect(r.got.get('h')![0]).toMatchObject({ type: 'pool:watch', from: 'w' });
    r.clear();
    // The client's shot reaches the host only
    r.send('c', { type: 'pool:shot', gid: 'g1', n: 1, input: {} });
    expect(r.got.get('h')!.length).toBe(1);
    expect(r.got.get('w')!.length).toBe(0);
    r.clear();
    // The host's (accepted) shot reaches the client and the watcher
    r.send('h', { type: 'pool:shot', gid: 'g1', n: 1, input: {} });
    expect(r.got.get('c')!.length).toBe(1);
    expect(r.got.get('w')!.length).toBe(1);
    expect(r.got.get('x')!.length).toBe(0);
    r.clear();
    // Watchers and strangers can't shoot or aim
    r.send('w', { type: 'pool:shot', gid: 'g1', n: 1, input: {} });
    r.send('x', { type: 'pool:aim', gid: 'g1', dx: 1, dy: 0, p: 0.5 });
    expect([...r.got.values()].every(g => g.length === 0)).toBe(true);
    r.send('c', { type: 'pool:aim', gid: 'g1', dx: 1, dy: 0, p: 0.5 });
    expect(r.got.get('h')!.length).toBe(1);
    expect(r.got.get('w')!.length).toBe(1);
    r.clear();
    // Only the host sends results; end forgets the frame
    r.send('c', { type: 'pool:result', gid: 'g1', n: 1 });
    expect(r.got.get('w')!.length).toBe(0);
    r.send('h', { type: 'pool:result', gid: 'g1', n: 1 });
    expect(r.got.get('w')!.length).toBe(1);
    r.send('h', { type: 'pool:end', gid: 'g1', winner: 0 });
    expect(r.relay.frames.has('g1')).toBe(false);
  });

  it('a late watcher gets the state from the host only if it asked', () => {
    const r = room(['h', 'c', 'w']);
    r.send('h', { type: 'pool:start', config });
    r.clear();
    r.send('h', { type: 'pool:start', config, to: 'w' });
    expect(r.got.get('w')!.length).toBe(0);
    r.send('w', { type: 'pool:watch', gid: 'g1' });
    r.send('h', { type: 'pool:start', config, to: 'w' });
    expect(r.got.get('w')!.length).toBe(1);
    // Someone else can't take the frame over
    r.send('c', { type: 'pool:start', config });
    expect(r.relay.frames.get('g1')!.host).toBe('h');
  });

  it('a socket closing leaves its frames; the host leaving ends them', () => {
    const r = room(['h', 'c', 'w']);
    r.send('h', { type: 'pool:start', config });
    r.send('w', { type: 'pool:watch', gid: 'g1' });
    r.clear();
    r.relay.close('c', r.conns.values());
    expect(r.got.get('h')![0]).toMatchObject({ type: 'pool:leave', gid: 'g1', id: 'c' });
    expect(r.got.get('w')![0]).toMatchObject({ type: 'pool:leave', id: 'c' });
    expect(r.relay.frames.has('g1')).toBe(true);
    r.relay.close('h', r.conns.values());
    expect(r.relay.frames.has('g1')).toBe(false);
  });
});
