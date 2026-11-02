// ── Doors on the outside: a lit doorway and a sign, per building ────────
//
// For a batch of doors (an area: the plaza, a town, Noun Jersey): a frame
// with a lintel, a warm lit opening with the door swung half open, a step,
// a wall lamp, and a sign board over it with the place's name and kind.
// Merged per area: frames (lit, toon), glow (unlit) and signs (one canvas
// atlas), so 3 draw calls however many doors.

import type { BuildingDoor } from './contract';

import * as THREE from 'three';

import { releaseAfterUpload } from '../render/textureDiet';

import { Kit, boxAt, disposeMaterials, kitMaterials, panel } from './kit';
import { KIND_LABEL } from './names';
import { hash32, mulberry32, pick } from './rng';

export interface DoorMarkers {
  group: THREE.Group;
  dispose(): void;
  drawCalls: number;
}

const SIGN_W = 384;
const SIGN_H = 96;

const SIGN_BG = ['#1b1b1b', '#f3322c', '#2c6fb0', '#f4f1ea', '#2f8a5f', '#3b1f6b', '#d9a23f'];

/** Sign text colour on a background. */
function ink(bg: string) {
  return bg === '#f4f1ea' || bg === '#d9a23f' ? '#111111' : '#ffffff';
}

export function buildDoorMarkers(
  doors: readonly BuildingDoor[],
  toon: (o: THREE.Object3D) => void,
): DoorMarkers {
  const kit = new Kit();
  // Sign atlas: one row of slots per few doors
  const perRow = Math.floor(2048 / SIGN_W);
  const rows = Math.max(1, Math.ceil(doors.length / perRow));
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = Math.min(4096, THREE.MathUtils.ceilPowerOfTwo(rows * SIGN_H));
  const g = canvas.getContext('2d')!;
  const H = canvas.height;
  doors.forEach((d, i) => {
    const rnd = mulberry32(hash32(`sign:${d.id}`));
    const sx = (i % perRow) * SIGN_W;
    const sy = Math.floor(i / perRow) * SIGN_H;
    const bg = pick(rnd, SIGN_BG);
    g.fillStyle = bg;
    g.fillRect(sx, sy, SIGN_W, SIGN_H);
    g.strokeStyle = ink(bg);
    g.lineWidth = 4;
    g.strokeRect(sx + 4, sy + 4, SIGN_W - 8, SIGN_H - 8);
    const k = KIND_LABEL[d.kind ?? 'home'];
    g.fillStyle = ink(bg);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 38px "Arial Black", Impact, sans-serif';
    g.fillText((d.name ?? k.label).toUpperCase(), sx + SIGN_W / 2, sy + SIGN_H * 0.42, SIGN_W - 30);
    g.font = 'bold 20px system-ui, sans-serif';
    g.fillText(`${k.icon} ${k.label}`, sx + SIGN_W / 2, sy + SIGN_H * 0.8, SIGN_W - 30);
    const uv: [number, number, number, number] = [
      sx / 2048,
      1 - (sy + SIGN_H) / H,
      (sx + SIGN_W) / 2048,
      1 - sy / H,
    ];
    // Door frame: origin on the wall at the door's centre, +z out of the wall
    kit.frame.compose(
      new THREE.Vector3(d.x, d.y, d.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.yaw),
      new THREE.Vector3(1, 1, 1),
    );
    const w = d.width;
    const frame = pick(rnd, [0x2b2118, 0x1b1b1b, 0xf4f1ea, 0x6b2f3a, 0x2c4a6b]);
    const leaf = pick(rnd, [0xc23a2b, 0x2c6fb0, 0x2f8a5f, 0xf2c94c, 0x6b4a33, 0x111111]);
    kit.add(boxAt(-w / 2 - 0.14, -w / 2, 0, 2.5, -0.04, 0.12), frame);
    kit.add(boxAt(w / 2, w / 2 + 0.14, 0, 2.5, -0.04, 0.12), frame);
    kit.add(boxAt(-w / 2 - 0.2, w / 2 + 0.2, 2.42, 2.6, -0.04, 0.16), frame);
    // Step / threshold
    kit.add(boxAt(-w / 2 - 0.15, w / 2 + 0.15, -0.05, 0.07, -0.02, 0.45), 0x9a9a92);
    // The warm, lit doorway behind a half-open door
    kit.add(boxAt(-w / 2, w / 2, 0.02, 2.42, -0.03, -0.01), 0xffcf7a, 'glow');
    kit.add(boxAt(-w / 2 + 0.06, w / 2 - 0.06, 0.06, 1.9, -0.025, -0.012), 0xffe2a8, 'glow');
    const lw = w * 0.92;
    const hinge = new THREE.Matrix4().makeTranslation(-w / 2, 0, 0);
    const swing = new THREE.Matrix4().makeRotationY(-1.15);
    const leafM = new THREE.Matrix4().multiplyMatrices(hinge, swing);
    const saved = kit.frame.clone();
    kit.frame.multiply(leafM);
    kit.add(boxAt(0, lw, 0.03, 2.36, 0, 0.05), leaf);
    kit.add(boxAt(lw - 0.12, lw - 0.08, 1.0, 1.1, 0.05, 0.08), 0xd9b45a);
    kit.frame.copy(saved);
    // Wall lamp beside the door
    kit.add(boxAt(w / 2 + 0.25, w / 2 + 0.45, 2.05, 2.35, 0, 0.16), 0x2b2b2b);
    kit.add(boxAt(w / 2 + 0.28, w / 2 + 0.42, 2.08, 2.3, 0.1, 0.18), 0xfff0c0, 'glow');
    // Sign board over the door
    const sw = Math.max(1.6, w + 0.6);
    kit.add(boxAt(-sw / 2 - 0.05, sw / 2 + 0.05, 2.66, 3.12, -0.02, 0.1), frame);
    kit.addArt(panel(sw, sw / 4, 0, 2.89, 0.105), uv, true);
    // …and a blade sign sticking out beside it, readable down the street
    // (and under an awning that hides the flat one)
    const bx = -w / 2 - 0.32;
    kit.add(boxAt(bx - 0.03, bx + 0.03, 2.62, 2.66, 0, 1.45), 0x2b2b2b);
    kit.add(boxAt(bx - 0.035, bx + 0.035, 2.0, 2.62, 0.08, 1.42), frame);
    for (const side of [1, -1]) {
      const save = kit.frame.clone();
      kit.frame.multiply(
        new THREE.Matrix4().compose(
          new THREE.Vector3(bx + side * 0.04, 2.31, 0.75),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (side * Math.PI) / 2),
          new THREE.Vector3(1, 1, 1),
        ),
      );
      kit.addArt(panel(1.3, 0.325, 0, 0, 0), uv, true);
      kit.frame.copy(save);
    }
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  // Never drawn again: on a diet its 2048² canvas (16 MB) goes once it's uploaded
  releaseAfterUpload(texture);
  const mats = kitMaterials(texture);
  const built = kit.build(mats, false);
  const group = new THREE.Group();
  group.name = 'InteriorDoors';
  for (const m of built.meshes) {
    m.castShadow = false;
    group.add(m);
  }
  toon(group);
  return {
    group,
    drawCalls: built.meshes.length,
    dispose: () => {
      group.removeFromParent();
      disposeMaterials(group);
      for (const d of built.disposables) d.dispose();
      for (const m of new Set(Object.values(mats))) m.dispose();
      texture.dispose();
    },
  };
}
