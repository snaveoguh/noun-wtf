import type { InputFrame } from '../../core/Input';

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { CollisionWorld } from '../../physics/Collision';
import { RailSet } from '../../physics/Rails';
import { Player } from '../../skate/Player';

import { CAMP_RAMP, rampHeight, rampProfile, rampSurface, transitionRun } from './miniramp';

describe('the CAMP mini ramp', () => {
  const s = CAMP_RAMP;
  it('is a flat between two transitions up to decks', () => {
    expect(rampHeight(s, 0)).toBe(0);
    expect(rampHeight(s, s.length / 2 - 0.1)).toBe(s.height);
    expect(rampHeight(s, -(s.length / 2 - 0.1))).toBe(s.height);
    // Flat bottom long enough to set up
    expect(s.length - 2 * (transitionRun(s) + s.deck)).toBeGreaterThan(3.5);
  });

  it('rises smoothly, steepening to a lip short of vertical', () => {
    const pts = rampProfile(s, 16);
    let lastSlope = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i - 1]!;
      const [x1, y1] = pts[i]!;
      expect(y1).toBeGreaterThanOrEqual(y0);
      if (x1 - x0 < 1e-9) continue;
      const slope = (y1 - y0) / (x1 - x0);
      expect(slope).toBeGreaterThanOrEqual(lastSlope - 1e-9);
      lastSlope = slope;
    }
    const lipAngle = Math.acos((s.r - s.height) / s.r);
    expect(lipAngle).toBeGreaterThan((60 * Math.PI) / 180);
    expect(lipAngle).toBeLessThan((85 * Math.PI) / 180);
  });

  it('fits in the penthouse with room to stand on the decks under the ceiling', () => {
    expect(s.height + 1.9).toBeLessThan(3.4);
  });
});

// ── A real ride: the game's Player drops in and pumps the ramp ──────────

function input(over: Partial<InputFrame> = {}): InputFrame {
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

describe('skating the CAMP mini ramp (the real Player)', () => {
  it('rolls in from a deck, rides up the far wall and back without bailing', () => {
    const s = CAMP_RAMP;
    const world = new CollisionWorld();
    const floor = new THREE.Mesh(new THREE.BoxGeometry(40, 1, 40));
    floor.position.set(0, -0.5, 0);
    floor.updateMatrixWorld(true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(rampSurface(s), 3));
    const ramp = new THREE.Mesh(g);
    ramp.updateMatrixWorld(true);
    world.build([floor, ramp]);
    const p = new Player(world, new RailSet());
    // On the west deck, facing +x (yaw π/2), rolling toward the lip
    p.spawn(new THREE.Vector3(-s.length / 2 + 0.25, s.height + 0.02, 0), Math.PI / 2);
    p.mode = 'board';
    p.vel.set(2.5, 0, 0);
    const dt = 1 / 90;
    let maxX = -Infinity;
    let maxYfar = 0;
    let bailed = false;
    let backOnFlat = false;
    for (let t = 0; t < 6; t += dt) {
      p.update(dt, input(), Math.PI / 2, t * 1000);
      for (const e of p.events) if (e.type === 'bail') bailed = true;
      maxX = Math.max(maxX, p.pos.x);
      if (p.pos.x > 0) maxYfar = Math.max(maxYfar, p.pos.y);
      if (maxYfar > 0.4 && Math.abs(p.pos.x) < 1 && p.pos.y < 0.1) backOnFlat = true;
    }
    expect(bailed).toBe(false);
    // Up the far transition, then rolling back across the flat
    expect(maxYfar).toBeGreaterThan(0.4);
    expect(backOnFlat).toBe(true);
  });
});
