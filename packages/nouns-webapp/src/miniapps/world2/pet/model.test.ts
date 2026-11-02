import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { applyPose, BONES, makePet, MOCHI } from './model';
import { poseFor } from './pose';

describe('the MOCHI model', () => {
  it('is one skinned mesh (one draw), no textures, about half a metre tall', () => {
    const r = makePet(MOCHI);
    let meshes = 0;
    r.mesh.traverse(o => {
      if ((o as THREE.Mesh).isMesh) meshes++;
    });
    expect(meshes).toBe(1);
    expect(r.mesh.skeleton.bones).toHaveLength(BONES.length);
    const m = r.material as THREE.MeshStandardMaterial;
    expect(m.map).toBeNull();
    expect(r.height).toBeGreaterThan(0.45);
    expect(r.height).toBeLessThan(0.65);
    expect(r.hip).toBeGreaterThan(0.02);
  });

  it('shares its geometry between pets', () => {
    expect(makePet(MOCHI).mesh.geometry).toBe(makePet(MOCHI).mesh.geometry);
  });

  it('every vertex is bound to exactly one bone, and every pose stays in its culling sphere', () => {
    const r = makePet(MOCHI);
    const si = r.mesh.geometry.getAttribute('skinIndex');
    const sw = r.mesh.geometry.getAttribute('skinWeight');
    for (let i = 0; i < si.count; i++) {
      expect(si.getX(i)).toBeLessThan(BONES.length);
      expect(sw.getX(i)).toBe(1);
      expect(sw.getY(i)).toBe(0);
    }
    const v = new THREE.Vector3();
    const c = r.mesh.boundingSphere!.center;
    for (const g of ['run', 'fly', 'happy', 'sleep', 'sit', 'hop'] as const) {
      applyPose(r, poseFor(g, 0.3, 1.2, r.hip));
      r.mesh.updateMatrixWorld(true);
      r.mesh.skeleton.update();
      for (let i = 0; i < si.count; i += 7) {
        r.mesh.getVertexPosition(i, v);
        expect(v.distanceTo(c)).toBeLessThanOrEqual(r.mesh.boundingSphere!.radius);
      }
    }
  });
});
