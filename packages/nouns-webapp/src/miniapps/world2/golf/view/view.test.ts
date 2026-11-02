import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import type { Lie, Shape } from '../contract';
import type { MeshData } from './kit';

import { CollisionWorld } from '../../physics/Collision';
import { MountainStream } from '../../world/mountain/MountainStream';
import { coreWeight, courseGroundColour, lieColour, overlapsCourse } from '../course/colors';
import { ribbonDist, shapeDist, shapeRadius } from '../course/shapes';
import { BOUNDS, SITE, toWorld } from '../course/site';
import { OVERLAY_FRINGE, golfCourse } from '../course/surface';
import { CourseView } from './CourseView';
import { devPose } from './devShots';
import { MeshBuf, colliderTriangles } from './kit';
import { EDGE_DIP, LIFT, buildRegion, courseRegions, fineClusters, type Region, type RegionBuild } from './overlays';
import { buildScenery, waveFlags } from './scenery';
import { SliceQueue } from './slices';
import { tileTrees, treesWithin, unitTree } from './trees';
import { WATER_PAD, pondSurfaces, shapeOutline } from './water';

const C = golfCourse();
const L = C.layout;

function drain(it: Iterator<void>) {
  while (it.next().done !== true);
}

function finite(d: MeshData) {
  for (const a of [d.pos, d.nrm, d.col]) for (const v of a) if (!Number.isFinite(v)) return false;
  for (const i of d.idx) if (i < 0 || i >= d.count) return false;
  return true;
}

/** Point-in-mesh (x, z) through a hash of the mesh's triangles. */
function coverage(d: MeshData, ox: number, oz: number) {
  const cell = 6;
  const hash = new Map<string, number[]>();
  for (let t = 0; t < d.idx.length; t += 3) {
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (let k = 0; k < 3; k++) {
      const i = d.idx[t + k];
      x0 = Math.min(x0, d.pos[i * 3]);
      x1 = Math.max(x1, d.pos[i * 3]);
      z0 = Math.min(z0, d.pos[i * 3 + 2]);
      z1 = Math.max(z1, d.pos[i * 3 + 2]);
    }
    for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++)
      for (let k = Math.floor(z0 / cell); k <= Math.floor(z1 / cell); k++) {
        const key = `${i},${k}`;
        let l = hash.get(key);
        if (l === undefined) hash.set(key, (l = []));
        l.push(t);
      }
  }
  const P = d.pos;
  /** The mesh's height at (x, z), or null where it has no triangle. */
  return (wx: number, wz: number): number | null => {
    const x = wx - ox;
    const z = wz - oz;
    const l = hash.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`);
    if (l === undefined) return null;
    // The top surface wins (what you'd see)
    let best: number | null = null;
    for (const t of l) {
      const a = d.idx[t] * 3;
      const b = d.idx[t + 1] * 3;
      const c = d.idx[t + 2] * 3;
      const v0x = P[c] - P[a];
      const v0z = P[c + 2] - P[a + 2];
      const v1x = P[b] - P[a];
      const v1z = P[b + 2] - P[a + 2];
      const v2x = x - P[a];
      const v2z = z - P[a + 2];
      const d00 = v0x * v0x + v0z * v0z;
      const d01 = v0x * v1x + v0z * v1z;
      const d11 = v1x * v1x + v1z * v1z;
      const d20 = v2x * v0x + v2z * v0z;
      const d21 = v2x * v1x + v2z * v1z;
      const den = d00 * d11 - d01 * d01;
      if (Math.abs(den) < 1e-12) continue;
      const u = (d11 * d20 - d01 * d21) / den;
      const v = (d00 * d21 - d01 * d20) / den;
      if (u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6) {
        const y = P[a + 1] + u * (P[c + 1] - P[a + 1]) + v * (P[b + 1] - P[a + 1]);
        if (best === null || y > best) best = y;
      }
    }
    return best;
  };
}

/** Sample points inside a shape and out to `out` m past its edge. */
function shapeSamples(s: Shape, out: number): { x: number; z: number }[] {
  const pts: { x: number; z: number }[] = [];
  const R = shapeRadius(s) + out + 1;
  for (let a = 0; a < 40; a++)
    for (let k = 0; k <= 10; k++) {
      const x = s.x + Math.cos(a * 0.157) * R * (k / 10);
      const z = s.z + Math.sin(a * 0.157) * R * (k / 10);
      if (shapeDist(s, x, z) < out) pts.push({ x, z });
    }
  return pts;
}

describe('golf colours', () => {
  it('gives every lie a finite colour', () => {
    const lies: Lie[] = ['tee', 'fairway', 'fringe', 'green', 'rough', 'deep', 'sand', 'path', 'water', 'ob'];
    const out = { r: 0, g: 0, b: 0 };
    for (const l of lies)
      for (const s of [0, 1]) {
        lieColour(l, s, 123.4, -987.6, out);
        for (const v of [out.r, out.g, out.b]) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1.2);
        }
      }
    // Stripes differ
    const a = lieColour('fairway', 0, 0, 0, { r: 0, g: 0, b: 0 });
    const b = lieColour('fairway', 1, 0, 0, { r: 0, g: 0, b: 0 });
    expect(a.g).not.toBeCloseTo(b.g, 3);
  });

  it('blends the mountain in only inside the boundary', () => {
    const p = { x: 0, z: 0 };
    toWorld(1500, 0, p);
    expect(coreWeight(p.x, p.z)).toBe(1);
    toWorld(1500, SITE.V1 + 5, p);
    expect(coreWeight(p.x, p.z)).toBe(0);
    toWorld(SITE.U0 - 3, 0, p);
    expect(coreWeight(p.x, p.z)).toBe(0);
    expect(courseGroundColour(0, 0, { r: 0, g: 0, b: 0 })).toBe(0);
    expect(overlapsCourse(0, 0, 128, 128)).toBe(false);
    expect(overlapsCourse(BOUNDS.x0, BOUNDS.z0, BOUNDS.x0 + 1, BOUNDS.z0 + 1)).toBe(true);
  });
});

describe('golf overlays', () => {
  const regions = courseRegions(L);

  it('cuts the course into the 19 holes, the clubhouse and the range', () => {
    expect(regions.map(r => r.id)).toEqual([...L.holes.map(h => `h${h.n}`), 'club', 'range']);
    const paths = regions.reduce((a, r) => a + r.paths.length, 0);
    expect(paths).toBe(L.paths.length);
    const pads = regions.reduce((a, r) => a + r.shapes.length, 0) - L.holes.length - 1;
    expect(pads).toBe(L.pads.length);
  });

  const build = (r: Region, lod: number) => {
    const out: RegionBuild = { data: null, verts: 0 };
    drain(buildRegion(C, r, lod, out));
    expect(out.data).not.toBeNull();
    return out.data!;
  };

  it('builds every region far (LOD 1) with no NaNs, on the true surface', () => {
    let verts = 0;
    for (const r of regions) {
      const d = build(r, 1);
      expect(finite(d), r.id).toBe(true);
      verts += d.count;
      // Spot-check heights: every 97th vertex sits on the surface + its lift
      for (let i = 0; i < d.count; i += 97) {
        const x = d.pos[i * 3] + r.cx;
        const z = d.pos[i * 3 + 2] + r.cz;
        const dy = d.pos[i * 3 + 1] - C.height(x, z);
        expect(dy, `${r.id} @${i}`).toBeGreaterThan(EDGE_DIP - 0.005);
        expect(dy, `${r.id} @${i}`).toBeLessThan(LIFT.disc + 0.005);
      }
    }
    console.log('LOD1 overlay vertices', verts);
  });

  it('covers every footprint and its fringe (near LOD), with the right colours', () => {
    for (const id of ['h1', 'h7', 'h15', 'h19', 'club', 'range']) {
      const r = regions.find(q => q.id === id)!;
      const d = build(r, 0);
      expect(finite(d), id).toBe(true);
      const at = coverage(d, r.cx, r.cz);
      const shapes = [...r.shapes, ...r.fine.map(f => f.shape)];
      let n = 0;
      for (const s of shapes)
        for (const p of shapeSamples(s, OVERLAY_FRINGE - 0.6)) {
          const y = at(p.x, p.z);
          expect(y, `${id} hole at ${p.x.toFixed(1)},${p.z.toFixed(1)}`).not.toBeNull();
          // Never under the true ground (the sunk mountain sits SINK lower)
          // (a chord over a convex bank can dip a few cm; the mountain is SINK = 0.35 m down)
          expect(y! - C.height(p.x, p.z), `${id} under at ${p.x},${p.z}`).toBeGreaterThan(EDGE_DIP - 0.03);
          n++;
        }
      for (const rb of [...r.ribbons, ...r.paths])
        for (let i = 0; i < rb.pts.length; i++) {
          const q = rb.pts[i];
          for (const off of [-1, 0, 1]) {
            const x = q.x + off * (rb.half[i] + OVERLAY_FRINGE - 0.8) * 0.7;
            const z = q.z + off * (rb.half[i] + OVERLAY_FRINGE - 0.8) * 0.7;
            if (ribbonDist(rb, x, z) > OVERLAY_FRINGE - 0.6) continue;
            expect(at(x, z), `${id} ribbon gap at ${x},${z}`).not.toBeNull();
            n++;
          }
        }
      expect(n).toBeGreaterThan(200);
    }
  });

  it('keeps nearby greens and bunkers in one fine grid', () => {
    const h1 = regions[0];
    const cl = fineClusters(h1.fine, 2);
    expect(cl.length).toBeLessThanOrEqual(h1.fine.length);
    expect(cl.flat().length).toBe(h1.fine.length);
  });
});

describe('golf trees', () => {
  it('tiles every tree once and finds them by range, nearest tile first', () => {
    const ix = tileTrees(L.trees);
    const all = [...ix.tiles.values()].flat();
    expect(all.length).toBe(L.trees.length);
    expect(new Set(all).size).toBe(L.trees.length);
    const p = L.spawn;
    const got = new Set(treesWithin(ix, p.x, p.z, 300, []));
    L.trees.forEach((t, i) => {
      if (Math.hypot(t.x - p.x, t.z - p.z) < 300) expect(got.has(i)).toBe(true);
    });
    const list = treesWithin(ix, p.x, p.z, 600, []);
    const d = list.map(i => Math.hypot(L.trees[i].x - p.x, L.trees[i].z - p.z));
    // Nearest tiles first: the first hundred are all closer than the last hundred
    expect(Math.max(...d.slice(0, 100))).toBeLessThan(Math.min(...d.slice(-100)) + 150);
  });

  it('has a finite unit tree per kind, 1 m tall, canopy radius ~1', () => {
    for (const k of [0, 1, 2] as const)
      for (const low of [false, true]) {
        const d = unitTree(k, low);
        expect(finite(d)).toBe(true);
        let top = 0;
        let r = 0;
        for (let i = 0; i < d.count; i++) {
          top = Math.max(top, d.pos[i * 3 + 1]);
          r = Math.max(r, Math.hypot(d.pos[i * 3], d.pos[i * 3 + 2]));
        }
        expect(top).toBeGreaterThan(0.8);
        expect(top).toBeLessThan(1.1);
        expect(r).toBeGreaterThan(0.7);
        expect(r).toBeLessThan(1.25);
      }
  });
});

describe('golf slices', () => {
  it('runs jobs in priority order within the budget', () => {
    let now = 0;
    const q = new SliceQueue(() => now);
    const log: string[] = [];
    const job = (id: string, steps: number, ms: number) =>
      function* () {
        for (let i = 0; i < steps; i++) {
          now += ms;
          log.push(id);
          yield;
        }
      };
    let done = 0;
    q.push({ id: 'far', priority: 10, start: job('far', 3, 1), done: () => done++ });
    q.push({ id: 'near', priority: 1, start: job('near', 5, 1), done: () => done++ });
    q.sort();
    q.run(3);
    expect(log).toEqual(['near', 'near', 'near']);
    // A started job keeps going first even if something ranks lower now
    q.push({ id: 'urgent', priority: 0, start: job('urgent', 1, 1) });
    q.sort();
    q.run(3);
    expect(log.slice(3)).toEqual(['near', 'near', 'urgent']);
    expect(done).toBe(1);
    q.run(100);
    expect(q.length).toBe(0);
    expect(done).toBe(2);
    expect(q.maxMs).toBeLessThanOrEqual(4);
  });

  it('drops jobs that are no longer wanted', () => {
    const q = new SliceQueue(() => 0);
    q.push({ id: 'a', priority: 0, start: function* () {} });
    q.push({ id: 'b', priority: 0, start: function* () {} });
    q.remove(j => j.id === 'a');
    expect(q.has('a')).toBe(false);
    expect(q.has('b')).toBe(true);
  });
});

describe('golf scenery', () => {
  const ox = (BOUNDS.x0 + BOUNDS.x1) / 2;
  const oz = (BOUNDS.z0 + BOUNDS.z1) / 2;
  const sc = buildScenery(C, ox, oz);

  it('builds finite meshes, a collider per building and a flag per green', () => {
    for (const d of [sc.solid, sc.glass, sc.signs, sc.flags.data]) expect(finite(d)).toBe(true);
    expect(sc.signs.uv).not.toBeNull();
    expect(sc.colliders.length).toBeGreaterThanOrEqual(L.buildings.length);
    expect(sc.flags.flags.length).toBe(L.holes.length + L.range.targets.length);
    const tri = colliderTriangles(sc.colliders, ox, oz);
    expect(tri.length).toBe(sc.colliders.length * 108);
    for (const v of tri) expect(Number.isFinite(v)).toBe(true);
  });

  it('waves the flags without tearing them off the pole', () => {
    const pos = sc.flags.data.pos.slice();
    for (const t of [0, 0.7, 3.1]) {
      waveFlags(sc.flags, pos, t);
      for (const f of sc.flags.flags) {
        // Column 0 (the hoist) stays on the pole
        const k = f.v0 * 3;
        expect(Math.hypot(pos[k] - f.x, pos[k + 2] - f.z)).toBeLessThan(1e-4);
        const e = (f.v0 + sc.flags.cols - 1) * 3;
        const len = Math.hypot(pos[e] - f.x, pos[e + 2] - f.z);
        expect(len).toBeGreaterThan(sc.flags.w * 0.85);
        expect(len).toBeLessThan(sc.flags.w * 1.02);
      }
    }
  });

  it('winds kit boxes outward', () => {
    const b = new MeshBuf(0, 0).box(0, 0, 0, 2, 2, 2, 0xffffff, 0.4, true);
    const d = b.data();
    for (let t = 0; t < d.idx.length; t += 3) {
      const [a, c, e] = [d.idx[t], d.idx[t + 1], d.idx[t + 2]].map(i => new THREE.Vector3().fromArray(d.pos, i * 3));
      const n = new THREE.Vector3().crossVectors(c.clone().sub(a), e.clone().sub(a));
      const centre = a.clone().add(c).add(e).divideScalar(3);
      expect(n.dot(centre)).toBeGreaterThan(0);
    }
  });
});

describe('golf water', () => {
  it('outlines each pond WATER_PAD past its edge, at its level', () => {
    for (const h of L.holes)
      for (const p of h.water)
        for (const s of p.shapes)
          for (const q of shapeOutline(s, WATER_PAD, 24)) expect(shapeDist(s, q.x, q.z)).toBeCloseTo(WATER_PAD, 1);
    const w = pondSurfaces(L, 0, 0, { r: 0, g: 0.3, b: 0.6 });
    expect(w.count).toBeGreaterThan(0);
    for (const v of w.pos) expect(Number.isFinite(v)).toBe(true);
    for (let t = 0; t < w.idx.length; t += 3) {
      const a = w.idx[t] * 3;
      const b = w.idx[t + 1] * 3;
      const c = w.idx[t + 2] * 3;
      // Faces up
      const ux = w.pos[b] - w.pos[a];
      const uz = w.pos[b + 2] - w.pos[a + 2];
      const vx = w.pos[c] - w.pos[a];
      const vz = w.pos[c + 2] - w.pos[a + 2];
      expect(uz * vx - ux * vz).toBeGreaterThan(0);
    }
  });
});

describe('CourseView', () => {
  function host() {
    const scene = new THREE.Scene();
    const world = new CollisionWorld();
    return {
      scene,
      world,
      h: {
        scene,
        quality: () => 'low' as const,
        toon: () => true,
        world: () => world,
        warm: () => undefined,
        away: () => false,
        enabled: () => true,
      },
    };
  }

  it('does nothing far away, builds in slices when near, frees when it leaves', () => {
    const { scene, h } = host();
    const v = new CourseView(h);
    const cam = new THREE.PerspectiveCamera();
    const far = new THREE.Vector3(0, 0, 0);
    cam.position.copy(far);
    v.update(1 / 60, cam, far);
    expect(v.built).toBe(false);
    expect(scene.children.length).toBe(0);
    const p = L.spawn;
    const at = new THREE.Vector3(p.x, p.y, p.z);
    cam.position.copy(at);
    let frames = 0;
    const slow: [number, number][] = [];
    for (; frames < 4000 && (v.stats.queue > 0 || frames < 3); frames++) {
      v.update(1 / 60, cam, at);
      slow.push([frames, v.stats.sliceMs]);
    }
    expect(v.built).toBe(true);
    console.log('golf view built in', frames, 'frames', JSON.stringify(v.stats));
    console.log('slowest slices', JSON.stringify(slow.sort((a, b) => b[1] - a[1]).slice(0, 6)));
    const missing = (v as unknown as { regions: { r: { id: string }; mesh: unknown[] }[] }).regions
      .filter(s => s.mesh[1] === null)
      .map(s => s.r.id);
    expect(missing).toEqual([]);
    expect(v.stats.far).toBe(21);
    expect(v.stats.near).toBeGreaterThan(0);
    expect(v.stats.trees).toBeGreaterThan(100);
    // Slices stay near the budget: one can overrun by its last step (~10 ms
    // here unloaded; generous for a busy test machine), and most are ~3 ms
    expect(v.stats.maxSliceMs).toBeLessThan(80);
    const ms = slow.map(s => s[1]).filter(m => m > 0).sort((a, b) => a - b);
    expect(ms[Math.floor(ms.length / 2)]).toBeLessThan(8);
    cam.position.copy(far);
    v.update(1 / 60, cam, far);
    expect(v.built).toBe(false);
    expect(scene.children.length).toBe(0);
    v.dispose();
  }, 120000);

  it('has dev poses for every shot', () => {
    for (const s of ['air', 'tee1', 'green', 'clubhouse', 'island', 'noggle', 'range', 'entrance'] as const) {
      const p = devPose(L, s);
      for (const v of [p.cam, p.look, p.rider]) expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
    }
  });
});

describe('MountainStream golf hook', () => {
  it('colours the mountain mesh with the course ground inside the boundary', () => {
    const world = new CollisionWorld();
    const m = new MountainStream(world, 'low', false);
    const g = L.holes[0].green[0];
    m.prime(new THREE.Vector3(g.x, 0, g.z));
    let checked = 0;
    const col = { r: 0, g: 0, b: 0 };
    m.group.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const pos = mesh.geometry.attributes.position;
      const c = mesh.geometry.attributes.color;
      for (let i = 0; i < pos.count; i += 37) {
        const x = pos.getX(i) + mesh.position.x;
        const z = pos.getZ(i) + mesh.position.z;
        if (coreWeight(x, z) < 1 || Math.hypot(x - g.x, z - g.z) > 200) continue;
        const gr = C.ground(x, z, { lie: 'deep', stripe: 0, hole: 0 });
        if (gr.lie !== 'deep' && gr.lie !== 'rough') continue;
        lieColour(gr.lie, gr.stripe, x, z, col);
        expect(c.getX(i)).toBeCloseTo(col.r, 3);
        expect(c.getY(i)).toBeCloseTo(col.g, 3);
        checked++;
      }
    });
    expect(checked).toBeGreaterThan(20);
    m.dispose();
  }, 120000);
});
