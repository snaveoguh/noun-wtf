import { describe, expect, it } from 'vitest';

import { shouldPlayBed } from './bed';
import { HERO_SLIDES } from './rows';

const on = { sound: true, slideHasBed: true, live: true, voOn: false };

describe('hero sound bed', () => {
  it('the Noun Hoops slide has the clip and the court bed', () => {
    const hoops = HERO_SLIDES.find(s => s.key === 'hoops')!;
    expect(hoops.clip?.mp4).toBe('/home/hero-hoops.mp4');
    expect(hoops.clip?.webm).toBe('/home/hero-hoops.webm');
    expect(hoops.clip?.audio).toBeUndefined(); // the bed is the sound, not the file
    expect(hoops.bed).toEqual({ track: '/home/hoops-track.mp3', ambience: 'court' });
  });

  it('no slide has both a voice-over and a bed', () => {
    expect(HERO_SLIDES.filter(s => s.vo !== undefined && s.bed !== undefined)).toHaveLength(0);
  });

  it('plays only with sound on, on its slide, while visible', () => {
    expect(shouldPlayBed(on)).toBe(true);
    expect(shouldPlayBed({ ...on, sound: false })).toBe(false);
    expect(shouldPlayBed({ ...on, slideHasBed: false })).toBe(false);
    expect(shouldPlayBed({ ...on, live: false })).toBe(false);
  });

  it('never plays over the voice-over', () => {
    expect(shouldPlayBed({ ...on, voOn: true })).toBe(false);
  });

  it('walking the rotation with sound on: only the Hoops slide plays a bed', () => {
    const playing = HERO_SLIDES.filter(s =>
      shouldPlayBed({ sound: true, slideHasBed: s.bed !== undefined, live: true, voOn: false }),
    ).map(s => s.key);
    expect(playing).toEqual(['hoops']);
  });
});
