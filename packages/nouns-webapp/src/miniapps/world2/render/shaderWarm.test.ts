import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { clearFog, ShaderWarmer, unwarmed } from './shaderWarm';

function scene(n: number, shared = false) {
  const s = new THREE.Scene();
  const mat = new THREE.MeshBasicMaterial();
  for (let i = 0; i < n; i++)
    s.add(new THREE.Mesh(new THREE.BoxGeometry(), shared ? mat : new THREE.MeshBasicMaterial()));
  return s;
}

describe('unwarmed', () => {
  it('lists one object per material without a program, up to max', () => {
    const s = scene(10);
    expect(unwarmed(s, () => false, 4)).toHaveLength(4);
    expect(unwarmed(s, () => true, 4)).toHaveLength(0);
    // a shared material is one compile, not ten
    expect(unwarmed(scene(10, true), () => false, 99)).toHaveLength(1);
  });

  it('includes hidden objects (they get drawn later)', () => {
    const s = scene(2);
    s.children[0]!.visible = false;
    expect(unwarmed(s, () => false, 9)).toHaveLength(2);
  });
});

describe('ShaderWarmer', () => {
  it('compiles a backlog in batches, then rests', () => {
    const s = scene(14);
    const compiled = new Set<THREE.Material>();
    const r = {
      properties: {
        get: (m: object) => ({ currentProgram: compiled.has(m as THREE.Material) ? 1 : undefined }),
      },
      compile: (root: THREE.Object3D) => {
        root.traverse(o => compiled.add((o as THREE.Mesh).material as THREE.Material));
      },
    };
    const w = new ShaderWarmer(r, s, new THREE.PerspectiveCamera());
    w.tick(1); // first scan
    expect(compiled.size).toBe(ShaderWarmer.BATCH);
    w.tick(ShaderWarmer.BATCH_S);
    w.tick(ShaderWarmer.BATCH_S);
    expect(compiled.size).toBe(14);
    expect(w.issued).toBe(14);
  });
});

describe('clearFog', () => {
  it('is a FogExp2 (same programs as outdoors) that fogs nothing', () => {
    const f = clearFog();
    expect(f).toBeInstanceOf(THREE.FogExp2);
    expect(f.density).toBe(0);
  });
});
