// The pet behind the real rider: the game's own foot controller walks
// through CAMP (its real shell + furniture colliders), down a real tower
// fire escape, across a plaza; then a window jump. The pet steps against
// the real CollisionWorld every frame and must never end up inside
// geometry, never fall through a floor, and stay close (or poof back).

import type { InputFrame } from '../core/Input';
import type { EscapePlacement } from '../world/facades/details';

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { CollisionWorld } from '../physics/Collision';
import { RailSet } from '../physics/Rails';
import { Player } from '../skate/Player';
import { campLayout, solidBox } from '../world/camp/layout';
import { campShellBoxes, campSite, campTier } from '../world/camp/site';
import { buildEscape } from '../world/facades/details';
import { PAD, planTowerEscape, type TowerEscapePlan } from '../world/facades/escape';
import { Geo } from '../world/facades/geom';

import { collisionPetWorld } from './collisionWorld';
import { PET } from './contract';
import { chooseMode, newPetBody, poofTo, stepPet, type Owner, type PetBody } from './follow';

function frame(over: Partial<InputFrame> = {}): InputFrame {
  return {
    moveX: 0,
    moveY: 0,
    lookX: 0,
    lookY: 0,
    stickX: 0,
    stickY: 0,
    push: false,
    pushPressed: false,
    brake: false,
    crouch: false,
    manual: false,
    noseManual: false,
    grabL: false,
    grabR: false,
    sprint: false,
    jumpPressed: false,
    boardTogglePressed: false,
    cameraTogglePressed: false,
    micPressed: false,
    respawnPressed: false,
    emotePressed: 0,
    spray: false,
    colorCyclePressed: false,
    tricks: [],
    mode: 'touch',
    ...over,
  };
}

const boxMesh = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0));
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.updateMatrixWorld(true);
  return m;
};

function ownerOf(p: Player): Owner {
  const foot = p.mode === 'foot';
  return {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z,
    fx: foot ? Math.sin(p.footYaw) : p.fwd.x,
    fz: foot ? Math.cos(p.footYaw) : p.fwd.z,
    speed: p.speed,
    grounded: foot ? p.footGrounded : p.state !== 'air',
    onBoard: !foot,
    headTop: p.pos.y + 1.75,
  };
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
/** How deep the pet's body is in geometry (m), from the real capsule pushout. */
function depthIn(world: CollisionWorld, b: PetBody): number {
  _a.set(b.x, b.y + 0.24, b.z);
  _b.set(b.x, b.y + 0.32, b.z);
  return world.capsulePushout(_a, _b, 0.16).length();
}

interface Stats {
  reached: number;
  maxDepth: number;
  maxDist: number;
  far: number;
  frames: number;
  poofs: number;
  minDy: number;
}

/** Walk the real Player along waypoints; the pet follows every frame. */
function walk(
  world: CollisionWorld,
  start: THREE.Vector3,
  path: { x: number; z: number }[],
  o: { sprint?: boolean; maxT?: number } = {},
  /** The lowest floor on the way (the pet must never be under it). */
  floorY = -Infinity,
): Stats & { p: Player; pet: PetBody } {
  const p = new Player(world, new RailSet());
  p.spawn(start, Math.PI);
  p.mode = 'foot';
  p.footGrounded = true;
  const pw = collisionPetWorld(world);
  const pet = newPetBody();
  poofTo(pet, ownerOf(p), pw);
  const ctx = { vehicle: false, busy: false, away: false, parkour: false };
  const s: Stats = { reached: 0, maxDepth: 0, maxDist: 0, far: 0, frames: 0, poofs: 0, minDy: 0 };
  const dt = 1 / 60;
  let i = 0;
  for (let t = 0; t < (o.maxT ?? 600) && i < path.length; t += dt) {
    const w = path[i]!;
    const dx = w.x - p.pos.x;
    const dz = w.z - p.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.3) {
      i++;
      continue;
    }
    const k = Math.min(1, dist / 0.5) / Math.max(dist, 1e-6);
    p.update(dt, frame({ moveX: -dx * k, moveY: dz * k, sprint: o.sprint ?? true }), 0, t * 1000);
    const ow = ownerOf(p);
    if (stepPet(pet, ow, chooseMode(ctx, 'beside', ow), pw, dt) === 'poof') s.poofs++;
    s.frames++;
    s.maxDepth = Math.max(s.maxDepth, depthIn(world, pet));
    const d = Math.hypot(pet.x - p.pos.x, pet.z - p.pos.z);
    s.maxDist = Math.max(s.maxDist, d);
    if (d > 3.2) s.far++;
    s.minDy = Math.min(s.minDy, pet.y - floorY);
  }
  s.reached = i;
  return { ...s, p, pet };
}

// ── CAMP, the real room ─────────────────────────────────────────────────

const { tier, y0, top } = campTier(13.6);
const site = campSite(tier, top);
const win = { x0: site.window.x0 - site.origin.x, x1: site.window.x1 - site.origin.x };
const L = campLayout(site.w, site.d, site.h, win.x0, win.x1);
const O = site.origin;

function campWorld() {
  const world = new CollisionWorld();
  const meshes = campShellBoxes(site, y0, top).map(b =>
    boxMesh(b.min[0], b.max[0], b.min[1], b.max[1], b.min[2], b.max[2]),
  );
  // the room's floor slab, and its solid furniture
  meshes.push(
    boxMesh(
      site.room.minX - 1,
      site.room.maxX + 1,
      site.floorY - 0.4,
      site.floorY,
      site.room.minZ - 1,
      site.room.maxZ + 1,
    ),
  );
  for (const q of L.pieces) {
    if (!q.solid) continue;
    const b = solidBox(q);
    meshes.push(
      boxMesh(
        O.x + b.minX,
        O.x + b.maxX,
        site.floorY + q.y,
        site.floorY + b.h,
        O.z + b.minZ,
        O.z + b.maxZ,
      ),
    );
  }
  world.build(meshes);
  return world;
}

const at = (x: number, z: number) => ({ x: O.x + x, z: O.z + z });

describe('MOCHI follows the real rider', () => {
  it('through CAMP: round the furniture, along the walls, to the window', () => {
    const world = campWorld();
    const W = site.w / 2;
    const s0 = L.spawns[3]!;
    const start = new THREE.Vector3(O.x + s0.x, site.floorY + 0.05, O.z + s0.z);
    const route = [
      at(-1.2, 4.4),
      at(-1.4, 2.4),
      // along the west wall and back, close to it
      at(-W + 0.7, 2.0),
      at(-W + 0.7, 7.5),
      at(-1.0, 7.4),
      at(-1.4, 2.4),
      // out to the window
      at((win.x0 + win.x1) / 2, 0.7),
    ];
    const r = walk(world, start, route, {}, site.floorY);
    expect(r.reached).toBe(route.length);
    // never in a wall or furniture (a 1.5 cm brush allowed for the voxel feet)
    expect(r.maxDepth).toBeLessThan(0.015);
    // never under the floor
    expect(r.minDy).toBeGreaterThan(-0.05);
    expect(r.maxDist).toBeLessThan(PET.poofFar);
    expect(r.far / r.frames).toBeLessThan(0.12);
  });

  it('down the fire escape: every flight, never off the stair', () => {
    const roof = 17;
    const length = 10.4;
    const topY = 146.1;
    const { world, plan } = escapeScene(topY, roof, length);
    const start = new THREE.Vector3(1, topY + 0.05, plan.inset + plan.lane / 2);
    const route = routeDown(plan);
    const r = walk(world, start, route, { maxT: 900 }, roof);
    expect(r.reached).toBe(route.length);
    expect(r.p.pos.y).toBeCloseTo(roof, 1);
    expect(r.maxDepth).toBeLessThan(0.015);
    expect(r.minDy).toBeGreaterThan(-0.05);
    // it can fall behind on a turn, but a poof brings it back: never left behind
    expect(Math.hypot(r.pet.x - r.p.pos.x, r.pet.z - r.p.pos.z)).toBeLessThan(3);
    expect(Math.abs(r.pet.y - r.p.pos.y)).toBeLessThan(0.5);
  });

  it('across a plaza: benches, planters, a fountain, at a sprint', () => {
    const world = new CollisionWorld();
    const meshes = [boxMesh(-100, 100, -1, 0, -100, 100)];
    for (let i = 0; i < 12; i++) {
      const x = -30 + (i % 4) * 18 + (i % 3);
      const z = -20 + Math.floor(i / 4) * 18;
      meshes.push(boxMesh(x, x + 2.2, 0, 0.45, z, z + 0.6)); // bench
      meshes.push(boxMesh(x + 5, x + 6.2, 0, 1.1, z + 4, z + 5.2)); // planter
    }
    meshes.push(boxMesh(-3, 3, 0, 0.7, -3, 3)); // the fountain rim
    world.build(meshes);
    const route = [
      { x: -35, z: -30 },
      { x: 30, z: -26 },
      { x: 34, z: 25 },
      { x: -10, z: 28 },
      { x: -6, z: -8 },
      { x: 8, z: 6 },
      { x: -36, z: -28 },
    ];
    const r = walk(world, new THREE.Vector3(-40, 0.05, -34), route, {}, 0);
    expect(r.reached).toBe(route.length);
    expect(r.maxDepth).toBeLessThan(0.015);
    expect(r.minDy).toBeGreaterThan(-0.05);
    expect(r.far / r.frames).toBeLessThan(0.12);
  });

  it('jumping out of the window: waits, then poofs back beside you on the plaza', () => {
    const world = campWorld();
    const ground = new CollisionWorld();
    void ground;
    // add the plaza under the tower
    const all = campShellBoxes(site, y0, top).map(b =>
      boxMesh(b.min[0], b.max[0], b.min[1], b.max[1], b.min[2], b.max[2]),
    );
    all.push(
      boxMesh(
        site.room.minX - 1,
        site.room.maxX + 1,
        site.floorY - 0.4,
        site.floorY,
        site.room.minZ - 1,
        site.room.maxZ + 1,
      ),
    );
    all.push(boxMesh(O.x - 80, O.x + 80, -1, 0, O.z - 80, O.z + 80));
    world.build(all);
    const p = new Player(world, new RailSet());
    p.spawn(new THREE.Vector3(O.x + (win.x0 + win.x1) / 2, site.floorY + 0.05, O.z + 1.0), Math.PI);
    p.mode = 'foot';
    p.footGrounded = true;
    const pw = collisionPetWorld(world);
    const pet = newPetBody();
    poofTo(pet, ownerOf(p), pw);
    const dt = 1 / 60;
    let poofed = false;
    let maxDepth = 0;
    for (let t = 0; t < 14; t += dt) {
      // run out through the window (−z), then stand where you land
      const out = p.pos.z > O.z - 6;
      const steps = Math.min(160, Math.max(1, Math.ceil((p.speed * dt) / 0.5)));
      for (let i = 0; i < steps; i++)
        p.update(dt / steps, frame(out ? { moveY: -1, sprint: true } : {}), 0, t * 1000);
      const ow = ownerOf(p);
      const ev = stepPet(pet, ow, 'beside', pw, dt);
      poofed ||= ev === 'poof';
      maxDepth = Math.max(maxDepth, depthIn(world, pet));
      // it never jumps after you: it waits up in CAMP while you fall
      if (!p.footGrounded && p.pos.y < site.floorY - 5)
        expect(pet.y).toBeGreaterThan(site.floorY - 1.5);
    }
    expect(p.pos.y).toBeLessThan(1);
    expect(poofed).toBe(true);
    expect(pet.y).toBeCloseTo(p.pos.y, 1);
    expect(Math.hypot(pet.x - p.pos.x, pet.z - p.pos.z)).toBeLessThan(1.6);
    expect(maxDepth).toBeLessThan(0.015);
  });
});

// ── The tower escape scene (as in world/facades/towerEscape.test.ts) ─────

function escapeScene(topY: number, roof: number, length: number) {
  const world = new CollisionWorld();
  const bottom = roof + 0.9 + 0.2;
  const land = { u0: length + 1.2, u1: length + 3.2, roof, depth: 0.25 };
  const spec = { length, top: topY, bottom, exit: 3.6, exitEnd: 'B' as const, land };
  const plan = planTowerEscape(spec)!;
  world.build([
    boxMesh(-40, length + 40, -1, 0, -40, 40),
    boxMesh(length, length + 20, 0, roof, -16, 0),
    boxMesh(length, length + 20, roof, roof + 0.9, -0.25, 0),
    boxMesh(0, length, 0, topY + 6, -12, 0),
  ]);
  const e: EscapePlacement = {
    face: { nx: 0, nz: 1, at: 0, s0: 0, s1: length, y0: 0, y1: topY + 6, lm: null },
    a: 0,
    b: length,
    ladderAtS1: true,
    plan,
  };
  const collide = new Geo();
  buildEscape(new Geo(), new Geo(), collide, e, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(collide.pos, 3));
  world.setDynamic('camp:escape:test', g);
  return { world, plan };
}

function routeDown(plan: TowerEscapePlan): { x: number; z: number }[] {
  const Lh = plan.length;
  const inner = plan.inset + plan.lane / 2;
  const outer = plan.inset + plan.lane * 1.5;
  const path = [
    { x: Lh - PAD / 2, z: inner },
    { x: Lh - PAD / 2, z: outer },
  ];
  for (let k = 0; k < plan.flights; k++) {
    const isOuter = k % 2 === 0;
    const d = isOuter ? outer : inner;
    const next = isOuter ? inner : outer;
    const end = isOuter ? PAD / 2 : Lh - PAD / 2;
    path.push({ x: end, z: d });
    if (k < plan.flights - 1) path.push({ x: end, z: next });
  }
  const lx = Lh + 2.2;
  path.push({ x: lx, z: (inner + outer) / 2 }, { x: lx, z: -0.3 }, { x: lx, z: -4 });
  return path;
}
