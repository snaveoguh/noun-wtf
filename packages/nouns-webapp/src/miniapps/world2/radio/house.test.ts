import { describe, expect, it } from 'vitest';

import { FM_GAP_MS, srcKey } from '../../../../../nouns-party/src/fmStation';

import {
  HOUSE_ALERT_S,
  HOUSE_CUT_MIN_S,
  HOUSE_CUT_RANGE,
  HOUSE_DAY_MS,
  HOUSE_JINGLE_P,
  HOUSE_NO_REPEAT_MS,
  HOUSE_GAP_MAX_MS,
  HOUSE_GAP_MIN_MS,
  houseAt,
  houseDay,
  houseSlot,
  libraryTracks,
  type HouseCatalog,
  type HouseItem,
  type HouseTrack,
} from './house';

const DAY = Date.UTC(2026, 9, 19);

function owner(id: string, dur: number): HouseTrack {
  return {
    src: { kind: 'direct', url: `/world2/fm/songs/${id}.mp3` },
    title: id,
    artist: 'NOUN FM',
    dur,
    origin: 'owner',
  };
}
function lib(id: string, dur: number): HouseTrack {
  return {
    src: { kind: 'youtube', id },
    title: id,
    artist: 'someone',
    dur,
    origin: 'library',
    dj: 'DJ X',
  };
}

const CAT: HouseCatalog = {
  owner: [owner('sell-it-cold', 67.6), owner('noun-city', 49.9)],
  library: Array.from({ length: 30 }, (_, i) =>
    lib(`yt${String(i).padStart(9, '0')}`, 150 + i * 7),
  ),
  breaks: [18, 9.6, 16.8, 12.3, 16.3],
};

const songs = (items: HouseItem[]) =>
  items.filter((x): x is HouseItem & { kind: 'song' } => x.kind === 'song');

describe('house programme', () => {
  it('is deterministic: same day + catalogue → same schedule, same item at the same moment', () => {
    const a = houseDay(CAT, DAY);
    const b = houseDay({ ...CAT, library: [...CAT.library].reverse() }, DAY);
    expect(b).toEqual(a);
    const t = DAY + 5 * 3600_000 + 12_345;
    expect(houseAt(a, t)).toEqual(houseAt(b, t));
    // another day is a different running order
    expect(
      houseDay(CAT, DAY + HOUSE_DAY_MS).map(x => x.kind === 'song' && srcKey(x.track.src)),
    ).not.toEqual(a.map(x => x.kind === 'song' && srcKey(x.track.src)));
  });

  it('runs all day, with only off-air holes between items', () => {
    const a = houseDay(CAT, DAY);
    expect(a[0]!.at).toBe(DAY);
    let holes = 0;
    for (let i = 1; i < a.length; i++) {
      const gap = a[i]!.at - a[i - 1]!.endAt;
      if (gap === 0) continue;
      holes++;
      expect(gap).toBeGreaterThanOrEqual(HOUSE_GAP_MIN_MS);
      expect(gap).toBeLessThanOrEqual(HOUSE_GAP_MAX_MS);
    }
    expect(holes).toBeGreaterThan(0);
    // (the day can end inside a off-air gap)
    expect(a[a.length - 1]!.endAt).toBeGreaterThanOrEqual(DAY + HOUSE_DAY_MS - HOUSE_GAP_MAX_MS);
  });

  it('never cuts the owner songs short', () => {
    for (const s of songs(houseDay(CAT, DAY)))
      if (s.track.origin === 'owner') expect(s.cut).toBe(false);
  });

  it('a tiny catalogue gets a off-air gap after every song (no looping the same two)', () => {
    const a = houseDay({ owner: CAT.owner, library: [], breaks: CAT.breaks }, DAY);
    for (let i = 0; i < a.length - 1; i++) {
      if (a[i]!.kind !== 'song') continue;
      // the song (and its jingle, if any) then a hole before the next song
      const nextSong = a.slice(i + 1).find(x => x.kind === 'song');
      if (nextSong === undefined) continue;
      expect(nextSong.at - a[i]!.endAt).toBeGreaterThanOrEqual(HOUSE_GAP_MIN_MS);
    }
  });

  it('never repeats a track within an hour when the catalogue allows it', () => {
    const last = new Map<string, number>();
    for (const s of songs(houseDay(CAT, DAY))) {
      const k = srcKey(s.track.src);
      const prev = last.get(k);
      if (prev !== undefined) expect(s.startAt - prev).toBeGreaterThanOrEqual(HOUSE_NO_REPEAT_MS);
      last.set(k, s.startAt);
    }
  });

  it('mixes owner songs and library tracks roughly half and half', () => {
    const s = songs(houseDay(CAT, DAY));
    const own = s.filter(x => x.track.origin === 'owner').length / s.length;
    // two owner songs can't fill half an hour-long no-repeat window, so the
    // share sits below 50% here, but they're in the mix all day
    expect(own).toBeGreaterThan(0.1);
    expect(own).toBeLessThan(0.6);
  });

  it('cuts songs short only after 60-80% and drops a break right after; normal changes get the gap', () => {
    const a = houseDay(CAT, DAY);
    let cuts = 0;
    for (let i = 0; i < a.length; i++) {
      const it = a[i]!;
      if (it.kind !== 'song') continue;
      const len = (it.endAt - it.startAt) / 1000;
      if (it.cut) {
        cuts++;
        expect(it.track.dur).toBeGreaterThanOrEqual(HOUSE_CUT_MIN_S);
        expect(len / it.track.dur).toBeGreaterThanOrEqual(HOUSE_CUT_RANGE[0] - 0.01);
        expect(len / it.track.dur).toBeLessThanOrEqual(HOUSE_CUT_RANGE[1] + 0.01);
        const next = a[i + 1];
        if (next !== undefined) {
          expect(next.kind).toBe('break');
          if (next.kind === 'break') {
            const blen = (next.endAt - next.at) / 1000;
            if (next.brk.type === 'alert') expect(blen).toBe(HOUSE_ALERT_S);
            else expect(blen).toBeCloseTo(CAT.breaks[next.brk.index]!, 2);
          }
          // the song after a break starts straight away
          const after = a[i + 2];
          // (unless a off-air gap came in between)
          if (after?.kind === 'song' && after.at === next.endAt)
            expect(after.startAt).toBe(after.at);
        }
      } else {
        expect(len).toBeCloseTo(it.track.dur, 2);
        const prev = a[i - 1];
        if (prev?.kind !== 'break') expect(it.startAt - it.at).toBe(FM_GAP_MS);
      }
    }
    const share = cuts / songs(a).length;
    expect(share).toBeGreaterThan(0.12);
    expect(share).toBeLessThan(0.4);
    const breaks = a.filter(x => x.kind === 'break');
    expect(breaks.some(x => x.kind === 'break' && x.brk.type === 'alert')).toBe(true);
    expect(breaks.some(x => x.kind === 'break' && x.brk.type === 'interlude')).toBe(true);
  });

  it('plays full jingles between songs that play out, never inside the short gap', () => {
    const a = houseDay(CAT, DAY);
    let jingles = 0;
    let outs = 0;
    for (let i = 0; i < a.length - 1; i++) {
      const it = a[i]!;
      if (it.kind !== 'song' || it.cut) continue;
      outs++;
      const next = a[i + 1]!;
      if (next.kind !== 'break') continue;
      jingles++;
      expect(next.brk.type).toBe('interlude');
      if (next.brk.type === 'interlude')
        expect((next.endAt - next.at) / 1000).toBeCloseTo(CAT.breaks[next.brk.index]!, 2);
    }
    expect(jingles / outs).toBeGreaterThan(HOUSE_JINGLE_P - 0.1);
    expect(jingles / outs).toBeLessThan(HOUSE_JINGLE_P + 0.1);
  });

  it('works with just the owner songs (tiny catalogue: least-recently-played)', () => {
    const a = houseDay({ owner: CAT.owner, library: [], breaks: [] }, DAY);
    expect(a.length).toBeGreaterThan(100);
    const s = songs(a);
    for (let i = 1; i < s.length; i++)
      expect(srcKey(s[i]!.track.src)).not.toBe(srcKey(s[i - 1]!.track.src));
    // no jingles to drop: every break is an alert
    expect(a.every(x => x.kind === 'song' || x.brk.type === 'alert')).toBe(true);
  });

  it('is empty with nothing to play', () => {
    expect(houseDay({ owner: [], library: [], breaks: [1] }, DAY)).toEqual([]);
  });

  it('is pre-empted by anything the station has on (queue / DJ set)', () => {
    const a = houseDay(CAT, DAY);
    const t = DAY + 3600_000;
    expect(houseSlot(true, a, t)).toBeNull();
    expect(houseSlot(false, a, t)).toEqual(houseAt(a, t));
  });

  it('only takes library sets published before the day (every client agrees)', () => {
    const sets = [
      { dj: 'old', at: DAY - 1, tracks: [lib('a', 100)] },
      { dj: 'new', at: DAY + 1, tracks: [lib('b', 100)] },
    ];
    expect(libraryTracks(sets, DAY).map(t => t.dj)).toEqual(['old']);
  });
});
