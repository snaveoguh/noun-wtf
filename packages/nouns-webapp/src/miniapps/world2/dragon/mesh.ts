// ── The dragon's meshes, shared by your own dragon and everyone else's ────
//
// The body and the two wings are merged once (per page) into three
// geometries + one material; every dragon in the scene (yours, and the
// remote riders' in remote.ts) is three meshes over those, so a sky full of
// dragons costs three draw calls each and no extra geometry. The wings hang
// off hinge pivots so they can flap.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { toonify } from '../render/Toon';
import { PartBuilder } from '../world/landmarks/parts';

import { dragonBody, dragonWing, SADDLE, WING_ROOT } from './model';

/** A touch bigger than life. */
export const DRAGON_SCALE = 1.35;

export interface DragonMesh {
  group: THREE.Group;
  wingL: THREE.Object3D;
  wingR: THREE.Object3D;
}

let shared: {
  mat: THREE.Material;
  body: THREE.BufferGeometry;
  wingL: THREE.BufferGeometry;
  wingR: THREE.BufferGeometry;
} | null = null;

function merged(k: PartBuilder): THREE.BufferGeometry {
  const parts = [...k.geo.solid, ...k.geo.thin, ...k.geo.glow];
  const geo = mergeGeometries(parts, false)!;
  for (const q of parts) q.dispose();
  geo.computeBoundingSphere();
  return geo;
}

function sharedParts() {
  if (shared !== null) return shared;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
  mat.name = 'Dragon';
  const body = new PartBuilder();
  dragonBody(body, new THREE.Matrix4());
  const wl = new PartBuilder();
  dragonWing(wl, new THREE.Matrix4(), 1);
  const wr = new PartBuilder();
  dragonWing(wr, new THREE.Matrix4(), -1);
  shared = { mat, body: merged(body), wingL: merged(wl), wingR: merged(wr) };
  return shared;
}

/**
 * One dragon (cheap: shares the geometry with every other). `material`
 * overrides the shared one (the race ghost's see-through look).
 */
export function buildDragonMesh(
  toon: boolean,
  castShadow = true,
  material?: THREE.Material,
): DragonMesh {
  const s = sharedParts();
  const group = new THREE.Group();
  group.name = 'NounDragon';
  const mesh = (geo: THREE.BufferGeometry) => {
    const m = new THREE.Mesh(geo, material ?? s.mat);
    m.castShadow = castShadow;
    return m;
  };
  group.add(mesh(s.body));
  const wing = (side: 1 | -1, geo: THREE.BufferGeometry) => {
    const pivot = new THREE.Object3D();
    pivot.position.set(side * WING_ROOT.x, WING_ROOT.y, WING_ROOT.z);
    pivot.add(mesh(geo));
    group.add(pivot);
    return pivot;
  };
  const wingL = wing(1, s.wingL);
  const wingR = wing(-1, s.wingR);
  group.scale.setScalar(DRAGON_SCALE);
  if (toon && material === undefined) toonify(group);
  return { group, wingL, wingR };
}

/** Wings at flap phase `flap` (radians of the beat). */
export function flapWings(d: DragonMesh, flap: number) {
  const beat = Math.sin(flap) * 0.7;
  d.wingL.rotation.z = 0.15 + beat;
  d.wingR.rotation.z = -0.15 - beat;
}

/** How fast the wings beat (rad/s): big slow beats climbing, a glide diving. */
export function flapRate(speed: number, vy: number): number {
  if (vy > 3) return 9;
  if (vy < -6) return 1.2;
  return 4 + speed * 0.05;
}

const _s = new THREE.Vector3();

/**
 * Where the dragon is, given where its rider sits and its orientation (the
 * network sends the rider's seat + the dragon's quaternion).
 */
export function dragonFromSeat(
  seat: THREE.Vector3,
  quat: THREE.Quaternion,
  out: THREE.Vector3,
): THREE.Vector3 {
  _s.copy(SADDLE).multiplyScalar(DRAGON_SCALE).applyQuaternion(quat);
  return out.copy(seat).sub(_s);
}

/** Free the shared geometry (page teardown). */
export function disposeDragonMeshes() {
  if (shared === null) return;
  shared.mat.dispose();
  shared.body.dispose();
  shared.wingL.dispose();
  shared.wingR.dispose();
  shared = null;
}
