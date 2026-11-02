// The game's CollisionWorld as the pet's follow code sees it (PetWorld).

import type { PetWorld } from './follow';
import type { CollisionWorld } from '../physics/Collision';

import * as THREE from 'three';

const DOWN = new THREE.Vector3(0, -1, 0);
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _cor = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** The game's collision as the follow code sees it. */
export function collisionPetWorld(world: CollisionWorld): PetWorld {
  return {
    ground(x, top, z, depth) {
      const hit = world.raycast(_o.set(x, top, z), DOWN, depth);
      // only floors (not a wall's face grazed on the way down)
      return hit !== null && hit.normal.y > 0.55 ? hit.point.y : null;
    },
    clear(ax, ay, az, bx, by, bz) {
      _d.set(bx - ax, by - ay, bz - az);
      const len = _d.length();
      if (len < 1e-5) return 1;
      const hit = world.raycast(_o.set(ax, ay, az), _d.divideScalar(len), len);
      return hit === null ? 1 : hit.distance / len;
    },
    pushout(x, y, z, r) {
      _a.set(x, y, z);
      _b.set(x, y + 0.001, z);
      const c = world.capsulePushout(_a, _b, r, undefined, _cor);
      return [c.x, c.z];
    },
  };
}
