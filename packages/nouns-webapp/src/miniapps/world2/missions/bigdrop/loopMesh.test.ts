import type { InputFrame } from '../../core/Input';

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { CollisionWorld } from '../../physics/Collision';
import { RailSet } from '../../physics/Rails';
import { Player } from '../../skate/Player';

import { buildLoopGeometry } from './loopMesh';
import { laneAt, loopShift, type LoopShape } from './loopPath';

const shape: LoopShape = {
  R: 26,
  turns: 1,
  w: 8.6,
  hw: 3,
  approach: 38,
  runout: 36,
  catchHalf: 17,
  funnel: 26,
};

describe('loop structure', () => {
  for (const turns of [1, 2] as const) {
    it(`builds a ${turns === 1 ? 'single' : 'double'} loop in loop-local coordinates`, () => {
      const sh = { ...shape, turns };
      const g = buildLoopGeometry(sh, 64);
      for (const geo of [g.solid, g.neon, g.collider]) {
        const a = geo.getAttribute('position').array as Float32Array;
        expect(a.length).toBeGreaterThan(300);
        expect(a.every(Number.isFinite)).toBe(true);
        geo.computeBoundingBox();
        const bb = geo.boundingBox!;
        // Float32 stays precise: nothing more than ~100 m from the origin
        for (const v of [bb.min, bb.max]) expect(v.length()).toBeLessThan(120);
      }
      // Up over the circle (and the noggles on top)
      g.solid.computeBoundingBox();
      expect(g.solid.boundingBox!.max.y).toBeGreaterThan(2 * sh.R + 8);
      // The towers stand clear of every lane
      expect(g.towerX[0]).toBeLessThan(laneAt(sh, 0) - sh.hw - 2);
      expect(g.towerX[1]).toBeGreaterThan(laneAt(sh, 2 * Math.PI * turns) + sh.hw + 2);
      expect(g.towerX[1] - g.towerX[0]).toBeGreaterThan(loopShift(sh));
    });
  }

  it("puts a wall in a rider's way at a tower but not down the lane", () => {
    const g = buildLoopGeometry(shape, 64);
    const world = new CollisionWorld();
    world.setDynamic('loop', g.collider);
    const n = new THREE.Vector3();
    const r = 0.32;
    // A rider standing in the way in, on the deck: clear
    const lane = laneAt(shape, 0);
    const a = new THREE.Vector3(lane, 0.6, -10);
    const b = new THREE.Vector3(lane, 1.4, -10);
    expect(world.capsulePushout(a, b, r, n).length()).toBe(0);
    // At a tower's foot: pushed out
    const x = g.towerX[0];
    expect(
      world.capsulePushout(a.set(x + 2.3, 0.6, 0), b.set(x + 2.3, 1.4, 0), r, n).length(),
    ).toBeGreaterThan(0);
  });
});

describe('Player.ride', () => {
  const idle: InputFrame = {
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
  };

  function player() {
    const floor = new THREE.Mesh(new THREE.BoxGeometry(200, 1, 200));
    floor.position.y = -0.5;
    const world = new CollisionWorld();
    world.build([floor]);
    const p = new Player(world, new RailSet());
    p.spawn(new THREE.Vector3(0, 0, 0), 0);
    return p;
  }

  it('skips the board physics while it returns true, and runs them when it returns false', () => {
    const p = player();
    p.vel.set(0, 0, 10);
    let calls = 0;
    p.ride = dt => {
      calls++;
      // Drive the rider straight up at 3 m/s
      p.pos.y += 3 * dt;
      p.vel.set(0, 3, 0);
      return true;
    };
    for (let i = 0; i < 60; i++) p.update(1 / 60, idle, 0, i * 16);
    expect(calls).toBe(60);
    expect(p.pos.y).toBeCloseTo(3, 6);
    expect(p.pos.z).toBe(0);
    // Handing back: the normal physics roll the board along again
    p.pos.y = 0;
    p.vel.set(0, 0, 10);
    p.ride = () => false;
    for (let i = 0; i < 30; i++) p.update(1 / 60, idle, 0, 1000 + i * 16);
    expect(p.pos.z).toBeGreaterThan(4);
  });
});
