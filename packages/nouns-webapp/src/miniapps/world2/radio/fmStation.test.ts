// NOUN FM station rules (packages/nouns-party/src/fmStation.ts): link
// validation, queue rules, DJ sets, and what's on air when.

import { describe, expect, it } from 'vitest';

import {
  addEntry,
  addSet,
  advance,
  cancelSet,
  classifyUrl,
  cleanName,
  cleanText,
  emptyFmState,
  FM_GAP_MS,
  FM_PER_RIDER,
  FM_QUEUE_MAX,
  loadState,
  moveEntry,
  nextChange,
  onAir,
  ownerTag,
  removeEntry,
  setEnd,
  skipCurrent,
  validSrc,
  validTrack,
  type FmState,
  type FmTrack,
} from '../../../../../nouns-party/src/fmStation';

const T0 = Date.UTC(2026, 9, 14, 12, 0, 0);
const MIN = 60_000;

let n = 0;
const direct = (name = `t${n++}`, dur = 120): FmTrack => ({
  src: { kind: 'direct', url: `https://cdn.example.org/fm/${name}.mp3` },
  title: name,
  artist: 'tester',
  dur,
});
const yt = (id: string, dur = 200): FmTrack => ({
  src: { kind: 'youtube', id },
  title: id,
  artist: 'yt',
  dur,
});

function add(s: FmState, t: FmTrack, owner: string, now: number, id = `e${n++}`) {
  return addEntry(s, t, owner, owner, now, id);
}

describe('classifyUrl', () => {
  it('takes YouTube watch / short / shorts / embed links as a video id only', () => {
    for (const u of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ?si=abc',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    ]) {
      const c = classifyUrl(u);
      expect(c, u).toEqual({ ok: true, src: { kind: 'youtube', id: 'dQw4w9WgXcQ' } });
    }
  });

  it('rejects YouTube playlists, channels and bad ids', () => {
    for (const u of [
      'https://www.youtube.com/playlist?list=PL123',
      'https://www.youtube.com/@somechannel',
      'https://www.youtube.com/watch?v=short',
      'https://youtu.be/',
    ])
      expect(classifyUrl(u).ok, u).toBe(false);
  });

  it('rejects YouTube audio extraction, rippers, proxies and raw googlevideo streams', () => {
    for (const u of [
      'https://rr3---sn-abc.googlevideo.com/videoplayback?expire=1&mime=audio%2Fwebm',
      'https://www.y2mate.com/youtube-mp3/dQw4w9WgXcQ',
      'https://ytmp3.cc/en13/dl/abc.mp3',
      'https://loader.to/api/button/?url=https://youtu.be/dQw4w9WgXcQ&f=mp3',
      'https://co.wuk.sh/api/json', // cobalt
      'https://cobalt.tools/dl/abc.mp3',
      'https://yewtu.be.invidious.example/latest_version?id=dQw4w9WgXcQ&itag=140',
      'https://pipedapi.kavin.rocks/streams/dQw4w9WgXcQ',
      'https://evil.example/convert.mp3?src=https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://evil.example/youtube/dQw4w9WgXcQ.mp3',
      'https://cdn.example.org/yt-dlp/out.m4a',
    ]) {
      const c = classifyUrl(u);
      expect(c.ok, u).toBe(false);
      if (!c.ok) expect(c.reason, u).toMatch(/YouTube/);
    }
  });

  it('takes Audius track permalinks, not playlists / albums / profiles', () => {
    expect(classifyUrl('https://audius.co/artist-1/some-track-123')).toEqual({
      ok: true,
      src: { kind: 'audius', id: '', url: 'https://audius.co/artist-1/some-track-123' },
    });
    expect(classifyUrl('https://audius.co/artist-1/playlist/mix').ok).toBe(false);
    expect(classifyUrl('https://audius.co/artist-1/album/lp').ok).toBe(false);
    expect(classifyUrl('https://audius.co/artist-1').ok).toBe(false);
    expect(classifyUrl('http://audius.co/a/b').ok).toBe(false);
  });

  it('takes https links to audio files, strips the fragment', () => {
    for (const ext of ['mp3', 'ogg', 'm4a', 'opus', 'wav', 'flac', 'aac', 'oga'])
      expect(classifyUrl(`https://cdn.example.org/a/song.${ext}#t=3`)).toEqual({
        ok: true,
        src: { kind: 'direct', url: `https://cdn.example.org/a/song.${ext}` },
      });
    expect(classifyUrl('https://cdn.example.org/a/song.MP3?sig=1').ok).toBe(true);
  });

  it('rejects unknown hosts / pages, http, private hosts, logins, junk', () => {
    for (const u of [
      'https://soundcloud.com/artist/track',
      'https://open.spotify.com/track/abc',
      'https://example.org/page.html',
      'https://example.org/stream',
      'http://cdn.example.org/song.mp3',
      'https://localhost/song.mp3',
      'https://127.0.0.1/song.mp3',
      'https://192.168.1.10/song.mp3',
      'https://[::1]/song.mp3',
      'https://printer.local/song.mp3',
      'https://intranet/song.mp3',
      'https://user:pw@cdn.example.org/song.mp3',
      'javascript:alert(1)//.mp3',
      'data:audio/mp3;base64,AAAA',
      'ftp://cdn.example.org/song.mp3',
      'not a url',
      '',
      `https://cdn.example.org/${'a'.repeat(600)}.mp3`,
    ])
      expect(classifyUrl(u).ok, u).toBe(false);
    expect(classifyUrl(42).ok).toBe(false);
  });

  it('re-checks sources from the wire', () => {
    expect(validSrc({ kind: 'youtube', id: 'dQw4w9WgXcQ' })).not.toBeNull();
    expect(validSrc({ kind: 'youtube', id: 'x' })).toBeNull();
    expect(validSrc({ kind: 'audius', id: 'aB3x', url: 'https://audius.co/a/b' })).not.toBeNull();
    expect(validSrc({ kind: 'audius', id: '', url: 'https://audius.co/a/b' })).toBeNull();
    expect(validSrc({ kind: 'audius', id: 'aB3x', url: 'https://evil.example/a/b' })).toBeNull();
    expect(validSrc({ kind: 'direct', url: 'https://x.googlevideo.com/a.mp3' })).toBeNull();
    expect(validSrc({ kind: 'stream', url: 'https://cdn.example.org/a.mp3' })).toBeNull();
  });
});

describe('text + tracks', () => {
  it('cleans names and free text', () => {
    expect(cleanName('<b>DJ ⌐◨-◨</b>')).toBe('bDJ ⌐◨-◨b');
    expect(cleanName('   ', 20, 'DJ NOUN')).toBe('DJ NOUN');
    expect(cleanName('x'.repeat(50)).length).toBe(20);
    expect(cleanText('a\u0000b<script>  c', 80)).toBe('abscript c');
  });

  it('caps track length and needs a real duration', () => {
    expect(typeof validTrack(direct('ok', 600))).toBe('object');
    expect(validTrack(direct('long', 601))).toMatch(/capped/);
    expect(validTrack(direct('short', 2))).toMatch(/too short/);
    expect(validTrack({ ...direct(), dur: 'abc' })).toMatch(/unknown/);
    expect(
      validTrack({ ...direct(), src: { kind: 'direct', url: 'https://x.org/a.html' } }),
    ).toMatch(/not allowed/);
  });

  it('owner tags are stable and do not reveal the key', () => {
    const k = 'abcdefghijklmnopqrstuvwx';
    expect(ownerTag(k)).toBe(ownerTag(k));
    expect(ownerTag(k)).not.toBe(ownerTag(`${k}y`));
    expect(ownerTag(k)).not.toContain(k);
    expect(ownerTag(k)).toMatch(/^[\da-f]{16}$/);
  });
});

describe('queue rules', () => {
  it('caps each rider and the whole queue, refuses duplicates', () => {
    const s = emptyFmState();
    for (let i = 0; i < FM_PER_RIDER + 1; i++) expect(add(s, direct(), 'alice', T0)).toBeNull();
    // the first went straight on air, so alice now has FM_PER_RIDER waiting
    expect(s.current?.entry.owner).toBe('alice');
    expect(add(s, direct(), 'alice', T0)).toMatch(/already have/);
    expect(add(s, direct(), 'bob', T0)).toBeNull();
    const dup = s.queue[0]!;
    expect(add(s, { ...dup }, 'carol', T0)).toMatch(/already queued/);
    const big = emptyFmState();
    for (let i = 0; i < FM_QUEUE_MAX + 1; i++) add(big, direct(), `r${i}`, T0);
    expect(add(big, direct(), 'late', T0)).toMatch(/full/);
  });

  it('remove / move only your own entries; moves skip over other riders', () => {
    const s = emptyFmState();
    add(s, direct('playing'), 'x', T0);
    add(s, direct('a1'), 'alice', T0, 'a1');
    add(s, direct('b1'), 'bob', T0, 'b1');
    add(s, direct('a2'), 'alice', T0, 'a2');
    expect(removeEntry(s, 'b1', 'alice')).toMatch(/own/);
    expect(moveEntry(s, 'b1', 'alice', -1)).toMatch(/own/);
    // a2 up: swaps with a1, bob keeps his place
    expect(moveEntry(s, 'a2', 'alice', -1)).toBeNull();
    expect(s.queue.map(e => e.id)).toEqual(['a2', 'b1', 'a1']);
    expect(moveEntry(s, 'a2', 'alice', -1)).toBeNull(); // already first of hers
    expect(s.queue.map(e => e.id)).toEqual(['a2', 'b1', 'a1']);
    expect(removeEntry(s, 'a1', 'alice')).toBeNull();
    expect(s.queue.map(e => e.id)).toEqual(['a2', 'b1']);
    expect(removeEntry(s, 'nope', 'alice')).toMatch(/not in/);
  });

  it('skip: only the owner of the playing track (or admin = null owner)', () => {
    const s = emptyFmState();
    add(s, direct('mine', 100), 'alice', T0);
    add(s, direct('next', 100), 'bob', T0);
    expect(skipCurrent(s, 'bob', T0 + 10_000)).toMatch(/only whoever/);
    expect(skipCurrent(s, 'alice', T0 + 10_000)).toBeNull();
    expect(s.current?.entry.title).toBe('next');
    expect(s.current?.startAt).toBe(T0 + 10_000 + FM_GAP_MS);
    expect(skipCurrent(s, null, T0 + 20_000)).toBeNull();
    expect(s.current).toBeNull();
  });
});

describe('timeline', () => {
  it('an idle station starts a new track after one ident gap; tracks chain gap to gap', () => {
    const s = emptyFmState();
    s.freeAt = T0 - 3600_000; // quiet for an hour
    add(s, direct('a', 60), 'u1', T0);
    add(s, direct('b', 30), 'u2', T0 + 5000);
    expect(s.current?.startAt).toBe(T0 + FM_GAP_MS);
    let a = onAir(s, T0 + 1000);
    expect(a.source).toBe('queue');
    expect(a.track?.title).toBe('a');
    expect(T0 + 1000 < a.startAt).toBe(true); // in the ident
    const bStart = T0 + FM_GAP_MS + 60_000 + FM_GAP_MS;
    advance(s, bStart - 1000);
    a = onAir(s, bStart - 1000);
    expect(a.track?.title).toBe('b');
    expect(a.startAt).toBe(bStart);
    advance(s, bStart + 31_000);
    expect(onAir(s, bStart + 31_000).source).toBe('fallback');
  });

  it('advance is idempotent: one jump or many small steps land on the same state', () => {
    const mk = () => {
      const s = emptyFmState();
      for (let i = 0; i < 6; i++) add(s, direct(`x${i}`, 40 + i * 7), `r${i}`, T0);
      addSet(
        s,
        { dj: 'DJ', name: 'set', startAt: T0 + 3 * MIN, tracks: [direct('s1', 50)] },
        'dj',
        T0,
        'set1',
      );
      return s;
    };
    const a = mk();
    const b = mk();
    advance(a, T0 + 9 * MIN);
    for (let t = T0; t <= T0 + 9 * MIN; t += 777) advance(b, t);
    advance(b, T0 + 9 * MIN);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('a set cuts in at its time, plays its tracks with idents, then the queue resumes', () => {
    const s = emptyFmState();
    add(s, direct('q1', 300), 'u1', T0);
    add(s, direct('q2', 100), 'u2', T0);
    const at = T0 + 2 * MIN;
    expect(
      addSet(
        s,
        {
          dj: 'DJ Nouns',
          name: 'Lunch',
          startAt: at,
          tracks: [direct('s1', 60), direct('s2', 30)],
        },
        'dj',
        T0,
        'set1',
      ),
    ).toBeNull();
    // before the set: queue
    expect(onAir(s, at - 1000).track?.title).toBe('q1');
    // set track 1 (ident first), then track 2
    advance(s, at + 1000);
    let a = onAir(s, at + 1000);
    expect(a.source).toBe('set');
    expect(a.set).toMatchObject({ dj: 'DJ Nouns', name: 'Lunch', index: 0, count: 2 });
    expect(a.startAt).toBe(at + FM_GAP_MS);
    const s2 = at + FM_GAP_MS + 60_000 + FM_GAP_MS;
    a = onAir(s, s2 + 10);
    expect(a.track?.title).toBe('s2');
    expect(a.startAt).toBe(s2);
    // q1 was cut; after the set the queue moves on to q2
    const end = setEnd(s.sets[0]!);
    expect(end).toBe(s2 + 30_000);
    advance(s, end + 100);
    a = onAir(s, end + 100);
    expect(a.source).toBe('queue');
    expect(a.track?.title).toBe('q2');
    expect(a.startAt).toBe(end + FM_GAP_MS);
  });

  it('tracks queued during a live set wait for it to end', () => {
    const s = emptyFmState();
    addSet(s, { dj: 'A', name: 'x', startAt: T0, tracks: [direct('s', 100)] }, 'dj', T0, 'set');
    add(s, direct('q', 50), 'u', T0 + 10_000);
    expect(onAir(s, T0 + 20_000).source).toBe('set');
    const end = T0 + FM_GAP_MS + 100_000;
    advance(s, end + 1);
    expect(onAir(s, end + 1).track?.title).toBe('q');
    expect(s.current?.startAt).toBe(end + FM_GAP_MS);
  });

  it('falls back to the pirate station when nothing is on', () => {
    const s = emptyFmState();
    expect(onAir(s, T0)).toMatchObject({ source: 'fallback', track: null, key: '' });
    expect(nextChange(s, T0)).toBeNull();
  });

  it('nextChange points at the next boundary', () => {
    const s = emptyFmState();
    add(s, direct('a', 60), 'u', T0);
    expect(nextChange(s, T0)).toBe(T0 + FM_GAP_MS);
    expect(nextChange(s, T0 + FM_GAP_MS)).toBe(T0 + FM_GAP_MS + 60_000);
  });
});

describe('DJ sets', () => {
  const set = (startAt: number, tracks = [direct()]) => ({ dj: 'dj', name: 'n', startAt, tracks });

  it('books for the next 24 hours only, not in the past', () => {
    const s = emptyFmState();
    expect(addSet(s, set(T0 - 5 * MIN), 'a', T0, '1')).toMatch(/passed/);
    expect(addSet(s, set(T0 + 25 * 3600_000), 'a', T0, '1')).toMatch(/today/);
    expect(addSet(s, set(T0 + 23 * 3600_000), 'a', T0, '1')).toBeNull();
  });

  it('caps tracks and length, needs at least one track', () => {
    const s = emptyFmState();
    expect(addSet(s, set(T0 + MIN, []), 'a', T0, '1')).toMatch(/at least one/);
    const many = Array.from({ length: 21 }, () => direct('m', 30));
    expect(addSet(s, set(T0 + MIN, many), 'a', T0, '1')).toMatch(/20 tracks/);
    const long = Array.from({ length: 13 }, () => direct('l', 600));
    expect(addSet(s, set(T0 + MIN, long), 'a', T0, '1')).toMatch(/2 hours/);
    expect(addSet(s, set(T0 + MIN, [{ ...direct(), dur: 9999 }]), 'a', T0, '1')).toMatch(/capped/);
  });

  it('one slot at a time: no overlaps; booking again replaces your own set', () => {
    const s = emptyFmState();
    expect(addSet(s, set(T0 + 10 * MIN, [direct('a', 300)]), 'alice', T0, 'a')).toBeNull();
    expect(addSet(s, set(T0 + 12 * MIN), 'bob', T0, 'b')).toMatch(/overlaps dj/);
    expect(addSet(s, set(T0 + 20 * MIN), 'bob', T0, 'b')).toBeNull();
    // alice moves hers: replaced, not added
    expect(addSet(s, set(T0 + 40 * MIN), 'alice', T0, 'a2')).toBeNull();
    expect(s.sets.map(x => x.id)).toEqual(['b', 'a2']);
    // her new slot may not overlap bob's either
    expect(addSet(s, set(T0 + 20 * MIN), 'alice', T0, 'a3')).toMatch(/overlaps/);
  });

  it('a live set cannot be replaced, only cancelled (by its DJ or an admin)', () => {
    const s = emptyFmState();
    addSet(s, set(T0, [direct('x', 300)]), 'alice', T0, 'a');
    expect(addSet(s, set(T0 + 60 * MIN), 'alice', T0 + MIN, 'a2')).toMatch(/live/);
    expect(cancelSet(s, 'a', 'bob', T0 + MIN)).toMatch(/only its DJ/);
    expect(cancelSet(s, 'a', 'alice', T0 + MIN)).toBeNull();
    expect(s.sets).toHaveLength(0);
    addSet(s, set(T0 + 5 * MIN), 'carol', T0 + MIN, 'c');
    expect(cancelSet(s, 'c', null, T0 + 2 * MIN)).toBeNull();
  });

  it('finished sets are pruned', () => {
    const s = emptyFmState();
    addSet(s, set(T0, [direct('x', 60)]), 'a', T0, 'a');
    advance(s, T0 + 10 * MIN);
    expect(s.sets).toHaveLength(0);
  });
});

describe('loadState', () => {
  it('round-trips a station and drops anything invalid', () => {
    const s = emptyFmState();
    add(s, direct('a'), 'u', T0);
    add(s, yt('dQw4w9WgXcQ'), 'u', T0);
    addSet(s, { dj: 'd', name: 'n', startAt: T0 + 60 * MIN, tracks: [direct('s')] }, 'u', T0, 's');
    const back = loadState(JSON.parse(JSON.stringify(s)));
    expect(back).toEqual(s);
    const bad = loadState({
      queue: [
        {
          id: 'x',
          owner: 'o',
          by: 'b',
          src: { kind: 'direct', url: 'https://x.googlevideo.com/a.mp3' },
          dur: 60,
        },
      ],
      sets: [{ id: 's', startAt: T0, tracks: [] }],
      current: { entry: 'nope', startAt: 1 },
    });
    expect(bad).toEqual(emptyFmState());
    expect(loadState(null)).toBeNull();
  });
});
