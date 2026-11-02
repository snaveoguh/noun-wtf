import type { FootballMsg } from '../contract';

import { describe, expect, it } from 'vitest';

import { LoopbackHub, NetTransport, type FootballNet } from './transport';

const ping = (c: number): FootballMsg => ({ type: 'football:ping', gid: 'g', from: 'a', c });

describe('football transport', () => {
  it('loopback: latency, per-link order under jitter, deterministic loss', () => {
    const recv = (seed: number) => {
      const hub = new LoopbackHub({ latencyMs: 50, jitterMs: 80, loss: 0.25, seed });
      const a = hub.endpoint('a');
      const b = hub.endpoint('b');
      const got: number[] = [];
      const at: number[] = [];
      b.onMessage(m => {
        if (m.type === 'football:ping') {
          got.push(m.c);
          at.push(hub.now);
        }
      });
      for (let i = 0; i < 200; i++) {
        a.send(ping(i));
        hub.advance(5);
      }
      hub.advance(1000);
      return { got, at, hub };
    };
    const r = recv(4);
    expect(r.got.length).toBeGreaterThan(120);
    expect(r.got.length).toBeLessThan(180);
    expect(r.hub.dropped + r.got.length).toBe(200);
    // In order (TCP-like), never sooner than the latency
    expect([...r.got].sort((x, y) => x - y)).toEqual(r.got);
    expect(r.at[0]).toBeGreaterThanOrEqual(50);
    // Same seed, same run
    expect(recv(4).got).toEqual(r.got);
    expect(recv(5).got).not.toEqual(r.got);
  });

  it('loopback without a relay: `to` goes to that endpoint only; junk is dropped', () => {
    const hub = new LoopbackHub();
    const a = hub.endpoint('a');
    const n = { b: 0, c: 0 };
    hub.endpoint('b').onMessage(() => n.b++);
    hub.endpoint('c').onMessage(() => n.c++);
    a.send({ type: 'football:pong', gid: 'g', to: 'b', c: 1, a: 2 });
    a.send(ping(1));
    a.send({ type: 'football:s', gid: 'g' } as unknown as FootballMsg);
    hub.advance(1);
    expect(n).toEqual({ b: 2, c: 1 });
  });

  it('NetTransport: checks what arrives, sends only while connected', () => {
    const sent: unknown[] = [];
    const net: FootballNet = { myId: 'x1', connected: false, sendFootball: m => sent.push(m) };
    const t = new NetTransport(net);
    const got: FootballMsg[] = [];
    const off = t.onMessage(m => got.push(m));
    t.send(ping(1));
    expect(sent.length).toBe(0);
    net.connected = true;
    t.send(ping(2));
    expect(sent.length).toBe(1);
    expect(t.selfId).toBe('x1');
    net.onFootball!({ type: 'football:ping', gid: 'g', from: 'a', c: 3 });
    net.onFootball!({ type: 'football:ping', gid: 'g' });
    expect(got.length).toBe(1);
    off();
    net.onFootball!({ type: 'football:ping', gid: 'g', from: 'a', c: 3 });
    expect(got.length).toBe(1);
    const offline = new NetTransport({ ...net, connected: true }, true);
    expect(offline.selfId).toBe('me');
    expect(offline.online).toBe(false);
  });
});
