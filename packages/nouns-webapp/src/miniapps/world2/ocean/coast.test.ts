import { describe, expect, it } from 'vitest';

import { GROWN_TOWNS, LAGOON, townFrameNow, townToWorld } from '../towns/site';
import { edgeDistance } from '../world/mountain/config';
import {
  TERRAIN_LIPSCHITZ,
  sampleTerrain,
  terrainHeight,
  type TerrainSample,
} from '../world/mountain/terrain';
import { tracks } from '../world/mountain/tracks';

import {
  COAST,
  bandHi,
  bandLo,
  coastAt,
  coastFrameNow,
  oceanBlocked,
  seabedDepth,
  shoreDistUV,
  type CoastPoint,
} from './coast';

const c = coastFrameNow()!;
const f = c.town;
const cp: CoastPoint = { d: 0, a: 0, u: 0, vp: 0 };
const w = { x: 0, z: 0 };
const at = (vp: number, u: number) => townToWorld(f, vp, u, w);

describe('the coast off Puerto Noun', () => {
  it('sits on the beach side, sea level under the pad', () => {
    expect(c).not.toBeNull();
    expect(c.sea).toBeCloseTo(f.P - COAST.seaDown, 6);
    // straight in front of the town
    for (let u = 0; u <= f.Lf; u += 10) expect(shoreDistUV(u, COAST.shore, c.uB)).toBeCloseTo(0, 1);
    expect(shoreDistUV(c.uB, 10, c.uB)).toBeLessThan(-100);
    expect(shoreDistUV(c.uB, 600, c.uB)).toBeGreaterThan(400);
  });

  it('leaves the pad and the lagoon alone, beaches down to the water', () => {
    const s: TerrainSample = { y: 0, track: 0, alley: 0, side: 0, dist: 0 };
    for (let u = 10; u <= f.Lf - 10; u += 15) {
      for (const vp of [-30, 0, 30, 80, LAGOON.v3 + 2]) {
        const p = at(vp, u);
        const lag = vp > LAGOON.v0 && vp < LAGOON.v3;
        if (!lag) expect(terrainHeight(p.x, p.z)).toBeCloseTo(f.P, 1);
      }
      // the outer beach: sand, falling to the sea at the shore, then the seabed
      const s0 = at(COAST.shore, u);
      expect(terrainHeight(s0.x, s0.z)).toBeCloseTo(c.sea, 1);
      const s1 = at(COAST.shore + 100, u);
      expect(terrainHeight(s1.x, s1.z)).toBeCloseTo(c.sea - seabedDepth(100), 1);
      const b = at(COAST.shore - 6, u);
      sampleTerrain(b.x, b.z, s);
      expect(s.sand).toBeGreaterThan(0.8);
      expect(s.y).toBeGreaterThan(c.sea);
    }
  });

  it('the main line and every other town stay dry and clear of the beach', () => {
    tracks.ensure(edgeDistance(f.ox, f.oz) + COAST.far + 2000);
    const main = tracks.tracks.find(t => t.id === f.site.track.id)!;
    let minT = Infinity;
    for (let i = 0; i < main.xs.length; i++) {
      const d = coastAt(c, main.xs[i], main.zs[i], cp).d;
      minT = Math.min(minT, -d);
    }
    // ~120 m: the town's own main street (v' = 0) is 132 m from the shore
    expect(minT).toBeGreaterThan(115);
    // past the town, the band (berm + fall) never reaches the line
    for (let i = 0; i < main.xs.length; i++) {
      const p = coastAt(c, main.xs[i], main.zs[i], cp);
      if (p.u > -100 && p.u < f.Lf + 100) continue;
      if (p.d > -COAST.reach) {
        const s = { y: 0, track: 0, alley: 0, side: 0, dist: 0 };
        sampleTerrain(main.xs[i], main.zs[i], s);
        expect(s.track).toBeGreaterThan(0.3);
      }
    }
    for (const id of GROWN_TOWNS) {
      if (id === 'beach') continue;
      const g = townFrameNow(id)!;
      expect(coastAt(c, g.ox, g.oz, cp).d).toBeLessThan(-COAST.reach);
    }
  });

  it('the band: berm over the sea at the water, never steeper than the terrain bound', () => {
    expect(bandLo(0)).toBe(0);
    expect(bandHi(0)).toBe(0);
    for (let t = 0; t < 1200; t += 0.5) {
      expect(bandLo(t)).toBeLessThanOrEqual(bandHi(t));
      expect(Math.abs(bandHi(t + 0.5) - bandHi(t)) / 0.5).toBeLessThan(0.9);
      expect(Math.abs(bandLo(t + 0.5) - bandLo(t)) / 0.5).toBeLessThan(0.9);
    }
    // by the edge of its reach it no longer bites anywhere near
    expect(bandHi(COAST.reach)).toBeGreaterThan(900);
    expect(bandLo(COAST.reach)).toBeLessThan(-700);
  });

  it('stays inside the Lipschitz bound the ray marcher relies on', () => {
    let worst = 0;
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const e = 0.5;
    for (let i = 0; i < 4000; i++) {
      // the beach, the arms, the far ring
      const u = -1600 + rnd() * 3600;
      const vp = 40 + rnd() * 3400;
      const p = at(vp, u);
      if (Math.abs(shoreDistUV(u, vp, c.uB)) > 1300) continue;
      const h = terrainHeight(p.x, p.z);
      const gx = (terrainHeight(p.x + e, p.z) - h) / e;
      const gz = (terrainHeight(p.x, p.z + e) - h) / e;
      worst = Math.max(worst, Math.hypot(gx, gz));
    }
    expect(worst).toBeLessThan(TERRAIN_LIPSCHITZ);
  });

  it('keeps the dressing off the sea and the beach', () => {
    const p = at(COAST.shore + 300, c.uB);
    expect(oceanBlocked(p.x, p.z)).toBe(true);
    const q = at(-30, c.uB - 2000);
    expect(oceanBlocked(q.x, q.z)).toBe(false);
  });
});
