import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  addSet,
  emptyFmState,
  FM_GAP_MS,
  ownerTag,
  setEnd,
  setLength,
  type FmTrack,
} from '../../../../../nouns-party/src/fmStation';

import {
  creditFor,
  fetchLibrary,
  libSetKey,
  nextFreeSlot,
  parseLibrary,
  publishSet,
  type LibSet,
} from './library';
import { NounFm } from './NounFm';
import { localTransport } from './transport';

const yt = (n: number, dur = 200): FmTrack => ({
  src: { kind: 'youtube', id: `vid${String(n).padStart(8, '0')}` },
  title: `Track ${n}`,
  artist: 'Artist',
  dur,
});

const lib = (over: Partial<LibSet> = {}): LibSet => ({
  id: '0123456789abcdef',
  dj: 'DJ pip',
  name: 'Sunset session',
  tracks: [yt(1), yt(2)],
  by: 'tagtagtagtagtag1',
  at: 1,
  lastAt: 1,
  plays: 0,
  ...over,
});

const NOW = Date.UTC(2026, 9, 19, 12);
const KEY = 'kkkkkkkkkkkkkkkkkkkkkkkk';

describe('nextFreeSlot', () => {
  const len = setLength([yt(1)]);

  it('starts now on a free station', () => {
    expect(nextFreeSlot([], len, NOW)).toBe(NOW);
  });

  it('waits for the live set, and skips past back-to-back ones', () => {
    const s = emptyFmState();
    expect(addSet(s, { dj: 'a', startAt: NOW - 60_000, tracks: [yt(1)] }, 'ka', NOW, 'a')).toBe(
      null,
    );
    const liveEnd = setEnd(s.sets[0]!);
    expect(addSet(s, { dj: 'b', startAt: liveEnd, tracks: [yt(2)] }, 'kb', NOW, 'b')).toBe(null);
    const slot = nextFreeSlot(s.sets, len, NOW)!;
    expect(slot).toBe(setEnd(s.sets[1]!));
    // and the station takes that booking
    expect(addSet(s, { dj: 'c', startAt: slot, tracks: [yt(3)] }, 'kc', NOW, 'c')).toBe(null);
  });

  it('fits into a gap long enough, not one too short', () => {
    const s = emptyFmState();
    addSet(s, { dj: 'a', startAt: NOW + 60_000, tracks: [yt(1)] }, 'ka', NOW, 'a');
    // a 3m24s set won't fit in the minute before a's set
    expect(nextFreeSlot(s.sets, len, NOW)).toBe(setEnd(s.sets[0]!));
    // a 10 s set will
    expect(nextFreeSlot(s.sets, FM_GAP_MS + 5000, NOW)).toBe(NOW);
  });

  it('ignores the set this booking replaces', () => {
    const s = emptyFmState();
    addSet(s, { dj: 'me', startAt: NOW + 1000, tracks: [yt(1)] }, 'me', NOW, 'mine');
    expect(nextFreeSlot(s.sets, len, NOW, 'mine')).toBe(NOW);
  });

  it('gives up past today', () => {
    const s = emptyFmState();
    const day = 24 * 3600_000;
    s.sets.push({
      id: 'x',
      dj: 'x',
      name: 'x',
      owner: 'x',
      startAt: NOW + day - 1000,
      tracks: [yt(1)],
    });
    // too long for the day before that set: the next slot is past today
    expect(nextFreeSlot(s.sets, day, NOW)).toBe(null);
    expect(nextFreeSlot(s.sets, len, NOW)).toBe(NOW);
  });
});

describe('creditFor', () => {
  it("puts the player on the booking and the DJ's credit in the name", () => {
    const c = creditFor(lib(), 'zoe', false);
    expect(c.dj).toBe('zoe');
    expect(c.name).toBe('Sunset session - DJ pip');
  });

  it('fits long names into the station limits and keeps the credit', () => {
    const c = creditFor(
      lib({ name: 'a very long set name indeed ok', dj: 'DJ longname here' }),
      'p',
      false,
    );
    expect(c.name.length).toBeLessThanOrEqual(32);
    expect(c.name.endsWith('- DJ longname here')).toBe(true);
    // and the station accepts it unchanged
    const s = emptyFmState();
    addSet(s, { ...c, startAt: NOW, tracks: [yt(1)] }, 'k', NOW, 'id');
    expect(s.sets[0]!.name).toBe(c.name);
  });

  it('leaves your own set as it is', () => {
    expect(creditFor(lib(), 'zoe', true)).toEqual({ dj: 'DJ pip', name: 'Sunset session' });
  });
});

describe('parseLibrary / libSetKey', () => {
  it('drops sets with bad tracks and keeps good ones', () => {
    const got = parseLibrary({
      sets: [
        lib(),
        lib({
          id: 'b',
          tracks: [{ ...yt(1), src: { kind: 'direct', url: 'http://x.com/a.mp3' } }],
        }),
        null,
        { id: 'c' },
      ],
    });
    expect(got.map(s => s.id)).toEqual(['0123456789abcdef']);
    expect(parseLibrary(null)).toEqual([]);
  });

  it('treats sets as the same regardless of case and track titles', () => {
    expect(libSetKey('DJ pip', 'Sunset', [yt(1)])).toBe(
      libSetKey('dj PIP', 'sunset', [{ ...yt(1), title: 'renamed' }]),
    );
    expect(libSetKey('DJ pip', 'Sunset', [yt(1)])).not.toBe(libSetKey('DJ pip', 'Sunset', [yt(2)]));
  });
});

describe('library client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads the library and reports the server reason on errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ sets: [lib()], total: 3 }))),
    );
    const r = await fetchLibrary();
    expect(r.ok && r.sets.length === 1 && r.total === 3).toBe(true);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'slow down' }), { status: 429 })),
    );
    expect(await publishSet(KEY, { dj: 'a', name: 'b', tracks: [yt(1)] })).toEqual({
      ok: false,
      reason: 'slow down',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>', { status: 200 })),
    );
    expect((await fetchLibrary()).ok).toBe(false);
  });
});

describe('NounFm.bookSet', () => {
  it("resolves with the station's answer (ok, then the reason it refused)", async () => {
    localStorage.clear();
    const fm = new NounFm(localTransport());
    // one frame says hello to the (in-tab) station
    fm.update(0.2, new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
    await new Promise(r => setTimeout(r, 0));
    fm.update(0.2, new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
    expect(fm.view.ready).toBe(true);
    const now = fm.serverNow();
    expect(await fm.bookSet('me', 'mine', now, [yt(1)])).toEqual({ ok: true });
    const r = await fm.bookSet('me', 'mine', now, [{ ...yt(2), dur: 9999 }]);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.msg).toContain('capped');
    expect(fm.view.state?.sets[0]?.owner).toBe(ownerTag(fm.libraryKey()));
    fm.dispose();
  });
});
