import { describe, expect, it } from 'vitest';

import {
  autoQuality,
  isMobile,
  isWeakDevice,
  ladderTick,
  LOW_TIER_BAD_FPS,
  MIN_SCALE,
  stepDown,
  type LiteState,
} from './deviceTier';

const ANDROID =
  'Mozilla/5.0 (Linux; Android 11; SM-A125F) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';

describe('device tier', () => {
  it('phones and iPads boot low; desktops by cores', () => {
    expect(autoQuality({ ua: ANDROID })).toBe('low');
    expect(autoQuality({ ua: IPHONE })).toBe('low');
    expect(autoQuality({ ua: MAC, maxTouchPoints: 5 })).toBe('low'); // iPadOS
    expect(autoQuality({ ua: MAC, cores: 10 })).toBe('high');
    expect(autoQuality({ ua: MAC, cores: 4 })).toBe('medium');
    expect(isMobile({ ua: MAC, touchFirst: true })).toBe(true);
  });

  it('weak: older Android by memory/cores or GPU family; iPhones only by GPU', () => {
    expect(isWeakDevice({ ua: ANDROID, memory: 3, cores: 8 })).toBe(true);
    expect(isWeakDevice({ ua: ANDROID, memory: 8, cores: 4 })).toBe(true);
    expect(isWeakDevice({ ua: ANDROID, memory: 8, cores: 8, gpu: 'Adreno (TM) 740' })).toBe(false);
    expect(isWeakDevice({ ua: ANDROID, memory: 8, cores: 8, gpu: 'Mali-G52 MC2' })).toBe(true);
    expect(isWeakDevice({ ua: ANDROID, memory: 8, cores: 8, gpu: 'Adreno (TM) 506' })).toBe(true);
    expect(isWeakDevice({ ua: IPHONE, cores: 6, gpu: 'Apple GPU' })).toBe(false);
    expect(isWeakDevice({ ua: MAC, cores: 8, gpu: 'Google SwiftShader' })).toBe(true);
  });

  it('the ladder: render scale down to the floor, then shadows, then post, then stop', () => {
    let s: LiteState | null = { scale: 1, shadows: true, post: true };
    const seen: LiteState[] = [];
    while (s !== null) {
      seen.push(s);
      s = stepDown(s);
    }
    expect(seen.map(x => x.scale)).toEqual([1, 0.85, 0.7, 0.6, 0.6, 0.6]);
    expect(seen.at(-2)).toEqual({ scale: MIN_SCALE, shadows: false, post: true });
    expect(seen.at(-1)).toEqual({ scale: MIN_SCALE, shadows: false, post: false });
  });

  it('steps after 2 s of bad FPS while probing, 4 s later; good frames reset it', () => {
    const l = { bad: 0, age: 0 };
    expect(ladderTick(l, LOW_TIER_BAD_FPS - 5, 1)).toBe(false);
    expect(ladderTick(l, LOW_TIER_BAD_FPS - 5, 1)).toBe(true);
    expect(ladderTick(l, 60, 1)).toBe(false);
    l.age = 30;
    for (let i = 0; i < 3; i++) expect(ladderTick(l, 20, 1)).toBe(false);
    expect(ladderTick(l, 20, 1)).toBe(true);
    // a good sample in between resets the count
    ladderTick(l, 20, 3);
    ladderTick(l, 60, 0.5);
    expect(ladderTick(l, 20, 3)).toBe(false);
  });
});
