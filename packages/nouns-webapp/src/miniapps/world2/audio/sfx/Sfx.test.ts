import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BEDS, isSample, isSfxId, nextGap, SFX_FILES } from './Sfx';
import { uiSoundFor } from './uiSounds';

const DIR = join(__dirname, '../../../../../public/world2/sfx');

describe('sfx files', () => {
  it('every sound in the bank exists, is an mp3, and is credited with a CC0 licence', () => {
    const credits = readFileSync(join(DIR, 'CREDITS.md'), 'utf8');
    for (const f of Object.values(SFX_FILES)) {
      expect(f.endsWith('.mp3')).toBe(true);
      expect(statSync(join(DIR, f)).size).toBeGreaterThan(300);
      const row = credits.split('\n').find(l => l.startsWith(`| ${f} |`));
      expect(row, f).toBeDefined();
      expect(row).toMatch(/CC0 1\.0 \|$/);
      expect(row).toMatch(/https:\/\//);
    }
  });

  it('nothing unlisted ships, and the lot stays small', () => {
    const files = readdirSync(DIR).filter(f => f !== 'CREDITS.md');
    expect(files.sort()).toEqual([...Object.values(SFX_FILES)].sort());
    const total = files.reduce((n, f) => n + statSync(join(DIR, f)).size, 0);
    expect(total).toBeLessThan(1.5 * 1024 * 1024);
  });

  it('ambience beds only use files in the bank', () => {
    for (const bed of Object.values(BEDS))
      for (const l of bed) for (const id of l.id) expect(isSample(id)).toBe(true);
  });

  it('knows samples from synth ids', () => {
    expect(isSfxId('coins')).toBe(true);
    expect(isSfxId('whoosh')).toBe(true);
    expect(isSample('whoosh')).toBe(false);
    expect(isSfxId('nope')).toBe(false);
  });

  it('bed gaps stay inside their range', () => {
    expect(nextGap([2, 6], 0)).toBe(2);
    expect(nextGap([2, 6], 1)).toBe(6);
    expect(nextGap([2, 6], 7)).toBe(6);
  });
});

describe('ui sounds', () => {
  it('close / cancel, accept, plain', () => {
    expect(uiSoundFor('close ✕', 'w2-chip')).toBe('ui-cancel');
    expect(uiSoundFor('leave', '')).toBe('ui-cancel');
    expect(uiSoundFor('Accept', 'w2-maccept')).toBe('ui-confirm');
    expect(uiSoundFor('another riddle', 'w2-chip')).toBe('ui-click');
  });
});
