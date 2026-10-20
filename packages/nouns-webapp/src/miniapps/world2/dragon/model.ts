// ── The Noun dragon: a blocky, procedural model (original geometry) ──────
//
// Built in its own frame: +Z forward (head), y = 0 at its feet, the saddle
// on its back at SADDLE. Three parts so the ride can flap the wings: the
// body (head in noggles, horns, legs, tail) and each wing, hinged at its
// root on the shoulder (WING_ROOT, wing-local x = 0 at the hinge).

import * as THREE from 'three';

import { box, boxAt, cyl } from '../towns/kit';
import { noggles } from '../world/landmarks/models';
import { NOUN, sub, type Parts } from '../world/landmarks/parts';

export const DRAGON_C = {
  body: 0x3fbf62,
  dark: 0x2a8f47,
  belly: 0xffd25a,
  horn: 0xf6e7c8,
  wing: 0x9f59ff,
  wingBone: 0x5a2fa8,
  saddle: 0xe8352b,
  claw: 0x14131a,
} as const;

const C = DRAGON_C;

/** Rider's seat (dragon-local). */
export const SADDLE = new THREE.Vector3(0, 3.55, -0.4);
/** Wing hinges (dragon-local), left (+x) and right (−x). */
export const WING_ROOT = { x: 0.95, y: 3.1, z: 0.6 } as const;

export function dragonBody(k: Parts, m: THREE.Matrix4) {
  // Torso + belly plates
  k.add(boxAt(-1.1, 1.1, 1.4, 3.4, -2.2, 2.0), C.body, m, { collide: true });
  k.add(boxAt(-0.9, 0.9, 1.2, 1.5, -1.9, 1.8), C.belly, m);
  // Back ridge spikes
  for (let i = 0; i < 6; i++) {
    const z = -2.6 + i * 0.85;
    k.add(new THREE.ConeGeometry(0.22, 0.6, 4).translate(0, 3.65, z), C.dark, m);
  }
  // Neck + head
  k.add(boxAt(-0.6, 0.6, 2.9, 4.6, 1.6, 2.8).rotateX(-0.45), C.body, m);
  k.add(boxAt(-0.95, 0.95, 4.2, 5.8, 2.2, 4.0), C.body, m);
  k.add(boxAt(-0.7, 0.7, 4.25, 5.0, 4.0, 5.1), C.body, m); // snout
  k.add(boxAt(-0.72, 0.72, 4.15, 4.4, 4.0, 5.1), C.belly, m); // jaw line
  for (const x of [-0.35, 0.35]) k.add(box(0.14, 0.14, 0.05, x, 4.85, 5.12), C.claw, m); // nostrils
  for (const x of [-0.6, 0.6]) {
    k.add(new THREE.ConeGeometry(0.2, 1.1, 5).rotateX(-0.6).translate(x, 6.1, 2.4), C.horn, m);
  }
  noggles(k, sub(m, 0.32, 5.15, 4.05), 0.62, NOUN.red, { depth: 0.18 });
  // Legs (chunky, clawed)
  for (const [x, z] of [
    [-0.85, 1.3],
    [0.85, 1.3],
    [-0.85, -1.5],
    [0.85, -1.5],
  ]) {
    k.add(box(0.6, 1.5, 0.7, x, 0.75, z), C.dark, m);
    k.add(box(0.75, 0.25, 0.95, x, 0.12, z + 0.1), C.claw, m);
  }
  // Tail: tapering blocks trailing back and a little down (kept under the
  // rider's line of sight from the chase camera), a spade at the tip
  let y = 2.3;
  let z = -2.2;
  for (let i = 0; i < 6; i++) {
    const s = 0.8 - i * 0.11;
    k.add(box(s * 1.4, s * 1.2, 1.0, 0, y, z - 0.5), i % 2 === 0 ? C.body : C.dark, m);
    z -= 0.95;
    y -= 0.08;
  }
  k.add(
    new THREE.OctahedronGeometry(0.55, 0).scale(1, 0.3, 1.2).translate(0, y, z - 0.3),
    C.saddle,
    m,
  );
  // Saddle
  k.add(boxAt(-0.75, 0.75, 3.4, 3.62, -1.1, 0.4), C.saddle, m);
  k.add(boxAt(-0.6, 0.6, 3.6, 4.1, 0.25, 0.45), C.saddle, m);
  k.add(
    cyl(0.06, 0.06, 1.0, 5, 0, 0, 0)
      .rotateZ(Math.PI / 2)
      .translate(0, 3.0, 0.5),
    C.claw,
    m,
    {
      bucket: 'thin',
    },
  );
}

/** One wing (side +1 left / −1 right), hinge at the origin, spread along ±x. */
export function dragonWing(k: Parts, m: THREE.Matrix4, side: 1 | -1) {
  const s = side;
  // Bones: arm out, three fingers fanning back
  k.add(boxAt(0, s * 3.4, -0.12, 0.12, -0.15, 0.15).translate(0, 0.3, 0.2), C.wingBone, m);
  for (const [len, back] of [
    [2.6, -1.4],
    [2.0, -2.4],
    [1.6, -3.0],
  ]) {
    const g = boxAt(0, 0.12, -0.08, 0.08, back, 0);
    g.translate(s * 3.4 - 0.06, 0.3, 0.2);
    k.add(g, C.wingBone, m);
    void len;
  }
  // Membrane: a thin slab in three panels, purple
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.4);
  shape.lineTo(s * 3.4, 0.4);
  shape.lineTo(s * 3.4, -2.8);
  shape.lineTo(s * 2.0, -2.2);
  shape.lineTo(s * 1.0, -2.6);
  shape.lineTo(0, -1.8);
  shape.closePath();
  const mem = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false });
  // shape (x, y) → wing (x, z): lay it flat
  mem.rotateX(Math.PI / 2);
  mem.translate(0, 0.32, 0.2);
  k.add(mem, C.wing, m);
}
