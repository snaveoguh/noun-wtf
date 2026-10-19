import { describe, expect, it } from 'vitest';

import { MISSION_BY_ID, MISSIONS, NPCS, validateMissions } from './defs';
import {
  activeMissions,
  apply,
  emptyState,
  mergeServer,
  postable,
  sanitizeState,
  unlockedFor,
  waitingToMeet,
  type MissionState,
} from './progress';

const NOW = Date.UTC(2026, 9, 14);

/** A state that's met everyone and done `ids`. */
function withDone(...ids: string[]): MissionState {
  const s = emptyState();
  for (const n of Object.keys(NPCS) as (keyof typeof NPCS)[]) s.met[n] = NOW;
  for (const id of ids) s.done[id] = NOW;
  return s;
}

const kickflip = { t: 'combo', tricks: ['Kickflip'], nj: false, ud: false } as const;

describe('mission data', () => {
  it('every chain points at real missions, ids are unique, every NPC is a real Noun seed', () => {
    expect(new Set(MISSIONS.map(m => m.id)).size).toBe(MISSIONS.length);
    for (const m of MISSIONS) for (const a of m.after) expect(MISSION_BY_ID[a]).toBeDefined();
    for (const n of Object.values(NPCS)) {
      expect(n.seeds.length).toBe(n.nouns.length);
      for (const seed of n.seeds) expect(seed).toHaveLength(5);
    }
    expect(NPCS.twins.nouns).toContain(911);
    expect(NPCS.oracle.seeds[0][3]).toBe(65); // crystal ball
  });

  it('The One is legendary at 10,000 km/h, Déjà vu sits below it at 1,000', () => {
    expect(MISSION_BY_ID['the-one']!.tier).toBe(4);
    expect(MISSION_BY_ID['the-one']!.obj).toEqual({ k: 'record', key: 'kmh', min: 10_000 });
    expect(MISSION_BY_ID['deja-vu']!.obj).toEqual({ k: 'record', key: 'kmh', min: 1000 });
  });
});

describe('mission progress', () => {
  it('nothing moves before you meet the Oracle; she opens everyone else', () => {
    const s = emptyState();
    expect(apply(s, kickflip, NOW)).toEqual([]);
    expect(waitingToMeet(s)).toEqual(['oracle']);
    apply(s, { t: 'met', npc: 'oracle' }, NOW);
    expect(apply(s, kickflip, NOW).map(m => m.id)).toEqual(['wake-up']);
    // Every other character now has a first mission waiting
    expect(waitingToMeet(s).sort()).toEqual(
      ['baller', 'captain', 'courier', 'dj', 'keymaker', 'twins', 'writer'].sort(),
    );
    // ...but their missions only count once you've talked to them
    expect(apply(s, { t: 'fm' }, NOW)).toEqual([]);
    apply(s, { t: 'met', npc: 'dj' }, NOW);
    expect(apply(s, { t: 'fm' }, NOW).map(m => m.id)).toEqual(['hear-the-signal']);
  });

  it('a heelflip is not a kickflip, a bailed combo never arrives, a Double Kickflip is', () => {
    const s = withDone();
    expect(apply(s, { t: 'combo', tricks: ['Heelflip'], nj: false, ud: false }, NOW)).toEqual([]);
    expect(
      apply(s, { t: 'combo', tricks: ['Ollie', 'Double Kickflip'], nj: false, ud: false }, NOW).map(
        m => m.id,
      ),
    ).toEqual(['wake-up']);
  });

  it('chains: one signal finishes one step, not the next one too', () => {
    const s = withDone('wake-up');
    expect(apply(s, { t: 'tag', color: '#4BEA69' }, NOW).map(m => m.id)).toEqual(['leave-a-mark']);
    expect(apply(s, { t: 'tag', color: '#f3322c' }, NOW)).toEqual([]);
    expect(apply(s, { t: 'tag', color: '#4BEA69' }, NOW).map(m => m.id)).toEqual(['code-green']);
  });

  it('running totals add up; bests keep the max', () => {
    const s = withDone('wake-up', 'hear-the-signal');
    for (let i = 0; i < 179; i++) apply(s, { t: 'fmRide', dt: 1 }, NOW);
    expect(s.done['stay-tuned']).toBeUndefined();
    expect(apply(s, { t: 'fmRide', dt: 1 }, NOW).map(m => m.id)).toEqual(['stay-tuned']);
    apply(s, { t: 'streak', s: 200 }, NOW);
    apply(s, { t: 'streak', s: 100 }, NOW);
    expect(s.prog.unbroken).toBe(200);
    expect(apply(s, { t: 'streak', s: 300 }, NOW).map(m => m.id)).toEqual(['unbroken']);
  });

  it('Jersey line only counts combos landed in Noun Jersey', () => {
    const s = withDone('wake-up', 'ride-with-the-crew');
    const five = ['Ollie', 'Kickflip', 'Heelflip', '50-50', 'Manual'];
    expect(apply(s, { t: 'combo', tricks: five, nj: false, ud: false }, NOW)).toEqual([]);
    expect(apply(s, { t: 'combo', tricks: five, nj: true, ud: false }, NOW).map(m => m.id)).toEqual(
      ['jersey-line'],
    );
  });

  it('timed and NPC-driven missions only finish from their own events', () => {
    const s = withDone('wake-up');
    expect(apply(s, { t: 'delivered', id: 'other' }, NOW)).toEqual([]);
    expect(apply(s, { t: 'delivered', id: 'special-delivery' }, NOW).map(m => m.id)).toEqual([
      'special-delivery',
    ]);
    expect(apply(s, { t: 'raceWon', id: 'outrun-the-twins' }, NOW).map(m => m.id)).toEqual([
      'outrun-the-twins',
    ]);
    expect(apply(s, { t: 'hoops', win: false }, NOW).map(m => m.id)).toEqual(['play-the-game']);
    expect(apply(s, { t: 'hoops', win: false }, NOW)).toEqual([]);
    expect(apply(s, { t: 'hoops', win: true }, NOW).map(m => m.id)).toEqual(['take-the-court']);
  });
});

describe('record missions: server-accepted values only', () => {
  it('a client speed, however high, never finishes one', () => {
    const s = withDone('wake-up', 'free-your-mind', 'deja-vu');
    apply(s, { t: 'speed', kmh: 50_000, surface: 'track' }, NOW);
    for (const sig of [kickflip, { t: 'streak', s: 9999 }, { t: 'udHang', s: 99 }] as const)
      apply(s, sig, NOW);
    expect(s.done['the-one']).toBeUndefined();
    expect(apply(s, { t: 'server', best: { kmh: 9_999 } }, NOW)).toEqual([]);
    expect(apply(s, { t: 'server', best: { kmh: 10_000.4 } }, NOW).map(m => m.id)).toEqual([
      'the-one',
    ]);
  });

  it('hang time comes from the server too', () => {
    const s = withDone('wake-up');
    expect(apply(s, { t: 'udHang', s: 30 }, NOW)).toEqual([]);
    expect(apply(s, { t: 'server', best: { airS: 10.2 } }, NOW).map(m => m.id)).toEqual([
      'free-your-mind',
    ]);
  });

  it('300 on grass needs both the grass (client) and the saved speed (server)', () => {
    const s = withDone('wake-up', 'special-delivery');
    // Saved 400 km/h, but never that fast on grass: no
    expect(apply(s, { t: 'server', best: { kmh: 400 } }, NOW)).toEqual([]);
    apply(s, { t: 'speed', kmh: 310, surface: 'track' }, NOW);
    expect(apply(s, { t: 'server', best: { kmh: 400 } }, NOW)).toEqual([]);
    apply(s, { t: 'speed', kmh: 305, surface: 'grass' }, NOW);
    expect(apply(s, { t: 'server', best: { kmh: 400 } }, NOW).map(m => m.id)).toEqual([
      'there-is-no-road',
    ]);
  });
});

describe('persistence', () => {
  it('round-trips through JSON', () => {
    const s = withDone('wake-up', 'leave-a-mark');
    s.prog.unbroken = 120;
    s.title = 'wake-up';
    s.grassKmh = 120;
    s.server = { kmh: 400 };
    expect(sanitizeState(JSON.parse(JSON.stringify(s)), NOW)).toEqual(s);
  });

  it('drops junk: unknown ids, bad numbers, a title not earned, other versions', () => {
    const s = sanitizeState(
      {
        v: 1,
        met: { oracle: NOW, nobody: NOW, dj: 'soon' },
        done: { 'wake-up': NOW, 'made-up': NOW, 'the-one': NaN },
        prog: { unbroken: -5, 'stay-tuned': 30, nope: 3 },
        title: 'the-one',
        grassKmh: 'fast',
      },
      NOW,
    );
    expect(s.met).toEqual({ oracle: NOW });
    expect(s.done).toEqual({ 'wake-up': NOW });
    expect(s.prog).toEqual({ 'stay-tuned': 30 });
    expect(s.title).toBeNull();
    expect(s.grassKmh).toBe(0);
    expect(sanitizeState({ v: 99, done: { 'wake-up': NOW } }, NOW).done).toEqual({});
    expect(sanitizeState('nope', NOW)).toEqual(emptyState());
  });

  it('server missions merge in (earliest time wins) and count as having met the character', () => {
    const s = emptyState();
    s.done['wake-up'] = NOW;
    const fresh = mergeServer(s, { 'wake-up': NOW - 5, 'leave-a-mark': NOW - 1, bogus: 1 });
    expect(fresh.map(m => m.id)).toEqual(['leave-a-mark']);
    expect(s.done).toEqual({ 'wake-up': NOW - 5, 'leave-a-mark': NOW - 1 });
    expect(s.met.writer).toBe(NOW - 1);
    expect(activeMissions(s).map(m => m.id)).toContain('code-green');
    expect(unlockedFor(s, 'dj')?.id).toBe('hear-the-signal');
  });
});

describe('server validation (validateMissions)', () => {
  it('keeps known ids with sane times and complete chains', () => {
    const out = validateMissions(
      { 'wake-up': NOW, 'leave-a-mark': NOW + 1, 'code-green': NOW + 2 },
      undefined,
      {},
      NOW + 10,
    );
    expect(Object.keys(out).sort()).toEqual(['code-green', 'leave-a-mark', 'wake-up']);
  });

  it('drops unknown ids, future / ancient / fractional times, broken chains', () => {
    const out = validateMissions(
      {
        'made-up': NOW,
        'wake-up': NOW + 3_600_000,
        'leave-a-mark': 5,
        'hear-the-signal': NOW + 0.5,
        'code-green': NOW,
      },
      undefined,
      {},
      NOW,
    );
    expect(out).toEqual({});
  });

  it('record missions need the row’s accepted records, whatever the client says', () => {
    const chain = {
      'wake-up': NOW,
      'free-your-mind': NOW,
      'deja-vu': NOW,
      'the-one': NOW,
    };
    expect(Object.keys(validateMissions(chain, undefined, { airS: 3, kmh: 20_000 }, NOW))).toEqual([
      'wake-up',
    ]);
    expect(
      Object.keys(validateMissions(chain, undefined, { airS: 10, kmh: 1500 }, NOW)).sort(),
    ).toEqual(['deja-vu', 'free-your-mind', 'wake-up']);
  });

  it('never removes what the row already holds, never rewrites its times', () => {
    const prev = { 'wake-up': NOW - 100 };
    expect(validateMissions({ 'wake-up': NOW }, prev, {}, NOW)).toEqual(prev);
    expect(validateMissions('junk', prev, {}, NOW)).toEqual(prev);
    expect(validateMissions([1, 2], prev, {}, NOW)).toEqual(prev);
  });
});

describe('cutscene seen-flags', () => {
  it('persist through storage, junk and unknown scenes dropped', () => {
    const s = emptyState();
    expect(s.seen).toEqual({});
    s.seen.oracle = NOW;
    s.seen.door = NOW + 5;
    const back = sanitizeState(JSON.parse(JSON.stringify(s)), NOW);
    expect(back.seen).toEqual({ oracle: NOW, door: NOW + 5 });
    const junk = sanitizeState(
      { ...s, seen: { oracle: 'yes', twins: -4, 'made-up': NOW, one: NOW } },
      NOW,
    );
    expect(junk.seen).toEqual({ one: NOW });
    expect(sanitizeState({ ...s, seen: [1, 2] }, NOW).seen).toEqual({});
  });

  it('older saves without them load with none seen', () => {
    const old: Partial<MissionState> = { ...emptyState() };
    delete old.seen;
    expect(sanitizeState(old, NOW).seen).toEqual({});
  });

  it('never ride along with the missions posted to the server', () => {
    const s = emptyState();
    s.seen.oracle = NOW;
    s.done['wake-up'] = NOW;
    s.met.oracle = NOW;
    expect(Object.keys(postable(s))).toEqual(['wake-up']);
  });
});
