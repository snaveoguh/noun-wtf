// High-speed crashes into trees and walls: you bail where you hit, never get
// sent back to a far-off safe spot (the plaza), and glancing scrapes at
// mountain speed don't take you out.

import type { InputFrame } from '../core/Input';
import type { TerrainCollider } from '../physics/Collision';

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { CollisionWorld } from '../physics/Collision';
import { RailSet } from '../physics/Rails';

import { Player } from './Player';

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

/** Where the rider's last safe spot is left: far away, like the plaza. */
const PLAZA = new THREE.Vector3(-500, 0, -500);

/** A mountain: a plane sloping down along +z, `deg` steep. */
function mountain(deg: number) {
  const k = Math.tan((deg * Math.PI) / 180);
  const height = (_x: number, z: number) => -k * z;
  const terrain: TerrainCollider = {
    raycast(_ox, oy, oz, _dx, dy, dz, far) {
      const f0 = oy + k * oz;
      if (f0 <= 0) return 0;
      const df = dy + k * dz;
      if (df >= 0) return -1;
      const t = -f0 / df;
      return t <= far ? t : -1;
    },
    normal(_x, _z, out) {
      const l = Math.hypot(k, 1);
      out.x = 0;
      out.y = 1 / l;
      out.z = k / l;
    },
  };
  const world = new CollisionWorld();
  world.terrain = terrain;
  const p = new Player(world, new RailSet());
  p.terrain = { height, inDomain: () => true, surface: () => 'track' };
  return { p, world, height, k };
}

/** A mountain tree's trunk collider (as world/mountain/DressingAssets builds it). */
function addTree(world: CollisionWorld, x: number, y: number, z: number) {
  const trunk = new THREE.CylinderGeometry(0.3, 0.38, 3, 6, 1, false).toNonIndexed();
  trunk.translate(0, 1.5, 0);
  world.setDynamic('tree', trunk, new THREE.Vector3(x, y, z));
}

/** Game.ts's substeps: ≤ 0.5 m per step at 60 fps. */
function ride(p: Player, seconds: number, over: Partial<InputFrame> = {}) {
  const dt = 1 / 60;
  const out = { bails: 0, respawns: 0, bailAt: null as THREE.Vector3 | null, maxAir: 0 };
  const r0 = p.respawns;
  let air = 0;
  for (let f = 0; f < seconds * 60; f++) {
    const n = Math.min(160, Math.max(1, Math.ceil(dt / (1 / 90)), Math.ceil((p.speed * dt) / 0.5)));
    for (let i = 0; i < n; i++) {
      p.update(dt / n, frame(over), 0, f * 16);
      for (const e of p.events)
        if (e.type === 'bail') {
          out.bails++;
          out.bailAt ??= p.pos.clone();
        }
    }
    air = p.state === 'air' ? air + dt : 0;
    out.maxAir = Math.max(out.maxAir, air);
  }
  out.respawns = p.respawns - r0;
  return out;
}

describe('crashing into a tree on the mountain', () => {
  for (const speed of [25, 60, 110])
    it(`head on at ${speed} m/s bails at the trunk`, () => {
      const { p, world, height, k } = mountain(12);
      addTree(world, 0, height(0, 60), 60);
      p.spawn(new THREE.Vector3(0, 0, 0), 0);
      p.safePos.copy(PLAZA);
      p.vel.set(0, -k, 1).normalize().multiplyScalar(speed);
      p.run = 5000;
      const r = ride(p, 4);
      expect(r.respawns).toBe(0);
      expect(r.bails).toBeGreaterThan(0);
      expect(r.bailAt!.z).toBeGreaterThan(58);
      expect(r.bailAt!.z).toBeLessThan(60);
    });

  it('flying into a trunk bails there too (it used to just stop dead)', () => {
    const { p, world, height, k } = mountain(12);
    addTree(world, 0, height(0, 30), 30);
    p.spawn(new THREE.Vector3(0, 0, 0), 0);
    p.safePos.copy(PLAZA);
    p.pos.y += 1.2;
    p.state = 'air';
    p.vel.set(0, -k, 1).normalize().multiplyScalar(40);
    const r = ride(p, 3);
    expect(r.respawns).toBe(0);
    expect(r.bails).toBe(1);
    expect(r.bailAt!.z).toBeGreaterThan(28.5);
    expect(r.bailAt!.z).toBeLessThan(30);
  });

  it("hitting a tree where the slope's rays miss still bails there, not in the plaza", () => {
    // In the live game the rider can end up just under the slope, where the
    // terrain's raycast misses (a shallow ray from underground) and only the
    // terrain rescue holds them up. The old code stopped dead at the trunk,
    // never landed (the rescue doesn't), hung in 'air' and after 1.5 s the
    // wedge check threw them back to their last safe spot: the plaza.
    const { p, world, height, k } = mountain(12);
    world.terrain = null;
    addTree(world, 0, height(0, 30), 30);
    for (const x of [0, 0.3, -0.3]) {
      p.spawn(new THREE.Vector3(x, 0, 0), 0);
      p.pos.y = 0;
      p.safePos.copy(PLAZA);
      p.vel.set(0, -k, 1).normalize().multiplyScalar(25);
      const r = ride(p, 4);
      expect(r.bails).toBeGreaterThan(0);
      expect(r.bailAt!.z).toBeGreaterThan(28.5);
      expect(p.pos.distanceTo(PLAZA)).toBeGreaterThan(400);
      expect(p.pos.distanceTo(new THREE.Vector3(0, height(0, 30), 30))).toBeLessThan(8);
    }
  });

  it('a glancing scrape along a wall at mountain speed deflects you instead', () => {
    const { p, world, height, k } = mountain(12);
    // A long rock face 8° off the line of travel
    const face = new THREE.Mesh(new THREE.BoxGeometry(1, 30, 200));
    face.rotation.y = (8 * Math.PI) / 180;
    face.position.set(-8, height(0, 80), 80);
    world.build([face]);
    p.spawn(new THREE.Vector3(0, 0, 0), 0);
    p.vel.set(0, -k, 1).normalize().multiplyScalar(80);
    p.run = 5000;
    const r = ride(p, 3);
    expect(r.bails).toBe(0);
  });

  it('a stuck rider gets put down where they are, not at a far-off safe spot', () => {
    const { p, height } = mountain(12);
    p.spawn(new THREE.Vector3(0, 0, 40), 0);
    p.safePos.copy(PLAZA);
    // Wedged: in the air, held in place (as if collision kept putting it back)
    let respawned = false;
    const dt = 1 / 60;
    for (let f = 0; f < 120 && !respawned; f++) {
      const r0 = p.respawns;
      p.state = 'air';
      p.pos.set(0, height(0, 40) + 0.5, 40);
      p.vel.set(0, 0, 0);
      p.update(dt, frame(), 0, f * 16);
      respawned = p.respawns !== r0;
    }
    expect(respawned).toBe(true);
    expect(p.pos.distanceTo(new THREE.Vector3(0, height(0, 40), 40))).toBeLessThan(0.5);
  });
});

describe('walls in the city', () => {
  function city() {
    const floor = new THREE.Mesh(new THREE.BoxGeometry(200, 1, 200));
    floor.position.set(0, -0.5, 0);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(20, 4, 1));
    wall.position.set(0, 2, 20.5);
    const world = new CollisionWorld();
    world.build([floor, wall]);
    const p = new Player(world, new RailSet());
    p.spawn(new THREE.Vector3(0, 0, 0), 0);
    return p;
  }

  it('slamming into one fast bails you', () => {
    const p = city();
    p.vel.set(0, 0, 12);
    expect(ride(p, 3).bails).toBe(1);
  });

  it('rolling into one slowly just stops you', () => {
    const p = city();
    p.vel.set(0, 0, 5);
    const r = ride(p, 6);
    expect(r.bails).toBe(0);
    expect(p.pos.z).toBeGreaterThan(19);
  });
});
