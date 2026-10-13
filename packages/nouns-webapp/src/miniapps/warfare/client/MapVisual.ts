// ── Map visuals: toon geometry built from the sim's box/ramp data ──────
//
// Same idea as world2's NounJerseyPark: everything static is batched by
// material into a handful of merged meshes (textured solids with vertex
// tints, flat solids, emissive windows/neon) so a whole arena is ~10 draw
// calls. Geometry comes straight from MapDef, so what you see is exactly
// what paint collides with. Dressing (windows, signs, lamps, car bodies,
// vat bands, roof trusses) is visual only.

import type { BoxDef, MapDef, RampDef } from '../sim/world';
import type { Quality } from '@/miniapps/world2/render/Graphics';

import * as THREE from 'three';

import { inkExcluded, toonify } from '@/miniapps/world2/render/Toon';
import { SURFACES } from '@/miniapps/world2/world/proceduralTextures';

import { getCorrugated, getGlow, getSplatAtlas, neonSign } from './textures';

type TexKey = 'asphalt' | 'concrete' | 'plazaTile' | 'stucco' | 'wood' | 'corrugated' | 'none';

class Batch {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  idx: number[] = [];

  get empty() {
    return this.idx.length === 0;
  }

  quad(
    o: [number, number, number],
    u: [number, number, number],
    v: [number, number, number],
    n: [number, number, number],
    c: THREE.Color,
    uvScale: number,
  ) {
    const base = this.pos.length / 3;
    const pts = [
      o,
      [o[0] + u[0], o[1] + u[1], o[2] + u[2]],
      [o[0] + u[0] + v[0], o[1] + u[1] + v[1], o[2] + u[2] + v[2]],
      [o[0] + v[0], o[1] + v[1], o[2] + v[2]],
    ];
    const ax = Math.abs(n[0]);
    const ay = Math.abs(n[1]);
    for (const p of pts) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(c.r, c.g, c.b);
      if (ay >= 0.7) this.uv.push(p[0] * uvScale, p[2] * uvScale);
      else if (ax >= 0.7) this.uv.push(p[2] * uvScale, p[1] * uvScale);
      else this.uv.push(p[0] * uvScale, p[1] * uvScale);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  tri(
    a: number[],
    b: number[],
    c3: number[],
    n: [number, number, number],
    c: THREE.Color,
    uvScale: number,
  ) {
    const base = this.pos.length / 3;
    for (const p of [a, b, c3]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(c.r, c.g, c.b);
      if (Math.abs(n[0]) >= 0.7) this.uv.push(p[2] * uvScale, p[1] * uvScale);
      else this.uv.push(p[0] * uvScale, p[1] * uvScale);
    }
    this.idx.push(base, base + 1, base + 2);
  }

  box(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    c: THREE.Color,
    uvScale = 0.25,
    skipBottom = true,
  ) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    this.quad([x1, y0, z1], [0, 0, -dz], [0, dy, 0], [1, 0, 0], c, uvScale);
    this.quad([x0, y0, z0], [0, 0, dz], [0, dy, 0], [-1, 0, 0], c, uvScale);
    this.quad([x0, y0, z1], [dx, 0, 0], [0, dy, 0], [0, 0, 1], c, uvScale);
    this.quad([x1, y0, z0], [-dx, 0, 0], [0, dy, 0], [0, 0, -1], c, uvScale);
    this.quad([x0, y1, z1], [dx, 0, 0], [0, 0, -dz], [0, 1, 0], c, uvScale);
    if (!skipBottom) this.quad([x0, y0, z0], [dx, 0, 0], [0, 0, dz], [0, -1, 0], c, uvScale);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export interface MapVisual {
  root: THREE.Group;
  /** Meshes for world2's CollisionWorld (third-person camera boom). */
  collisionMeshes: THREE.Mesh[];
  night: boolean;
  update(t: number): void;
  dispose(): void;
}

const C = (hex: number) => new THREE.Color(hex);

export function buildMapVisual(map: MapDef, quality: Quality, toon: boolean): MapVisual {
  const night = map.id === 'nouncity';
  const root = new THREE.Group();
  root.name = `warfare-map-${map.id}`;
  const rand = rng(map.id === 'nouncity' ? 11 : 23);
  const batches = new Map<TexKey, Batch>();
  const B = (k: TexKey) => {
    let b = batches.get(k);
    if (b === undefined) {
      b = new Batch();
      batches.set(k, b);
    }
    return b;
  };
  const glowB = new Batch(); // unlit emissive (windows, neon strips, lamp heads)
  const decalB = new Batch(); // ground markings (polygon offset)
  const flickers: { mat: THREE.MeshBasicMaterial; base: number; speed: number; phase: number }[] =
    [];
  const disposables: { dispose(): void }[] = [];

  // ── Solid boxes
  const tex = (b: BoxDef): TexKey => {
    switch (b.tag) {
      case 'floor':
        return night ? 'asphalt' : 'concrete';
      case 'wall':
        return 'corrugated';
      case 'building':
        return 'stucco';
      case 'crate':
        return 'wood';
      case 'container':
        return 'corrugated';
      case 'bench':
        return 'wood';
      case 'parapet':
      case 'bridge':
      case 'planter':
      case 'barrier':
      case 'catwalk':
      case 'roof':
        return 'concrete';
      default:
        return 'none';
    }
  };
  const BUILDING_TINTS = night
    ? [0x5a4f7a, 0x46607e, 0x6b4a66, 0x3f5e5a, 0x6a5a4a, 0x55557a]
    : [0x9aa3ad];
  const VAT = [0xffc20e, 0xe0287a, 0x18c6d6, 0x39c94a];
  let vatI = 0;
  const color = (b: BoxDef): THREE.Color => {
    if (b.color !== undefined) return C(b.color);
    const cx = (b.min[0] + b.max[0]) / 2;
    switch (b.tag) {
      case 'floor':
        return night ? C(0x8a8a96) : C(0xb8b4ac);
      case 'wall':
        return C(0x8e9cab);
      case 'building':
        return C(BUILDING_TINTS[Math.floor(rand() * BUILDING_TINTS.length)]);
      case 'roof':
        return C(0x3a3d48);
      case 'parapet':
        return night ? C(0xb9b2c4) : C(0x4b5560);
      case 'catwalk':
        return C(0x5d6873);
      case 'crate':
        return C(0xe0b27a);
      case 'container':
        return C(0x3f7fbf);
      case 'tank':
        return C(VAT[vatI++ % VAT.length]);
      case 'car':
        return C(
          [0xf04e37, 0x2a9df4, 0xffd23f, 0x8e44ad, 0xf2f2f2, 0x2ecc71][Math.floor(rand() * 6)],
        );
      case 'planter':
        return C(0xb6aea2);
      case 'statue':
        return C(0xd22209);
      case 'kiosk':
        return C([0x2bb3a6, 0xf2a03d, 0xe74c8c][Math.floor(rand() * 3)]);
      case 'pillar':
        return night ? C(0x262a33) : C(0xf2c230);
      case 'bench':
        return C(0xb07a4a);
      case 'dumpster':
        return C(0x2f7d4f);
      case 'barrier':
        return C(0xe8e4dc);
      case 'bridge':
        return C(0x9a97a6);
      case 'base':
        return cx < 0 ? C(0xc2372d) : C(0x2f6fd6);
    }
  };

  const wantsWindows = (b: BoxDef) => night && b.tag === 'building';

  for (const b of map.boxes) {
    const [x0, y0, z0] = b.min;
    const [x1, y1, z1] = b.max;
    const c = color(b);
    if (b.tag === 'car') {
      buildCar(B('none'), glowB, b, c);
      continue;
    }
    if (b.tag === 'pillar' && night) {
      // Street lamp: thin pole + lamp head
      const mx = (x0 + x1) / 2;
      const mz = (z0 + z1) / 2;
      B('none').box(mx - 0.09, 0, mz - 0.09, mx + 0.09, y1, mz + 0.09, c);
      B('none').box(mx - 0.3, y1 - 0.12, mz - 0.3, mx + 0.3, y1 + 0.05, mz + 0.3, C(0x1c1f26));
      glowB.box(
        mx - 0.22,
        y1 - 0.2,
        mz - 0.22,
        mx + 0.22,
        y1 - 0.12,
        mz + 0.22,
        C(0xffe3a0),
        1,
        false,
      );
      lampPool(root, mx, mz, 0xffd38a, 5.5, disposables);
      continue;
    }
    if (b.tag === 'tank') {
      // Square paint vat: banded, ladder, drip
      B('none').box(x0, y0, z0, x1, y1, z1, c);
      const dark = c.clone().multiplyScalar(0.55);
      B('none').box(x0 - 0.06, y1 - 0.5, z0 - 0.06, x1 + 0.06, y1 - 0.25, z1 + 0.06, dark);
      B('none').box(x0 - 0.06, 0.4, z0 - 0.06, x1 + 0.06, 0.65, z1 + 0.06, dark);
      // Paint pooled on top (bright, unlit)
      glowB.quad(
        [x0 + 0.2, y1 + 0.01, z1 - 0.2],
        [x1 - x0 - 0.4, 0, 0],
        [0, 0, -(z1 - z0 - 0.4)],
        [0, 1, 0],
        c.clone().multiplyScalar(1.1),
        1,
      );
      // Drip down the face toward the centre of the map
      const face = (x0 + x1) / 2 < 0 ? 1 : -1;
      const fx = face > 0 ? x1 + 0.012 : x0 - 0.012;
      const dz = (z1 - z0) * 0.25;
      glowB.quad(
        [fx, y1 - 2.4, face > 0 ? z0 + dz * 2.4 : z0 + dz * 1.6],
        [0, 0, face > 0 ? -dz * 0.6 : dz * 0.6],
        [0, 2.4, 0],
        [face, 0, 0],
        c,
        1,
      );
      // Ladder rungs on the far side
      const lx = face > 0 ? x0 - 0.05 : x1 + 0.05;
      for (let y = 0.5; y < y1 - 0.2; y += 0.45)
        B('none').box(lx - 0.03, y, z0 + 0.9, lx + 0.03, y + 0.05, z1 - 0.9, C(0x30343c));
      continue;
    }
    const tk = tex(b);
    const uvs = tk === 'corrugated' ? 0.5 : tk === 'wood' ? 0.7 : 0.22;
    B(tk).box(x0, y0, z0, x1, y1, z1, c, uvs, !(y0 > 0.01));
    if (b.tag === 'statue') {
      // Noggle lenses: white | black halves on both faces of each frame
      if (y1 - y0 > 1) {
        const w = x1 - x0;
        for (const zf of [z0 - 0.012, z1 + 0.012]) {
          const n: [number, number, number] = [0, 0, zf < z0 ? -1 : 1];
          const ly0 = y0 + 0.22;
          const lh = y1 - y0 - 0.44;
          const lx0 = x0 + 0.22;
          const lw = w - 0.44;
          B('none').quad(
            zf < z0 ? [lx0 + lw / 2, ly0, zf] : [lx0, ly0, zf],
            [zf < z0 ? -lw / 2 : lw / 2, 0, 0],
            [0, lh, 0],
            n,
            C(0xffffff),
            1,
          );
          B('none').quad(
            zf < z0 ? [lx0 + lw, ly0, zf] : [lx0 + lw / 2, ly0, zf],
            [zf < z0 ? -lw / 2 : lw / 2, 0, 0],
            [0, lh, 0],
            n,
            C(0x111111),
            1,
          );
        }
      }
    }
    if (b.tag === 'planter') {
      // Bushes
      const n = Math.max(1, Math.round(((x1 - x0) * (z1 - z0)) / 1.2));
      for (let i = 0; i < n; i++) {
        const bx = x0 + 0.3 + rand() * (x1 - x0 - 0.6);
        const bz = z0 + 0.3 + rand() * (z1 - z0 - 0.6);
        const r = 0.35 + rand() * 0.2;
        B('none').box(
          bx - r,
          y1,
          bz - r,
          bx + r,
          y1 + r * 1.4,
          bz + r,
          C(rand() < 0.5 ? 0x3c8a3f : 0x2f7a46),
        );
      }
    }
    if (b.tag === 'barrier') {
      // Red stripes on the long faces
      const long = x1 - x0 > z1 - z0;
      const red = C(0xd63a2a);
      const segs = Math.max(2, Math.round((long ? x1 - x0 : z1 - z0) / 0.5));
      for (let i = 0; i < segs; i += 2) {
        const a = i / segs;
        const w = 1 / segs;
        if (long) {
          const sx = x0 + (x1 - x0) * a;
          const sw = (x1 - x0) * w;
          B('none').quad([sx, y0 + 0.3, z1 + 0.01], [sw, 0, 0], [0, 0.3, 0], [0, 0, 1], red, 1);
          B('none').quad(
            [sx + sw, y0 + 0.3, z0 - 0.01],
            [-sw, 0, 0],
            [0, 0.3, 0],
            [0, 0, -1],
            red,
            1,
          );
        } else {
          const sz = z0 + (z1 - z0) * a;
          const sw = (z1 - z0) * w;
          B('none').quad(
            [x1 + 0.01, y0 + 0.3, sz + sw],
            [0, 0, -sw],
            [0, 0.3, 0],
            [1, 0, 0],
            red,
            1,
          );
          B('none').quad([x0 - 0.01, y0 + 0.3, sz], [0, 0, sw], [0, 0.3, 0], [-1, 0, 0], red, 1);
        }
      }
    }
    if (b.tag === 'base') {
      // Team-coloured glow strip on top
      const cx = (x0 + x1) / 2;
      glowB.box(
        x0 + 0.05,
        y1,
        z0 + 0.05,
        x1 - 0.05,
        y1 + 0.06,
        z1 - 0.05,
        cx < 0 ? C(0xff5a4a) : C(0x5a9dff),
        1,
      );
    }
    if (b.tag === 'parapet' && !night) {
      // Yellow safety rail on catwalk edges
      B('none').box(x0 - 0.02, y1 - 0.08, z0 - 0.02, x1 + 0.02, y1 + 0.02, z1 + 0.02, C(0xf2c230));
    }
    if (b.tag === 'dumpster') {
      B('none').box(x0 - 0.05, y1, z0 - 0.05, x1 + 0.05, y1 + 0.08, z1 + 0.05, C(0x1d4d33));
    }
    if (b.tag === 'container') {
      // Door bars on the short ends
      const alongX = x1 - x0 > z1 - z0;
      const bar = c.clone().multiplyScalar(0.6);
      for (let k = 0; k < 4; k++) {
        if (alongX) {
          const zz = z0 + ((k + 0.5) / 4) * (z1 - z0);
          B('none').box(x1, 0.2, zz - 0.04, x1 + 0.05, y1 - 0.2, zz + 0.04, bar);
          B('none').box(x0 - 0.05, 0.2, zz - 0.04, x0, y1 - 0.2, zz + 0.04, bar);
        } else {
          const xx = x0 + ((k + 0.5) / 4) * (x1 - x0);
          B('none').box(xx - 0.04, 0.2, z1, xx + 0.04, y1 - 0.2, z1 + 0.05, bar);
          B('none').box(xx - 0.04, 0.2, z0 - 0.05, xx + 0.04, y1 - 0.2, z0, bar);
        }
      }
    }
    if (wantsWindows(b)) buildWindows(glowB, b, rand);
    if (b.tag === 'bridge' && night) {
      glowB.box(
        x0,
        y0 - 0.05,
        (z0 + z1) / 2 - 0.08,
        x1,
        y0,
        (z0 + z1) / 2 + 0.08,
        C(0xc04dff),
        1,
        false,
      );
    }
  }

  // ── Ramps / stairs
  for (const r of map.ramps) buildRamp(r.look === 'stairs' ? B('none') : B('concrete'), r, night);

  // ── Ground markings
  if (night) {
    // Plaza tiles
    const plaza = B('plazaTile');
    plaza.quad([-24.6, 0.004, 8.6], [49.2, 0, 0], [0, 0, -17.2], [0, 1, 0], C(0xb8aec6), 0.25);
    // Sidewalks along the street blocks
    for (const zz of [-24.5, 22.5])
      decalB.quad([-33, 0.005, zz + 2], [66, 0, 0], [0, 0, -2], [0, 1, 0], C(0x9b98a6), 1);
    // Lane dashes
    for (const zz of [-18.8, 18.8])
      for (let x = -30; x < 30; x += 3)
        decalB.quad([x, 0.006, zz + 0.08], [1.6, 0, 0], [0, 0, -0.16], [0, 1, 0], C(0xf0c53a), 1);
    // Crosswalks
    for (const [zc, dir] of [
      [-10.3, 1],
      [10.3, 1],
    ] as const) {
      for (let x = -4; x < 4; x += 1.0)
        decalB.quad(
          [x, 0.007, zc + 1.6 * dir],
          [0.5, 0, 0],
          [0, 0, -3.2 * dir],
          [0, 1, 0],
          C(0xf4f4f0),
          1,
        );
    }
    for (const xc of [-21, 21])
      for (let z = -7.5; z < 7.5; z += 1.0)
        decalB.quad([xc - 1.5, 0.007, z + 0.5], [3, 0, 0], [0, 0, -0.5], [0, 1, 0], C(0xf4f4f0), 1);
  } else {
    // Safety lines + spawn bays painted in team colours
    for (const zz of [-17.8, 17.8])
      decalB.quad([-20, 0.006, zz + 0.1], [40, 0, 0], [0, 0, -0.2], [0, 1, 0], C(0xf2c230), 1);
    for (const xx of [-21.2, 21.2])
      decalB.quad([xx - 0.1, 0.006, 17.8], [0.2, 0, 0], [0, 0, -35.6], [0, 1, 0], C(0xf2c230), 1);
    decalB.quad([-29.4, 0.005, 18.4], [7.6, 0, 0], [0, 0, -36.8], [0, 1, 0], C(0x8a3a34), 1);
    decalB.quad([21.8, 0.005, 18.4], [7.6, 0, 0], [0, 0, -36.8], [0, 1, 0], C(0x2f4f8a), 1);
    // Hazard chevrons at the stairs feet
    for (const xs of [-28.6, 28.6])
      for (const zs of [-20, 20])
        for (let k = 0; k < 4; k++)
          decalB.quad(
            [xs < 0 ? xs : xs - 0.6, 0.007, zs + (k - 2) * 0.7 + 0.3],
            [0.6, 0, 0],
            [0, 0, -0.3],
            [0, 1, 0],
            C(k % 2 === 0 ? 0xf2c230 : 0x222222),
            1,
          );
  }

  // ── Build meshes
  const mats: THREE.Material[] = [];
  const texFor = (k: TexKey): THREE.Texture | null => {
    switch (k) {
      case 'asphalt':
        return SURFACES.asphalt();
      case 'concrete':
        return SURFACES.concrete();
      case 'plazaTile':
        return SURFACES.plazaTile();
      case 'stucco':
        return SURFACES.stucco();
      case 'wood':
        return SURFACES.wood();
      case 'corrugated':
        return getCorrugated();
      case 'none':
        return null;
    }
  };
  const collisionMeshes: THREE.Mesh[] = [];
  for (const [k, b] of batches) {
    if (b.empty) continue;
    const m = new THREE.MeshStandardMaterial({
      map: texFor(k),
      vertexColors: true,
      roughness: 0.92,
      metalness: 0,
    });
    mats.push(m);
    const mesh = new THREE.Mesh(b.geometry(), m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `solid-${k}`;
    root.add(mesh);
    collisionMeshes.push(mesh);
  }
  if (!decalB.empty) {
    const m = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    mats.push(m);
    const mesh = new THREE.Mesh(decalB.geometry(), m);
    mesh.receiveShadow = true;
    root.add(mesh);
    inkExcluded.add(mesh);
  }
  if (!glowB.empty) {
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    mats.push(m);
    const mesh = new THREE.Mesh(glowB.geometry(), m);
    mesh.name = 'glow';
    root.add(mesh);
  }

  // Pre-painted splats (the arena has seen a few matches already)
  root.add(buildOldPaint(map, rand, mats));

  // ── Dressing
  if (night) buildCityDressing(root, map, rand, quality, flickers, disposables, mats);
  else buildWarehouseDressing(root, map, rand, quality, mats);

  if (toon) toonify(root);

  return {
    root,
    collisionMeshes,
    night,
    update(t: number) {
      for (const f of flickers) {
        const k = Math.sin(t * f.speed + f.phase);
        f.mat.opacity = k > 0.97 ? f.base * 0.35 : f.base;
      }
    },
    dispose() {
      root.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
        inkExcluded.delete(o);
      });
      for (const m of mats) m.dispose();
      for (const d of disposables) d.dispose();
    },
  };
}

// ── Pieces ───────────────────────────────────────────────────────────────

function buildRamp(b: Batch, r: RampDef, night: boolean) {
  const steps = r.look === 'stairs';
  const c = steps ? (night ? C(0x8e8a99) : C(0x5d6873)) : C(0xa49fb0);
  const rise = r.y1 - r.y0;
  if (steps) {
    const n = Math.max(2, Math.round(rise / 0.25));
    for (let i = 0; i < n; i++) {
      const a = i / n;
      const a1 = (i + 1) / n;
      const top = r.y0 + rise * a1;
      let x0 = r.x0;
      let x1 = r.x1;
      let z0 = r.z0;
      let z1 = r.z1;
      const L = r.dir === '+x' || r.dir === '-x' ? r.x1 - r.x0 : r.z1 - r.z0;
      switch (r.dir) {
        case '+x':
          x0 = r.x0 + L * a;
          x1 = r.x0 + L * a1;
          break;
        case '-x':
          x1 = r.x1 - L * a;
          x0 = r.x1 - L * a1;
          break;
        case '+z':
          z0 = r.z0 + L * a;
          z1 = r.z0 + L * a1;
          break;
        case '-z':
          z1 = r.z1 - L * a;
          z0 = r.z1 - L * a1;
          break;
      }
      b.box(x0, r.y0, z0, x1, top, z1, i % 2 === 0 ? c : c.clone().multiplyScalar(0.92), 0.5);
      // Yellow nosing
      const nose = C(0xf2c230);
      switch (r.dir) {
        case '+x':
          b.box(x1 - 0.06, top, z0, x1, top + 0.01, z1, nose);
          break;
        case '-x':
          b.box(x0, top, z0, x0 + 0.06, top + 0.01, z1, nose);
          break;
        case '+z':
          b.box(x0, top, z1 - 0.06, x1, top + 0.01, z1, nose);
          break;
        case '-z':
          b.box(x0, top, z0, x1, top + 0.01, z0 + 0.06, nose);
          break;
      }
    }
    return;
  }
  // Smooth ramp: sloped top, two triangle sides, high-end face
  const { x0, x1, z0, z1, y0, y1 } = r;
  const h = (x: number, z: number) => {
    switch (r.dir) {
      case '+x':
        return y0 + ((x - x0) / (x1 - x0)) * rise;
      case '-x':
        return y0 + ((x1 - x) / (x1 - x0)) * rise;
      case '+z':
        return y0 + ((z - z0) / (z1 - z0)) * rise;
      case '-z':
        return y0 + ((z1 - z) / (z1 - z0)) * rise;
    }
  };
  const p00 = [x0, h(x0, z0), z0];
  const p10 = [x1, h(x1, z0), z0];
  const p11 = [x1, h(x1, z1), z1];
  const p01 = [x0, h(x0, z1), z1];
  // top: normal from cross product
  const e1 = new THREE.Vector3(p10[0] - p00[0], p10[1] - p00[1], p10[2] - p00[2]);
  const e2 = new THREE.Vector3(p01[0] - p00[0], p01[1] - p00[1], p01[2] - p00[2]);
  const n = new THREE.Vector3().crossVectors(e2, e1).normalize();
  if (n.y < 0) n.negate();
  const nn: [number, number, number] = [n.x, n.y, n.z];
  b.tri(p00, p01, p11, nn, c, 0.25);
  b.tri(p00, p11, p10, nn, c, 0.25);
  // sides
  const side = c.clone().multiplyScalar(0.8);
  if (r.dir === '+z' || r.dir === '-z') {
    for (const [xx, nx] of [
      [x0, -1],
      [x1, 1],
    ] as const) {
      const a = [xx, y0, z0];
      const bb = [xx, y0, z1];
      const top = r.dir === '+z' ? [xx, y1, z1] : [xx, y1, z0];
      if (nx < 0) b.tri(a, bb, top, [-1, 0, 0], side, 0.25);
      else b.tri(a, top, bb, [1, 0, 0], side, 0.25);
    }
  } else {
    for (const [zz, nz] of [
      [z0, -1],
      [z1, 1],
    ] as const) {
      const a = [x0, y0, zz];
      const bb = [x1, y0, zz];
      const top = r.dir === '+x' ? [x1, y1, zz] : [x0, y1, zz];
      if (nz > 0) b.tri(a, bb, top, [0, 0, 1], side, 0.25);
      else b.tri(a, top, bb, [0, 0, -1], side, 0.25);
    }
  }
  // Guard rails along the open sides of the roof ramp
  const rail = C(0xf2c230);
  if (r.dir === '+z' || r.dir === '-z') {
    for (const xx of [x0, x1]) {
      for (let k = 0; k <= 4; k++) {
        const zz = z0 + ((z1 - z0) * k) / 4;
        const hh = h(xx, zz);
        b.box(xx - 0.04, hh, zz - 0.04, xx + 0.04, hh + 0.95, zz + 0.04, rail);
      }
    }
  }
}

function buildWindows(glow: Batch, b: BoxDef, rand: () => number) {
  const [x0, y0, z0] = b.min;
  const [x1, y1, z1] = b.max;
  const faces: {
    o: [number, number, number];
    u: [number, number, number];
    n: [number, number, number];
    len: number;
  }[] = [];
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  // Faces whose outward normal points toward the arena centre
  if (z1 < 0 || (cz < 0 && z1 - z0 < 8))
    faces.push({ o: [x0, 0, z1 + 0.02], u: [1, 0, 0], n: [0, 0, 1], len: x1 - x0 });
  if (z0 > 0 || (cz > 0 && z1 - z0 < 8))
    faces.push({ o: [x1, 0, z0 - 0.02], u: [-1, 0, 0], n: [0, 0, -1], len: x1 - x0 });
  if (x1 < -20) faces.push({ o: [x1 + 0.02, 0, z1], u: [0, 0, -1], n: [1, 0, 0], len: z1 - z0 });
  if (x0 > 20) faces.push({ o: [x0 - 0.02, 0, z0], u: [0, 0, 1], n: [-1, 0, 0], len: z1 - z0 });
  if (faces.length === 0 && Math.abs(cx) < 30) {
    faces.push({ o: [x0, 0, z1 + 0.02], u: [1, 0, 0], n: [0, 0, 1], len: x1 - x0 });
    faces.push({ o: [x1, 0, z0 - 0.02], u: [-1, 0, 0], n: [0, 0, -1], len: x1 - x0 });
  }
  const lit = [0xffd27a, 0xffe9b0, 0x9fe8ff, 0xff9fd2, 0xfff2c8];
  const dark = 0x1a2036;
  for (const f of faces) {
    const cols = Math.floor((f.len - 1) / 2.2);
    if (cols < 1) continue;
    const pad = (f.len - cols * 2.2) / 2;
    for (let i = 0; i < cols; i++) {
      for (let y = y0 + 1.1; y + 1.4 < y1 - 0.3; y += 2.6) {
        const on = rand() < 0.55;
        const col = C(on ? lit[Math.floor(rand() * lit.length)] : dark);
        const along = pad + i * 2.2 + 0.5;
        const o: [number, number, number] = [f.o[0] + f.u[0] * along, y, f.o[2] + f.u[2] * along];
        const u: [number, number, number] = [f.u[0] * 1.2, 0, f.u[2] * 1.2];
        glow.quad(o, u, [0, 1.3, 0], f.n, col, 1);
      }
    }
  }
}

function buildCar(b: Batch, glow: Batch, box: BoxDef, c: THREE.Color) {
  const [x0, , z0] = box.min;
  const [x1, y1, z1] = box.max;
  const alongX = x1 - x0 > z1 - z0;
  b.box(x0, 0.22, z0, x1, 0.82, z1, c);
  const inset = 0.6;
  const glass = C(0x2a3550);
  if (alongX) b.box(x0 + inset, 0.82, z0 + 0.1, x1 - inset - 0.2, y1, z1 - 0.1, glass);
  else b.box(x0 + 0.1, 0.82, z0 + inset, x1 - 0.1, y1, z1 - inset - 0.2, glass);
  if (alongX)
    b.box(x0 + inset + 0.05, y1 - 0.02, z0 + 0.15, x1 - inset - 0.25, y1 + 0.03, z1 - 0.15, c);
  else b.box(x0 + 0.15, y1 - 0.02, z0 + inset + 0.05, x1 - 0.15, y1 + 0.03, z1 - inset - 0.25, c);
  const tire = C(0x15161a);
  const wr = 0.3;
  const corners = alongX
    ? [
        [x0 + 0.75, z0],
        [x1 - 0.75, z0],
        [x0 + 0.75, z1],
        [x1 - 0.75, z1],
      ]
    : [
        [x0, z0 + 0.75],
        [x0, z1 - 0.75],
        [x1, z0 + 0.75],
        [x1, z1 - 0.75],
      ];
  for (const [wx, wz] of corners)
    b.box(
      wx - (alongX ? wr : 0.12),
      0,
      wz - (alongX ? 0.12 : wr),
      wx + (alongX ? wr : 0.12),
      wr * 2,
      wz + (alongX ? 0.12 : wr),
      tire,
    );
  // Lights
  if (alongX) {
    glow.box(x1, 0.5, z0 + 0.2, x1 + 0.03, 0.66, z0 + 0.5, C(0xfff4c8), 1);
    glow.box(x1, 0.5, z1 - 0.5, x1 + 0.03, 0.66, z1 - 0.2, C(0xfff4c8), 1);
    glow.box(x0 - 0.03, 0.5, z0 + 0.2, x0, 0.66, z0 + 0.5, C(0xff3030), 1);
    glow.box(x0 - 0.03, 0.5, z1 - 0.5, x0, 0.66, z1 - 0.2, C(0xff3030), 1);
  } else {
    glow.box(x0 + 0.2, 0.5, z1, x0 + 0.5, 0.66, z1 + 0.03, C(0xfff4c8), 1);
    glow.box(x1 - 0.5, 0.5, z1, x1 - 0.2, 0.66, z1 + 0.03, C(0xfff4c8), 1);
    glow.box(x0 + 0.2, 0.5, z0 - 0.03, x0 + 0.5, 0.66, z0, C(0xff3030), 1);
    glow.box(x1 - 0.5, 0.5, z0 - 0.03, x1 - 0.2, 0.66, z0, C(0xff3030), 1);
  }
}

function lampPool(
  root: THREE.Object3D,
  x: number,
  z: number,
  color: number,
  r: number,
  disposables: { dispose(): void }[],
) {
  const geo = new THREE.PlaneGeometry(r * 2, r * 2);
  const mat = new THREE.MeshBasicMaterial({
    map: getGlow(),
    color: new THREE.Color(color).multiplyScalar(0.45),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -3,
  });
  disposables.push(geo, mat);
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.02, z);
  m.renderOrder = 2;
  root.add(m);
  inkExcluded.add(m);
}

/** Static paint already on the arena (atlas splats baked into one mesh). */
function buildOldPaint(map: MapDef, rand: () => number, mats: THREE.Material[]): THREE.Mesh {
  const b = new Batch();
  const cols = [0xe8352b, 0x2f7bff, 0xffc20e, 0x2bd96b, 0xc04dff, 0xff7a1a, 0x18d6d6];
  const n = map.id === 'warehouse' ? 70 : 40;
  const [hx, hz] = map.half;
  for (let i = 0; i < n; i++) {
    const x = (rand() * 2 - 1) * (hx - 3);
    const z = (rand() * 2 - 1) * (hz - 3);
    const s = 0.6 + rand() * 1.6;
    const cell = Math.floor(rand() * 4);
    const u0 = (cell % 2) * 0.5;
    const v0 = Math.floor(cell / 2) * 0.5;
    const col = C(cols[Math.floor(rand() * cols.length)]).multiplyScalar(0.8);
    const base = b.pos.length / 3;
    const a = rand() * Math.PI * 2;
    const ca = Math.cos(a) * s;
    const sa = Math.sin(a) * s;
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    for (const [cx, cz] of corners) {
      b.pos.push(x + cx * ca - cz * sa, 0.009 + i * 0.0001, z + cx * sa + cz * ca);
      b.nor.push(0, 1, 0);
      b.col.push(col.r, col.g, col.b);
      b.uv.push(u0 + ((cx + 1) / 2) * 0.5, v0 + ((cz + 1) / 2) * 0.5);
    }
    b.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const mat = new THREE.MeshStandardMaterial({
    map: getSplatAtlas(),
    vertexColors: true,
    alphaTest: 0.5,
    transparent: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    roughness: 0.4,
  });
  mats.push(mat);
  const mesh = new THREE.Mesh(b.geometry(), mat);
  mesh.receiveShadow = true;
  inkExcluded.add(mesh);
  return mesh;
}

function addSign(
  root: THREE.Object3D,
  text: string,
  color: string,
  pos: [number, number, number],
  rotY: number,
  w: number,
  h: number,
  mats: THREE.Material[],
  flickers?: { mat: THREE.MeshBasicMaterial; base: number; speed: number; phase: number }[],
  frame = false,
) {
  const tex = neonSign(text, color, { w: 512, h: Math.round((512 * h) / w), frame });
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  mats.push(mat);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(...pos);
  m.rotation.y = rotY;
  m.renderOrder = 3;
  root.add(m);
  inkExcluded.add(m);
  if (flickers !== undefined)
    flickers.push({ mat, base: 1, speed: 1.3 + Math.random() * 2, phase: Math.random() * 6 });
}

function buildCityDressing(
  root: THREE.Object3D,
  map: MapDef,
  rand: () => number,
  quality: Quality,
  flickers: { mat: THREE.MeshBasicMaterial; base: number; speed: number; phase: number }[],
  disposables: { dispose(): void }[],
  mats: THREE.Material[],
) {
  // Skyline towers beyond the arena
  const sky = new Batch();
  const win = new Batch();
  for (let i = 0; i < 26; i++) {
    const side = i % 4;
    const along = -50 + rand() * 100;
    const w = 6 + rand() * 9;
    const d = 6 + rand() * 8;
    const h = 18 + rand() * 34;
    let x0: number;
    let z0: number;
    if (side === 0) {
      x0 = along;
      z0 = -44 - rand() * 14;
    } else if (side === 1) {
      x0 = along;
      z0 = 31 + rand() * 14;
    } else if (side === 2) {
      x0 = -52 - rand() * 12;
      z0 = along * 0.5;
    } else {
      x0 = 39 + rand() * 12;
      z0 = along * 0.5;
    }
    const bx: BoxDef = { min: [x0, 0, z0], max: [x0 + w, h, z0 + d], tag: 'building' };
    sky.box(x0, 0, z0, x0 + w, h, z0 + d, C([0x2a2d48, 0x312a44, 0x233446][i % 3]), 0.2);
    buildWindows(win, bx, rand);
    // Rooftop beacon
    win.box(
      x0 + w / 2 - 0.2,
      h,
      z0 + d / 2 - 0.2,
      x0 + w / 2 + 0.2,
      h + 0.5,
      z0 + d / 2 + 0.2,
      C(0xff3b3b),
      1,
    );
  }
  const skyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  const winMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: true });
  mats.push(skyMat, winMat);
  root.add(new THREE.Mesh(sky.geometry(), skyMat));
  root.add(new THREE.Mesh(win.geometry(), winMat));

  // Neon signs
  addSign(root, 'NOUN.WTF', '#ff4fd8', [-11.25, 4.6, 8.55], Math.PI, 6.5, 1.8, mats, flickers);
  addSign(root, '⌐◨-◨', '#ff3b2f', [11.25, 4.6, 8.55], Math.PI, 5, 1.8, mats, flickers);
  addSign(root, 'SPLAT BAR', '#3ef2ff', [-11.25, 2.4, -8.55], 0, 5.5, 1.4, mats, flickers);
  addSign(root, 'PIP3 ARCADE', '#ffd23f', [11.25, 2.4, -8.55], 0, 6, 1.4, mats, flickers);
  addSign(root, 'NOUN CITY', '#ff4fd8', [0, 9.5, 25.45], Math.PI, 12, 3, mats, flickers);
  addSign(root, 'NOUNS DAO', '#3ef2ff', [0, 9.5, -25.45], 0, 12, 3, mats, flickers);
  addSign(root, 'PAINT 24/7', '#ffd23f', [-20, 7.5, -25.45], 0, 7, 1.8, mats, flickers);
  addSign(root, 'LIL NOUNS', '#9be22d', [20, 7.5, -25.45], 0, 7, 1.8, mats, flickers);
  addSign(
    root,
    'RED NOGGLES',
    '#ff4a3d',
    [-32.95, 6, 0],
    Math.PI / 2,
    9,
    2.2,
    mats,
    undefined,
    true,
  );
  addSign(
    root,
    'BLUE NOGGLES',
    '#4a8dff',
    [32.95, 6, 0],
    -Math.PI / 2,
    9,
    2.2,
    mats,
    undefined,
    true,
  );
  addSign(root, 'OPEN', '#ff4fd8', [-7.2, 1.9, -15.55], 0, 1.6, 0.6, mats, flickers);

  // Moon + stars
  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(14, 32),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xfff3d6),
      fog: false,
      toneMapped: false,
    }),
  );
  mats.push(moon.material);
  moon.position.set(-180, 160, -420);
  moon.lookAt(0, 0, 0);
  root.add(moon);
  const starGeo = new THREE.BufferGeometry();
  const sp: number[] = [];
  for (let i = 0; i < (quality === 'low' ? 250 : 600); i++) {
    const a = rand() * Math.PI * 2;
    const e = 0.15 + rand() * 1.2;
    const r = 800;
    sp.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 2,
    sizeAttenuation: false,
    fog: false,
  });
  mats.push(starMat);
  const stars = new THREE.Points(starGeo, starMat);
  root.add(stars);
  inkExcluded.add(stars);

  // A few real lights for the plaza (skip on low)
  if (quality !== 'low') {
    const spots: [number, number, number, number][] = [
      [0, 5, 0, 0xff6ad5],
      [-12, 4.4, -7.5, 0xffd38a],
      [12, 4.4, 7.5, 0xffd38a],
      [0, 4, -18, 0x6ad8ff],
      [0, 4, 18, 0xffb36a],
    ];
    for (const [x, y, z, c] of spots) {
      const l = new THREE.PointLight(c, 18, 16, 1.6);
      l.position.set(x, y, z);
      root.add(l);
    }
  }
  void map;
  void disposables;
}

function buildWarehouseDressing(
  root: THREE.Object3D,
  map: MapDef,
  rand: () => number,
  quality: Quality,
  mats: THREE.Material[],
) {
  const [hx, hz] = map.half;
  const steel = new Batch();
  const glow = new Batch();
  // Roof trusses (visual) + hanging lamps
  for (let x = -hx + 3; x <= hx - 3; x += 6.5) {
    steel.box(x - 0.15, 10.2, -hz - 2, x + 0.15, 10.7, hz + 2, C(0x3a3f48));
    steel.box(x - 0.08, 9.6, -hz - 2, x + 0.08, 10.2, hz + 2, C(0x3a3f48));
    for (const z of [-8, 8]) {
      steel.box(x - 0.02, 7.6, z - 0.02, x + 0.02, 9.6, z + 0.02, C(0x222222));
      steel.box(x - 0.45, 7.35, z - 0.45, x + 0.45, 7.6, z + 0.45, C(0x30343c));
      glow.box(x - 0.38, 7.3, z - 0.38, x + 0.38, 7.35, z + 0.38, C(0xfff1c8), 1, false);
    }
  }
  for (let z = -hz; z <= hz; z += 5)
    steel.box(-hx - 2, 10.7, z - 0.1, hx + 2, 10.9, z + 0.1, C(0x2c3038));
  // High window strips on the long walls
  for (const zf of [-21.48, 21.48]) {
    for (let x = -28; x < 28; x += 4) {
      glow.quad(
        zf < 0 ? [x, 6.6, zf] : [x + 3.2, 6.6, zf],
        [zf < 0 ? 3.2 : -3.2, 0, 0],
        [0, 1.8, 0],
        [0, 0, zf < 0 ? 1 : -1],
        C(0xcfe6ff),
        1,
      );
    }
  }
  const sm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 });
  const gm = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  mats.push(sm, gm);
  const sMesh = new THREE.Mesh(steel.geometry(), sm);
  sMesh.castShadow = true;
  root.add(sMesh);
  root.add(new THREE.Mesh(glow.geometry(), gm));
  // Painted wall murals: big noggles on each end wall
  const signs: [string, string, [number, number, number], number][] = [
    ['⌐◨-◨', '#ff3b2f', [-29.45, 6.5, 0], Math.PI / 2],
    ['⌐◨-◨', '#3b7bff', [29.45, 6.5, 0], -Math.PI / 2],
    ['PAINT WORKS', '#ffd23f', [0, 8, -21.45], 0],
    ['SPLAT CO.', '#ff4fd8', [0, 8, 21.45], Math.PI],
  ];
  for (const [t, c, p, r] of signs)
    addSign(root, t, c, p, r, 9, 2.6, mats, undefined, t.length > 4);
  if (quality !== 'low') {
    for (const [x, z] of [
      [-13, -8],
      [13, 8],
      [0, 0],
      [-13, 8],
      [13, -8],
    ]) {
      const l = new THREE.PointLight(0xfff1c8, 14, 18, 1.5);
      l.position.set(x, 7, z);
      root.add(l);
    }
  }
  void rand;
}
