import { describe, expect, it, vi } from 'vitest';

import { ExchangeNet } from './exchangeNet';
import { packMove, type PeerPose } from './wire';

// A stand-in PartySocket: records what's sent, lets the test deliver messages
const { sockets, FakeSocket } = vi.hoisted(() => {
  const sockets: InstanceType<typeof FakeSocket>[] = [];
  class FakeSocket {
    id = 'me';
    readyState = 1;
    sent: string[] = [];
    private on: Record<string, ((e: { data?: string }) => void)[]> = {};
    constructor(public opts: { host: string; room: string }) {
      sockets.push(this);
    }
    addEventListener(t: string, f: (e: { data?: string }) => void) {
      (this.on[t] ??= []).push(f);
    }
    send(m: string) {
      this.sent.push(m);
    }
    close() {}
    emit(t: string, data?: unknown) {
      for (const f of this.on[t] ?? [])
        f({ data: data === undefined ? undefined : JSON.stringify(data) });
    }
  }
  return { sockets, FakeSocket };
});
vi.mock('partysocket', () => ({ default: FakeSocket }));
vi.stubGlobal('WebSocket', { OPEN: 1 });

const ME = 'r:0000aaa';
const pose = (o: Partial<PeerPose> = {}): PeerPose => ({
  x: 1,
  y: 0,
  z: 2,
  yaw: 0,
  anim: 'idle',
  speed: 0,
  name: 'BOB',
  seedKey: '1-2-3-4-5',
  weight: 0,
  tag: 'r:0000bbb',
  ping: null,
  ...o,
});
/** What the relay sends on: world:player with the whitelisted fields. */
const relayed = (id: string, p: PeerPose) => ({
  ...(JSON.parse(packMove(p)) as Record<string, unknown>),
  type: 'world:player',
  id,
});

function connect() {
  const net = new ExchangeNet(() => ME, 'example.test', 'noun-world-v2-exchange');
  net.connect();
  const ws = sockets.at(-1)!;
  ws.emit('open');
  return { net, ws };
}

describe('ExchangeNet', () => {
  it('joins its own room and sends my pose with my public tag', () => {
    const { net, ws } = connect();
    expect(ws.opts.room).toBe('noun-world-v2-exchange');
    net.send(0.2, { ...pose(), name: 'ME' });
    const msg = JSON.parse(ws.sent[0]!) as { type: string; state: string };
    expect(msg.type).toBe('world:move');
    expect(JSON.parse(msg.state)).toMatchObject({ gx: 1, gt: ME, n: 'ME' });
    // Unchanged poses aren't resent every tick
    net.send(0.2, { ...pose(), name: 'ME' });
    expect(ws.sent).toHaveLength(1);
  });

  it('keeps Exchange walkers, ignores plaza riders and itself, drops leavers', () => {
    const { net, ws } = connect();
    const peers = vi.fn();
    net.onPeers = peers;
    ws.emit('message', relayed('p1', pose()));
    ws.emit('message', relayed('me', pose()));
    // A Noun World rider (no gx marker) in the same room isn't one of us
    ws.emit('message', { type: 'world:player', id: 'p2', state: '{"v":2,"a":"idle"}' });
    expect([...net.peers.keys()]).toEqual(['p1']);
    expect(net.peers.get('p1')!.buf.latest).toMatchObject({ name: 'BOB', tag: 'r:0000bbb' });
    ws.emit('message', { type: 'world:leave', id: 'p1' });
    expect(net.peers.size).toBe(0);
    expect(peers).toHaveBeenCalledTimes(2);
  });

  it('an offer ping wakes me only when it is new and meant for me', () => {
    const { net, ws } = connect();
    const pinged = vi.fn();
    net.onPinged = pinged;
    // Someone already in the room with an old ping: a joiner doesn't replay it
    ws.emit('message', {
      type: 'world:sync',
      players: { p1: relayed('p1', pose({ ping: { seq: 3, to: ME } })) },
    });
    expect(pinged).not.toHaveBeenCalled();
    ws.emit('message', relayed('p1', pose({ ping: { seq: 3, to: ME } })));
    expect(pinged).not.toHaveBeenCalled();
    ws.emit('message', relayed('p1', pose({ ping: { seq: 4, to: 'r:0000ccc' } })));
    expect(pinged).not.toHaveBeenCalled();
    ws.emit('message', relayed('p1', pose({ ping: { seq: 5, to: ME } })));
    expect(pinged).toHaveBeenCalledWith('p1');
    // The same ping again (every pose repeats it) doesn't wake me twice
    ws.emit('message', relayed('p1', pose({ ping: { seq: 5, to: ME }, x: 3 })));
    expect(pinged).toHaveBeenCalledTimes(1);
  });

  it('pingOffer goes out in my next pose', () => {
    const { net, ws } = connect();
    net.pingOffer('r:0000bbb');
    net.send(0.2, pose());
    const blob = JSON.parse((JSON.parse(ws.sent.at(-1)!) as { state: string }).state);
    expect(blob.go).toEqual([1, 'r:0000bbb']);
  });

  it('ignores junk', () => {
    const { net, ws } = connect();
    for (const m of ['not json', '{"type":"world:player","id":"x","state":"{bad"}'])
      for (const f of (ws as unknown as { on: Record<string, ((e: { data: string }) => void)[]> })
        .on.message ?? [])
        f({ data: m });
    expect(net.peers.size).toBe(0);
  });
});
