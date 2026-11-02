import { describe, expect, it } from 'vitest';

import { GROWN_TOWNS, townFrameNow } from '../towns/site';
import { LANDMARKS, landmarkPlace } from '../world/landmarks/sites';
import { bowlMapPoint } from '../world/mountain/noggleBowl';
import {
  MOUNTAIN,
  TERRAIN_LIPSCHITZ,
  sampleTerrain,
  terrainHeight,
} from '../world/mountain/terrain';
import { INFLUENCE, tracks } from '../world/mountain/tracks';

import { STADIUM, pitchToWorld } from './contract';
import {
  PAD,
  SITE,
  inStadium,
  padDistance,
  padLevel,
  stadiumBlocked,
  stadiumFrame,
  stadiumSpawn,
} from './site';
import { STANDABLE_TOP } from './view/stadium/layout';

/** terrain.ts / runProof.ts baseHeight (the radial gradient). */
function baseHeight(x: number, z: number): number {
  const w = MOUNTAIN.wallZ;
  const dx = Math.max(0, Math.abs(x) - w);
  const dz = Math.max(0, Math.abs(z) - w);
  const de = Math.hypot(dx, dz);
  const L = MOUNTAIN.slopeEase;
  return MOUNTAIN.topY - MOUNTAIN.slope * (de - L * (1 - Math.exp(-de / L)));
}

const f = stadiumFrame();
const P = f.y;
const _w = { x: 0, y: 0, z: 0 };
const toWorld = (px: number, pz: number) => pitchToWorld(f, px, 0, pz, _w);

/** Pitch-local points over pad + blend (+ a margin), every `step` m. */
function* region(step: number, extra = SITE.M + 10) {
  for (let px = -PAD.halfX - extra; px <= PAD.halfX + extra; px += step)
    for (let pz = -PAD.halfZ - extra; pz <= PAD.halfZ + extra; pz += step) yield [px, pz] as const;
}

describe('NOUN STADIUM site', () => {
  it('sits down the −Z side, a few km out, off the golf course (−X) and the surf (+X)', () => {
    expect(SITE.z).toBeLessThan(-2000);
    expect(Math.abs(SITE.x)).toBeLessThan(500);
    expect(f.yaw).toBeCloseTo(Math.PI / 2);
  });

  it('is deterministic', () => {
    expect(padLevel()).toBe(P);
    expect(stadiumFrame()).toEqual(f);
    expect(stadiumSpawn()).toEqual(stadiumSpawn());
    expect(Number.isFinite(P)).toBe(true);
  });

  it('is level under the whole stadium and its apron', () => {
    for (const [px, pz] of region(6, 0)) {
      const w = toWorld(px, pz);
      if (padDistance(px, pz) > 0) continue;
      expect(Math.abs(terrainHeight(w.x, w.z) - P)).toBeLessThan(1e-9);
    }
    // the whole outer wall footprint is on the flat
    for (const [px, pz] of [
      [STADIUM.halfX, STADIUM.halfZ],
      [-STADIUM.halfX, STADIUM.halfZ],
      [STADIUM.halfX, -STADIUM.halfZ],
      [-STADIUM.halfX, -STADIUM.halfZ],
    ])
      expect(padDistance(px, pz)).toBeLessThan(-8);
  });

  it('has no track anywhere within reach', () => {
    const reach = Math.hypot(PAD.halfX, PAD.halfZ) + SITE.M;
    // every line only moves away from the city: grow past the far side
    tracks.ensure(Math.hypot(SITE.x, SITE.z) + reach + INFLUENCE + 500);
    let nearest = Infinity;
    for (const t of tracks.tracks)
      for (let i = 0; i < t.xs.length; i++)
        nearest = Math.min(nearest, Math.hypot(t.xs[i] - SITE.x, t.zs[i] - SITE.z));
    expect(nearest).toBeGreaterThan(reach + INFLUENCE + 200);
    // …so no sample there feels a line
    const s = { y: 0, track: 0, alley: 0, side: 0, dist: 0 };
    for (const [px, pz] of region(20)) {
      const w = toWorld(px, pz);
      sampleTerrain(w.x, w.z, s);
      expect(s.dist).toBe(INFLUENCE);
      expect(s.track).toBe(0);
    }
  });

  it('keeps clear of the other set pieces', () => {
    const far = (x: number, z: number, r: number) =>
      expect(Math.hypot(x - SITE.x, z - SITE.z)).toBeGreaterThan(r);
    const reach = Math.hypot(PAD.halfX, PAD.halfZ) + SITE.M;
    for (const def of LANDMARKS) {
      const p = landmarkPlace(def, true);
      if (p !== null) far(p.x, p.z, reach + p.r + 500);
    }
    for (const id of GROWN_TOWNS) {
      const t = townFrameNow(id);
      if (t !== null) far((t.x0 + t.x1) / 2, (t.z0 + t.z1) / 2, reach + 1000);
    }
    const b = bowlMapPoint();
    if (b !== null) far(b.x, b.z, reach + 1000);
  });

  it('blends into the slope within the terrain gradient bound', () => {
    const e = 0.25;
    let worst = 0;
    for (const [px, pz] of region(4)) {
      const w = toWorld(px, pz);
      const gx = (terrainHeight(w.x + e, w.z) - terrainHeight(w.x - e, w.z)) / (2 * e);
      const gz = (terrainHeight(w.x, w.z + e) - terrainHeight(w.x, w.z - e)) / (2 * e);
      worst = Math.max(worst, Math.hypot(gx, gz));
    }
    expect(worst).toBeLessThan(TERRAIN_LIPSCHITZ);
    // and gently: no cliff to ride into
    expect(worst).toBeLessThan(0.9);
  });

  it('is continuous at the pad edge and at the outer edge of the blend', () => {
    for (let k = 0; k < 64; k++) {
      const th = (k / 64) * Math.PI * 2;
      for (const d of [0, SITE.M]) {
        // walk outward along the ray until padDistance crosses d
        const dx = Math.cos(th);
        const dz = Math.sin(th);
        let r = 0;
        while (padDistance(dx * r, dz * r) < d) r += 0.5;
        const a = toWorld(dx * (r - 0.05), dz * (r - 0.05));
        const ax = a.x;
        const az = a.z;
        const b = toWorld(dx * (r + 0.05), dz * (r + 0.05));
        expect(Math.abs(terrainHeight(ax, az) - terrainHeight(b.x, b.z))).toBeLessThan(0.15);
      }
    }
  });

  it('keeps the ground (and everything you can stand on) inside the run-proof band', () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const [px, pz] of region(8)) {
      const w = toWorld(px, pz);
      const d = terrainHeight(w.x, w.z) - baseHeight(w.x, w.z);
      const top = padDistance(px, pz) <= 0 ? STANDABLE_TOP : 0;
      lo = Math.min(lo, d);
      hi = Math.max(hi, d + top);
    }
    expect(lo).toBeGreaterThan(-70 + 10);
    expect(hi).toBeLessThan(55);
  });

  it('keeps the dressing out of the pad, and only there', () => {
    const c = toWorld(0, 0);
    expect(stadiumBlocked(c.x, c.z)).toBe(true);
    const e = toWorld(PAD.halfX + SITE.keepOut - 2, 0);
    expect(stadiumBlocked(e.x, e.z)).toBe(true);
    const o = toWorld(PAD.halfX + SITE.keepOut + 10, 0);
    expect(stadiumBlocked(o.x, o.z)).toBe(false);
    expect(stadiumBlocked(0, 0)).toBe(false);
  });

  it('spawns outside the main entrance, on the pad, facing in', () => {
    const sp = stadiumSpawn();
    expect(inStadium(sp.x, sp.z)).toBe(false);
    expect(inStadium(sp.x, sp.z, 12)).toBe(true);
    expect(Math.abs(terrainHeight(sp.x, sp.z) - P)).toBeLessThan(1e-9);
    // facing the centre spot
    const fx = Math.sin(sp.yaw);
    const fz = Math.cos(sp.yaw);
    const tx = f.x - sp.x;
    const tz = f.z - sp.z;
    expect((fx * tx + fz * tz) / Math.hypot(tx, tz)).toBeGreaterThan(0.999);
  });
});
