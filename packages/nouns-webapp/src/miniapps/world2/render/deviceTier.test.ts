import { describe, expect, it } from 'vitest';

import {
  autoQuality,
  budgetScale,
  isMobile,
  isWeakDevice,
  LOW_PIXEL_BUDGET,
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
});

describe("budgetScale (tablets draw a phone's worth of pixels on low)", () => {
  it('leaves phones at 1, portrait or landscape', () => {
    expect(budgetScale(393, 852)).toBe(1);
    expect(budgetScale(852, 393)).toBe(1);
    expect(budgetScale(430, 932)).toBe(1);
    expect(budgetScale(412, 915)).toBe(1);
  });
  it('brings tablets down to ~0.6 MP, in 0.05 steps', () => {
    expect(budgetScale(1180, 820)).toBe(0.75); // iPad Air / 10th gen
    expect(budgetScale(820, 1180)).toBe(0.75);
    expect(budgetScale(810, 1080)).toBe(0.8); // iPad 9th gen
    expect(budgetScale(1280, 800)).toBe(0.75); // Android tablet
    expect(budgetScale(1366, 1024)).toBe(0.65); // iPad Pro 12.9
    for (const [w, h] of [
      [1180, 820],
      [1366, 1024],
      [1280, 800],
    ])
      expect(w * h * budgetScale(w, h) ** 2).toBeLessThanOrEqual(LOW_PIXEL_BUDGET);
  });
  it('never goes under the ladder floor', () => {
    expect(budgetScale(3840, 2160)).toBe(MIN_SCALE);
  });
});
