import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { shotPose, type ShotKind } from './camera';
import { edgeSpot } from './cypher';

const out = () => ({ pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 0 });

describe('battle camera shots', () => {
  it('close shots never swing through the crews waiting on the edge', () => {
    const spots = [0, 1, 2].flatMap(i => [edgeSpot(0, i, 3).p, edgeSpot(1, i, 3).p]);
    for (const shot of ['dancer', 'punch', 'winner'] as ShotKind[])
      for (let orbit = 0; orbit < 40; orbit += 0.05) {
        const o = shotPose(
          { shot, focus: new THREE.Vector3(0, 0.5, 0), beat: 0, calm: false },
          orbit,
          out(),
        );
        for (const s of spots) {
          const d = Math.hypot(o.pos.x - s.x, o.pos.z - s.z);
          expect(d, `${shot} @${orbit.toFixed(2)}`).toBeGreaterThan(1.6);
        }
        expect(Number.isFinite(o.fov) && o.fov > 20).toBe(true);
      }
  });

  it('crane and wide shots sit above the light poles (3.6 m) and look at the circle', () => {
    for (const shot of ['intro', 'wide'] as ShotKind[])
      for (let orbit = 0; orbit < 20; orbit += 0.3) {
        const o = shotPose(
          { shot, focus: new THREE.Vector3(), beat: 0, calm: false },
          orbit,
          out(),
        );
        expect(o.pos.y).toBeGreaterThan(5.5);
        expect(Math.hypot(o.look.x, o.look.z)).toBeLessThan(0.5);
      }
  });
});
