// ── Skyline — stacked setback towers grown out of the plaza's rooftops ──
//
// The baked plaza ring tops out at ~21 m. These towers rise 60–150 m off
// the existing roofs in 2–3 setback tiers with chunky trim bands, so they
// read as JSR skyscrapers under the toon ramp + ink pass. Everything is
// merged into two meshes (facade + trim) = two draw calls, and each tier
// gets a plain box collider so the towers are climbable like any wall.

import * as THREE from 'three';

interface TowerSpec {
  /** Footprint centre (world XZ). */
  x: number;
  z: number;
  /** Footprint size along X / Z. */
  w: number;
  d: number;
  /** Absolute height of the main roof (metres above the plaza floor). */
  top: number;
  tint: number;
  /** Antenna mast on the crown. */
  mast?: number;
}

// Ring of buildings sits at |x| or |z| ≈ 76–92. Plaza-facing facades are
// at ±76; towers whose near edge is 76 run flush with the facade below
// (one continuous climb), the rest are set back across the roof.
const TOWERS: TowerSpec[] = [
  // North side (z 76–94)
  { x: -20, z: 82.5, w: 14, d: 13, top: 150, tint: 0xa9c6ea, mast: 18 },
  { x: 56, z: 85, w: 12, d: 12, top: 96, tint: 0xf0b8a4 },
  // South side (z −94 – −76)
  { x: 12, z: -83, w: 15, d: 14, top: 122, tint: 0xf1d7a6, mast: 12 },
  { x: -64, z: -85, w: 11, d: 11, top: 68, tint: 0x9fd8cf },
  // East side (x 76–92)
  { x: 82.5, z: -42, w: 13, d: 15, top: 112, tint: 0xd98f6a },
  { x: 84, z: 58, w: 11, d: 12, top: 64, tint: 0xc9c2e8 },
  // West side (x −92 – −76)
  { x: -83, z: -18, w: 14, d: 13, top: 140, tint: 0xe9e2cf, mast: 16 },
  { x: -84, z: 56, w: 11, d: 12, top: 82, tint: 0xf3c25b },
];

const BAY_W = 3; // window bay width (m)
const FLOOR_H = 3.6; // storey height (m)
const TILE_BAYS = 8; // bays per texture tile
const TILE_FLOORS = 8; // floors per texture tile

let facadeTextures: { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } | null = null;

/** 8×8 bays of windows: albedo (white wall, glass) + emissive (lit windows). */
function getFacadeTextures() {
  if (facadeTextures !== null) return facadeTextures;
  const S = 512;
  const cell = S / TILE_BAYS;
  const a = document.createElement('canvas');
  a.width = a.height = S;
  const ac = a.getContext('2d')!;
  const e = document.createElement('canvas');
  e.width = e.height = S;
  const ec = e.getContext('2d')!;
  ac.fillStyle = '#f4f1ea';
  ac.fillRect(0, 0, S, S);
  ec.fillStyle = '#000';
  ec.fillRect(0, 0, S, S);
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let fy = 0; fy < TILE_FLOORS; fy++) {
    // Spandrel line under each floor's windows
    ac.fillStyle = '#d9d3c6';
    ac.fillRect(0, fy * cell + cell - 6, S, 6);
    for (let bx = 0; bx < TILE_BAYS; bx++) {
      const x0 = bx * cell + 9;
      const y0 = fy * cell + 11;
      const w = cell - 18;
      const h = cell - 24;
      ac.fillStyle = '#46679e';
      ac.fillRect(x0, y0, w, h);
      // Flat cel reflection streak + mullion
      ac.fillStyle = '#7d9fd1';
      ac.fillRect(x0 + 4, y0 + 4, w * 0.3, h - 8);
      ac.fillStyle = '#2c3f66';
      ac.fillRect(x0 + w / 2 - 1.5, y0, 3, h);
      const r = rnd();
      if (r < 0.3) {
        const warm = rnd() < 0.7;
        ec.fillStyle = warm ? '#ffcf73' : '#bfe6ff';
        ec.fillRect(x0, y0, w, h);
        ac.fillStyle = warm ? '#ffe2a6' : '#d6efff';
        ac.fillRect(x0, y0, w, h);
        ac.fillStyle = 'rgba(0,0,0,0.18)';
        ac.fillRect(x0 + w / 2 - 1.5, y0, 3, h);
      }
    }
  }
  const mk = (c: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  facadeTextures = { map: mk(a), emissive: mk(e) };
  return facadeTextures;
}

/** Growable attribute arrays for one merged mesh. */
class Builder {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];

  /** Quad from 4 corners (CCW seen from the normal side). */
  quad(p: THREE.Vector3[], n: THREE.Vector3, uvs: [number, number][], c: THREE.Color) {
    const base = this.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      this.pos.push(p[i].x, p[i].y, p[i].z);
      this.nrm.push(n.x, n.y, n.z);
      this.uv.push(uvs[i][0], uvs[i][1]);
      this.col.push(c.r, c.g, c.b);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * Axis-aligned box: sides go to `sides` (window UVs in metres when
 * `windows`), top goes to `top`. Bottom is never visible → skipped.
 */
function box(
  sides: Builder,
  top: Builder,
  min: THREE.Vector3,
  max: THREE.Vector3,
  sideColor: THREE.Color,
  topColor: THREE.Color,
  windows: { u0: number; v0: number } | null,
) {
  const { x: x0, y: y0, z: z0 } = min;
  const { x: x1, y: y1, z: z1 } = max;
  const uvFor = (along0: number, along1: number): [number, number][] => {
    if (windows === null)
      return [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ];
    const u0 = windows.u0 + along0 / BAY_W / TILE_BAYS;
    const u1 = windows.u0 + along1 / BAY_W / TILE_BAYS;
    const v0 = windows.v0 + y0 / FLOOR_H / TILE_FLOORS;
    const v1 = windows.v0 + y1 / FLOOR_H / TILE_FLOORS;
    return [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ];
  };
  // +Z face
  sides.quad(
    [V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z1)],
    V(0, 0, 1),
    uvFor(x0, x1),
    sideColor,
  );
  // −Z face
  sides.quad(
    [V(x1, y0, z0), V(x0, y0, z0), V(x0, y1, z0), V(x1, y1, z0)],
    V(0, 0, -1),
    uvFor(-x1, -x0),
    sideColor,
  );
  // +X face
  sides.quad(
    [V(x1, y0, z1), V(x1, y0, z0), V(x1, y1, z0), V(x1, y1, z1)],
    V(1, 0, 0),
    uvFor(-z1, -z0),
    sideColor,
  );
  // −X face
  sides.quad(
    [V(x0, y0, z0), V(x0, y0, z1), V(x0, y1, z1), V(x0, y1, z0)],
    V(-1, 0, 0),
    uvFor(z0, z1),
    sideColor,
  );
  // Top
  top.quad(
    [V(x0, y1, z1), V(x1, y1, z1), V(x1, y1, z0), V(x0, y1, z0)],
    V(0, 1, 0),
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    topColor,
  );
}

export interface Skyline {
  group: THREE.Group;
  collision: THREE.Mesh[];
  /** Highest point of any tower (for bounds). */
  maxY: number;
}

/**
 * Build the towers on top of `roofs` (the COL_Buildings collision mesh,
 * used to find each footprint's roof height).
 */
export function buildSkyline(roofs: THREE.Object3D | null): Skyline {
  const group = new THREE.Group();
  group.name = 'Skyline';
  const facade = new Builder();
  const trim = new Builder();
  const collision: THREE.Mesh[] = [];
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  let maxY = 0;
  // Collision-only mesh (never rendered): make the probe winding-agnostic
  const roofMat = (roofs as THREE.Mesh | null)?.material;
  if (roofMat !== undefined && !Array.isArray(roofMat)) roofMat.side = THREE.DoubleSide;

  const roofAt = (x: number, z: number) => {
    if (roofs === null) return 0;
    ray.set(new THREE.Vector3(x, 400, z), down);
    ray.far = 420;
    const hits = ray.intersectObject(roofs, true);
    return hits.length > 0 ? hits[0].point.y : 0;
  };

  const addCollider = (min: THREE.Vector3, max: THREE.Vector3) => {
    const size = new THREE.Vector3().subVectors(max, min);
    const m = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z));
    m.name = 'COL_Skyline';
    m.position.addVectors(min, max).multiplyScalar(0.5);
    m.updateMatrixWorld(true);
    collision.push(m);
  };

  const roofCol = new THREE.Color(0x77736f);
  const mastCol = new THREE.Color(0x3a3d4a);
  TOWERS.forEach((t, ti) => {
    const hx = t.w / 2;
    const hz = t.d / 2;
    // Sit on the lowest roof under the footprint (taller roof parts just
    // swallow the base) so nothing floats.
    let base = Infinity;
    for (const [sx, sz] of [
      [0, 0],
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ])
      base = Math.min(base, roofAt(t.x + sx * (hx - 0.3), t.z + sz * (hz - 0.3)));
    if (!Number.isFinite(base)) base = 0;
    const tint = new THREE.Color(t.tint);
    const band = tint.clone().multiplyScalar(0.62);
    const white = new THREE.Color(0xf6f3ec);
    const span = t.top - base;
    const tiers =
      span > 90
        ? [
            { inset: 0, frac: 0.48 },
            { inset: 1.8, frac: 0.78 },
            { inset: 3.4, frac: 1 },
          ]
        : [
            { inset: 0, frac: 0.62 },
            { inset: 1.9, frac: 1 },
          ];
    const uvo = { u0: (ti * 0.37) % 1, v0: (ti * 0.29) % 1 };
    let y = base;
    for (const tier of tiers) {
      const yTop = base + span * tier.frac;
      const min = V(t.x - hx + tier.inset, y, t.z - hz + tier.inset);
      const max = V(t.x + hx - tier.inset, yTop, t.z + hz - tier.inset);
      box(facade, trim, min, max, tint, roofCol, uvo);
      addCollider(min, max);
      // Chunky trim band at the setback (flush with the roof, sticks out a bit)
      const bMin = V(min.x - 0.3, yTop - 0.8, min.z - 0.3);
      const bMax = V(max.x + 0.3, yTop + 0.05, max.z + 0.3);
      box(trim, trim, bMin, bMax, band, roofCol, null);
      addCollider(bMin, bMax);
      // Thin white floor-line bands every ~4 storeys on the main shaft
      for (let ly = y + FLOOR_H * 4; ly < yTop - 3; ly += FLOOR_H * 4) {
        box(
          trim,
          trim,
          V(min.x - 0.08, ly - 0.25, min.z - 0.08),
          V(max.x + 0.08, ly + 0.25, max.z + 0.08),
          white,
          white,
          null,
        );
      }
      y = yTop;
    }
    // Crown: plant room + optional mast
    const ci = tiers[tiers.length - 1].inset + 2.2;
    const cMin = V(t.x - hx + ci, y, t.z - hz + ci);
    const cMax = V(t.x + hx - ci, y + 4.5, t.z + hz - ci);
    box(trim, trim, cMin, cMax, band, roofCol, null);
    addCollider(cMin, cMax);
    let topY = cMax.y;
    if (t.mast !== undefined) {
      const mMin = V(t.x - 0.4, cMax.y, t.z - 0.4);
      const mMax = V(t.x + 0.4, cMax.y + t.mast, t.z + 0.4);
      box(trim, trim, mMin, mMax, mastCol, mastCol, null);
      addCollider(mMin, mMax);
      topY = mMax.y;
    }
    maxY = Math.max(maxY, topY);
  });

  const tex = getFacadeTextures();
  const facadeMat = new THREE.MeshStandardMaterial({
    name: 'tower_facade__Skyline',
    color: 0xffffff,
    map: tex.map,
    vertexColors: true,
    roughness: 0.85,
    metalness: 0,
    // Cool + dim so TimeOfDay treats it as windows (neon at night), not lamps
    emissive: new THREE.Color(0.32, 0.34, 0.42),
    emissiveMap: tex.emissive,
    emissiveIntensity: 0.55,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    name: 'tower_trim__Skyline',
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.9,
    metalness: 0,
  });
  for (const [b, mat, name] of [
    [facade, facadeMat, 'SkylineFacade'],
    [trim, trimMat, 'SkylineTrim'],
  ] as const) {
    const mesh = new THREE.Mesh(b.geometry(), mat);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.updateMatrixWorld(true);
  return { group, collision, maxY };
}
