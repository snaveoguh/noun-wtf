import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FILE_STING_P,
  parseInterludes,
  parseSongs,
  pickGapSound,
  pickSecondJingle,
} from './fmAssets';
import { FM_GAP_MS } from './NounFm';

const PUB = join(__dirname, '../../../../public/world2/fm');
const interludes = parseInterludes(
  JSON.parse(readFileSync(join(PUB, 'interludes/manifest.json'), 'utf8')),
);
const songs = parseSongs(JSON.parse(readFileSync(join(PUB, 'songs/manifest.json'), 'utf8')));

describe('NOUN FM recordings', () => {
  it('ships the owner jingles + songs with stings that fit the gap', () => {
    expect(interludes.length).toBeGreaterThanOrEqual(5);
    expect(interludes[0]!.id).toBe('noun-fm-jingle');
    for (const i of interludes) {
      expect(i.stingDur).toBeLessThanOrEqual(4.4);
      expect(i.stingDur * 1000).toBeLessThan(FM_GAP_MS);
      expect(i.fullDur).toBeGreaterThan(i.stingDur);
      expect(i.sting).toMatch(/^\/world2\/fm\/interludes\/[\w-]+-sting\.mp3$/);
    }
    expect(songs.map(s => s.id).sort()).toEqual(['noun-city', 'sell-it-cold']);
    expect(songs.find(s => s.id === 'noun-city')!.title).toBe('Noun City');
  });

  it('rejects bad manifest rows', () => {
    expect(
      parseInterludes({
        interludes: [{ file: '../x.mp3', full: 'a.mp3', duration: 1, fullDuration: 2 }],
      }),
    ).toEqual([]);
    expect(parseSongs({ songs: [{ file: 'a.mp3', duration: 2 }] })).toEqual([]);
    expect(parseSongs(null)).toEqual([]);
  });

  it('picks the gap sound from the play key: same for every listener, ~60% recorded', () => {
    expect(pickGapSound('q:abc', 5)).toEqual(pickGapSound('q:abc', 5));
    expect(pickGapSound('q:abc', 0)).toEqual({ kind: 'synth' });
    let files = 0;
    const seen = new Set<number>();
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const p = pickGapSound(`play-${i}`, 5);
      if (p.kind === 'file') {
        files++;
        seen.add(p.index);
        expect(p.index).toBeGreaterThanOrEqual(0);
        expect(p.index).toBeLessThan(5);
      }
    }
    expect(files / N).toBeGreaterThan(FILE_STING_P - 0.04);
    expect(files / N).toBeLessThan(FILE_STING_P + 0.04);
    expect(seen.size).toBe(5);
  });

  it("the intro's second jingle is never the main one", () => {
    for (let r = 0; r < 1; r += 0.01)
      expect(pickSecondJingle(interludes, r)!.id).not.toBe('noun-fm-jingle');
    expect(pickSecondJingle(interludes.slice(0, 1), 0.5)).toBeNull();
  });
});
