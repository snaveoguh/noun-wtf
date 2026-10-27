// ── Dev: parkour pose preview (posed Noun rigs by the props they hold) ───
//
//   const pv = await (await import('/src/miniapps/world2/parkour/view/preview.ts')).pkPreview()
//   pv.show([{ kind: 'hang', phase: 0.2 }, { kind: 'wallrun', phase: 0.3 }], { view: 'three' })
//
// Each rig stands at its move's distance from a wall / ledge / pole, so a
// contact sheet shows whether hands land on the lip and the head stays out
// of the wall. For iterating on poses in seconds; not shipped anywhere.

import type { PkAnim } from '../contract';

import * as THREE from 'three';

import { randomSeed } from '../../character/NounAppearance';
import { loadCharacterAssets, NounCharacter } from '../../character/NounCharacter';
import { PK } from '../contract';

import { ParkourRig } from './ParkourRig';

export type PreviewItem = Partial<PkAnim> & { kind: PkAnim['kind']; label?: string };

/** The prop each move holds on to, in rider space. */
function propFor(a: PreviewItem): THREE.Object3D {
  const g = new THREE.Group();
  const wall = new THREE.MeshStandardMaterial({ color: 0x7c8aa0, roughness: 0.9 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x30343c, metalness: 0.5 });
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m = wall) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    b.castShadow = b.receiveShadow = true;
    g.add(b);
  };
  switch (a.kind) {
    case 'wallrun': {
      const s = a.side ?? 1;
      box(0.3, 4, 3, s * (PK.wallRunDist + 0.15), 1.5, 0);
      break;
    }
    case 'wallup':
      box(2.4, 4, 0.3, 0, 1.6, PK.wallUpDist + 0.15);
      break;
    case 'climb':
    case 'mantle':
      box(2.4, 3, 0.3, 0, 1.2, 0.52 + 0.15);
      break;
    case 'hang':
    case 'pullup':
    case 'leap':
      // A wall whose top is the lip
      box(2.4, PK.hangDrop + 0.6, 0.6, 0, (PK.hangDrop - 0.6) / 2, PK.hangDist + 0.3);
      break;
    case 'pole': {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 12), metal);
      p.position.set(0, 1.4, 0.08 + PK.poleGap);
      p.castShadow = true;
      g.add(p);
      break;
    }
    case 'vault':
      box(1.6, 0.8, 0.5, 0, -0.1, 0.1);
      break;
    case 'balance':
      box(0.12, 0.6, 3, 0, -0.3, 0, metal);
      break;
    default:
      break;
  }
  return g;
}

export async function pkPreview(w = 1200, h = 800) {
  const assets = await loadCharacterAssets();
  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;background:#20232b';
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const labels = document.createElement('div');
  labels.style.cssText =
    'position:fixed;inset:0;pointer-events:none;font:700 15px system-ui;color:#fff';
  document.body.appendChild(labels);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(w, h, true);
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a2e38);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(6, 10, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14 });
  scene.add(sun);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x8a8f99 }),
  );
  floor.receiveShadow = true;
  scene.add(floor);
  const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 200);
  const seed = randomSeed();
  const cells: {
    ch: NounCharacter;
    rig: ParkourRig;
    holder: THREE.Group;
    prop: THREE.Object3D | null;
  }[] = [];

  const cell = (i: number) => {
    while (cells.length <= i) {
      const ch = new NounCharacter(seed, assets);
      ch.board.visible = false;
      const holder = new THREE.Group();
      holder.add(ch.root);
      scene.add(holder);
      cells.push({ ch, rig: new ParkourRig(ch), holder, prop: null });
    }
    return cells[i];
  };

  return {
    renderer,
    scene,
    camera,
    /**
     * Pose a row (or grid) of riders and render. `lift`: raise each rider so
     * its feet are where the move has them (hangs, poles, wall moves).
     */
    show(
      items: PreviewItem[],
      o: {
        cols?: number;
        view?: 'front' | 'side' | 'three' | 'back' | 'low' | 'open';
        gap?: number;
        zoom?: number;
      } = {},
    ) {
      const cols = o.cols ?? Math.min(items.length, 4);
      const rows = Math.ceil(items.length / cols);
      const gap = o.gap ?? 3.6;
      cells.forEach(c => (c.holder.visible = false));
      labels.innerHTML = '';
      items.forEach((it, i) => {
        const c = cell(i);
        c.holder.visible = true;
        const cx = (i % cols) - (cols - 1) / 2;
        const cz = Math.floor(i / cols) - (rows - 1) / 2;
        // Climbing moves hang in the air: lift the rider (and its prop with it)
        const air = [
          'hang',
          'pullup',
          'leap',
          'pole',
          'wallrun',
          'wallup',
          'climb',
          'mantle',
          'flip',
        ].includes(it.kind)
          ? 1.2
          : 0;
        c.holder.position.set(cx * gap, air, cz * gap);
        if (c.prop !== null) c.holder.remove(c.prop);
        c.prop = propFor(it);
        c.holder.add(c.prop);
        const a: PkAnim = {
          kind: it.kind,
          phase: it.phase ?? 0.25,
          side: it.side ?? 1,
          amt: it.amt ?? 0.5,
        };
        c.ch.play({ clip: 'idle', fade: 0 });
        // Settle the blend fully in
        for (let k = 0; k < 30; k++) {
          c.ch.update(1 / 60, { lean: 0, travelled: 0, riding: false });
          c.rig.update(1 / 60, a);
        }
      });
      const span = Math.max(cols, rows) * gap;
      const dist = (span * 0.95 + 4) / (o.zoom ?? 1);
      const v = o.view ?? 'three';
      const dir =
        v === 'front'
          ? new THREE.Vector3(0, 0.3, 1)
          : v === 'side'
            ? new THREE.Vector3(1, 0.25, 0)
            : v === 'back'
              ? new THREE.Vector3(0.35, 0.3, -1)
              : v === 'low'
                ? new THREE.Vector3(0.7, -0.1, -1)
                : v === 'open'
                  ? new THREE.Vector3(-1, 0.35, 0.45)
                  : new THREE.Vector3(1, 0.45, -0.8);
      camera.position.copy(dir.normalize().multiplyScalar(dist)).add(new THREE.Vector3(0, 1.6, 0));
      camera.lookAt(0, 1.6, 0);
      camera.updateMatrixWorld();
      renderer.render(scene, camera);
      items.forEach((it, i) => {
        const c = cells[i];
        const p = c.holder.position
          .clone()
          .add(new THREE.Vector3(0, -0.3, 0))
          .project(camera);
        const d = document.createElement('div');
        d.textContent = it.label ?? `${it.kind} ${it.phase ?? ''}`;
        d.style.cssText = `position:absolute;left:${((p.x + 1) / 2) * w}px;top:${((1 - p.y) / 2) * h}px;transform:translateX(-50%);background:#000a;padding:1px 6px`;
        labels.appendChild(d);
      });
    },
  };
}
