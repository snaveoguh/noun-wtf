// ── The pool hall: `/world?play=pool`'s own room ────────────────────────
//
// A small, warm room built round one table (the standalone entrance): a
// checker floor, panelled walls, a bar along the back with lit shelves, a
// neon NOUN POOL sign, a cue rack, a jukebox glow, stools, and a long
// pendant lamp over the table. Floats at a pocket high over the plaza like
// the interiors do (nothing up there); PoolMode hides the world round it.

import * as THREE from 'three';

export const HALL_W = 9;
export const HALL_D = 7;
const H = 3.3;

export interface Hall {
  group: THREE.Group;
  /** Lights (added to the group). */
  lights: THREE.Light[];
  /** Neon flicker etc. */
  update(dt: number): void;
  dispose(): void;
}

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildHall(): Hall {
  const group = new THREE.Group();
  group.name = 'pool-hall';
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  const std = (
    color: number,
    roughness = 0.8,
    extra: THREE.MeshStandardMaterialParameters = {},
  ) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, ...extra });
    mats.push(m);
    return m;
  };
  const glow = (color: number) => {
    const m = new THREE.MeshBasicMaterial({ color });
    mats.push(m);
    return m;
  };
  const box = (
    w: number,
    h: number,
    d: number,
    m: THREE.Material,
    x: number,
    y: number,
    z: number,
    shadow = true,
  ) => {
    const g = new THREE.BoxGeometry(w, h, d);
    geos.push(g);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  // ── Floor: big checker, a rug under the table ──
  const floorTex = canvasTex(512, 512, c => {
    const n = 8;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        c.fillStyle = (i + j) % 2 === 0 ? '#2a1d18' : '#c9b48e';
        c.fillRect((i * 512) / n, (j * 512) / n, 512 / n, 512 / n);
      }
  });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(HALL_W / 2, HALL_D / 2);
  texs.push(floorTex);
  box(HALL_W, 0.1, HALL_D, std(0xffffff, 0.7, { map: floorTex }), 0, -0.05, 0, false);
  box(3.8, 0.012, 2.6, std(0x5a1d24, 0.95), 0, 0.006, 0, false);

  // ── Walls: dark green panelling with a wood dado ──
  const wallM = std(0x23372c, 0.9);
  const dadoM = std(0x5b3420, 0.6);
  const t = 0.12;
  for (const [w, d, x, z] of [
    [HALL_W, t, 0, -HALL_D / 2],
    [HALL_W, t, 0, HALL_D / 2],
    [t, HALL_D, -HALL_W / 2, 0],
    [t, HALL_D, HALL_W / 2, 0],
  ] as const) {
    box(w, H, d, wallM, x, H / 2, z, false);
    box(w + 0.02, 1.0, d + 0.04, dadoM, x, 0.5, z, false);
  }
  // Ceiling
  box(HALL_W, 0.1, HALL_D, std(0x161210, 1), 0, H + 0.05, 0, false);

  // ── The bar along the back wall (−Z) ──
  const barZ = -HALL_D / 2 + 0.75;
  box(4.2, 1.05, 0.6, std(0x4a2614, 0.5), -1.6, 0.525, barZ);
  box(4.4, 0.06, 0.75, std(0x9a5a2a, 0.35), -1.6, 1.08, barZ);
  // Back shelves with bottles
  const shelfM = std(0x3a2214, 0.6);
  const bottleC = [0x2f8f4a, 0x9a3a1a, 0xd8b04a, 0x3a5aa8, 0xb8c8d8];
  for (let s = 0; s < 3; s++) {
    const y = 1.45 + s * 0.42;
    box(3.8, 0.04, 0.26, shelfM, -1.6, y, -HALL_D / 2 + 0.2, false);
    for (let k = 0; k < 14; k++) {
      const c = bottleC[(k * 7 + s * 3) % bottleC.length]!;
      const b = box(
        0.07,
        0.26,
        0.07,
        std(c, 0.2, { emissive: c, emissiveIntensity: 0.25 }),
        -3.3 + k * 0.26,
        y + 0.15,
        -HALL_D / 2 + 0.2,
        false,
      );
      b.scale.y = 0.8 + ((k * 13 + s) % 5) * 0.08;
    }
  }
  // Stools
  const stoolM = std(0x8a1f22, 0.5);
  const legM = std(0x222222, 0.4, { metalness: 0.6 });
  for (let k = 0; k < 5; k++) {
    const x = -3.3 + k * 0.85;
    box(0.36, 0.08, 0.36, stoolM, x, 0.74, barZ + 0.62);
    box(0.06, 0.7, 0.06, legM, x, 0.35, barZ + 0.62);
  }

  // ── Neon sign over the bar ──
  const neonTex = canvasTex(1024, 256, c => {
    c.fillStyle = 'rgba(0,0,0,0)';
    c.fillRect(0, 0, 1024, 256);
    c.font = 'bold 150px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.shadowColor = '#ff2f8e';
    c.shadowBlur = 28;
    c.fillStyle = '#ffd6ea';
    c.fillText('NOUN POOL', 512, 132);
    c.lineWidth = 6;
    c.strokeStyle = '#ff2f8e';
    c.strokeText('NOUN POOL', 512, 132);
  });
  texs.push(neonTex);
  const neonM = new THREE.MeshBasicMaterial({ map: neonTex, transparent: true, depthWrite: false });
  mats.push(neonM);
  const neonG = new THREE.PlaneGeometry(3.2, 0.8);
  geos.push(neonG);
  const neon = new THREE.Mesh(neonG, neonM);
  neon.position.set(1.9, 2.55, -HALL_D / 2 + t / 2 + 0.02);
  group.add(neon);

  // ── Noggles poster + cue rack on the side walls ──
  const posterTex = canvasTex(256, 360, c => {
    c.fillStyle = '#f3e7c9';
    c.fillRect(0, 0, 256, 360);
    c.fillStyle = '#e8402f';
    // Pixel noggles
    const px = 14;
    const ox = 30;
    const oy = 120;
    const on = (x: number, y: number) => c.fillRect(ox + x * px, oy + y * px, px, px);
    for (let x = 0; x < 6; x++)
      for (let y = 0; y < 5; y++) if (x === 0 || x === 5 || y === 0 || y === 4) on(x, y);
    for (let x = 7; x < 13; x++)
      for (let y = 0; y < 5; y++) if (x === 7 || x === 12 || y === 0 || y === 4) on(x, y);
    on(6, 1);
    on(-1, 1);
    on(-2, 1);
    on(-2, 2);
    c.fillStyle = '#fff';
    c.fillRect(ox + px, oy + px, px * 2, px * 3);
    c.fillRect(ox + px * 8, oy + px, px * 2, px * 3);
    c.fillStyle = '#111';
    c.fillRect(ox + px * 3, oy + px, px * 2, px * 3);
    c.fillRect(ox + px * 10, oy + px, px * 2, px * 3);
    c.font = 'bold 40px system-ui';
    c.textAlign = 'center';
    c.fillText('8 BALL', 128, 300);
  });
  texs.push(posterTex);
  const posterG = new THREE.PlaneGeometry(0.9, 1.26);
  geos.push(posterG);
  const posterM = std(0xffffff, 0.8, { map: posterTex });
  for (const z of [-1.4, 1.4]) {
    const p = new THREE.Mesh(posterG, posterM);
    p.position.set(-HALL_W / 2 + t / 2 + 0.01, 1.85, z);
    p.rotation.y = Math.PI / 2;
    group.add(p);
  }
  // Cue rack on the +X wall
  const rackM = std(0x6a3a1c, 0.5);
  box(0.06, 1.3, 1.4, rackM, HALL_W / 2 - 0.1, 1.3, 0.6);
  const cueM = std(0xe0c48e, 0.5);
  for (let k = 0; k < 6; k++) {
    const c = box(0.025, 1.4, 0.025, cueM, HALL_W / 2 - 0.16, 1.15, 0.05 + k * 0.22, false);
    c.rotation.x = 0.04;
  }
  // Jukebox glow in the corner
  box(0.8, 1.5, 0.55, std(0x6b2f3a, 0.5), HALL_W / 2 - 0.7, 0.75, -HALL_D / 2 + 0.5);
  box(0.6, 0.5, 0.05, glow(0xffb347), HALL_W / 2 - 0.7, 1.1, -HALL_D / 2 + 0.79, false);

  // ── The lamp over the table ──
  const shadeM = std(0x1f5a3a, 0.5, { side: THREE.DoubleSide });
  const lampY = 1.95;
  box(1.9, 0.18, 0.45, shadeM, 0, lampY, 0, false);
  box(1.8, 0.02, 0.38, glow(0xfff2c8), 0, lampY - 0.09, 0, false);
  for (const x of [-0.7, 0.7]) box(0.012, H - lampY, 0.012, legM, x, (H + lampY) / 2, 0, false);

  // ── Lights ──
  const lights: THREE.Light[] = [];
  const spot = new THREE.SpotLight(0xfff0d0, 12, 5, 0.9, 0.55, 1.4);
  spot.position.set(0, lampY - 0.1, 0);
  spot.target.position.set(0, 0, 0);
  spot.castShadow = false;
  group.add(spot, spot.target);
  lights.push(spot);
  const barLight = new THREE.PointLight(0xff9a5a, 6, 7, 1.6);
  barLight.position.set(-1.6, 2.4, barZ + 0.4);
  group.add(barLight);
  lights.push(barLight);
  const neonLight = new THREE.PointLight(0xff2f8e, 3, 5, 1.8);
  neonLight.position.set(1.9, 2.4, -HALL_D / 2 + 0.6);
  group.add(neonLight);
  lights.push(neonLight);

  let time = 0;
  return {
    group,
    lights,
    update(dt) {
      time += dt;
      // The odd neon flicker
      const f = Math.sin(time * 37) > 0.995 ? 0.35 : 1;
      neonM.opacity = f;
      neonLight.intensity = 3 * f;
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const tx of texs) tx.dispose();
      group.removeFromParent();
    },
  };
}
