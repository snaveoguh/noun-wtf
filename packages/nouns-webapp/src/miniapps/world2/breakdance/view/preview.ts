// ── Dev: pose preview (a bare scene of posed Noun rigs, no world) ───────
//
//   const pv = await (await import('/src/miniapps/world2/breakdance/view/preview.ts')).posePreview()
//   pv.show([{ move: 'windmill', b: 0.3 }, { move: 'headspin', b: 0.1 }], { cols: 2, view: 'three' })
//
// For iterating on how a move reads (and contact-sheet screenshots) in
// seconds instead of loading Noun World. Not shipped anywhere.

import type { MoveId } from '../contract';

import * as THREE from 'three';

import { loadCharacterAssets, NounCharacter } from '../../character/NounCharacter';

import { seedOf } from './dancer';
import { VIEW_MOVES } from './moves';
import { movePose } from './pose';
import { PoseDriver } from './rig';

export interface PreviewItem {
  move: MoveId;
  b: number;
  n?: number;
  mirror?: boolean;
  label?: string;
}

export async function posePreview(w = 1200, h = 800) {
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
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 });
  scene.add(sun);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x8a8f99 }),
  );
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(60, 60, 0x555a66, 0x6a6f7a);
  grid.position.y = 0.002;
  scene.add(grid);
  const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 200);
  const rigs: { ch: NounCharacter; d: PoseDriver }[] = [];

  const rig = (i: number) => {
    while (rigs.length <= i) {
      const ch = new NounCharacter(seedOf(null, `pv:${rigs.length}`), assets);
      ch.board.visible = false;
      scene.add(ch.root);
      rigs.push({ ch, d: new PoseDriver(ch.root, ch.body, ch.body, ch.head) });
    }
    return rigs[i];
  };

  const api = {
    rigs,
    renderer,
    scene,
    camera,
    /** Pose a grid of rigs and render one frame. view: camera angle per cell. */
    show(
      items: PreviewItem[],
      o: {
        cols?: number;
        view?: 'front' | 'side' | 'three' | 'top' | 'low';
        gap?: number;
        zoom?: number;
      } = {},
    ) {
      const cols = o.cols ?? Math.min(items.length, 4);
      const rows = Math.ceil(items.length / cols);
      const gap = o.gap ?? 3.4;
      rigs.forEach(r => (r.ch.root.visible = false));
      labels.innerHTML = '';
      items.forEach((it, i) => {
        const r = rig(i);
        r.ch.root.visible = true;
        const cx = (i % cols) - (cols - 1) / 2;
        const cz = Math.floor(i / cols) - (rows - 1) / 2;
        r.ch.root.position.set(cx * gap, 0, cz * gap);
        r.ch.play({ clip: 'idle', fade: 0 });
        r.ch.update(1 / 60, { lean: 0, travelled: 0, riding: false });
        const n = it.n ?? VIEW_MOVES[it.move]?.beats ?? 4;
        r.d.drive(1, [{ out: movePose(it.move, it.b, n, it.mirror === true), w: 1 }], 1);
      });
      const span = Math.max(cols, rows) * gap;
      const dist = (span * 1.05 + 3.5) / (o.zoom ?? 1);
      const v = o.view ?? 'three';
      const dir =
        v === 'front'
          ? new THREE.Vector3(0, 0.25, 1)
          : v === 'side'
            ? new THREE.Vector3(1, 0.25, 0)
            : v === 'top'
              ? new THREE.Vector3(0.01, 1, 0.35)
              : v === 'low'
                ? new THREE.Vector3(0.7, 0.18, 1)
                : new THREE.Vector3(0.8, 0.45, 1);
      camera.position.copy(dir.normalize().multiplyScalar(dist)).add(new THREE.Vector3(0, 0.9, 0));
      camera.lookAt(0, 0.9, 0);
      camera.updateMatrixWorld();
      renderer.render(scene, camera);
      // Labels under each rig
      items.forEach((it, i) => {
        const p = rigs[i].ch.root.position
          .clone()
          .add(new THREE.Vector3(0, -0.1, 0.9))
          .project(camera);
        const el = document.createElement('div');
        el.textContent = it.label ?? `${it.move} @${it.b}`;
        el.style.cssText = `position:absolute;left:${((p.x + 1) / 2) * w}px;top:${((1 - p.y) / 2) * h}px;transform:translateX(-50%);background:rgba(0,0,0,.6);padding:1px 6px`;
        labels.appendChild(el);
      });
    },
  };
  return api;
}
