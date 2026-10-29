import { describe, expect, it } from 'vitest';

import {
  autoQuality,
  bootPlan,
  deviceLine,
  isMobile,
  isWeakDevice,
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

  it("an explicit Low on a phone keeps every phone protection (the owner's Moto G06)", () => {
    // auto on a phone boots low with the weak check and the full ladder
    expect(bootPlan('low', false, true)).toEqual({ phone: true, ladder: 'phone' });
    // Settings → Low (or ?q=low) on a phone: the same, never less
    expect(bootPlan('low', true, true)).toEqual({ phone: true, ladder: 'phone' });
    // ?q=low on a desktop stays as chosen (scripts, comparisons)
    expect(bootPlan('low', true, false)).toEqual({ phone: false, ladder: null });
    // medium / high (auto or picked) keep the desktop ladder
    expect(bootPlan('high', false, false)).toEqual({ phone: false, ladder: 'desktop' });
    expect(bootPlan('medium', true, true)).toEqual({ phone: false, ladder: 'desktop' });
  });

  it('the perf device line names the verdict and the GPU', () => {
    const g06 = { ua: ANDROID, gpu: 'Mali-G52 MC2', memory: 4, cores: 8 };
    expect(deviceLine(g06, true, isWeakDevice(g06))).toBe(
      'WEAK · Mali-G52 MC2 · 4 GB · 8 cores · mobile',
    );
    expect(deviceLine({ ua: MAC, cores: 10 }, false, false)).toBe(
      'not checked · gpu hidden · ? GB · 10 cores',
    );
  });
});
