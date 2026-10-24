import { describe, expect, it } from 'vitest';

import { HERO_SLIDES } from './rows';
import { shouldStartVo, shouldStopVo } from './voiceOver';

const on = { sound: true, slideHasVo: true, live: true, played: false };

describe('hero voice-over', () => {
  it('only the NOUN WTF brand slide has one, and it is the first slide', () => {
    expect(HERO_SLIDES[0]!.vo).toBe('/home/vo-intro.mp3');
    expect(HERO_SLIDES.filter(s => s.vo !== undefined)).toHaveLength(1);
  });

  it('plays once per page view, with sound on, on its slide, while visible', () => {
    expect(shouldStartVo(on)).toBe(true);
    expect(shouldStartVo({ ...on, played: true })).toBe(false);
    // never before the visitor turns sound on
    expect(shouldStartVo({ ...on, sound: false })).toBe(false);
    expect(shouldStartVo({ ...on, slideHasVo: false })).toBe(false);
    expect(shouldStartVo({ ...on, live: false })).toBe(false);
  });

  it('stops when muted, the slide changes, or the hero hides', () => {
    expect(shouldStopVo(on)).toBe(false);
    expect(shouldStopVo({ ...on, sound: false })).toBe(true);
    expect(shouldStopVo({ ...on, slideHasVo: false })).toBe(true);
    expect(shouldStopVo({ ...on, live: false })).toBe(true);
  });
});

describe('clip sync under the voice-over', () => {
  it('slows the clip to end with the voice, never speeds it up, never below 0.75x', async () => {
    const { syncRate, VO_SECONDS } = await import('./voiceOver');
    expect(syncRate(VO_SECONDS * 0.9)).toBeCloseTo(0.9, 5);
    expect(syncRate(40)).toBe(1);
    expect(syncRate(5)).toBe(0.75);
    expect(syncRate(Number.NaN)).toBe(1);
  });
});
