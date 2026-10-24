import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parsePlaylist, type FmItem } from '@/components/NounFm/station';

import {
  afterBeat,
  BEATS_FAVOURED,
  BEATS_MAX_STRIKES,
  beatsSource,
  beatsTrackLabel,
  beatsWeight,
  hipHopPool,
  isNativeApp,
  pickBeat,
  type BeatsPickState,
} from './beatsPicker';

const item = (id: string, genre: string, extra: Partial<FmItem> = {}): FmItem => ({
  id: id.padEnd(11, 'x'),
  title: `t${id}`,
  artist: `a${id}`,
  genre,
  kind: 'music',
  dur: 200,
  ...extra,
});

const fresh = (): BeatsPickState => ({ recent: [], blocked: new Set(), lastArtist: '' });

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('hipHopPool', () => {
  it('keeps only hip-hop music, by genre tag', () => {
    const pool = hipHopPool([
      item('1', 'boom bap'),
      item('2', 'roots reggae'),
      item('3', 'instrumental hip hop'),
      item('4', 'jazz rap', { kind: 'video' }),
      item('5', 'soulquarians'),
      item('6', 'trip-hop'),
      item('7', 'UK Hip Hop'),
      item('8', 'dj set', { kind: 'video' }),
    ]);
    expect(pool.map(t => t.genre)).toEqual([
      'boom bap',
      'instrumental hip hop',
      'soulquarians',
      'UK Hip Hop',
    ]);
  });

  it('drops long mixes', () => {
    expect(hipHopPool([item('1', 'boom bap', { dur: 1800 })])).toEqual([]);
  });

  it('weights instrumental / boom bap / jazz rap above the rest', () => {
    for (const g of BEATS_FAVOURED)
      expect(beatsWeight(g)).toBeGreaterThan(beatsWeight('underground hip hop'));
    expect(beatsWeight('roots reggae')).toBe(0);
  });

  it('matches the real playlist: ~800 hip-hop tracks, no non-hip-hop', () => {
    const raw = JSON.parse(
      readFileSync(resolve(__dirname, '../../../../public/fm/playlist.json'), 'utf8'),
    ) as unknown;
    const pool = hipHopPool(parsePlaylist(raw));
    expect(pool.length).toBeGreaterThan(700);
    expect(pool.every(t => t.kind === 'music' && beatsWeight(t.genre) > 0)).toBe(true);
    const genres = new Set(pool.map(t => t.genre));
    for (const g of BEATS_FAVOURED) expect(genres.has(g)).toBe(true);
  });
});

describe('pickBeat', () => {
  it('favours the riding-soundtrack genres over thousands of picks', () => {
    const items: FmItem[] = [];
    for (let i = 0; i < 50; i++) items.push(item(`i${i}`, 'instrumental hip hop'));
    for (let i = 0; i < 50; i++) items.push(item(`u${i}`, 'underground hip hop'));
    const pool = hipHopPool(items);
    const rng = seeded(7);
    let fav = 0;
    const N = 4000;
    for (let n = 0; n < N; n++) {
      const t = pickBeat(pool, fresh(), rng)!;
      if (t.genre === 'instrumental hip hop') fav++;
    }
    // weight 5 vs 1 over equal counts: ~83%
    expect(fav / N).toBeGreaterThan(0.75);
    expect(fav / N).toBeLessThan(0.9);
  });

  it('shuffles without repeats and avoids the same artist twice', () => {
    const pool = hipHopPool([
      item('1', 'boom bap', { artist: 'X' }),
      item('2', 'boom bap', { artist: 'X' }),
      item('3', 'boom bap', { artist: 'Y' }),
    ]);
    let s = afterBeat(fresh(), pool[0]!);
    const rng = seeded(1);
    for (let n = 0; n < 50; n++) expect(pickBeat(pool, s, rng)!.artist).toBe('Y');
    s = afterBeat(s, pool[2]!);
    for (let n = 0; n < 50; n++) expect(pickBeat(pool, s, rng)!.id).toBe(pool[1]!.id);
  });

  it('never picks refused ids, and relaxes rather than returning nothing', () => {
    const pool = hipHopPool([item('1', 'boom bap'), item('2', 'jazz rap')]);
    const s = { ...afterBeat(fresh(), pool[0]!), blocked: new Set([pool[1]!.id]) };
    expect(pickBeat(pool, s, seeded(3))!.id).toBe(pool[0]!.id);
    expect(pickBeat(pool, { ...s, blocked: new Set(pool.map(t => t.id)) }, seeded(3))).toBe(null);
  });

  it('labels artist – title', () => {
    expect(beatsTrackLabel({ artist: 'Madlib', title: 'Slim' })).toBe('Madlib – Slim');
    expect(beatsTrackLabel({ artist: '', title: 'Untitled' })).toBe('Untitled');
  });
});

describe('beatsSource (YouTube or the offline worklet)', () => {
  const env = { offline: false, native: false, nativeEmbedsBlocked: false, strikes: 0 };
  it('plays YouTube normally', () => {
    expect(beatsSource(env)).toBe('youtube');
    expect(beatsSource({ ...env, native: true })).toBe('youtube');
    expect(beatsSource({ ...env, strikes: BEATS_MAX_STRIKES - 1 })).toBe('youtube');
  });
  it('falls back for ?offline=1, the app refusing embeds, or 3 errors in a row', () => {
    expect(beatsSource({ ...env, offline: true })).toBe('offline');
    expect(beatsSource({ ...env, native: true, nativeEmbedsBlocked: true })).toBe('offline');
    expect(beatsSource({ ...env, strikes: 3 })).toBe('offline');
  });
  it('spots the Capacitor app', () => {
    expect(isNativeApp('?source=app', {})).toBe(true);
    expect(isNativeApp('', { Capacitor: { isNativePlatform: () => true } })).toBe(true);
    expect(isNativeApp('?offline=1', { Capacitor: { isNativePlatform: () => false } })).toBe(false);
    expect(isNativeApp('', null)).toBe(false);
  });
});
