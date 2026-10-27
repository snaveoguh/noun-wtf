// The hide & seek codec: good messages through, junk dropped.

import { describe, expect, it } from 'vitest';

import { makeConfig, newGame, snapshot } from '../rules';

import { readConfig, readMsg, readSnap } from './codec';

const players = [
  { id: 'a', name: 'Ann', cpu: false, seed: '1-2-3-4-5' },
  { id: 'cpu:0', name: 'Peeky Pete', cpu: true },
];
const config = makeConfig({ gid: 'hs-1', seed: 9, players });

describe('codec', () => {
  it('round-trips a config and a real snapshot', () => {
    expect(readConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
    const snap = { ...snapshot(newGame(config)), bots: [['cpu:0', 1, 0, 2, 0.5, 2]] };
    expect(readSnap(JSON.parse(JSON.stringify(snap)))).toEqual(snap);
  });

  it('round-trips every message type', () => {
    const msgs = [
      {
        type: 'hideseek:lobby',
        from: 'h',
        open: { gid: 'g', host: 'h', hostName: 'H', n: 3, max: 12, state: 'lobby', names: ['H'] },
        hide: ['x'],
      },
      { type: 'hideseek:lobby', open: null },
      { type: 'hideseek:join', gid: 'g', from: 'b' },
      { type: 'hideseek:roster', gid: 'g', host: 'h', players, cpu: 2 },
      { type: 'hideseek:start', gid: 'hs-1', host: 'h', config },
      { type: 'hideseek:act', gid: 'g', a: 'tag', target: 'b', from: 'a' },
      { type: 'hideseek:act', gid: 'g', a: 'whistle' },
      { type: 'hideseek:leave', gid: 'g', id: 'a' },
      { type: 'hideseek:end', gid: 'g' },
    ];
    for (const m of msgs) expect(readMsg(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });

  it('drops junk', () => {
    expect(readMsg(null)).toBeNull();
    expect(readMsg({ type: 'hideseek:nope', gid: 'g' })).toBeNull();
    expect(readMsg({ type: 'hideseek:join' })).toBeNull();
    expect(readMsg({ type: 'hideseek:act', gid: 'g', a: 'teleport' })).toBeNull();
    expect(readMsg({ type: 'hideseek:join', gid: '<script>' })).toBeNull();
    // Too many players, a duplicate, a bad order
    const many = Array.from({ length: 13 }, (_, i) => ({ id: `p${i}`, name: 'x', cpu: false }));
    expect(readMsg({ type: 'hideseek:roster', gid: 'g', players: many, cpu: 0 })).toBeNull();
    expect(readConfig({ ...config, players: [players[0], players[0]] })).toBeNull();
    expect(readConfig({ ...config, order: ['a', 'a'] })).toBeNull();
    // A start whose config isn't for that game
    expect(readMsg({ type: 'hideseek:start', gid: 'other', config })).toBeNull();
    // Snapshots: bad phase, NaN, a bad standing
    const snap = { ...snapshot(newGame(config)), bots: [] };
    expect(readSnap({ ...snap, ph: 'party' })).toBeNull();
    expect(readSnap({ ...snap, t: NaN })).toBeNull();
    expect(readSnap({ ...snap, st: [['a', 'x']] })).toBeNull();
    expect(readSnap({ ...snap, bots: [['cpu:0', 1, 2, 3, 4, 99]] })).toBeNull();
  });

  it('trims names and strips control characters', () => {
    const m = readMsg({
      type: 'hideseek:roster',
      gid: 'g',
      players: [{ id: 'a', name: 'a\u0007very long name that keeps on going', cpu: false }],
      cpu: 0,
    });
    expect(m?.type === 'hideseek:roster' && m.players[0]!.name).toBe('avery long name that kee');
  });
});
