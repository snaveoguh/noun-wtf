import { describe, expect, it } from 'vitest';

import { PIXELS, pixelAt, stageAt, streakAt, STREAK_COUNT, T } from './introScene';

describe('intro timeline', () => {
  it('uses the real 16x5 noggles: 34 frame, 16 white, 16 pupil pixels', () => {
    const n = (k: string) => PIXELS.filter(p => p.k === k).length;
    expect([n('R'), n('W'), n('B')]).toEqual([34, 16, 16]);
  });

  it('starts empty', () => {
    expect(PIXELS.every(p => pixelAt(p, 0).alpha === 0)).toBe(true);
  });

  it('every pixel has fully landed before the dive starts', () => {
    for (const p of PIXELS) {
      const s = pixelAt(p, T.dive - 1);
      expect(s.alpha).toBe(1);
      expect(s.scale).toBeCloseTo(1, 5);
      expect(s.dy).toBeCloseTo(0, 9);
    }
  });

  it('the frame builds left to right before the eyes punch in', () => {
    const lastFrame = Math.max(
      ...PIXELS.filter(p => p.k === 'R').map(p => T.frameStart + p.x * T.frameStepX + p.y * T.frameStepY + T.frameDur),
    );
    expect(lastFrame).toBeLessThanOrEqual(T.eyes + 200);
  });

  it('dives into the pupil at the end, and the streaks have faded by then', () => {
    expect(stageAt(T.dive - 1).scale).toBe(1);
    expect(stageAt(T.total).scale).toBeGreaterThan(30);
    for (let i = 0; i < STREAK_COUNT; i++) expect(streakAt(i, T.total + 500).a).toBe(0);
  });
});
