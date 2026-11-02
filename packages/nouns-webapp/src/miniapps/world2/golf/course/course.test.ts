import { describe, expect, it } from 'vitest';

import { townFrameNow, GROWN_TOWNS } from '../../towns/site';
import { TERRAIN_LIPSCHITZ, megaBlocked, terrainHeight } from '../../world/mountain/terrain';
import { tracks, type NearestTrack } from '../../world/mountain/tracks';

import { polyDist, ribbonDist, shapeDist, unionDist } from './shapes';
import { BOUNDS, SITE, mountainBase, toCourse, toWorld } from './site';
import { golfCourse, golfSink } from './surface';

const C = golfCourse();
const L = C.layout;

describe('NOUN LINKS layout', () => {
  it('has 19 holes with sane pars and lengths', () => {
    expect(L.holes.length).toBe(19);
    const lens = L.holes.map(h => `${h.n}:${h.par}:${Math.round(h.length)}`);
    console.log('holes', lens.join(' '), 'par', L.par, 'trees', L.trees.length);
    for (const h of L.holes) {
      const [lo, hi] = h.par === 3 ? [120, 215] : h.par === 4 ? [320, 450] : [460, 580];
      expect(h.length, `hole ${h.n}`).toBeGreaterThan(lo);
      expect(h.length, `hole ${h.n}`).toBeLessThan(hi);
    }
    expect(L.par).toBeGreaterThanOrEqual(72);
    expect(L.trees.length).toBeGreaterThan(500);
  });

  it('keeps every hole inside the boundary', () => {
    const c = { u: 0, v: 0 };
    for (const h of L.holes) {
      for (const p of [h.teeSpot, h.pin, ...h.line]) {
        toCourse(p.x, p.z, c);
        expect(c.u, `hole ${h.n}`).toBeGreaterThan(SITE.U0 + 25);
        expect(c.u, `hole ${h.n}`).toBeLessThan(SITE.U1 - 25);
        expect(c.v, `hole ${h.n}`).toBeGreaterThan(SITE.V0 + 25);
        expect(c.v, `hole ${h.n}`).toBeLessThan(SITE.V1 - 25);
      }
      for (const p of h.fairway?.pts ?? []) {
        toCourse(p.x, p.z, c);
        expect(Math.abs(c.v), `hole ${h.n} fairway`).toBeLessThan(SITE.V1 - 20);
      }
    }
  });

  it("never lets one hole's tee, fairway or green run into another's", () => {
    const pts = (h: (typeof L.holes)[number]) => {
      const out: { x: number; z: number }[] = [];
      for (const s of [...h.green, h.tee]) {
        for (let a = 0; a < 16; a++) {
          const r = s.kind === 'blob' ? s.r * s.sx : Math.max(s.hw, s.hl);
          out.push({ x: s.x + Math.cos(a * 0.39) * r, z: s.z + Math.sin(a * 0.39) * r });
        }
      }
      for (const p of h.fairway?.pts ?? []) out.push(p);
      return out;
    };
    for (const a of L.holes)
      for (const b of L.holes) {
        if (a.n === b.n) continue;
        for (const p of pts(a)) {
          const dg = unionDist(b.green, p.x, p.z);
          expect(dg, `hole ${a.n} point vs green ${b.n}`).toBeGreaterThan(18);
          if (b.fairway) {
            const df = ribbonDist(b.fairway, p.x, p.z);
            expect(df, `hole ${a.n} vs fairway ${b.n}`).toBeGreaterThan(12);
          }
          expect(shapeDist(b.tee, p.x, p.z), `hole ${a.n} vs tee ${b.n}`).toBeGreaterThan(8);
        }
      }
  });

  it('keeps water off tees, and greens dry (the island green too)', () => {
    for (const h of L.holes) {
      expect(C.lie(h.teeSpot.x, h.teeSpot.z), `tee ${h.n}`).toBe('tee');
      expect(C.lie(h.pin.x, h.pin.z), `pin ${h.n}`).toBe('green');
      for (const w of h.water) {
        expect(unionDist(w.shapes, h.teeSpot.x, h.teeSpot.z)).toBeGreaterThan(10);
        if (h.n === 15)
          expect(h.pin.y, 'island green above its lake').toBeGreaterThan(w.level + 0.8);
        else
          expect(unionDist(w.shapes, h.pin.x, h.pin.z), `pond off green ${h.n}`).toBeGreaterThan(
            12,
          );
        // The water never stands above its rim
        for (const sh of w.shapes)
          for (let a = 0; a < 32; a++) {
            const r = sh.kind === 'blob' ? sh.r * 1.5 * sh.sx : 10;
            for (let k = 0; k < 40; k++) {
              const x = sh.x + Math.cos(a * 0.196) * r * (k / 40);
              const z = sh.z + Math.sin(a * 0.196) * r * (k / 40);
              const dd = unionDist(w.shapes, x, z);
              if (dd > 0.2 && dd < 0.6)
                expect(C.height(x, z), `rim ${h.n}`).toBeGreaterThan(w.level);
            }
          }
      }
    }
    const island = L.holes[14];
    expect(island.name).toBe('ISLAND');
    // Short of the island green is water
    const t = island.teeSpot;
    const p = island.pin;
    let wet = 0;
    for (let s = 0.55; s < 0.85; s += 0.02)
      if (C.lie(t.x + (p.x - t.x) * s, t.z + (p.z - t.z) * s) === 'water') wet++;
    expect(wet).toBeGreaterThan(3);
  });

  it('puts greens on gentle slopes (≤ 14 %, tiers included) and a hole in every green', () => {
    const n = { x: 0, y: 0, z: 0 };
    for (const h of L.holes) {
      let worst = 0;
      for (let i = -12; i <= 12; i += 2)
        for (let k = -12; k <= 12; k += 2) {
          const x = h.pin.x + i;
          const z = h.pin.z + k;
          if (C.lie(x, z) !== 'green') continue;
          C.normal(x, z, n);
          worst = Math.max(worst, Math.sqrt(1 - n.y * n.y) / n.y);
        }
      expect(worst, `green ${h.n}`).toBeLessThan(0.14);
    }
  });

  it('is a gentle, smooth surface (well within the terrain Lipschitz bound)', () => {
    let worst = 0;
    const e = 0.5;
    for (let x = BOUNDS.x0; x < BOUNDS.x1; x += 9.7)
      for (let z = BOUNDS.z0; z < BOUNDS.z1; z += 9.7) {
        const g =
          Math.hypot(
            terrainHeight(x + e, z) - terrainHeight(x - e, z),
            terrainHeight(x, z + e) - terrainHeight(x, z - e),
          ) /
          (2 * e);
        worst = Math.max(worst, g);
      }
    console.log('worst gradient over the site', worst.toFixed(3));
    expect(worst).toBeLessThan(TERRAIN_LIPSCHITZ * 0.75);
  });

  it('stays inside the run-proof band round the mountain gradient', () => {
    const c = { u: 0, v: 0 };
    for (let x = BOUNDS.x0; x < BOUNDS.x1; x += 37)
      for (let z = BOUNDS.z0; z < BOUNDS.z1; z += 37) {
        const de = Math.hypot(x - SITE.kx, z - SITE.kz);
        toCourse(x, z, c);
        if (c.u < SITE.U0 - 200 || c.u > SITE.U1 + 200) continue;
        const d = terrainHeight(x, z) - mountainBase(de);
        expect(d).toBeGreaterThan(-60);
        expect(d).toBeLessThan(50);
      }
  });

  it('matches the terrain inside the core (terrain.ts blends it in)', () => {
    for (const h of L.holes) {
      expect(terrainHeight(h.pin.x, h.pin.z)).toBeCloseTo(h.pin.y, 4);
      expect(terrainHeight(h.teeSpot.x, h.teeSpot.z)).toBeCloseTo(h.teeSpot.y, 4);
    }
    expect(megaBlocked(L.spawn.x, L.spawn.z)).toBe(true);
    // Overlays: the mesh sinks under a green, not out in the deep rough
    expect(golfSink(L.holes[0].pin.x, L.holes[0].pin.z)).toBeGreaterThan(0.3);
  });

  it('is far from every dirt line, town and the city', () => {
    tracks.ensure(6000);
    const nt: NearestTrack = { track: null, d: 0, side: 0, s: 0, k: 0, weight: 0 };
    const w = { x: 0, z: 0 };
    let closest = Infinity;
    for (let u = SITE.U0 - SITE.BLEND; u <= SITE.U1 + SITE.BLEND; u += 25)
      for (let v = SITE.V0 - SITE.BLEND; v <= SITE.V1 + SITE.BLEND; v += 25) {
        toWorld(u, v, w);
        const n = tracks.nearest(w.x, w.z, nt);
        expect(n.d, `line near (${w.x | 0}, ${w.z | 0})`).toBeGreaterThanOrEqual(96);
        // Point-to-point distance to every line vertex (beyond INFLUENCE)
        if (Math.round(u / 25) % 8 === 0 && Math.round(v / 25) % 4 === 0)
          for (const t of tracks.tracks)
            for (let i = 0; i < t.xs.length; i += 4)
              if (Number.isFinite(t.xs[i]))
                closest = Math.min(closest, Math.hypot(t.xs[i] - w.x, t.zs[i] - w.z));
      }
    console.log('closest line vertex to the site', closest | 0);
    expect(closest).toBeGreaterThan(400);
    for (const id of GROWN_TOWNS) {
      const f = townFrameNow(id);
      if (f === null) continue;
      expect(f.x1 < BOUNDS.x0 || f.x0 > BOUNDS.x1 || f.z1 < BOUNDS.z0 || f.z0 > BOUNDS.z1, id).toBe(
        true,
      );
    }
  });

  it('lies: tee, fairway, rough, deep, sand, OB', () => {
    const h = L.holes[0];
    const fw = h.fairway!.pts[Math.floor(h.fairway!.pts.length / 2)];
    expect(C.lie(fw.x, fw.z)).toBe('fairway');
    const b = h.bunkers[0].shape;
    expect(C.lie(b.x, b.z)).toBe('sand');
    // Beyond the boundary
    const o = { x: 0, z: 0 };
    toWorld(1500, SITE.V1 + 20, o);
    expect(C.lie(o.x, o.z)).toBe('ob');
    expect(polyDist(h.line, fw.x, fw.z)).toBeLessThan(5);
    const kinds = new Set<string>();
    for (let x = BOUNDS.x0; x < BOUNDS.x1; x += 11)
      for (let z = BOUNDS.z0; z < BOUNDS.z1; z += 11) kinds.add(C.lie(x, z));
    for (const k of [
      'tee',
      'fairway',
      'fringe',
      'green',
      'rough',
      'deep',
      'sand',
      'path',
      'water',
      'ob',
    ])
      expect(kinds).toContain(k);
  });

  it('keeps cart paths out of bunkers and ponds', () => {
    for (const path of L.paths)
      for (const p of path.pts)
        for (const h of L.holes) {
          for (const b of h.bunkers)
            expect(shapeDist(b.shape, p.x, p.z), `path in a bunker on ${h.n}`).toBeGreaterThan(0.5);
          for (const w of h.water)
            expect(unionDist(w.shapes, p.x, p.z), `path in a pond on ${h.n}`).toBeGreaterThan(0.5);
        }
  });

  it('builds quickly', () => {
    const t0 = performance.now();
    const c2 = new (C.constructor as new () => typeof C)();
    const ms = performance.now() - t0;
    console.log('course build ms', ms.toFixed(1));
    expect(c2.layout.holes.length).toBe(19);
    let t1 = performance.now();
    let s = 0;
    for (let i = 0; i < 20000; i++) s += C.height(L.spawn.x + (i % 200), L.spawn.z + i / 200);
    t1 = performance.now() - t1;
    console.log('height µs', ((t1 / 20000) * 1000).toFixed(2), s > 0);
    expect(ms).toBeLessThan(1500);
  });
});
