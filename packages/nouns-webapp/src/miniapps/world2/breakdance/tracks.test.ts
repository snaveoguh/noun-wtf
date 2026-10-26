// @vitest-environment node
// Songs: the manifest is checked, and a song's bars land on the battle's.

import { describe, expect, it } from 'vitest';

import manifest from '../../../../public/breaks/tracks.json';

import { beatAt, makeClock, timeOf } from './sim/clock';
import {
  beatTime,
  HOUSE_TRACK,
  loadManifest,
  readManifest,
  songLoop,
  songPos,
  trackById,
  trackUrl,
  wrapPos,
} from './tracks';

describe('track manifest', () => {
  it('ships with the generated beat as the default', () => {
    const list = readManifest(manifest);
    expect(list[0]).toMatchObject({ id: 'house', file: null, bpm: null });
    // Every shipped song names its license
    for (const t of list.slice(1)) {
      expect(t.license.length).toBeGreaterThan(3);
      expect(t.file).not.toBeNull();
    }
  });

  it('keeps good songs and drops bad ones', () => {
    const list = readManifest([
      {
        id: 'good',
        title: 'Good',
        artist: 'A',
        file: 'good.mp3',
        bpm: 92.5,
        offset: 1.2,
        license: 'CC0 1.0',
        source: 'https://example.org/x',
      },
      { id: 'nolicense', file: 'x.mp3', bpm: 90, offset: 0 },
      { id: 'fast', file: 'x.mp3', bpm: 400, offset: 0, license: 'CC0' },
      { id: 'path', file: '../secret.mp3', bpm: 90, offset: 0, license: 'CC0' },
      { id: 'Bad ID', file: 'x.mp3', bpm: 90, offset: 0, license: 'CC0' },
      { id: 'good', file: 'dupe.mp3', bpm: 90, offset: 0, license: 'CC0' },
      { id: 'house', title: 'House', file: 'sneaky.mp3', bpm: 140, license: 'x' },
      {
        id: 'neg',
        file: 'n.ogg',
        bpm: 90,
        offset: -5,
        license: 'CC0',
        source: 'javascript:alert(1)',
      },
    ]);
    expect(list.map(t => t.id)).toEqual(['house', 'good', 'neg']);
    expect(list[0]).toMatchObject({ title: 'House', file: null, bpm: null });
    expect(list[1]).toMatchObject({ bpm: 92.5, offset: 1.2, source: 'https://example.org/x' });
    expect(list[2].offset).toBe(0);
    expect(list[2].source).toBeUndefined();
    expect(readManifest('nope')).toEqual([HOUSE_TRACK]);
    expect(trackById(list, 'missing')).toBe(HOUSE_TRACK);
    expect(trackUrl(list[1])).toBe('/breaks/tracks/good.mp3');
    expect(trackUrl(HOUSE_TRACK)).toBeNull();
  });

  it('falls back to the generated beat when the manifest is missing', async () => {
    const list = await loadManifest((() => Promise.reject(new Error('404'))) as typeof fetch);
    expect(list).toEqual([HOUSE_TRACK]);
  });
});

describe('the song on the battle clock', () => {
  it("puts the song's first downbeat on the battle's first beat, and every bar after on a bar", () => {
    const bpm = 92;
    const offset = 1.234;
    const clock = makeClock(bpm);
    // Battle time 0 is the intro's downbeat (beat −4): the file's first downbeat
    expect(songPos(0, offset)).toBeCloseTo(offset, 9);
    expect(beatAt(clock, 0)).toBe(-4);
    for (const beat of [-4, 0, 1, 16, 37, 100]) {
      const t = timeOf(clock, beat);
      expect(beatTime(beat, bpm)).toBeCloseTo(t, 9);
      // Song beats since its first downbeat == battle beats since the intro's
      const songBeats = ((songPos(t, offset) - offset) * bpm) / 60;
      expect(songBeats).toBeCloseTo(beat + 4, 9);
    }
  });

  it('loops a short song on whole bars', () => {
    const loop = songLoop(30, 1, 100)!;
    expect(loop.start).toBe(1);
    expect(((loop.end - loop.start) * 100) / 60 / 4).toBeCloseTo(12, 9);
    const p = wrapPos(loop.end + 0.6, loop);
    expect(p).toBeCloseTo(loop.start + 0.6, 9);
    expect(wrapPos(5, loop)).toBe(5);
    expect(songLoop(2, 1, 100)).toBeNull();
  });
});
