import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { mergeStatic } from './mergeStatic';

const box = (m: THREE.Material, x: number, cast = true) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m);
  mesh.position.x = x;
  mesh.castShadow = cast;
  return mesh;
};

const meshes = (g: THREE.Object3D) => {
  const out: THREE.Mesh[] = [];
  g.traverse(o => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
};

const tris = (g: THREE.Object3D) =>
  meshes(g).reduce((n, m) => n + (m.geometry.index?.count ?? 0) / 3, 0);

describe('mergeStatic', () => {
  it('one mesh per material (and shadow flags), same triangles, parts in place', () => {
    const wood = new THREE.MeshStandardMaterial();
    const brass = new THREE.MeshStandardMaterial();
    const g = new THREE.Group();
    g.position.set(10, 0, 0); // the group's own frame, not the world's
    const sub = new THREE.Group();
    sub.position.y = 2;
    sub.add(box(wood, 0), box(wood, 3));
    g.add(sub, box(wood, -3), box(brass, 0), box(brass, 1), box(wood, 5, false));
    const before = tris(g);
    expect(mergeStatic(g)).toBe(3); // 3 casting wood → 1, 2 brass → 1
    expect(meshes(g)).toHaveLength(3); // + the lone non-casting wood box
    expect(tris(g)).toBe(before);
    const merged = meshes(g).find(m => m.material === wood && m.castShadow)!;
    merged.geometry.computeBoundingBox();
    const bb = merged.geometry.boundingBox!;
    // boxes at x -3 (y 0) and x 0, 3 (y 2, inside sub), in the group's frame
    expect(bb.min.x).toBeCloseTo(-3.5);
    expect(bb.max.x).toBeCloseTo(3.5);
    expect(bb.max.y).toBeCloseTo(2.5);
  });

  it('leaves skipped (ink-excluded) and hidden parts alone', () => {
    const m = new THREE.MeshBasicMaterial();
    const g = new THREE.Group();
    const sign = box(m, 0);
    const hidden = box(m, 1);
    hidden.visible = false;
    g.add(sign, hidden, box(m, 2), box(m, 3));
    expect(mergeStatic(g, new Set([sign]))).toBe(1);
    expect(meshes(g)).toContain(sign);
    expect(meshes(g)).toContain(hidden);
    expect(meshes(g)).toHaveLength(3);
  });
});
