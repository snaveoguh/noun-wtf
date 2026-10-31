// "Or obv u jump to floor": a rider who jumps out of CAMP's window falls
// ~130 m. With the game's own substep rule (Game.step) the real Player
// must land on the plaza (no tunnelling at ~55 m/s), on foot and on a board.

import type { InputFrame } from '../../core/Input';

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { CollisionWorld } from '../../physics/Collision';
import { RailSet } from '../../physics/Rails';
import { Player } from '../../skate/Player';

const input = (): InputFrame => ({
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
});

function fall(mode: 'foot' | 'board', fps: number) {
  const world = new CollisionWorld();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(200, 1, 200));
  floor.position.set(0, -0.5, 0);
  floor.updateMatrixWorld(true);
  world.build([floor]);
  const p = new Player(world, new RailSet());
  p.spawn(new THREE.Vector3(0, 146.1, 0), Math.PI);
  p.mode = mode;
  if (mode === 'foot') p.footGrounded = false;
  else p.state = 'air';
  p.vel.set(0, 0, -3);
  const dt = 1 / fps;
  let landed = false;
  let minY = Infinity;
  for (let t = 0; t < 12 && !landed; t += dt) {
    // Game.step's substeps
    const steps = Math.min(
      160,
      Math.max(1, Math.ceil(dt / (1 / 90)), Math.ceil((p.speed * dt) / 0.5)),
    );
    for (let i = 0; i < steps; i++) p.update(dt / steps, input(), Math.PI, t * 1000);
    minY = Math.min(minY, p.pos.y);
    landed = mode === 'foot' ? p.footGrounded : p.state !== 'air';
  }
  return { landed, minY, y: p.pos.y };
}

describe('jumping out of the CAMP window', () => {
  for (const mode of ['foot', 'board'] as const)
    for (const fps of [60, 20])
      it(`lands on the plaza from 146 m (${mode}, ${fps} fps)`, () => {
        const r = fall(mode, fps);
        expect(r.landed).toBe(true);
        expect(r.minY).toBeGreaterThan(-0.3);
        expect(r.y).toBeCloseTo(0, 0);
      });
});
