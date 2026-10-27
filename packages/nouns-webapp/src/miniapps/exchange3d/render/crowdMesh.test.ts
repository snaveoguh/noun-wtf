import { describe, expect, it } from 'vitest';

import { LEG_SWING, LOW, lowNounGeometry, PART, swingLeg } from './crowdMesh';

// The bug: walkers between pits "lose their legs and turn into a 3D block"
// when the LOD hands them from a rig to the instanced crowd. The crowd's
// low-poly Noun now has legs that walk.

describe('exchange3d low-poly Noun', () => {
  const g = lowNounGeometry();
  const pos = g.getAttribute('position');
  const part = g.getAttribute('aPart');
  const side = g.getAttribute('aSide');

  it('has two legs (trousers + shoes) under the torso, reaching the floor', () => {
    const legs = { l: 0, r: 0 };
    let minLegY = Infinity;
    let maxLegY = -Infinity;
    let minArtY = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const p = part.getX(i);
      const y = pos.getY(i);
      if (p === PART.art) {
        expect(side.getX(i)).toBe(0);
        minArtY = Math.min(minArtY, y);
      } else {
        expect(p === PART.trouser || p === PART.shoe).toBe(true);
        if (side.getX(i) < 0) legs.l++;
        else legs.r++;
        minLegY = Math.min(minLegY, y);
        maxLegY = Math.max(maxLegY, y);
      }
    }
    expect(legs.l).toBeGreaterThan(0);
    expect(legs.l).toBe(legs.r);
    expect(minLegY).toBe(0); // shoes on the floor
    expect(minArtY).toBeCloseTo(LOW.hipY); // the torso starts at the hip
    expect(maxLegY).toBeGreaterThanOrEqual(LOW.hipY); // no gap at the hip
    expect(part.count).toBe(pos.count);
    expect(side.count).toBe(pos.count);
  });

  it('swings a leg about the hip: the hip stays put, the foot moves', () => {
    const hip = swingLeg(LOW.hipY, 0, LEG_SWING);
    expect(hip.y).toBeCloseTo(LOW.hipY);
    expect(hip.z).toBeCloseTo(0);
    const foot = swingLeg(0, 0, LEG_SWING);
    expect(Math.abs(foot.z)).toBeGreaterThan(0.2);
    // Leg length is kept
    expect(Math.hypot(foot.y - LOW.hipY, foot.z)).toBeCloseTo(LOW.hipY);
    // Standing (no swing): unchanged
    expect(swingLeg(0.1, 0.05, 0)).toEqual({ y: expect.closeTo(0.1), z: expect.closeTo(0.05) });
  });
  it('far LOD: same silhouette on one trouser block, half the triangles, nothing swings', () => {
    const far = lowNounGeometry(true);
    const fp = far.getAttribute('position');
    const fs = far.getAttribute('aSide');
    expect(fp.count * 2).toBeLessThanOrEqual(pos.count);
    let minY = Infinity;
    let maxX = 0;
    for (let i = 0; i < fp.count; i++) {
      expect(fs.getX(i)).toBe(0);
      if (far.getAttribute('aPart').getX(i) !== PART.art) {
        minY = Math.min(minY, fp.getY(i));
        maxX = Math.max(maxX, Math.abs(fp.getX(i)));
      }
    }
    expect(minY).toBe(0);
    expect(maxX).toBeCloseTo(LOW.legX + LOW.legW / 2);
  });
});
