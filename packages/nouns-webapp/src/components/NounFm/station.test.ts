import { describe, expect, it } from 'vitest';

import {
  afterPlay,
  jingleFor,
  parsePlaylist,
  pickNext,
  TALK_EVERY,
  type FmItem,
  type FmJingle,
  type PickState,
} from './station';

const song = (id: string, artist: string): FmItem => ({
  id,
  title: `t-${id}`,
  artist,
  genre: 'dub',
  kind: 'music',
  dur: 200,
});
const talk = (id: string): FmItem => ({ ...song(id, 'KEXP'), kind: 'video' });
const ids = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(11 - prefix.length, '0')}`);

const fresh: PickState = { recent: [], blocked: new Set(), sinceTalk: 0, lastArtist: '' };
/** Deterministic rng cycling through [0, 1). */
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length]!;
};

describe('parsePlaylist', () => {
  it('keeps only well-formed, unique YouTube ids', () => {
    const items = parsePlaylist({
      items: [
        {
          id: 'JtyCtksvSOg',
          title: 'Wandering Eye',
          artist: "Fat Freddy's Drop",
          kind: 'music',
          dur: 300,
        },
        { id: 'JtyCtksvSOg', title: 'dupe' },
        { id: 'not-an-id', title: 'bad' },
        { id: '0PsOJ_fRckg', title: 'KEXP session', artist: 'KEXP', kind: 'video' },
        { id: 'abcdefghijk', kind: 'weird' },
      ],
    });
    expect(items.map(i => i.id)).toEqual(['JtyCtksvSOg', '0PsOJ_fRckg', 'abcdefghijk']);
    expect(items[2]!.kind).toBe('music');
    expect(parsePlaylist(null)).toEqual([]);
  });
});

describe('pickNext', () => {
  it('never returns a blocked or just-played id while others remain', () => {
    const [a, b, c] = ids(3, 'a');
    const items = [song(a!, 'x'), song(b!, 'y'), song(c!, 'z')];
    const s = { ...fresh, recent: [a!], blocked: new Set([b!]) };
    for (const r of [0, 0.4, 0.99]) expect(pickNext(items, s, () => r)?.id).toBe(c);
  });

  it('avoids the artist that just played', () => {
    const [a, b] = ids(2, 'b');
    const items = [song(a!, 'Rhombus'), song(b!, 'Kora')];
    const s = { ...fresh, lastArtist: 'rhombus' };
    expect(pickNext(items, s, () => 0)?.id).toBe(b);
  });

  it('slots a video/podcast in after TALK_EVERY songs, songs otherwise', () => {
    const songs = ids(20, 's').map(id => song(id, id));
    const v = talk(ids(1, 'v')[0]!);
    const items = [...songs, v];
    expect(pickNext(items, { ...fresh, sinceTalk: TALK_EVERY - 1 }, () => 0.99)?.kind).toBe(
      'music',
    );
    expect(pickNext(items, { ...fresh, sinceTalk: TALK_EVERY }, () => 0.5)?.id).toBe(v.id);
  });

  it('relaxes the rules rather than going silent', () => {
    const [a] = ids(1, 'c');
    const items = [song(a!, 'x')];
    expect(pickNext(items, { ...fresh, recent: [a!], lastArtist: 'x' }, () => 0)?.id).toBe(a);
    expect(pickNext(items, { ...fresh, blocked: new Set([a!]) }, () => 0)).toBeNull();
  });
});

describe('afterPlay', () => {
  it('tracks recents (newest first, no dupes) and the songs-since-talk count', () => {
    const [a, b] = ids(2, 'd');
    let s = afterPlay(fresh, song(a!, 'x'));
    s = afterPlay(s, song(b!, 'y'));
    s = afterPlay(s, song(a!, 'x'));
    expect(s.recent).toEqual([a, b]);
    expect(s.sinceTalk).toBe(3);
    expect(afterPlay(s, talk(b!)).sinceTalk).toBe(0);
  });
});

describe('jingleFor', () => {
  const jingles: FmJingle[] = [
    { id: 'j1', title: 'one', sting: '/j1s.mp3', full: '/j1.mp3' },
    { id: 'j2', title: 'two', sting: '/j2s.mp3', full: '/j2.mp3' },
  ];

  it('plays the full interlude between songs and the sting on a skip', () => {
    expect(jingleFor(jingles, false, '', seq(0))?.url).toBe('/j1.mp3');
    expect(jingleFor(jingles, true, '', seq(0))?.url).toBe('/j1s.mp3');
    expect(jingleFor(jingles, false, '', seq(0.9))?.url).toBe('/j2.mp3');
  });

  it("doesn't repeat the last jingle when there's another", () => {
    expect(jingleFor(jingles, true, 'j1', seq(0))?.jingle.id).toBe('j2');
    expect(jingleFor([], false, '', seq(0))).toBeNull();
  });
});
