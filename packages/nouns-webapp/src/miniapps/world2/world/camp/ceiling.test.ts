// "I can jump through the walls onto the roof": inside CAMP the walls run up
// under the roof slab, so a climb found no wall above its hands near the
// ceiling and mantled onto the roof. With the real Player: climbing (and
// wall-jumping) inside a CAMP-shaped room never gets you above the ceiling.

import type { InputFrame } from '../../core/Input';

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { CollisionWorld } from '../../physics/Collision';
import { RailSet } from '../../physics/Rails';
import { Player } from '../../skate/Player';

import { campShellBoxes, campSite, campTier } from './site';

const frame = (over: Partial<InputFrame> = {}): InputFrame => ({
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
});

function room() {
  const { tier, y0, top } = campTier(13.6);
  const site = campSite(tier, top);
  const meshes = campShellBoxes(site, y0, top).map(b => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]),
    );
    m.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    m.updateMatrixWorld(true);
    return m;
  });
  const world = new CollisionWorld();
  world.build(meshes);
  return { world, site };
}

describe('climbing inside CAMP', () => {
  // Facing each wall from just inside it (the back wall, west, east)
  const walls = [
    {
      name: 'back',
      at: (s: ReturnType<typeof campSite>) => [s.origin.x, s.room.maxZ - 0.6],
      to: [0, 1],
    },
    {
      name: 'west',
      at: (s: ReturnType<typeof campSite>) => [s.room.minX + 0.6, s.origin.z + 5],
      to: [-1, 0],
    },
    {
      name: 'east',
      at: (s: ReturnType<typeof campSite>) => [s.room.maxX - 0.6, s.origin.z + 5],
      to: [1, 0],
    },
  ] as const;

  for (const w of walls)
    for (const sprint of [false, true])
      it(`up the ${w.name} wall${sprint ? ' (fast)' : ''}: stops under the ceiling, never on the roof`, () => {
        const { world, site } = room();
        const [x, z] = w.at(site);
        const p = new Player(world, new RailSet());
        p.spawn(new THREE.Vector3(x, site.floorY + 0.02, z), 0);
        p.mode = 'foot';
        p.footGrounded = true;
        let climbed = false;
        let maxY = -Infinity;
        const dt = 1 / 60;
        for (let t = 0; t < 8; t += dt) {
          // Camera faces +z (yaw 0): moveY → +z, moveX → −x
          const input =
            p.climb !== null
              ? frame({ moveY: 1, sprint })
              : frame({ moveX: -w.to[0], moveY: w.to[1], sprint });
          p.update(dt, input, 0, t * 1000);
          if (p.climb !== null) climbed = true;
          maxY = Math.max(maxY, p.pos.y);
        }
        expect(climbed).toBe(true);
        // Feet never above the ceiling, let alone on the roof (top)
        expect(maxY).toBeLessThan(site.ceilY);
        expect(p.pos.y).toBeLessThan(site.ceilY);
      });
});
