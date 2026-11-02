import { describe, expect, it } from 'vitest';

import { LANDMARKS, landmarkPlace } from '../../world/landmarks/sites';
import { MOUNTAIN, edgeDistance } from '../../world/mountain/config';
import { bowlFrameNow } from '../../world/mountain/noggleBowl';
import { njFrameNow } from '../../world/mountain/nounJersey';
import { TERRAIN_LIPSCHITZ, terrainHeight } from '../../world/mountain/terrain';
import { TOWN_SITES, TRACK_STEP, tracks } from '../../world/mountain/tracks';
import {
  LINE_TOWNS,
  townBlocked,
  townCoords,
  townFrameNow,
  townGround,
  townToWorld,
  type TownFrame,
} from '../site';

import {
  PINES_LAKE,
  padCoords,
  sideTownFrame,
  spurHeight,
  stationFrame,
  stationGround,
  stationToWorld,
} from './pads';
import { SIDE_MARGIN, SIDE_TOWNS, SPUR, STATION_MARGIN, STATIONS, type SideTownId } from './places';

const sides = Object.fromEntries(
  SIDE_TOWNS.map(st => [st.id, sideTownFrame(st.id, true)!]),
) as Record<SideTownId, NonNullable<ReturnType<typeof sideTownFrame>>>;
const stations = STATIONS.map(st => ({ st, f: stationFrame(st.id, true)! }));
const lineFrames = LINE_TOWNS.map(id => townFrameNow(id)!);

const w = { x: 0, z: 0 };

/** Every track point inside the rectangle (u, v') of a frame. */
function linesIn(
  f: { ox: number; oz: number; fx: number; fz: number; rx: number; rz: number; side: number },
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  skip?: (t: (typeof tracks.tracks)[number], s: number) => boolean,
) {
  const hits: string[] = [];
  const c = { u: 0, vp: 0 };
  for (const t of tracks.tracks)
    for (let i = 0; i < t.xs.length; i++) {
      padCoords(f as never, t.xs[i]!, t.zs[i]!, c);
      if (
        c.u > u0 &&
        c.u < u1 &&
        c.vp > v0 &&
        c.vp < v1 &&
        skip?.(t, t.s0 + i * TRACK_STEP) !== true
      )
        hits.push(`${t.id}@${Math.round(t.s0 + i * TRACK_STEP)}`);
    }
  return hits;
}

describe('side towns', () => {
  it('resolve beside their main line, at fixed numbers (every client must agree)', () => {
    for (const st of SIDE_TOWNS) {
      const f = sides[st.id];
      expect(f.site.track.id).toBe(st.track);
      expect(f.site.track.depth).toBe(0);
      expect(f.Lf).toBe(st.len);
      // Main street is `off` m from the line at the junction
      const j = tracks.pointAt(f.site.track, st.s, { x: 0, z: 0, h: 0, k: 0 });
      const c = townCoords(f, j.x, j.z);
      expect(c.vp).toBeCloseTo(-st.off, 3);
      expect(c.u).toBeCloseTo(st.len / 2, 3);
      expect([Math.round(f.ox), Math.round(f.oz), f.side, Math.round(f.P)]).toMatchSnapshot(st.id);
    }
  });

  it('no line (their own included) comes inside the terrace or its blends', () => {
    for (const st of SIDE_TOWNS) {
      const f = sides[st.id];
      const hits = linesIn(
        f,
        -SIDE_MARGIN.up - 10,
        f.Lf + SIDE_MARGIN.dn + 10,
        f.vmin - SIDE_MARGIN.lat - 8,
        f.vmax + SIDE_MARGIN.lat + 10,
      );
      expect(hits, st.id).toEqual([]);
    }
  });

  it('levels the pad (the lake cut into Loon Lake), the spur graded from the road to it', () => {
    for (const st of SIDE_TOWNS) {
      const f = sides[st.id];
      for (const vp of [f.vmin + 2, -9, 0, 9, f.vmax - 2])
        for (const u of [3, 40, 90, 150, f.Lf - 3]) {
          townToWorld(f, vp, u, w);
          expect(terrainHeight(w.x, w.z)).toBeCloseTo(townGround(f, u, vp), 3);
        }
      // Spur: on its centre line the ground is the spur's grade from 10 m off the road on
      const sp = f.spur;
      expect(Math.abs(sp.yb - sp.ya)).toBeLessThanOrEqual(4.01);
      for (let t = 10; t <= sp.len; t += 6) {
        const y = terrainHeight(sp.ax + sp.dx * t, sp.az + sp.dz * t);
        expect(y).toBeCloseTo(spurHeight(sp, t), 2);
      }
      // …and it's the road's own height where it leaves the road
      const x0 = sp.ax - sp.dx * 0.5;
      const z0 = sp.az - sp.dz * 0.5;
      expect(Math.abs(terrainHeight(x0, z0) - sp.ya)).toBeLessThan(0.6);
    }
  });

  it('cuts Loon Lake under the water line, rimmed at pad level', () => {
    const f = sides.pines;
    expect(f.lagoon).toBe(true);
    const mid = (PINES_LAKE.v1 + PINES_LAKE.v2) / 2;
    expect(townGround(f, f.Lf / 2, mid)).toBeCloseTo(f.P - 1.7, 3);
    expect(townGround(f, f.Lf / 2, PINES_LAKE.v0 - 1)).toBeCloseTo(f.P, 4);
    expect(townGround(f, f.Lf / 2, PINES_LAKE.v3 + 1)).toBeCloseTo(f.P, 4);
    expect(sides.peak.lagoon).toBe(false);
  });

  it('keeps blends + spur within the collision tracer gradient bound', () => {
    let max = 0;
    const e = 0.5;
    const grad = (x: number, z: number) => {
      const gx = (terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e);
      const gz = (terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
      return Math.hypot(gx, gz);
    };
    for (const st of SIDE_TOWNS) {
      const f = sides[st.id];
      for (let u = -SIDE_MARGIN.up - 6; u <= f.Lf + SIDE_MARGIN.dn + 6; u += 6)
        for (let vp = -st.off - 4; vp <= f.vmax + SIDE_MARGIN.lat + 6; vp += 5) {
          townToWorld(f, vp, u, w);
          max = Math.max(max, grad(w.x, w.z));
        }
    }
    for (const { f } of stations)
      for (let u = -f.endUp - 4; u <= f.Lf + f.endDn + 4; u += 3)
        for (let vp = -8; vp <= f.vmax + f.far + 4; vp += 2.5) {
          stationToWorld(f, vp, u, w);
          max = Math.max(max, grad(w.x, w.z));
        }
    expect(max).toBeLessThan(TERRAIN_LIPSCHITZ);
  });

  it('keeps the dressing off the pads and spurs', () => {
    for (const st of SIDE_TOWNS) {
      const f = sides[st.id];
      townToWorld(f, 20, 100, w);
      expect(townBlocked(w.x, w.z)).toBe(true);
      const sp = f.spur;
      expect(townBlocked(sp.ax + sp.dx * sp.len * 0.5, sp.az + sp.dz * sp.len * 0.5)).toBe(true);
      townToWorld(f, f.vmax + 60, 100, w);
      expect(townBlocked(w.x, w.z)).toBe(false);
    }
  });
});

describe('stations', () => {
  it('ids are unique and every site resolves deterministically', () => {
    expect(new Set(STATIONS.map(s => s.id)).size).toBe(STATIONS.length);
    for (const { st, f } of stations) {
      expect(f).not.toBeNull();
      expect(Math.abs(f.grade)).toBeLessThan(0.2);
      expect([
        Math.round(f.ox),
        Math.round(f.oz),
        f.side,
        Math.round(f.P),
        +f.grade.toFixed(3),
      ]).toMatchSnapshot(st.id);
    }
  });

  it('never touch the road: the line stays outside the forecourt and its road-side blend', () => {
    for (const { st, f } of stations) {
      const t = tracks.tracks.find(q => q.id === st.track && q.depth === 0)!;
      const c = { u: 0, vp: 0 };
      for (let ds = -f.Lf / 2 - f.endUp - 4; ds <= f.Lf / 2 + f.endDn + 4; ds += 3) {
        const p = tracks.pointAt(t, st.s + ds, { x: 0, z: 0, h: 0, k: 0 });
        padCoords(f, p.x, p.z, c);
        // Road edge (centre + half width) short of where the blend starts
        expect(c.vp + MOUNTAIN.trackHalf, st.id).toBeLessThanOrEqual(
          f.vmin - STATION_MARGIN.road + 0.01,
        );
      }
    }
  });

  it('no other line comes near a forecourt', () => {
    for (const { st, f } of stations) {
      const own = tracks.tracks.find(q => q.id === st.track && q.depth === 0)!;
      const hits = linesIn(f, -60, f.Lf + 60, f.vmin - 40, f.vmax + 50, t => t === own);
      expect(hits, st.id).toEqual([]);
    }
  });

  it('follow the road grade: forecourt height = P + grade · u, the road beside it within ~0.6 m', () => {
    for (const { st, f } of stations) {
      const t = tracks.tracks.find(q => q.id === st.track && q.depth === 0)!;
      for (const u of [2, f.Lf / 2, f.Lf - 2]) {
        stationToWorld(f, (f.vmin + f.vmax) / 2, u, w);
        expect(terrainHeight(w.x, w.z)).toBeCloseTo(stationGround(f, u), 3);
        const p = tracks.pointAt(t, st.s - f.Lf / 2 + u, { x: 0, z: 0, h: 0, k: 0 });
        expect(Math.abs(terrainHeight(p.x, p.z) - stationGround(f, u)), st.id).toBeLessThan(0.8);
      }
    }
  });
});

describe('clear of everything else', () => {
  const boxes = () => [
    ...Object.values(sides).map(f => ({ ...f, id: f.id as string })),
    ...stations.map(({ st, f }) => ({ id: st.id, x0: f.x0, z0: f.z0, x1: f.x1, z1: f.z1 })),
  ];
  const overlap = (a: { x0: number; z0: number; x1: number; z1: number }, b: typeof a, m = 0) =>
    a.x0 - m < b.x1 && a.x1 + m > b.x0 && a.z0 - m < b.z1 && a.z1 + m > b.z0;

  it("doesn't overlap the line towns, each other, Noun Jersey, the Bowl or a landmark", () => {
    const list = boxes();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++)
        expect(overlap(list[i]!, list[j]!), `${list[i]!.id}/${list[j]!.id}`).toBe(false);
      for (const lf of lineFrames as TownFrame[])
        expect(overlap(list[i]!, lf, 200), `${list[i]!.id}/${lf.id}`).toBe(false);
      const nj = njFrameNow()!;
      const bw = bowlFrameNow()!;
      for (const o of [nj, bw] as { ox: number; oz: number }[])
        expect(
          Math.hypot(
            (list[i]!.x0 + list[i]!.x1) / 2 - o.ox,
            (list[i]!.z0 + list[i]!.z1) / 2 - o.oz,
          ),
        ).toBeGreaterThan(900);
      for (const def of LANDMARKS) {
        const p = landmarkPlace(def, true)!;
        expect(
          p.x > list[i]!.x0 - 60 &&
            p.x < list[i]!.x1 + 60 &&
            p.z > list[i]!.z0 - 60 &&
            p.z < list[i]!.z1 + 60,
          `${list[i]!.id}/${def.id}`,
        ).toBe(false);
      }
    }
  });

  it('stays off the mega ramp terraces and launch ramps on its line', () => {
    for (const { st } of stations) {
      const t = tracks.tracks.find(q => q.id === st.track && q.depth === 0)!;
      for (const m of t.megas) expect(st.s < m.s - 260 || st.s > m.s + 380, st.id).toBe(true);
      for (const r of t.ramps)
        expect(
          r.s < st.s - 60 - r.spec.land - 20 || r.s - r.spec.length - 40 > st.s + 60,
          st.id,
        ).toBe(true);
      for (const tw of TOWN_SITES)
        if (tw.track === st.track) expect(Math.abs(tw.at - st.s)).toBeGreaterThan(1300);
    }
  });

  it("leaves the parallel sessions' sites alone (golf −X near in, Puerto Noun's ocean, the −Z stadium)", () => {
    for (const st of [...SIDE_TOWNS, ...STATIONS]) {
      if (st.track === 3) expect(st.s, st.id).toBeGreaterThanOrEqual(15000);
      if (st.track === 2) expect(st.s < 24000 || st.s > 31000, st.id).toBe(true);
    }
    for (const b of boxes()) {
      // Nothing in a corridor straight down −Z from the plaza
      const inMinusZ = b.z1 < -1500 && b.x0 < 3000 && b.x1 > -3000;
      expect(inMinusZ, b.id).toBe(false);
      // …and nothing near the city itself
      expect(edgeDistance((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2)).toBeGreaterThan(2500);
    }
  });

  it('spur roads are clear of any other line', () => {
    for (const st of SIDE_TOWNS) {
      const sp = sides[st.id].spur;
      for (const t of tracks.tracks) {
        if (t === sides[st.id].site.track) continue;
        for (let i = 0; i < t.xs.length; i++) {
          const px = t.xs[i]! - sp.ax;
          const pz = t.zs[i]! - sp.az;
          const along = px * sp.dx + pz * sp.dz;
          const across = Math.abs(px * sp.dz - pz * sp.dx);
          // (a branch forking off the main right at the junction is fine: it's the road)
          expect(along > 10 && along < sp.len + 20 && across < SPUR.half + SPUR.blend + 30).toBe(
            false,
          );
        }
      }
    }
  }, 60_000);
});
