// ── Kenney Car Kit bodies (CC0), on the house wheels ───────────────────────
//
// public/world2/cars/<file>.glb are Kenney's "Car Kit" bodies run through
// scripts/cars/kenney-to-toon.mjs: flat per-face vertex colours, no texture,
// and empty `wheel-*` nodes where the kit's wheels were. Here the body is
// recoloured to the requested paint (its own body colour swapped), given the
// shared car materials, and fitted with the same wheel rig and driver as the
// procedural cars (models.ts). Until the GLB has loaded (or if it fails),
// buildAnyCar() falls back to a plain procedural shape.

import type { CarModel } from './models';
import type { CarSpec } from './specs';

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { carMaterials } from './kit';
import { addDriver, addWheels, buildCar, paintHex } from './models';

export const CARS_BASE = '/world2/cars/';

/** The kit body's own paint (sRGB hex) per file: swapped for the requested paint. */
export const KIT_BODY_PAINT: Record<string, number> = {
  'kaido.glb': 0x48a878,
  'bruiser.glb': 0xf06048,
};

const bodies = new Map<string, THREE.BufferGeometry | null>();
const loading = new Map<string, Promise<void>>();
const painted = new Map<string, THREE.BufferGeometry>();

/** Load the Kenney bodies the fleet uses (resolves even if one fails). */
export function preloadKenney(specs: readonly CarSpec[]): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const s of specs) {
    if (s.source === 'procedural') continue;
    const file = s.source.file;
    let p = loading.get(file);
    if (p === undefined) {
      p = load(file);
      loading.set(file, p);
    }
    jobs.push(p);
  }
  return Promise.all(jobs).then(() => undefined);
}

async function load(file: string): Promise<void> {
  try {
    const gltf = await new GLTFLoader().loadAsync(CARS_BASE + file);
    gltf.scene.updateMatrixWorld(true);
    const geos: THREE.BufferGeometry[] = [];
    gltf.scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      geos.push(g.index !== null ? g.toNonIndexed() : g);
    });
    const { mergeGeometries } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    bodies.set(file, merged);
  } catch (err) {
    console.warn('[cars] kit body failed to load', file, err);
    bodies.set(file, null);
  }
}

/** Any car: procedural, or a loaded Kenney body (fallback shape until then). */
export function buildAnyCar(spec: CarSpec, paint = 0): CarModel {
  if (spec.source === 'procedural') return buildCar(spec, paint);
  const file = spec.source.file;
  const base = bodies.get(file);
  if (base === undefined || base === null) return buildCar(spec, paint);
  const key = `${file}:${paint}`;
  let geo = painted.get(key);
  if (geo === undefined) {
    geo = repaint(base, KIT_BODY_PAINT[file] ?? -1, paintHex(spec, paint));
    painted.set(key, geo);
  }
  const [pm, gm] = carMaterials();
  const group = new THREE.Group();
  group.name = `car-${spec.id}`;
  const body = new THREE.Mesh(geo, [pm, gm]);
  body.name = 'car-body';
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  const driver = addDriver(group, spec);
  return {
    spec,
    paint,
    group,
    wheels: addWheels(group, spec),
    doors: [],
    thrusters: null,
    driver,
  };
}

/** Copy of `src` with faces near `from` (sRGB hex) painted `to`; one paint group. */
export function repaint(src: THREE.BufferGeometry, from: number, to: number): THREE.BufferGeometry {
  const g = src.clone();
  const col = g.attributes.color as THREE.BufferAttribute | undefined;
  if (col !== undefined && from >= 0) {
    const a = new THREE.Color(from);
    const b = new THREE.Color(to);
    for (let i = 0; i < col.count; i++) {
      const d =
        Math.abs(col.getX(i) - a.r) + Math.abs(col.getY(i) - a.g) + Math.abs(col.getZ(i) - a.b);
      if (d < 0.06) col.setXYZ(i, b.r, b.g, b.b);
    }
  }
  g.clearGroups();
  g.addGroup(0, g.attributes.position.count, 0);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
