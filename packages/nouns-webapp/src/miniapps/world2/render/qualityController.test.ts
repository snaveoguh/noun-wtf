import { describe, expect, it } from 'vitest';

import { MIN_SCALE } from './deviceTier';
import {
  desktopRungs,
  DESKTOP_TUNING,
  frameWindow,
  makeController,
  phoneRungs,
  PHONE_TUNING,
  qualityTick,
  UP_AFTER,
} from './qualityController';

const SLOW = { p50: 50, p95: 60 }; // ~20 fps on a phone
const STUTTER = { p50: 20, p95: 90 }; // fine median, keeps hitching
const OK = { p50: 30, p95: 34 }; // a 30 fps cap: playable, no headroom
const ROOMY = { p50: 16, p95: 18 }; // 60 fps with room

/** Feed `n` half-second windows; the rungs applied, in order. */
function feed(c: ReturnType<typeof makeController>, w: { p50: number; p95: number }, n: number) {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = qualityTick(c, w, 0.5);
    if (r !== null) out.push(c.at);
  }
  return out;
}

describe('rungs', () => {
  it('phones: scale to the floor, then shadows, then post', () => {
    const r = phoneRungs({ scale: 1, shadows: true, post: true });
    expect(r.map(x => x.scale)).toEqual([1, 0.85, 0.7, 0.6, 0.6, 0.6]);
    expect(r.at(-2)).toEqual({ scale: MIN_SCALE, shadows: false, post: true });
    expect(r.at(-1)).toEqual({ scale: MIN_SCALE, shadows: false, post: false });
  });

  it('desktop: render scale only, never under 1.25 on a Retina screen', () => {
    const boot = { scale: 2, shadows: true, post: true };
    expect(desktopRungs(boot, 2).map(x => x.scale)).toEqual([2, 1.75, 1.5, 1.25]);
    expect(desktopRungs({ ...boot, scale: 1.5 }, 1.5).map(x => x.scale)).toEqual([1.5, 1.25, 1]);
    expect(desktopRungs({ ...boot, scale: 1 }, 1)).toHaveLength(1);
    for (const r of desktopRungs(boot, 2)) expect(r.shadows && r.post).toBe(true);
  });
});

describe('frameWindow', () => {
  it('takes the median and p95 of the intervals', () => {
    const w = frameWindow([16, 17, 16, 16, 100, 16, 17, 16, 16, 16]);
    expect(w.p50).toBe(16);
    expect(w.p95).toBe(100);
  });
});

describe('qualityTick', () => {
  const phone = () =>
    makeController(phoneRungs({ scale: 1, shadows: true, post: true }), PHONE_TUNING);

  it('steps down after 2 s of slow frames while probing, then needs 4 s', () => {
    const c = phone();
    expect(feed(c, SLOW, 3)).toEqual([]);
    expect(feed(c, SLOW, 1)).toEqual([1]);
    c.age = 30;
    expect(feed(c, SLOW, 7)).toEqual([]);
    expect(feed(c, SLOW, 1)).toEqual([2]);
  });

  it('a steady stutter counts too; a lone hitch does not', () => {
    const c = phone();
    expect(feed(c, STUTTER, 4)).toEqual([1]);
    const d = phone();
    for (let i = 0; i < 20; i++) {
      feed(d, STUTTER, 1);
      feed(d, ROOMY, 1);
    }
    expect(d.at).toBe(0);
  });

  it('a 30 fps cap holds steady: neither down nor up', () => {
    const c = phone();
    expect(feed(c, OK, 200)).toEqual([]);
  });

  it('steps back up a scale rung after a run of headroom', () => {
    const c = phone();
    feed(c, SLOW, 4);
    expect(c.at).toBe(1);
    c.age = 100;
    expect(feed(c, ROOMY, UP_AFTER * 2 - 1)).toEqual([]);
    expect(feed(c, ROOMY, 1)).toEqual([0]);
  });

  it('never steps back up across the shadow rung (that relinks every lit material)', () => {
    const c = phone();
    c.at = 4; // scale floor, shadows off
    expect(c.rungs[c.at]!.shadows).toBe(false);
    expect(feed(c, ROOMY, 200)).toEqual([]);
  });

  it('stops stepping up once it flip-flops', () => {
    const c = phone();
    c.age = 100;
    feed(c, SLOW, 8); // down to 1
    feed(c, ROOMY, UP_AFTER * 2); // up to 0
    feed(c, SLOW, 8); // down: flip 1
    feed(c, ROOMY, UP_AFTER * 2); // up
    feed(c, SLOW, 8); // down: flip 2 → no more ups
    expect(c.noUp).toBe(true);
    expect(feed(c, ROOMY, 200)).toEqual([]);
  });

  it('frozen holds still', () => {
    const c = phone();
    c.frozen = true;
    expect(feed(c, SLOW, 50)).toEqual([]);
  });

  it('desktop tuning steps under ~40 fps and stops at the floor', () => {
    const c = makeController(
      desktopRungs({ scale: 2, shadows: true, post: true }, 2),
      DESKTOP_TUNING,
    );
    expect(feed(c, { p50: 30, p95: 35 }, 100)).toEqual([1, 2, 3]);
    expect(c.rungs[c.at]!.scale).toBe(1.25);
  });
});
