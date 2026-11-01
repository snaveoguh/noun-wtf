import { describe, expect, it } from 'vitest';

import { INTRO_SECONDS, introShot, type V3 } from './intro';
import {
  FLICKER,
  maxCutsPerWindow,
  STYLES_END,
  steppedTime,
  styleAt,
  styleCuts,
  windowCrossAt,
} from './introStyles';
import { campLayout } from './layout';
import { readingShot } from './reading';
import { campSite, campTier } from './site';

const { tier, top } = campTier(13.6);
const site = campSite(tier, top);
const L = campLayout(
  site.w,
  site.d,
  site.h,
  site.window.x0 - site.origin.x,
  site.window.x1 - site.origin.x,
);
/** Where the real shot crosses the window, from every spawn. */
const crosses = L.spawns.map(sp => {
  const o = site.origin;
  const rider: V3 = [o.x + sp.x, site.floorY, o.z + sp.z];
  const sh = readingShot(rider, sp.yaw);
  const shot = introShot(site, rider, sh.cam, sh.look, 38, sh.approach);
  return windowCrossAt(s => shot(s).pos, site.faceZ, INTRO_SECONDS);
});
const CROSSES = [...crosses, 4, 5.3, 6.1, 7.4];

describe("CAMP intro's style cuts", () => {
  it('finds the window crossing on the real shot', () => {
    for (const c of crosses) {
      expect(c).toBeGreaterThan(5);
      expect(c).toBeLessThan(6.5);
    }
  });

  it('starts super trippy, at full strength', () => {
    const f = styleAt(0);
    expect(f.style).toBe('trip');
    expect(f.amt).toBe(1);
  });

  it('plays trip → anime → haze → b&w → the game, cutting to b&w at the window', () => {
    for (const cross of crosses) {
      const order: string[] = [];
      for (const c of styleCuts(cross)) if (c.flicker !== true) order.push(c.style);
      const dedup = order.filter((s, i) => s !== order[i - 1]);
      expect(dedup).toEqual(['trip', 'anime', 'haze', 'bw', 'none']);
      const bw = styleCuts(cross).find(c => c.style === 'bw' && c.flicker !== true)!;
      expect(bw.at).toBeCloseTo(cross, 6);
    }
  });

  it('is the untouched look well before the hand-off, and stays so', () => {
    for (const cross of CROSSES) {
      const cuts = styleCuts(cross);
      const last = cuts[cuts.length - 1]!;
      expect(last.style).toBe('none');
      expect(last.at).toBeLessThanOrEqual(STYLES_END);
      expect(last.at).toBeLessThan(INTRO_SECONDS - 0.3);
      for (let t = last.at; t <= INTRO_SECONDS + 5; t += 0.01)
        expect(styleAt(t, { cross }).style).toBe('none');
    }
  });

  it('cuts are hard: the look only changes at a cut, and the cuts are in order', () => {
    for (const cross of CROSSES) {
      const cuts = styleCuts(cross);
      for (let i = 1; i < cuts.length; i++) expect(cuts[i]!.at).toBeGreaterThan(cuts[i - 1]!.at);
      const at = new Set(cuts.map(c => c.at));
      let prev = styleAt(0, { cross });
      for (let t = 0.001; t < INTRO_SECONDS; t += 0.001) {
        const f = styleAt(t, { cross });
        if (f.style !== prev.style) {
          // within a millisecond of a listed cut, from one look straight to another
          expect([...at].some(a => Math.abs(a - t) <= 0.0011)).toBe(true);
        } else if (f.since === prev.since) {
          // inside a section the strength only drifts (no dissolve, no jump)
          expect(Math.abs(f.amt - prev.amt)).toBeLessThan(0.01);
        }
        prev = f;
      }
    }
  });

  it('flickers are a few frames long', () => {
    const cuts = styleCuts();
    for (let i = 0; i < cuts.length; i++) {
      if (cuts[i]!.flicker !== true) continue;
      const len = cuts[i + 1]!.at - cuts[i]!.at;
      expect(len).toBeCloseTo(FLICKER, 6);
      expect(len * 60).toBeGreaterThanOrEqual(2);
      expect(len * 60).toBeLessThanOrEqual(4 + 1e-9);
    }
  });

  it('never more than 3 hard changes in any second (WCAG 2.3.1: ≤ 1.5 flashes/s)', () => {
    for (const cross of CROSSES) expect(maxCutsPerWindow(styleCuts(cross))).toBeLessThanOrEqual(3);
  });

  it('reduced motion / the setting off: nothing, ever', () => {
    for (let t = 0; t < INTRO_SECONDS; t += 0.05) {
      const f = styleAt(t, { off: true });
      expect(f.style).toBe('none');
      expect(f.step).toBe(0);
    }
  });

  it('anime is on twos: the camera holds for 1/12 s at a time', () => {
    const f = styleAt(2.0);
    expect(f.style).toBe('anime');
    expect(f.step).toBe(12);
    const held = new Set<number>();
    for (let t = 2.0; t < 2.5; t += 1 / 120) held.add(steppedTime(t, styleAt(t)));
    expect(held.size).toBeGreaterThanOrEqual(5);
    expect(held.size).toBeLessThanOrEqual(7);
    // every other look follows the clock
    expect(steppedTime(0.7, styleAt(0.7))).toBe(0.7);
    expect(steppedTime(4.0, styleAt(4.0))).toBe(4.0);
  });

  it('eases off as you come to', () => {
    expect(styleAt(1.5).amt).toBeLessThan(styleAt(0.2).amt);
    expect(styleAt(5.3, { cross: 5.6 }).amt).toBeLessThan(styleAt(3.3, { cross: 5.6 }).amt);
    expect(styleAt(6.5, { cross: 5.6 }).amt).toBeLessThan(styleAt(5.65, { cross: 5.6 }).amt);
  });
});
