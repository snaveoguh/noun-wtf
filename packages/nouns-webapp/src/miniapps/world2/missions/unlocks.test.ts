import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { riderId } from '../net/Stats';

import { MISSION_BY_ID } from './defs';
import { emptyState, MISSIONS_VERSION } from './progress';
import { bigDropUnlocked, doorUnlocked, RIDER_KEY, savedMissions, STORE_PREFIX } from './unlocks';

const RIDER = 'rider-test-1';
const NOW = Date.now() - 60_000;

function save(state: unknown, rider = RIDER) {
  localStorage.setItem(RIDER_KEY, rider);
  localStorage.setItem(STORE_PREFIX + rider, JSON.stringify(state));
}

/** Everything the deepest door needs before it (and the chains before those). */
function chainBefore(id: string): string[] {
  const out: string[] = [];
  const walk = (m: string) => {
    for (const a of MISSION_BY_ID[m]!.after) {
      walk(a);
      if (!out.includes(a)) out.push(a);
    }
  };
  walk(id);
  return out;
}

describe('bigDropUnlocked', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('is locked with no rider, no saved missions, or a fresh rider', () => {
    expect(bigDropUnlocked()).toBe(false);
    localStorage.setItem(RIDER_KEY, RIDER);
    expect(bigDropUnlocked()).toBe(false);
    save({ v: MISSIONS_VERSION, met: { oracle: NOW }, done: { 'wake-up': NOW } });
    expect(bigDropUnlocked()).toBe(false);
  });

  it('unlocks once the deepest door is done', () => {
    save({ v: MISSIONS_VERSION, met: {}, done: { 'deepest-door': NOW } });
    expect(bigDropUnlocked()).toBe(true);
  });

  it('unlocks when the Keymaker has sent you (met, the missions before the door done)', () => {
    const before = chainBefore('deepest-door');
    expect(before.length).toBeGreaterThan(0);
    const done = Object.fromEntries(before.map(id => [id, NOW]));
    save({ v: MISSIONS_VERSION, met: { oracle: NOW }, done });
    expect(bigDropUnlocked()).toBe(false); // not met the Keymaker yet
    save({ v: MISSIONS_VERSION, met: { oracle: NOW, keymaker: NOW }, done });
    expect(bigDropUnlocked()).toBe(true);
    // ...but not with one of them missing
    const missing = { ...done };
    delete missing[before[before.length - 1]!];
    save({ v: MISSIONS_VERSION, met: { oracle: NOW, keymaker: NOW }, done: missing });
    expect(bigDropUnlocked()).toBe(false);
  });

  it('reads only the current rider', () => {
    save({ v: MISSIONS_VERSION, met: {}, done: { 'deepest-door': NOW } }, 'someone-else');
    localStorage.setItem(RIDER_KEY, RIDER);
    expect(bigDropUnlocked()).toBe(false);
  });

  it('survives corrupt or forged storage (locked, never throws)', () => {
    localStorage.setItem(RIDER_KEY, RIDER);
    for (const raw of ['{not json', 'null', '[]', '"deepest-door"', '42', '{"v":1,"done":7}']) {
      localStorage.setItem(STORE_PREFIX + RIDER, raw);
      expect(bigDropUnlocked(), raw).toBe(false);
    }
    // An old version, a bad timestamp, an unknown mission: all dropped by the sanitizer
    save({ v: 0, met: {}, done: { 'deepest-door': NOW } });
    expect(bigDropUnlocked()).toBe(false);
    save({ v: MISSIONS_VERSION, met: {}, done: { 'deepest-door': 'yesterday' } });
    expect(bigDropUnlocked()).toBe(false);
    save({ v: MISSIONS_VERSION, met: {}, done: { 'deepest-door': Date.now() + 10 * 86_400_000 } });
    expect(bigDropUnlocked()).toBe(false);
    save({ v: MISSIONS_VERSION, met: {}, done: { 'not-a-mission': NOW } });
    expect(savedMissions()).toEqual(emptyState());
  });

  it('is locked when storage itself throws', () => {
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('blocked');
    };
    try {
      expect(bigDropUnlocked()).toBe(false);
    } finally {
      Storage.prototype.getItem = get;
    }
  });

  it('uses the same rider id key as the game', () => {
    const id = riderId();
    expect(localStorage.getItem(RIDER_KEY)).toBe(id);
  });
});

describe('doorUnlocked', () => {
  it('matches the door mission', () => {
    const s = emptyState();
    expect(doorUnlocked(s)).toBe(false);
    s.done['deepest-door'] = NOW;
    expect(doorUnlocked(s)).toBe(true);
  });
});
