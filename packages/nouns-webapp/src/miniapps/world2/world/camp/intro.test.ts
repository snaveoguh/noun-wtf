import { describe, expect, it } from 'vitest';

import { INTRO_SECONDS, introShot, type V3 } from './intro';
import { campLayout } from './layout';
import { CAMP_TOWER, campShellBoxes, campSite, campTier } from './site';

const { tier, y0, top } = campTier(13.6);
const site = campSite(tier, top);
const L = campLayout(
  site.w,
  site.d,
  site.h,
  site.window.x0 - site.origin.x,
  site.window.x1 - site.origin.x,
);
const boxes = campShellBoxes(site, y0, top);
/** The tower below the top tier (inset 0 / 0.9) as solid boxes too. */
const t = CAMP_TOWER;
const lower = [
  { min: [t.x - t.w / 2, 0, t.z - t.d / 2], max: [t.x + t.w / 2, y0, t.z + t.d / 2] },
] as const;
const inside = (p: V3, b: { min: readonly number[]; max: readonly number[] }, m = 0.15) =>
  p[0] > b.min[0]! - m &&
  p[0] < b.max[0]! + m &&
  p[1] > b.min[1]! - m &&
  p[1] < b.max[1]! + m &&
  p[2] > b.min[2]! - m &&
  p[2] < b.max[2]! + m;

describe("CAMP's opening shot", () => {
  for (const sp of L.spawns) {
    const o = site.origin;
    const rider: V3 = [o.x + sp.x, site.floorY, o.z + sp.z];
    // The game camera: 3.6 m behind (deeper in the room), 1.7 up
    const back = [-Math.sin(sp.yaw), -Math.cos(sp.yaw)];
    const final: V3 = [
      Math.min(site.room.maxX - 0.3, Math.max(site.room.minX + 0.3, rider[0] + back[0]! * 3)),
      site.floorY + 2.1,
      Math.min(site.room.maxZ - 0.3, rider[2] + back[1]! * 3),
    ];
    const look: V3 = [rider[0], rider[1] + 1.3, rider[2]];
    const shot = introShot(site, rider, final, look, 62);

    it(`from spawn ${sp.x},${sp.z}: starts far over the city, ends on the game camera`, () => {
      const a = shot(0);
      expect(Math.hypot(a.pos[0] - o.x, a.pos[2] - site.faceZ)).toBeGreaterThan(100);
      expect(a.pos[2]).toBeLessThan(site.faceZ - 50); // out over the plaza
      const z = shot(INTRO_SECONDS);
      z.pos.forEach((v, i) => expect(v).toBeCloseTo(final[i]!, 3));
      z.look.forEach((v, i) => expect(v).toBeCloseTo(look[i]!, 3));
      expect(z.fov).toBeCloseTo(62, 3);
    });

    it(`from spawn ${sp.x},${sp.z}: comes in through the window, never through a wall`, () => {
      let crossed = false;
      let prev = shot(0).pos;
      for (let s = 0.01; s <= INTRO_SECONDS; s += 0.01) {
        const p = shot(s).pos;
        for (const b of [...boxes, ...lower])
          expect(inside(p, b), `t=${s.toFixed(2)} in the tower`).toBe(false);
        if (prev[2] < site.faceZ && p[2] >= site.faceZ) {
          crossed = true;
          // …inside the opening
          expect(p[0]).toBeGreaterThan(site.window.x0 + 0.3);
          expect(p[0]).toBeLessThan(site.window.x1 - 0.3);
          expect(p[1]).toBeGreaterThan(site.window.y0 + 0.3);
          expect(p[1]).toBeLessThan(site.window.y1 - 0.3);
        }
        prev = p;
      }
      expect(crossed).toBe(true);
    });
  }

  it('moves smoothly (no jumps between frames at 60 fps)', () => {
    const sp = L.spawns[0]!;
    const o = site.origin;
    const rider: V3 = [o.x + sp.x, site.floorY, o.z + sp.z];
    const final: V3 = [rider[0], site.floorY + 2.1, rider[2] + 3];
    const shot = introShot(site, rider, final, [rider[0], rider[1] + 1.3, rider[2]], 62);
    let prev = shot(0).pos;
    let maxStep = 0;
    for (let s = 1 / 60; s <= INTRO_SECONDS; s += 1 / 60) {
      const p = shot(s).pos;
      maxStep = Math.max(maxStep, Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]));
      prev = p;
    }
    // Fastest over the city (~60 m/s), never a teleport
    expect(maxStep).toBeLessThan(2);
  });
});
