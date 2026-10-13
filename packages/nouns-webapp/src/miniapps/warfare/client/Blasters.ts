// ── Paint blaster models (procedural, toon) ─────────────────────────────
//
// Built along −Z (barrel forward, like a camera), origin at the grip. Used
// for the first-person viewmodel and, scaled, in each Noun's hand. Every
// blaster wears a noggle motif somewhere and a hopper of team paint.

import type { WeaponId } from '../sim/weapons';

import * as THREE from 'three';

import { toonify } from '@/miniapps/world2/render/Toon';

const geoCache = new Map<string, THREE.BufferGeometry>();

function boxGeo(w: number, h: number, d: number) {
  const k = `b${w},${h},${d}`;
  let g = geoCache.get(k);
  if (g === undefined) {
    g = new THREE.BoxGeometry(w, h, d);
    geoCache.set(k, g);
  }
  return g;
}

function cylGeo(r: number, len: number, seg = 12) {
  const k = `c${r},${len},${seg}`;
  let g = geoCache.get(k);
  if (g === undefined) {
    g = new THREE.CylinderGeometry(r, r, len, seg);
    g.rotateX(Math.PI / 2);
    geoCache.set(k, g);
  }
  return g;
}

function sphGeo(r: number) {
  const k = `s${r}`;
  let g = geoCache.get(k);
  if (g === undefined) {
    g = new THREE.SphereGeometry(r, 14, 10);
    geoCache.set(k, g);
  }
  return g;
}

export interface Blaster {
  group: THREE.Group;
  /** Muzzle point (local), for flashes and tracer starts. */
  muzzle: THREE.Vector3;
  /** Parts tinted with the paint colour. */
  paint: THREE.MeshStandardMaterial;
}

export function buildBlaster(id: WeaponId, paintColor: number, toon = true): Blaster {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.6 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });
  const red = new THREE.MeshStandardMaterial({ color: 0xd22209, roughness: 0.5 });
  const black = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 });
  const paint = new THREE.MeshStandardMaterial({
    color: paintColor,
    roughness: 0.25,
    emissive: new THREE.Color(paintColor).multiplyScalar(0.25),
  });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  /** Tiny ⌐◨-◨ plate. */
  const noggles = (x: number, y: number, z: number, s: number) => {
    add(boxGeo(0.07 * s, 0.05 * s, 0.012), red, x - 0.045 * s, y, z);
    add(boxGeo(0.07 * s, 0.05 * s, 0.012), red, x + 0.045 * s, y, z);
    add(boxGeo(0.03 * s, 0.03 * s, 0.014), trim, x - 0.055 * s, y, z - 0.002);
    add(boxGeo(0.03 * s, 0.03 * s, 0.014), black, x - 0.035 * s, y, z - 0.002);
    add(boxGeo(0.03 * s, 0.03 * s, 0.014), trim, x + 0.035 * s, y, z - 0.002);
    add(boxGeo(0.03 * s, 0.03 * s, 0.014), black, x + 0.055 * s, y, z - 0.002);
    add(boxGeo(0.06 * s, 0.012 * s, 0.012), red, x - 0.11 * s, y + 0.008 * s, z);
  };
  let muzzle = new THREE.Vector3(0, 0.05, -0.4);
  switch (id) {
    case 'splatter': {
      add(boxGeo(0.07, 0.12, 0.3), body, 0, 0.05, -0.1);
      add(boxGeo(0.06, 0.16, 0.08), body, 0, -0.06, 0.0).rotation.x = -0.25;
      add(cylGeo(0.022, 0.16), trim, 0, 0.07, -0.31);
      add(sphGeo(0.065), paint, 0, 0.17, -0.06);
      add(boxGeo(0.02, 0.05, 0.08), trim, 0, -0.03, -0.08);
      noggles(0, 0.13, -0.24, 0.6);
      muzzle = new THREE.Vector3(0, 0.07, -0.4);
      break;
    }
    case 'hopper': {
      add(boxGeo(0.08, 0.13, 0.55), body, 0, 0.05, -0.18);
      add(boxGeo(0.06, 0.15, 0.08), body, 0, -0.07, 0.02).rotation.x = -0.25;
      add(boxGeo(0.07, 0.1, 0.2), trim, 0, 0.02, 0.18);
      add(cylGeo(0.025, 0.28), black, 0, 0.07, -0.58);
      // Hopper drum full of paint
      const drum = add(cylGeo(0.07, 0.13, 14), paint, 0, 0.19, -0.12);
      drum.rotation.x = 0;
      add(sphGeo(0.032), trim, 0, 0.255, -0.12);
      add(boxGeo(0.06, 0.05, 0.08), body, 0, -0.04, -0.3);
      noggles(0, 0.13, -0.42, 0.6);
      muzzle = new THREE.Vector3(0, 0.07, -0.73);
      break;
    }
    case 'shotgun': {
      add(boxGeo(0.14, 0.12, 0.5), body, 0, 0.05, -0.15);
      add(boxGeo(0.07, 0.15, 0.08), body, 0, -0.07, 0.04).rotation.x = -0.25;
      // Twin barrels end in a giant pair of noggles
      add(cylGeo(0.035, 0.36), black, -0.04, 0.06, -0.52);
      add(cylGeo(0.035, 0.36), black, 0.04, 0.06, -0.52);
      add(boxGeo(0.11, 0.1, 0.04), red, -0.065, 0.06, -0.71);
      add(boxGeo(0.11, 0.1, 0.04), red, 0.065, 0.06, -0.71);
      add(boxGeo(0.04, 0.02, 0.04), red, 0, 0.08, -0.71);
      add(boxGeo(0.05, 0.06, 0.045), trim, -0.08, 0.06, -0.712);
      add(boxGeo(0.05, 0.06, 0.045), trim, 0.05, 0.06, -0.712);
      // Pump
      add(boxGeo(0.1, 0.07, 0.16), paint, 0, -0.03, -0.42);
      add(boxGeo(0.08, 0.1, 0.18), trim, 0, 0.02, 0.17);
      muzzle = new THREE.Vector3(0, 0.06, -0.75);
      break;
    }
    case 'longsplat': {
      add(boxGeo(0.07, 0.11, 0.6), body, 0, 0.04, -0.15);
      add(boxGeo(0.06, 0.15, 0.08), body, 0, -0.07, 0.03).rotation.x = -0.25;
      add(boxGeo(0.06, 0.12, 0.28), trim, 0, 0.0, 0.28);
      add(cylGeo(0.02, 0.6), black, 0, 0.06, -0.72);
      // Scope
      add(cylGeo(0.035, 0.3), black, 0, 0.16, -0.12);
      add(cylGeo(0.045, 0.04), red, 0, 0.16, -0.28);
      add(cylGeo(0.045, 0.04), red, 0, 0.16, 0.03);
      add(sphGeo(0.05), paint, 0, 0.12, 0.08);
      noggles(0, 0.11, -0.44, 0.5);
      muzzle = new THREE.Vector3(0, 0.06, -1.02);
      break;
    }
    case 'launcher': {
      add(cylGeo(0.1, 0.62, 14), body, 0, 0.08, -0.2);
      add(boxGeo(0.07, 0.15, 0.08), body, 0, -0.07, 0.0).rotation.x = -0.25;
      add(cylGeo(0.12, 0.08, 14), red, 0, 0.08, -0.53);
      add(cylGeo(0.07, 0.09, 14), black, 0, 0.08, -0.55);
      // Drum of paint bombs
      add(cylGeo(0.13, 0.14, 10), paint, 0, -0.02, -0.18).rotation.z = Math.PI / 2;
      add(boxGeo(0.06, 0.06, 0.14), trim, 0, 0.21, -0.08);
      noggles(0, 0.21, -0.18, 0.7);
      muzzle = new THREE.Vector3(0, 0.08, -0.62);
      break;
    }
  }
  if (toon) toonify(g);
  // toonify swaps materials; find the converted paint material for tinting
  let paintMat: THREE.MeshStandardMaterial = paint;
  g.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.isMesh && (m.material as THREE.Material).userData.toonSrc === paint)
      paintMat = m.material as THREE.MeshStandardMaterial;
  });
  return { group: g, muzzle, paint: paintMat };
}

/** Paint grenade in hand / flight. */
export function buildGrenade(color: number): THREE.Group {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(
    sphGeo(0.07),
    new THREE.MeshStandardMaterial({ color, roughness: 0.3 }),
  );
  const band = new THREE.Mesh(
    boxGeo(0.15, 0.03, 0.15),
    new THREE.MeshStandardMaterial({ color: 0xd22209 }),
  );
  g.add(shell, band);
  toonify(g);
  return g;
}
