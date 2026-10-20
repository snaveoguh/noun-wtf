import { describe, expect, it, vi } from 'vitest';

import { MOUNTAIN, edgeDistance } from '../world/mountain/config';
import { bowlFrameNow } from '../world/mountain/noggleBowl';
import { njFrameNow } from '../world/mountain/nounJersey';
import { TERRAIN_LIPSCHITZ, terrainHeight } from '../world/mountain/terrain';
import { TOWN_SITE, TOWN_SITES, tracks } from '../world/mountain/tracks';

import {
  GROWN_TOWNS,
  LAGOON,
  TOWN,
  placementOf,
  townBlocked,
  townCoords,
  townFrameNow,
  townGround,
  townSpawn,
  townToWorld,
  type TownFrame,
} from './site';
import { TOWNS } from './specs';

const warn = vi.spyOn(console, 'warn');
const frames = {} as Record<(typeof GROWN_TOWNS)[number], TownFrame>;
for (const id of GROWN_TOWNS) frames[id] = townFrameNow(id)!;

describe('town sites', () => {
  it('every town resolves on its main line, with no other line in reach', () => {
    for (const id of GROWN_TOWNS) {
      const f = frames[id];
      expect(f).not.toBeNull();
      expect(f.site.track.id).toBe(TOWN_SITES.find(q => q.town === id)!.track);
      expect(f.site.track.depth).toBe(0);
    }
    expect(warn.mock.calls.some(c => String(c[0]).includes('town'))).toBe(false);
  });

  it('placement is deterministic (fixed numbers: every client must agree)', () => {
    const c = frames.cowboy;
    const b = frames.beach;
    expect(Math.round(c.site.s)).toBe(11400);
    expect(Math.round(b.site.s)).toBe(28800);
    expect([Math.round(c.ox), Math.round(c.oz), c.side, Math.round(c.P), c.Lf]).toMatchSnapshot();
    expect([Math.round(b.ox), Math.round(b.oz), b.side, Math.round(b.P), b.Lf]).toMatchSnapshot();
    // The weird towns: pinned along-track like the others
    for (const id of ['noggle', 'shroom', 'neon', 'crater'] as const) {
      const f = frames[id];
      expect(Math.round(f.site.s)).toBe(TOWN_SITES.find(q => q.town === id)!.at);
      expect([Math.round(f.ox), Math.round(f.oz), f.side, Math.round(f.P), f.Lf]).toMatchSnapshot();
    }
  });

  it('sits ~10 km and ~25 km out, nowhere near the city', () => {
    const dc = edgeDistance(frames.cowboy.ox, frames.cowboy.oz);
    const db = edgeDistance(frames.beach.ox, frames.beach.oz);
    expect(dc).toBeGreaterThan(9000);
    expect(dc).toBeLessThan(11500);
    expect(db).toBeGreaterThan(23000);
    expect(db).toBeLessThan(27000);
    // Whole terrace (incl. blends) far out: nothing near the city changes
    for (const f of Object.values(frames))
      for (const [x, z] of [
        [f.x0, f.z0],
        [f.x1, f.z1],
        [f.x0, f.z1],
        [f.x1, f.z0],
      ])
        expect(edgeDistance(x, z)).toBeGreaterThan(8500);
  });

  it('leaves Noun Jersey and the Noggle Bowl exactly where they were', () => {
    const nj = njFrameNow()!;
    expect(nj.ox).toBeCloseTo(4282.0568796537445, 6);
    expect(nj.oz).toBeCloseTo(18516.490389265764, 6);
    expect(nj.side).toBe(1);
    expect(nj.P).toBeCloseTo(-2667.19663141011, 6);
    const bw = bowlFrameNow()!;
    expect(bw.ox).toBeCloseTo(-39956.33324411986, 6);
    expect(bw.oz).toBeCloseTo(-14442.991156267351, 6);
    expect(bw.P).toBeCloseTo(-5967.716495515085, 6);
  });

  it('leaves the +X line untouched for its first 10 km', () => {
    const t = tracks.main(1);
    const p = { x: 0, z: 0, h: 0, k: 0 };
    tracks.pointAt(t, 10000, p);
    expect(p.x).toBeCloseTo(8558.79, 1);
    expect(p.z).toBeCloseTo(-2915.58, 1);
    expect(t.megas.slice(0, 3).map(m => Math.round(m.s))).toEqual([2934, 6668, 10271]);
  });

  it('runs the line dead straight and ramp-free through town', () => {
    for (const f of Object.values(frames)) {
      const t = f.site.track;
      const p = { x: 0, z: 0, h: 0, k: 0 };
      for (let u = -TOWN_SITE.pre + 12; u <= TOWN_SITE.post - 12; u += 12) {
        tracks.pointAt(t, f.site.s + u, p);
        const c = townCoords(f, p.x, p.z);
        expect(Math.abs(c.vp)).toBeLessThan(0.05);
      }
      for (const r of t.ramps)
        expect(r.s < f.site.s - 260 || r.s > f.site.s + f.Lf + 40).toBe(true);
      // No branch forks inside the town
      for (const b of tracks.tracks)
        if (b.parent === t) expect(b.s0 < f.site.s - 200 || b.s0 > f.site.s + f.Lf + 60).toBe(true);
    }
  });

  it('levels the pad, and the line through town never climbs', () => {
    for (const f of Object.values(frames)) {
      const w = { x: 0, z: 0 };
      for (const vp of [-30, 0, 20])
        for (const u of [5, 60, 120, 200, f.Lf - 2]) {
          townToWorld(f, vp, u, w);
          expect(terrainHeight(w.x, w.z)).toBeCloseTo(townGround(f, u, vp), 4);
        }
      let prev = Infinity;
      for (let u = -TOWN.M_UP; u <= f.Lf + TOWN.M_DN; u += 2) {
        townToWorld(f, 0, u, w);
        const y = terrainHeight(w.x, w.z);
        expect(y).toBeLessThanOrEqual(prev + 0.02);
        prev = y;
      }
    }
  });

  it('keeps the terrace blends within the collision tracer gradient bound', () => {
    let max = 0;
    const w = { x: 0, z: 0 };
    const e = 0.5;
    for (const f of Object.values(frames))
      for (let u = -TOWN.M_UP - 10; u <= f.Lf + TOWN.M_DN + 10; u += 6)
        for (let vp = f.vmin - TOWN.M_LAT - 10; vp <= f.vmax + TOWN.M_LAT + 10; vp += 6) {
          townToWorld(f, vp, u, w);
          const gx = (terrainHeight(w.x + e, w.z) - terrainHeight(w.x - e, w.z)) / (2 * e);
          const gz = (terrainHeight(w.x, w.z + e) - terrainHeight(w.x, w.z - e)) / (2 * e);
          max = Math.max(max, Math.hypot(gx, gz));
        }
    expect(max).toBeLessThan(TERRAIN_LIPSCHITZ);
  });

  it('cuts the beach lagoon below the water line, rimmed by sand', () => {
    const f = frames.beach;
    const mid = (LAGOON.v1 + LAGOON.v2) / 2;
    expect(townGround(f, f.Lf / 2, mid)).toBeCloseTo(f.P - TOWN.lagoonFloor, 4);
    // Rim (pad level) all round the water rectangle drawn by build.ts
    expect(townGround(f, f.Lf / 2, LAGOON.v0 - 1)).toBeCloseTo(f.P, 4);
    expect(townGround(f, f.Lf / 2, LAGOON.v3 + 1)).toBeCloseTo(f.P, 4);
    expect(townGround(f, LAGOON.uIn0 - 1, mid)).toBeCloseTo(f.P, 4);
    expect(frames.cowboy.lagoon).toBe(false);
  });

  it('keeps the dressing off the pad, but not off the open slope', () => {
    for (const f of Object.values(frames)) {
      const w = townToWorld(f, 20, 100, { x: 0, z: 0 });
      expect(townBlocked(w.x, w.z)).toBe(true);
      townToWorld(f, f.vmax + 50, 100, w);
      expect(townBlocked(w.x, w.z)).toBe(false);
    }
    expect(townBlocked(150, 0)).toBe(false);
  });

  it('spawns on the line at the top of main street', () => {
    for (const id of GROWN_TOWNS) {
      const s = townSpawn(id)!;
      expect(s.y).toBeCloseTo(frames[id].P + 0.05, 4);
      const pl = placementOf(frames[id]);
      expect(Math.hypot(pl.x - s.x, pl.z - s.z)).toBeLessThan(pl.r);
    }
  });

  it('town specs name the line each town sits on', () => {
    expect(TOWNS.cowboy.track).toBe(frames.cowboy.site.track.id);
    expect(TOWNS.beach.track).toBe(frames.beach.site.track.id);
    expect(MOUNTAIN.trackHalf).toBeLessThan(8);
  });
});
