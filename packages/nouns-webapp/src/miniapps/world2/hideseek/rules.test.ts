// Hide & Seek rules: phases and timers, role rotation, tags (reach, walls,
// buildings), abilities, wins, scores, people leaving.

import type { HsPlayer } from './contract';
import type { Door, HsWorld, Vec } from './rules';

import { describe, expect, it } from 'vitest';

import {
  HIDE_S,
  INSIDE_BEACON_S,
  PING_CD,
  POINTS,
  REVEAL_S,
  TAG_CD,
  WHISTLE_CD,
  WHISTLE_MAX,
} from './contract';
import {
  blindfolded,
  checkDoor,
  checkTag,
  drop,
  hiders,
  makeConfig,
  newGame,
  ping,
  seekerCount,
  seekersFor,
  shuffled,
  snapshot,
  step,
  tag,
  whistle,
  type HsState,
} from './rules';

const P = (id: string, cpu = false): HsPlayer => ({ id, name: id.toUpperCase(), cpu });

/** A world with movable positions, an optional wall test and doors. */
function world(
  pos: Record<string, Vec>,
  wall: (a: Vec, b: Vec) => boolean = () => false,
  doors: Door[] = [],
): HsWorld & { pos2: Record<string, Vec> } {
  return {
    pos2: pos,
    pos: id => pos[id] ?? null,
    los: (a, b) => !wall(a, b),
    door: p =>
      p.y < 3000 ? null : (doors.find(d => Math.hypot(d.x - p.x, d.z - p.z) < 10) ?? null),
  };
}

function game(n = 4, o: Partial<Parameters<typeof makeConfig>[0]> = {}) {
  const players = Array.from({ length: n }, (_, i) => P(`p${i}`));
  const cfg = makeConfig({
    gid: 'g',
    seed: 42,
    players,
    hideS: 10,
    seekS: 60,
    first: ['p0'],
    ...o,
  });
  return newGame(cfg);
}

/** Run the clock in 0.1 s steps. */
function run(s: HsState, secs: number, w: HsWorld) {
  const n = Math.round(secs / 0.1);
  for (let i = 0; i < n; i++) step(s, 0.1, w);
  // (sums of 0.1 land a hair short of whole seconds)
  step(s, 1e-6, w);
}

const seekerIds = (s: HsState) => [...s.players.values()].filter(p => p.st === 's').map(p => p.id);

describe('setup', () => {
  it('shuffles deterministically', () => {
    expect(shuffled(['a', 'b', 'c', 'd', 'e'], 1)).toEqual(shuffled(['a', 'b', 'c', 'd', 'e'], 1));
    expect(shuffled(['a', 'b', 'c', 'd', 'e'], 1).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('caps seekers at 2 and always leaves someone to hide', () => {
    expect(seekerCount(2, 2)).toBe(1);
    expect(seekerCount(3, 2)).toBe(2);
    expect(seekerCount(12, 5)).toBe(2);
    expect(seekerCount(8, 0)).toBe(1);
  });

  it('puts "first" ids first and "last" ids last in the play order', () => {
    const players = ['a', 'b', 'c', 'd'].map(id => P(id));
    expect(makeConfig({ gid: 'g', seed: 3, players, first: ['c'] }).order[0]).toBe('c');
    expect(makeConfig({ gid: 'g', seed: 3, players, last: ['a'] }).order.at(-1)).toBe('a');
  });

  it('caps players at 12 and rounds at 9', () => {
    const many = Array.from({ length: 20 }, (_, i) => P(`x${i}`));
    const c = makeConfig({ gid: 'g', seed: 1, players: many, rounds: 50 });
    expect(c.players).toHaveLength(12);
    expect(c.rounds).toBe(9);
  });
});

describe('phases and timers', () => {
  it('runs hide → seek → reveal → next round → … → over', () => {
    const s = game(3, { rounds: 2 });
    const w = world({
      p0: { x: 0, y: 0, z: 0 },
      p1: { x: 50, y: 0, z: 0 },
      p2: { x: -50, y: 0, z: 0 },
    });
    expect(s.phase).toBe('hide');
    expect(s.t).toBe(10);
    run(s, 10.05, w);
    expect(s.phase).toBe('seek');
    run(s, 60, w);
    expect(s.phase).toBe('reveal');
    expect(s.win).toBe('hiders');
    run(s, REVEAL_S, w);
    expect(s.phase).toBe('hide');
    expect(s.round).toBe(1);
    run(s, 10 + 60 + REVEAL_S + 0.2, w);
    expect(s.phase).toBe('over');
  });

  it('uses the default hide time from the contract', () => {
    const s = newGame(makeConfig({ gid: 'g', seed: 1, players: [P('a'), P('b')] }));
    expect(s.t).toBe(HIDE_S);
  });

  it("blindfolds only the round's starting seekers, only while hiding", () => {
    const s = game(3);
    expect(blindfolded(s, 'p0')).toBe(true);
    expect(blindfolded(s, 'p1')).toBe(false);
    run(s, 10.05, world({}));
    expect(blindfolded(s, 'p0')).toBe(false);
  });
});

describe('role rotation', () => {
  it('gives each round the next seekers in the play order', () => {
    const order = ['a', 'b', 'c', 'd', 'e'];
    const all = new Set(order);
    expect(seekersFor(order, 0, 1, all)).toEqual(['a']);
    expect(seekersFor(order, 1, 1, all)).toEqual(['b']);
    expect(seekersFor(order, 4, 1, all)).toEqual(['e']);
    expect(seekersFor(order, 5, 1, all)).toEqual(['a']);
    expect(seekersFor(order, 1, 2, all)).toEqual(['c', 'd']);
    expect(seekersFor(order, 2, 2, all)).toEqual(['e', 'a']);
  });

  it('skips players who have left', () => {
    expect(seekersFor(['a', 'b', 'c'], 1, 1, new Set(['a', 'c']))).toEqual(['c']);
  });

  it('never makes everyone a seeker', () => {
    expect(seekersFor(['a', 'b'], 0, 2, new Set(['a', 'b']))).toEqual(['a']);
  });

  it('rotates across a real game and resets the found', () => {
    const s = game(3, { rounds: 3 });
    const w = world({
      p0: { x: 0, y: 0, z: 0 },
      p1: { x: 1, y: 0, z: 0 },
      p2: { x: 90, y: 0, z: 0 },
    });
    const seen: string[][] = [seekerIds(s)];
    run(s, 10.05, w);
    expect(tag(s, 'p0', 'p1', w)).toBe('ok');
    expect(s.players.get('p1')!.st).toBe('f');
    run(s, 60 + REVEAL_S + 0.3, w);
    seen.push(seekerIds(s));
    expect(s.players.get('p1')!.st).not.toBe('f');
    run(s, 10 + 60 + REVEAL_S + 0.3, w);
    seen.push(seekerIds(s));
    expect(new Set(seen.flat()).size).toBe(3);
  });
});

describe('tags', () => {
  const pos = () => ({
    p0: { x: 0, y: 0, z: 0 },
    p1: { x: 2, y: 0, z: 0 },
    p2: { x: 30, y: 0, z: 0 },
    p3: { x: 0, y: 5, z: 1 },
  });

  it('is only allowed in the seek phase', () => {
    const s = game();
    const w = world(pos());
    expect(checkTag(s, 'p0', 'p1', w)).toBe('phase');
  });

  it('needs a seeker tagging a hider', () => {
    const s = game();
    const w = world(pos());
    run(s, 10.05, w);
    expect(checkTag(s, 'p1', 'p2', w)).toBe('not-seeker');
    expect(checkTag(s, 'p0', 'p0', w)).toBe('not-hider');
  });

  it("checks reach on the host's positions, not the asker's word", () => {
    const s = game();
    const w = world(pos());
    run(s, 10.05, w);
    expect(checkTag(s, 'p0', 'p2', w)).toBe('far');
    // Up on a roof above them: too high
    expect(checkTag(s, 'p0', 'p3', w)).toBe('far');
    expect(checkTag(s, 'p0', 'p1', w)).toBe('ok');
  });

  it('refuses a tag through a wall', () => {
    const s = game();
    const w = world(pos(), () => true);
    run(s, 10.05, w);
    expect(tag(s, 'p0', 'p1', w)).toBe('wall');
    expect(s.players.get('p1')!.st).toBe('h');
  });

  it('rate-limits tries per seeker', () => {
    const s = game();
    const p = pos();
    const w = world(p);
    run(s, 10.05, w);
    expect(tag(s, 'p0', 'p2', w)).toBe('far');
    expect(tag(s, 'p0', 'p1', w)).toBe('cooldown');
    run(s, TAG_CD + 0.1, w);
    expect(tag(s, 'p0', 'p1', w)).toBe('ok');
  });

  it('infects: the found hider seeks and can tag', () => {
    const s = game();
    const p = pos();
    const w = world(p);
    run(s, 10.05, w);
    expect(tag(s, 'p0', 'p1', w)).toBe('ok');
    p.p2 = { x: 3, y: 0, z: 0 };
    expect(tag(s, 'p1', 'p2', w)).toBe('ok');
    expect(s.players.get('p2')!.foundBy).toBe('p1');
  });

  it("doesn't know where someone is: no tag", () => {
    const s = game();
    const w = world({ p0: { x: 0, y: 0, z: 0 } });
    run(s, 10.05, w);
    expect(checkTag(s, 'p0', 'p1', w)).toBe('unknown');
  });
});

describe('buildings', () => {
  const door: Door = { id: 'd1', x: 50, z: 50 };
  const inside = { x: 50, y: 4000, z: 52 };

  it('a seeker walking into the same building finds the hiders in there', () => {
    const s = game(3);
    const p: Record<string, Vec> = {
      p0: { x: 0, y: 0, z: 0 },
      p1: { ...inside },
      p2: { x: -40, y: 0, z: 0 },
    };
    const w = world(p, () => false, [door]);
    run(s, 10.05, w);
    expect(s.players.get('p1')!.st).toBe('h');
    p.p0 = { x: 49, y: 4000, z: 49 };
    step(s, 0.1, w);
    expect(s.players.get('p1')!.st).toBe('f');
    expect(s.events.some(e => e.k === 'tag' && e.inside === true)).toBe(true);
  });

  it('one inside, one out: no tag', () => {
    const s = game(3);
    const w = world(
      { p0: { x: 50, y: 0, z: 51 }, p1: { ...inside }, p2: { x: 0, y: 0, z: 0 } },
      () => false,
      [door],
    );
    run(s, 10.05, w);
    expect(checkTag(s, 'p0', 'p1', w)).toBe('far');
  });

  it('lights the door of a hider inside too long, until they come out', () => {
    const s = game(3, { seekS: 120 });
    const p: Record<string, Vec> = {
      p0: { x: 0, y: 0, z: 0 },
      p1: { ...inside },
      p2: { x: -40, y: 0, z: 0 },
    };
    const w = world(p, () => false, [door]);
    run(s, 10.05 + INSIDE_BEACON_S - 11, w);
    expect(s.lit.size).toBe(0);
    run(s, 2, w);
    expect([...s.lit.keys()]).toEqual(['d1']);
    expect(snapshot(s).bc).toEqual([['d1', 50, 50]]);
    p.p1 = { x: 50, y: 0, z: 46 };
    step(s, 0.1, w);
    expect(s.lit.size).toBe(0);
  });

  it('a CPU seeker checking a door finds everyone inside it', () => {
    const s = game(4);
    const w = world(
      {
        p0: { x: 50, y: 0, z: 48 },
        p1: { ...inside },
        p2: { x: 51, y: 4000, z: 50 },
        p3: { x: 0, y: 0, z: 0 },
      },
      () => false,
      [door],
    );
    run(s, 10.05, w);
    // (they've already been caught by nobody: the seeker's outside)
    expect(checkDoor(s, 'p0', 'd1', w).sort()).toEqual(['p1', 'p2']);
    expect(hiders(s).map(h => h.id)).toEqual(['p3']);
    expect(checkDoor(s, 'p3', 'd1', w)).toEqual([]);
  });
});

describe('abilities', () => {
  it('whistles: seek phase, hiders only, cooldown, a cap, points', () => {
    const s = game(3, { seekS: 600 });
    const w = world({});
    expect(whistle(s, 'p1')).toBe(false);
    run(s, 10.05, w);
    expect(whistle(s, 'p0')).toBe(false);
    expect(whistle(s, 'p1')).toBe(true);
    expect(whistle(s, 'p1')).toBe(false);
    for (let i = 1; i < WHISTLE_MAX + 2; i++) {
      run(s, WHISTLE_CD + 0.1, w);
      whistle(s, 'p1');
    }
    expect(s.players.get('p1')!.whistles).toBe(WHISTLE_MAX);
    expect(s.players.get('p1')!.score).toBe(WHISTLE_MAX * POINTS.whistle);
  });

  it('pings a random hider for a seeker, then waits', () => {
    const s = game(4);
    const w = world({});
    run(s, 10.05, w);
    expect(ping(s, 'p0')).toBeNull(); // a short wait at the start of the seek
    run(s, 8.2, w);
    const h = ping(s, 'p0');
    expect(['p1', 'p2', 'p3']).toContain(h);
    expect(ping(s, 'p0')).toBeNull();
    run(s, PING_CD + 0.2, w);
    expect(ping(s, 'p0')).not.toBeNull();
    expect(ping(s, 'p1')).toBeNull();
  });
});

describe('wins and scores', () => {
  it('seekers win the moment the last hider is found', () => {
    const s = game(3);
    const p: Record<string, Vec> = {
      p0: { x: 0, y: 0, z: 0 },
      p1: { x: 1, y: 0, z: 0 },
      p2: { x: 2, y: 0, z: 1 },
    };
    const w = world(p);
    run(s, 10.05, w);
    run(s, 20, w);
    tag(s, 'p0', 'p1', w);
    run(s, TAG_CD + 0.1, w);
    tag(s, 'p0', 'p2', w);
    expect(s.phase).toBe('reveal');
    expect(s.win).toBe('seekers');
    const sc = (id: string) => s.players.get(id)!.score;
    expect(sc('p0')).toBe(2 * POINTS.tag + POINTS.sweep);
    // 20 s hidden before being found: 2 points
    expect(sc('p1')).toBe(2);
    expect(s.reveal!.map(r => r.id).sort()).toEqual(['p0', 'p1', 'p2']);
    expect(s.reveal!.find(r => r.id === 'p2')).toMatchObject({ x: 2, z: 1, st: 'f' });
  });

  it('hiders win if anyone lasts the clock', () => {
    const s = game(3);
    const p: Record<string, Vec> = {
      p0: { x: 0, y: 0, z: 0 },
      p1: { x: 1, y: 0, z: 0 },
      p2: { x: 80, y: 0, z: 0 },
    };
    const w = world(p);
    run(s, 10.05, w);
    tag(s, 'p0', 'p1', w);
    run(s, 60, w);
    expect(s.win).toBe('hiders');
    expect(s.players.get('p2')!.score).toBe(6 + POINTS.survived);
    const snap = snapshot(s);
    expect(snap.win).toBe('hiders');
    expect(snap.rv).toHaveLength(3);
  });
});

describe('people leaving', () => {
  it('the last seeker leaving: a random hider takes over', () => {
    const s = game(4);
    drop(s, 'p0');
    const sk = seekerIds(s);
    expect(sk).toHaveLength(1);
    expect(s.events.some(e => e.k === 'reassign' && e.id === sk[0])).toBe(true);
    expect(s.phase).toBe('hide');
  });

  it('the last hider leaving ends the round for the seekers', () => {
    const s = game(3);
    const w = world({});
    run(s, 10.05, w);
    drop(s, 'p1');
    expect(s.phase).toBe('seek');
    drop(s, 'p2');
    expect(s.phase).toBe('over'); // one player left
  });

  it('a hider leaving mid-seek, others still hiding: nothing else changes', () => {
    const s = game(4);
    run(s, 10.05, world({}));
    drop(s, 'p2');
    expect(s.phase).toBe('seek');
    expect(hiders(s)).toHaveLength(2);
  });

  it('the snapshot hands its events over once', () => {
    const s = game(3);
    expect(snapshot(s).ev.length).toBeGreaterThan(0);
    expect(snapshot(s).ev).toEqual([]);
  });
});
