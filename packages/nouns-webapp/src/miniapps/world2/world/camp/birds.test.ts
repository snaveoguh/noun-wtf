import { describe, expect, it } from 'vitest';

import { BIRDS, birdAt } from './birds';
import { campSite, campTier } from './site';

const { tier, top } = campTier(13.6);
const site = campSite(tier, top);

describe("the birds round CAMP's tower", () => {
  it('stay out in front of the plaza face (never in the tower), round the window height', () => {
    for (let i = 0; i < BIRDS; i++)
      for (let t = 0; t < 120; t += 0.5) {
        const b = birdAt(site, i, t);
        expect(b.z).toBeLessThan(site.faceZ - 5);
        expect(b.y).toBeGreaterThan(site.floorY - 2);
        expect(b.y).toBeLessThan(site.floorY + 12);
        expect(Math.abs(b.flap)).toBeLessThanOrEqual(1);
      }
  });

  it('cross in front of the window now and then (the opening shot sees them)', () => {
    let near = 0;
    for (let t = 0; t < 60; t += 0.25)
      for (let i = 0; i < BIRDS; i++) {
        const b = birdAt(site, i, t);
        if (Math.abs(b.x - site.origin.x) < 6 && b.z > site.faceZ - 25) near++;
      }
    expect(near).toBeGreaterThan(20);
  });

  it('face the way they fly', () => {
    const a = birdAt(site, 3, 10);
    const b = birdAt(site, 3, 10.05);
    const heading = Math.atan2(b.x - a.x, b.z - a.z);
    const d = Math.atan2(Math.sin(heading - a.yaw), Math.cos(heading - a.yaw));
    expect(Math.abs(d)).toBeLessThan(0.2);
  });
});
