// The height grid + A* (nav.ts) and the CPU hiders / seekers (bots.ts).

import type { BotCtx, BotSeen } from './bots';
import type { Vec } from './rules';

import { describe, expect, it } from 'vitest';

import { makeBot, sees, thinkBot, viewRange } from './bots';
import { cellOf, findPath, groundAt, hideSpots, makeGrid, type NavGrid } from './nav';

/**
 * A 60 × 60 m test yard (2 m cells): flat floor, a wall along x = 0 from
 * z = −10 to 10 (8 m high), and a 12 m building at x 16..24, z 16..24.
 */
function yard(): NavGrid {
  return makeGrid(-30, -30, 31, 31, 2, (x, z) => {
    if (Math.abs(x) < 1 && Math.abs(z) <= 10) return 8;
    if (x >= 16 && x <= 24 && z >= 16 && z <= 24) return 12;
    return 0;
  });
}

const flatWalk = (path: Vec[] | null) => path !== null && path.every(p => p.y < 0.7);

describe('nav grid', () => {
  it('stores heights and maps world ↔ cells', () => {
    const g = yard();
    expect(groundAt(g, 0, 0)).toBe(8);
    expect(groundAt(g, 10, 10)).toBe(0);
    expect(groundAt(g, 20, 20)).toBe(12);
    expect(cellOf(g, -30, -30)).toEqual([0, 0]);
    expect(cellOf(g, 999, 999)).toEqual([30, 30]);
  });

  it('walks round a wall rather than over it', () => {
    const g = yard();
    const p = findPath(g, { x: -10, z: 0 }, { x: 10, z: 0 });
    expect(p).not.toBeNull();
    expect(flatWalk(p)).toBe(true);
    // It went round an end of the wall
    expect(p!.some(q => Math.abs(q.z) > 10)).toBe(true);
    expect(p!.at(-1)).toMatchObject({ x: 10, z: 0 });
  });

  it('climbs onto a roof when that is where it is going', () => {
    const g = yard();
    const p = findPath(g, { x: 0, z: 26 }, { x: 20, z: 20 });
    expect(p).not.toBeNull();
    expect(p!.at(-1)!.y).toBe(12);
  });

  it('finds sheltered and rooftop hiding spots', () => {
    const s = hideSpots(yard());
    expect(s.some(x => x.roof)).toBe(true);
    expect(s.some(x => !x.roof && x.cover >= 2)).toBe(true);
  });

  it('no path into nowhere', () => {
    const g = makeGrid(0, 0, 4, 4, 2, (x, z) => (x === 4 && z === 4 ? null : 0));
    expect(findPath(g, { x: 0, z: 0 }, { x: 4, z: 4 })).toBeNull();
  });
});

function ctx(g: NavGrid, players: BotSeen[], o: Partial<BotCtx> = {}): BotCtx {
  return {
    grid: g,
    spots: hideSpots(g),
    lobby: { x: -20, y: 0, z: -20 },
    phase: 'hide',
    time: 0,
    skill: 0.6,
    players,
    los: () => true,
    lit: [],
    canPing: () => true,
    sounds: [],
    ...o,
  };
}

function runBot(b: ReturnType<typeof makeBot>, c: BotCtx, secs: number) {
  const acts = [];
  for (let t = 0; t < secs; t += 0.05) {
    const me = c.players.find(p => p.id === b.id);
    if (me) me.pos = b.pos;
    acts.push(...thinkBot(b, 0.05, c));
  }
  return acts;
}

describe('CPU hiders', () => {
  it('run off to a hiding spot away from the start, then crouch', () => {
    const g = yard();
    const b = makeBot('cpu:0', { x: -20, y: 0, z: -20 }, 0, 7);
    const me: BotSeen = { id: 'cpu:0', pos: b.pos, st: 'h', blending: false };
    const c = ctx(g, [me]);
    runBot(b, c, 30);
    expect(Math.hypot(b.pos.x + 20, b.pos.z + 20)).toBeGreaterThan(10);
    expect(b.mode).toBe('hidden');
    expect(b.anim).toBe('crouch');
  });

  it('run from a seeker that comes close with a clear line', () => {
    const g = yard();
    const b = makeBot('cpu:0', { x: 10, y: 0, z: -10 }, 0, 3);
    b.mode = 'hidden';
    b.standing = 'h';
    const me: BotSeen = { id: 'cpu:0', pos: b.pos, st: 'h', blending: true };
    const seeker: BotSeen = { id: 's', pos: { x: 13, y: 0, z: -10 }, st: 's', blending: false };
    const c = ctx(g, [me, seeker], { phase: 'seek' });
    runBot(b, c, 0.3);
    expect(b.mode).toBe('flee');
    runBot(b, c, 6);
    expect(Math.hypot(b.pos.x - 13, b.pos.z + 10)).toBeGreaterThan(8);
  });
});

describe('CPU seekers', () => {
  it('stay put while blindfolded', () => {
    const g = yard();
    const b = makeBot('cpu:1', { x: -20, y: 0, z: -20 }, 0, 1);
    const c = ctx(g, [{ id: 'cpu:1', pos: b.pos, st: 's', blending: false }]);
    runBot(b, c, 5);
    expect(b.pos).toMatchObject({ x: -20, z: -20 });
  });

  it('see a hider in front of them, not one behind a wall or crouched far off', () => {
    const b = makeBot('cpu:1', { x: 0, y: 0, z: 0 }, 0, 1); // facing +z
    const g = yard();
    const front: BotSeen = { id: 'a', pos: { x: 0, y: 0, z: 10 }, st: 'h', blending: false };
    const behind: BotSeen = { id: 'b', pos: { x: 0, y: 0, z: -10 }, st: 'h', blending: false };
    const crouched: BotSeen = {
      id: 'c',
      pos: { x: 0, y: 0, z: viewRange(0.6, true) + 2 },
      st: 'h',
      blending: true,
    };
    const c = ctx(g, []);
    expect(sees(b, front, c)).toBe(true);
    expect(sees(b, behind, c)).toBe(false);
    expect(sees(b, crouched, c)).toBe(false);
    expect(sees(b, front, { ...c, los: () => false })).toBe(false);
    // Very close behind: heard
    expect(sees(b, { ...behind, pos: { x: 0, y: 0, z: -3 } }, c)).toBe(true);
  });

  it('chase a hider they see and ask to tag when close', () => {
    const g = yard();
    const b = makeBot('cpu:1', { x: -10, y: 0, z: -24 }, 0, 1);
    const hider: BotSeen = { id: 'h', pos: { x: -10, y: 0, z: -14 }, st: 'h', blending: false };
    const c = ctx(g, [{ id: 'cpu:1', pos: b.pos, st: 's', blending: false }, hider], {
      phase: 'seek',
    });
    const acts = runBot(b, c, 6);
    expect(acts.some(a => a.a === 'tag' && a.id === 'h')).toBe(true);
  });

  it('go and check a lit door', () => {
    const g = yard();
    const b = makeBot('cpu:1', { x: -10, y: 0, z: -24 }, 0, 1);
    const c = ctx(g, [{ id: 'cpu:1', pos: b.pos, st: 's', blending: false }], {
      phase: 'seek',
      lit: [{ id: 'door', x: 10, z: -24 }],
    });
    const acts = runBot(b, c, 10);
    expect(acts.some(a => a.a === 'door' && a.door === 'door')).toBe(true);
  });

  it('ping after a while with nobody seen', () => {
    const g = yard();
    const b = makeBot('cpu:1', { x: -10, y: 0, z: -24 }, 0, 1);
    const c = ctx(g, [{ id: 'cpu:1', pos: b.pos, st: 's', blending: false }], {
      phase: 'seek',
      los: () => false,
    });
    const acts = runBot(b, c, 15);
    expect(acts.some(a => a.a === 'ping')).toBe(true);
  });
});
