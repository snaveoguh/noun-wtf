// The mural bench against the real plaza: where it goes, what the shot sees,
// who can sit, and what goes on the wire.

import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';

import { CollisionWorld } from '../../physics/Collision';
import { buildingPrimitives, loadPlaza } from '../facades/plazaFixture.test-util';
import { quadOf } from '../MuralBillboard';

import { benchCollider, benchGeometry } from './build';
import { LINES, pickLine, pipeSeed } from './PipeHead';
import {
  BENCH,
  type BenchProbe,
  DRESSING_MATERIAL,
  type BenchSite,
  fromWall,
  muralKeyPoints,
  muralTargets,
  type MuralWall,
  NEAR_WALL,
  placeBench,
  probeOf,
  siteAt,
  toLocal,
  toWorld,
  type V3,
  wallOf,
} from './place';
import {
  decodeBench,
  encodeBench,
  offerSeat,
  PIPE_SEAT,
  remoteSeat,
  SIT_REACH,
  seatSpot,
  standSpot,
  wantsStand,
} from './rules';
import { benchShot, blendPose, GLIDE_IN, smooth } from './shot';

/** The mural decal as the game finds it (MuralBillboard's own quad maths). */
function muralWall(): MuralWall {
  const tris = buildingPrimitives('Decals')
    .filter(p => /^mural__/.test(p.material))
    .flatMap(p => p.tris);
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(tris.flatMap(t => t.p.flat())), 3),
  );
  g.computeVertexNormals();
  return wallOf(quadOf(new THREE.Mesh(g))!);
}

let wall: MuralWall;
let world: CollisionWorld;
let probe: BenchProbe;
let site: BenchSite;

beforeAll(async () => {
  wall = muralWall();
  const { collision } = await loadPlaza();
  world = new CollisionWorld();
  world.build(collision);
  // The render-only dressing (palms, trees, lamp heads), as the game passes it
  const dressing = ['Props', 'Foliage'].flatMap(name =>
    buildingPrimitives(name)
      .filter(p => DRESSING_MATERIAL.test(p.material))
      .map(p => {
        const g = new THREE.BufferGeometry();
        g.setAttribute(
          'position',
          new THREE.BufferAttribute(new Float32Array(p.tris.flatMap(t => t.p.flat())), 3),
        );
        return new THREE.Mesh(g);
      }),
  );
  expect(dressing.length).toBeGreaterThan(0);
  probe = probeOf(world, dressing);
  const r = placeBench(wall, probe);
  expect(r).not.toBeNull();
  site = r!.site;
});

/** A camera posed like the game's (lookAt + vertical FOV). */
function cameraFor(pose: { pos: V3; look: V3; fov: number }, aspect: number) {
  const cam = new THREE.PerspectiveCamera(pose.fov, aspect, 0.1, 2000);
  cam.position.set(...pose.pos);
  cam.lookAt(...pose.look);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

const ndc = (cam: THREE.Camera, p: V3) => new THREE.Vector3(...p).project(cam);
/** The screen's envelope corners (the biggest a clip can make it, frame included). */
const corners = (w: MuralWall): V3[] => {
  const s = siteAt(w, 20, 0, 0);
  const [ox, , oz] = w.origin;
  const [rx, , rz] = w.right;
  const [nx, , nz] = w.normal;
  const out: V3[] = [];
  for (const u of [-s.halfW, s.halfW])
    for (const y of [s.look[1] - s.halfH, s.look[1] + s.halfH])
      out.push([ox + rx * u + nx * 0.6, y, oz + rz * u + nz * 0.6]);
  return out;
};
/** NDC height the letterbox leaves (bars are 9% of the height each, at least 52 px). */
const OPEN = 0.8;
const ASPECTS = [16 / 9, 4 / 3, 390 / 844, 844 / 390];

describe('placement (real plaza)', () => {
  it('faces the mural squarely, on the plaza pavement across the road', () => {
    const f = [Math.sin(site.yaw), Math.cos(site.yaw)];
    expect(f[0]! * -wall.normal[0] + f[1]! * -wall.normal[2]).toBeGreaterThan(0.9999);
    // Across the ring road: further out than the road's far kerb, still near
    expect(site.dist).toBeGreaterThan(17.5);
    expect(site.dist).toBeLessThan(24);
    // Sitting in front of the mural, not off to one side of it
    expect(Math.abs(site.offset)).toBeLessThan(wall.width / 4);
    expect(site.y).toBeCloseTo(0, 2);
  });

  it('stands on one flat surface (no road, no kerb under it or its sitters’ feet)', () => {
    for (let x = -BENCH.length / 2 - 0.4; x <= BENCH.length / 2 + 0.4; x += 0.2)
      for (let z = -0.8; z <= 1.2; z += 0.2) {
        const w = toWorld(site, x, z);
        expect(probe.ground(w.x, w.z)).toBeCloseTo(site.y, 1);
      }
  });

  it('is clear of the lamp posts, planters and everything else solid', () => {
    for (let x = -BENCH.length / 2; x <= BENCH.length / 2; x += 0.2) {
      const w = toWorld(site, x, 0);
      expect(probe.clear(w.x, w.z, 0.7, site.y + 0.75, site.y + 3)).toBe(true);
    }
    // Its own collider overlaps nothing in the level
    const col = benchCollider(site);
    col.computeBoundingBox();
    const b = col.boundingBox!;
    expect(b.max.y).toBeCloseTo(site.y + BENCH.backTop, 2);
    const c = new THREE.Vector3();
    const s = new THREE.Vector3((b.min.x + b.max.x) / 2, site.y + 0.3, (b.min.z + b.max.z) / 2);
    const e = s.clone().setY(site.y + 0.9);
    expect(world.capsulePushout(s, e, 0.3, undefined, c).length()).toBe(0);
  });

  it('every seat can be walked up to and stood up from', () => {
    for (const seat of [0, 1, 2]) {
      const st = standSpot(site, seat);
      expect(probe.ground(st.x, st.z)).toBeCloseTo(site.y, 2);
      expect(probe.clear(st.x, st.z, 0.35, site.y + 0.4, site.y + 1.8)).toBe(true);
    }
  });

  it('local / world round trip', () => {
    const w = toWorld(site, 0.7, -0.3);
    const l = toLocal(site, w.x, w.z);
    expect(l.x).toBeCloseTo(0.7, 6);
    expect(l.z).toBeCloseTo(-0.3, 6);
  });

  it('a lamp post across the picture rules a spot out', () => {
    // A probe that's clear everywhere except a pole 5 m in front of the ideal spot's camera
    const flat: BenchProbe = {
      ground: () => 0,
      clear: () => true,
      hit: (a, b) => {
        // Pole at the ideal spot's centre line, half way to the wall
        const pole = siteAt(wall, 12, 0, 0);
        const t = (pole.z - a[2]) / (b[2] - a[2]);
        if (t <= 0 || t >= 1) return null;
        const x = a[0] + (b[0] - a[0]) * t;
        return Math.abs(x - pole.x) < 0.1 ? [x, a[1] + (b[1] - a[1]) * t, pole.z] : null;
      },
    };
    const r = placeBench(wall, flat)!;
    expect(r).not.toBeNull();
    expect(r.tried).toBeGreaterThan(0);
    // Without it the very first candidate wins
    expect(placeBench(wall, { ...flat, hit: () => null })!.tried).toBe(0);
  });
});

describe('the shot', () => {
  const times = [0, 2, 6, 12, 20, 45, 300];

  it('keeps the whole mural in frame and centred, on every screen shape', () => {
    for (const aspect of ASPECTS)
      for (const t of times) {
        const cam = cameraFor(benchShot(site, t, aspect), aspect);
        const pts = corners(wall).map(p => ndc(cam, p));
        for (const p of pts) {
          expect(Math.abs(p.x)).toBeLessThan(0.97);
          expect(Math.abs(p.y)).toBeLessThan(OPEN);
          expect(p.z).toBeLessThan(1);
        }
        // Centred left to right (within 4% of the frame), in the upper-middle
        const cx = (Math.min(...pts.map(p => p.x)) + Math.max(...pts.map(p => p.x))) / 2;
        expect(Math.abs(cx)).toBeLessThan(0.08);
        const cy = (Math.min(...pts.map(p => p.y)) + Math.max(...pts.map(p => p.y))) / 2;
        expect(cy).toBeGreaterThan(-0.05);
        expect(cy).toBeLessThan(0.45);
        // The mural fills a good part of the frame
        const w = Math.max(...pts.map(p => p.x)) - Math.min(...pts.map(p => p.x));
        expect(w).toBeGreaterThan(aspect < 1 ? 1.4 : 0.7);
      }
  });

  it('frames both sitters’ heads under the picture', () => {
    for (const aspect of ASPECTS)
      for (const t of [0, 20, 300]) {
        const cam = cameraFor(benchShot(site, t, aspect), aspect);
        const bottom = Math.min(...corners(wall).map(p => ndc(cam, p).y));
        for (const seat of [PIPE_SEAT, 1, 2]) {
          const s = seatSpot(site, seat);
          // A seated Noun: shoulders ~1 m up, the top of the head under 2 m
          const top = ndc(cam, [s.x, site.y + 1.95, s.z]);
          const shoulders = ndc(cam, [s.x, site.y + 1.1, s.z]);
          expect(Math.abs(top.x)).toBeLessThan(0.85);
          expect(top.y).toBeLessThan(bottom);
          expect(shoulders.y).toBeGreaterThan(-OPEN);
          expect(top.z).toBeLessThan(1);
        }
      }
  });

  it('sees the mural’s corners and centre unobstructed (rays against the real collision)', () => {
    for (const aspect of [16 / 9, 390 / 844])
      for (const t of times) {
        const cam = benchShot(site, t, aspect).pos;
        // Corners + centre: nothing in the way on this side of the far pavement.
        // (The far pavement's palm, 5 m in front of the wall, crosses the
        // picture's left third from anywhere on the plaza: not the bench's to dodge.)
        for (const p of muralKeyPoints(wall)) {
          const h = probe.hit(cam, p);
          if (h !== null) expect(fromWall(wall, h)).toBeLessThan(NEAR_WALL);
        }
        // Against the collision alone (the brief's check): corners and centre clear
        const solid = probeOf(world);
        for (const p of muralKeyPoints(wall)) {
          const h = solid.hit(cam, p);
          if (h !== null) expect(fromWall(wall, h)).toBeLessThan(NEAR_WALL);
        }
        // The dense grid: nothing this side of the far pavement crosses the picture
        for (const p of muralTargets(wall)) {
          const h = probe.hit(cam, p);
          if (h !== null) expect(fromWall(wall, h)).toBeLessThan(NEAR_WALL);
        }
        // The camera is in clear air
        expect(probe.clear(cam[0], cam[2], 0.35, cam[1] - 0.3, cam[1] + 0.3)).toBe(true);
      }
  });

  it('sits behind and a little above the bench, looking over it at the mural', () => {
    const s = benchShot(site, 300, 16 / 9);
    const l = toLocal(site, s.pos[0], s.pos[2]);
    expect(l.z).toBeLessThan(-3);
    expect(Math.abs(l.x)).toBeLessThan(1.5);
    expect(s.pos[1] - site.y).toBeGreaterThan(BENCH.backTop + 1);
    expect(s.fov).toBeLessThan(40);
  });

  it('moves smoothly: a slow push-in and drift, no jumps', () => {
    let prev = benchShot(site, 0, 16 / 9);
    for (let t = 1 / 60; t < 120; t += 1 / 60) {
      const s = benchShot(site, t, 16 / 9);
      const d = Math.hypot(s.pos[0] - prev.pos[0], s.pos[1] - prev.pos[1], s.pos[2] - prev.pos[2]);
      expect(d).toBeLessThan(0.01);
      expect(Math.abs(s.fov - prev.fov)).toBeLessThan(0.02);
      prev = s;
    }
  });

  it('the glides start and end exactly on their poses', () => {
    const a = { pos: [0, 1, 2] as V3, look: [3, 4, 5] as V3, fov: 62 };
    const b = benchShot(site, GLIDE_IN, 16 / 9);
    expect(blendPose(a, b, smooth(0))).toEqual(a);
    expect(blendPose(a, b, smooth(1))).toEqual(b);
    expect(smooth(-1)).toBe(0);
    expect(smooth(2)).toBe(1);
  });
});

describe('sitting', () => {
  const ask = (x: number, z: number, o: Partial<Parameters<typeof offerSeat>[1]> = {}) =>
    offerSeat(site, { free: true, speed: 0, x, z, taken: new Set(), ...o });

  it('offers the nearest free seat, never the pipe head’s', () => {
    for (const seat of [1, 2]) {
      const st = standSpot(site, seat);
      expect(ask(st.x, st.z)).toBe(seat);
    }
    const pipe = standSpot(site, PIPE_SEAT);
    expect(ask(pipe.x, pipe.z)).not.toBe(PIPE_SEAT);
    // From behind the bench too
    const behind = toWorld(site, BENCH.seats[2], -0.7);
    expect(ask(behind.x, behind.z)).toBe(2);
  });

  it('not when taken, moving, busy, or out of reach', () => {
    const st = standSpot(site, 1);
    expect(ask(st.x, st.z, { taken: new Set([1]) })).toBe(2);
    expect(ask(st.x, st.z, { taken: new Set([1, 2]) })).toBeNull();
    expect(ask(st.x, st.z, { speed: 6 })).toBeNull();
    expect(ask(st.x, st.z, { free: false })).toBeNull();
    const far = toWorld(site, 0, SIT_REACH + 1.2);
    expect(ask(far.x, far.z)).toBeNull();
  });

  it('a move or a jump stands you up; the stick at rest doesn’t', () => {
    expect(wantsStand({ moveX: 0, moveY: 1, jumpPressed: false })).toBe(true);
    expect(wantsStand({ moveX: -0.6, moveY: 0, jumpPressed: false })).toBe(true);
    expect(wantsStand({ moveX: 0, moveY: 0, jumpPressed: true })).toBe(true);
    expect(wantsStand({ moveX: 0.1, moveY: 0.1, jumpPressed: false })).toBe(false);
  });

  it('wire: `bn` round trips; anything else is ignored', () => {
    expect(decodeBench(JSON.parse(JSON.stringify(encodeBench(2))))).toBe(2);
    for (const bad of [undefined, null, 1, 'x', [], [0], [3], [1.5], ['1'], { 0: 1 }])
      expect(decodeBench(bad)).toBeNull();
  });

  it('a remote only sits where their position backs it up', () => {
    const st = standSpot(site, 1);
    expect(remoteSeat(site, 1, st.x, st.z)).toBe(1);
    expect(remoteSeat(site, 1, st.x + 5, st.z)).toBeNull();
    expect(remoteSeat(site, null, st.x, st.z)).toBeNull();
  });
});

describe('the bench and pipe', () => {
  it('is one geometry with colours, inside its own dimensions', () => {
    const g = benchGeometry();
    expect(g.attributes.color).toBeDefined();
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.max.x - b.min.x).toBeLessThanOrEqual(BENCH.length + 0.01);
    expect(b.max.y).toBeLessThanOrEqual(BENCH.backTop + 0.05);
    expect(b.min.y).toBeGreaterThanOrEqual(-0.001);
  });

  it('is a pipe head, found by filename', async () => {
    const { ImageData } = await import('@noundry/nouns-assets');
    const s = pipeSeed();
    expect(ImageData.images.heads[s.head]!.filename).toBe('head-pipe');
    expect(ImageData.images.glasses[s.glasses]!.filename).toBe('glasses-square-black');
  });

  it('never says the same line twice in a row', () => {
    for (const k of Object.keys(LINES) as (keyof typeof LINES)[]) {
      let last: string | null = null;
      for (let i = 0; i < 40; i++) {
        const l = pickLine(k, (i * 0.37) % 1, last);
        expect(l).not.toBe(last);
        last = l;
      }
    }
  });
});
