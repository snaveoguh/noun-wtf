import { describe, expect, it } from 'vitest';

import { EXCHANGE_ROOM, PeerBuffer, packMove, parseMove, type PeerPose } from './wire';

const pose = (o: Partial<PeerPose> = {}): PeerPose => ({
  x: 1.23456,
  y: 0.3,
  z: -7.5,
  yaw: 1.2,
  anim: 'walk',
  speed: 2.4,
  name: 'noun 42',
  seedKey: '0-12-40-123-7',
  weight: 0.25,
  tag: 'r:0a1b2c3',
  ping: null,
  ...o,
});

/** What the deployed relay forwards: only its whitelisted fields (server.ts world:move). */
function relay(msg: string): Record<string, unknown> {
  const d = JSON.parse(msg) as Record<string, unknown>;
  const keep = [
    'x',
    'y',
    'direction',
    'state',
    'hp',
    'nounId',
    'seedKey',
    'scaleX',
    'attackType',
    'attackTimer',
    'airborneY',
    'flipRotation',
  ];
  const out: Record<string, unknown> = { type: 'world:player', id: 'abc' };
  for (const k of keep) out[k] = d[k];
  return out;
}

describe('exchange3d wire format', () => {
  it('has its own room, apart from the plaza', () => {
    expect(EXCHANGE_ROOM).not.toBe('nouns-world-v2');
  });

  it('round-trips a pose through the whitelisting relay', () => {
    const msg = packMove(pose({ ping: { seq: 3, to: 'r:zz99xx1' } }));
    expect(JSON.parse(msg).type).toBe('world:move');
    const p = parseMove(relay(msg))!;
    expect(p).not.toBeNull();
    expect(p.x).toBeCloseTo(1.235, 3);
    expect(p.z).toBe(-7.5);
    expect(p.y).toBe(0.3);
    expect(p.yaw).toBe(1.2);
    expect(p).toMatchObject({
      anim: 'walk',
      name: 'noun 42',
      seedKey: '0-12-40-123-7',
      weight: 0.25,
      tag: 'r:0a1b2c3',
      ping: { seq: 3, to: 'r:zz99xx1' },
    });
  });

  it('reads as a Noun World v2 foot pose (q is the yaw), so Net.ts-style readers cope', () => {
    const blob = JSON.parse(JSON.parse(packMove(pose())).state);
    expect(blob.v).toBe(2);
    expect(blob.m).toBe('foot');
    const [, qy, , qw] = blob.q;
    expect(2 * Math.atan2(qy, qw)).toBeCloseTo(1.2, 2);
  });

  it('never sends anything but a public tag (no raw rider ids)', () => {
    const raw = '3f2a9c1e-77aa-4bd1-9a10-0123456789ab';
    const msg = packMove(pose({ tag: raw, ping: { seq: 1, to: raw } }));
    expect(msg).not.toContain(raw);
    const p = parseMove(relay(msg))!;
    expect(p.tag).toBe('');
    expect(p.ping).toBeNull();
  });

  it('ignores plaza riders, junk and oversize blobs', () => {
    const plaza = relay(packMove(pose()));
    plaza.state = JSON.stringify({ v: 2, a: 'skate_push' });
    expect(parseMove(plaza)).toBeNull();
    expect(parseMove({ state: 'idle' })).toBeNull();
    expect(parseMove({ state: '{nope' })).toBeNull();
    expect(parseMove({ state: `{"v":2,"gx":1,"n":"${'x'.repeat(3000)}"}` })).toBeNull();
    const odd = relay(packMove(pose()));
    odd.seedKey = '<script>';
    odd.state = JSON.stringify({
      v: 2,
      gx: 1,
      a: 'fly',
      sp: 1e9,
      w: 7,
      n: 'a\u0000b',
      gt: 'bot:x',
      go: ['x', 'r:1'],
    });
    expect(parseMove(odd)).toMatchObject({
      anim: 'idle',
      speed: 20,
      weight: 1,
      name: 'ab',
      seedKey: '0-0-0-0-0',
      tag: '',
      ping: null,
    });
  });

  it('plays a peer back between its samples, yaw the short way round', () => {
    const b = new PeerBuffer();
    expect(b.sample(0)).toBeNull();
    b.push(1000, pose({ x: 0, yaw: Math.PI - 0.1 }));
    b.push(1100, pose({ x: 1, yaw: -Math.PI + 0.1 }));
    const mid = b.sample(1050)!;
    expect(mid.x).toBeCloseTo(0.5);
    expect(Math.abs(Math.abs(mid.yaw) - Math.PI)).toBeLessThan(0.01);
    expect(b.sample(5000)!.x).toBe(1);
    expect(b.sample(0)!.x).toBe(0);
    for (let i = 0; i < 20; i++) b.push(2000 + i, pose());
    expect(b.latest).not.toBeNull();
  });
});
