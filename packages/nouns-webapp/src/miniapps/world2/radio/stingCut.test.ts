import { describe, expect, it } from 'vitest';

import { chooseStingCut, frameEnergy, onsetStrength } from './stingCut';

const SR = 8000;

/** Sections of [seconds, amplitude] as a sine at 220 Hz. */
function signal(parts: [number, number][]): Float32Array {
  const n = parts.reduce((s, [d]) => s + Math.round(d * SR), 0);
  const x = new Float32Array(n);
  let i = 0;
  for (const [d, a] of parts)
    for (let k = 0; k < Math.round(d * SR); k++, i++)
      x[i] = a * Math.sin((2 * Math.PI * 220 * i) / SR);
  return x;
}

describe('sting cut', () => {
  it('frames energy and finds onsets', () => {
    const e = frameEnergy(
      signal([
        [0.2, 0],
        [0.2, 0.8],
      ]),
      160,
    );
    expect(e.length).toBe(20);
    const on = onsetStrength(e);
    const peak = on.indexOf(Math.max(...on));
    expect(peak).toBe(10);
  });

  it('starts on the hook (the loud onset), not the quiet pad before it', () => {
    // 3 s quiet pad, a loud 4 s hook, 5 s medium tail
    const x = signal([
      [3, 0.05],
      [4, 0.9],
      [5, 0.3],
    ]);
    const c = chooseStingCut(x, SR, 4.3);
    expect(c.length).toBeCloseTo(4.3, 5);
    expect(c.start).toBeGreaterThan(2.8);
    expect(c.start).toBeLessThan(3.1);
  });

  it('skips leading silence and uses short files whole', () => {
    const x = signal([
      [0.5, 0],
      [3, 0.6],
    ]);
    const c = chooseStingCut(x, SR, 4.3);
    expect(c.start).toBeCloseTo(0.5, 1);
    expect(c.length).toBeCloseTo(3, 1);
  });

  it('is safe on silence', () => {
    expect(chooseStingCut(new Float32Array(SR * 10), SR, 4.3)).toEqual({ start: 0, length: 4.3 });
  });
});
