// ── 3D Grand Exchange: the instanced crowd ──────────────────────────────
//
// Every trader that isn't a full rig is one instance of a low-poly Noun:
// a body block and a head block, both wearing that trader's real Noun art.
// The art comes from one atlas texture (a 32×32 cell per trader, decoded
// from the on-chain run-length parts), picked per instance by `aCell`. So
// the whole crowd is ONE draw call (plus one for the blob shadows),
// whatever its size. VAST copies of the hall reuse the same instance
// matrices from further meshes: one more draw call per copy.

import { ImageData } from '@noundry/nouns-assets';
import * as THREE from 'three';

import { getToonRamp } from '../../world2/render/Toon';
import { rasterNoun, SPRITE, type Seed } from '../sim/looks';

/** Art counts for seeding (sim traders get seeds inside these). */
export const ART = {
  bodies: ImageData.images.bodies.length,
  accessories: ImageData.images.accessories.length,
  heads: ImageData.images.heads.length,
  glasses: ImageData.images.glasses.length,
  backgrounds: ImageData.bgcolors.length,
};

export class Atlas {
  readonly cells: number;
  readonly size: number;
  readonly data: Uint8Array;
  readonly texture: THREE.DataTexture;
  private buf = new Uint8ClampedArray(SPRITE * SPRITE * 4);

  constructor(capacity: number) {
    this.cells = Math.max(4, 2 ** Math.ceil(Math.log2(Math.ceil(Math.sqrt(capacity)))));
    this.size = this.cells * SPRITE;
    this.data = new Uint8Array(this.size * this.size * 4);
    this.texture = new THREE.DataTexture(this.data, this.size, this.size, THREE.RGBAFormat);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestMipmapLinearFilter;
    this.texture.generateMipmaps = true;
    this.texture.flipY = false;
    this.texture.needsUpdate = true;
  }

  /** Paint trader `i`'s Noun into its cell. Call `commit()` after a batch. */
  paint(i: number, s: Seed) {
    const im = ImageData.images;
    const parts = [
      im.bodies[s.body]?.data,
      im.accessories[s.accessory]?.data,
      im.heads[s.head]?.data,
      im.glasses[s.glasses]?.data,
    ].filter((p): p is string => typeof p === 'string');
    this.buf.fill(0);
    rasterNoun(parts, ImageData.palette, this.buf);
    const cx = (i % this.cells) * SPRITE;
    const cy = Math.floor(i / this.cells) * SPRITE;
    for (let y = 0; y < SPRITE; y++) {
      const row = ((cy + y) * this.size + cx) * 4;
      this.data.set(this.buf.subarray(y * SPRITE * 4, (y + 1) * SPRITE * 4), row);
    }
  }

  commit() {
    this.texture.needsUpdate = true;
  }

  cellOf(i: number): [number, number] {
    return [i % this.cells, Math.floor(i / this.cells)];
  }
}

// ── The low-poly Noun ──
// Sprite pixel rects [u0, v0, u1, v1] (v down, the art's rows).
type Rect = [number, number, number, number];
const HEAD_FRONT: Rect = [5, 4, 27, 21];
const BODY_FRONT: Rect = [9, 21, 23, 31];

/** Box faces: +x, −x, +y, −y, +z (front), −z (back). */
interface BoxUV {
  px: Rect;
  nx: Rect;
  py: Rect;
  ny: Rect;
  pz: Rect;
  nz: Rect;
}

const strip = (u: number, v0: number, v1: number): Rect => [u + 0.3, v0, u + 0.7, v1];
const row = (v: number, u0: number, u1: number): Rect => [u0, v + 0.3, u1, v + 0.7];

const HEAD_UV: BoxUV = {
  px: strip(8, 4, 21),
  nx: strip(23, 4, 21),
  py: row(6, 5, 27),
  ny: row(19, 5, 27),
  pz: HEAD_FRONT,
  nz: [12, 5, 20, 10],
};
const BODY_UV: BoxUV = {
  px: strip(10, 21, 31),
  nx: strip(21, 21, 31),
  py: row(22, 9, 23),
  ny: row(30, 9, 23),
  pz: BODY_FRONT,
  nz: [11, 22, 21, 27],
};

/** Low-poly sizes (m): matches world2's rigged Noun (~2 m, a 1.15 m head). */
export const LOW = {
  bodyW: 0.74,
  bodyH: 1.1,
  bodyD: 0.44,
  headW: 1.15,
  headH: 0.89,
  headD: 0.82,
  headY: 1.06,
  /** Height of the top of the head (labels sit above this). */
  top: 1.95,
} as const;

function addBox(
  pos: number[],
  uv: number[],
  nrm: number[],
  min: [number, number, number],
  max: [number, number, number],
  r: BoxUV,
) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const S = SPRITE;
  // Each face: 4 corners (as seen from outside: TL, TR, BL, BR) and the rect
  const face = (c: number[][], n: number[], rect: Rect) => {
    const [u0, v0, u1, v1] = rect;
    const uvs = [
      [u0 / S, v0 / S],
      [u1 / S, v0 / S],
      [u0 / S, v1 / S],
      [u1 / S, v1 / S],
    ];
    for (const k of [0, 2, 1, 1, 2, 3]) {
      pos.push(...c[k]!);
      uv.push(...uvs[k]!);
      nrm.push(...n);
    }
  };
  face(
    [
      [x0, y1, z1],
      [x1, y1, z1],
      [x0, y0, z1],
      [x1, y0, z1],
    ],
    [0, 0, 1],
    r.pz,
  );
  face(
    [
      [x1, y1, z0],
      [x0, y1, z0],
      [x1, y0, z0],
      [x0, y0, z0],
    ],
    [0, 0, -1],
    r.nz,
  );
  face(
    [
      [x1, y1, z1],
      [x1, y1, z0],
      [x1, y0, z1],
      [x1, y0, z0],
    ],
    [1, 0, 0],
    r.px,
  );
  face(
    [
      [x0, y1, z0],
      [x0, y1, z1],
      [x0, y0, z0],
      [x0, y0, z1],
    ],
    [-1, 0, 0],
    r.nx,
  );
  face(
    [
      [x0, y1, z0],
      [x1, y1, z0],
      [x0, y1, z1],
      [x1, y1, z1],
    ],
    [0, 1, 0],
    r.py,
  );
  face(
    [
      [x0, y0, z1],
      [x1, y0, z1],
      [x0, y0, z0],
      [x1, y0, z0],
    ],
    [0, -1, 0],
    r.ny,
  );
}

export function lowNounGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const nrm: number[] = [];
  const L = LOW;
  addBox(
    pos,
    uv,
    nrm,
    [-L.bodyW / 2, 0, -L.bodyD / 2],
    [L.bodyW / 2, L.bodyH, L.bodyD / 2],
    BODY_UV,
  );
  addBox(
    pos,
    uv,
    nrm,
    [-L.headW / 2, L.headY, -L.headD / 2 + 0.06],
    [L.headW / 2, L.headY + L.headH, L.headD / 2 + 0.06],
    HEAD_UV,
  );
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.computeBoundingSphere();
  return g;
}

function crowdMaterial(atlas: Atlas): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({
    map: atlas.texture,
    gradientMap: getToonRamp(),
    alphaTest: 0.5,
  });
  const uCells = { value: atlas.cells };
  m.onBeforeCompile = sh => {
    sh.uniforms.uCells = uCells;
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 aCell;\nuniform float uCells;',
      )
      .replace(
        '#include <uv_vertex>',
        '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = (vMapUv + aCell) / uCells;\n#endif',
      );
  };
  m.customProgramCacheKey = () => 'gx3d-crowd';
  return m;
}

function blobTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.25)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Extra lift (bob, hop, jump) and a side roll. */
  lift: number;
  roll: number;
  /** Lean forward (rad): a shout or a shake. */
  pitch: number;
  hidden: boolean;
}

export class CrowdMesh {
  readonly mesh: THREE.InstancedMesh;
  readonly shadows: THREE.InstancedMesh;
  readonly atlas: Atlas;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.MeshToonMaterial;
  private cellAttr: THREE.InstancedBufferAttribute;
  private copies: THREE.InstancedMesh[] = [];
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.atlas = new Atlas(capacity);
    this.geometry = lowNounGeometry();
    const cells = new Float32Array(capacity * 2);
    this.cellAttr = new THREE.InstancedBufferAttribute(cells, 2);
    this.geometry.setAttribute('aCell', this.cellAttr);
    this.material = crowdMaterial(this.atlas);
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'gx3d-crowd';
    const shadowGeo = new THREE.PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2);
    this.shadows = new THREE.InstancedMesh(
      shadowGeo,
      new THREE.MeshBasicMaterial({
        map: blobTexture(),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
      capacity,
    );
    this.shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shadows.count = 0;
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = -1;
  }

  /** Trader i wears this Noun. */
  setLook(i: number, s: Seed) {
    this.atlas.paint(i, s);
    const [cx, cy] = this.atlas.cellOf(i);
    this.cellAttr.setXY(i, cx, cy);
    this.cellAttr.needsUpdate = true;
  }

  commitLooks() {
    this.atlas.commit();
  }

  /** Write every trader's pose (n = live traders). */
  update(n: number, pose: (i: number, out: Pose) => void) {
    const p: Pose = { x: 0, y: 0, z: 0, yaw: 0, lift: 0, roll: 0, pitch: 0, hidden: false };
    this.mesh.count = n;
    this.shadows.count = n;
    for (let i = 0; i < n; i++) {
      p.lift = 0;
      p.roll = 0;
      p.pitch = 0;
      p.hidden = false;
      pose(i, p);
      _p.set(p.x, p.y + p.lift, p.z);
      _e.set(p.pitch, p.yaw, p.roll);
      _q.setFromEuler(_e);
      _s.setScalar(p.hidden ? 0 : 1);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      // The blob stays on the floor and shrinks as they jump
      const k = p.hidden ? 0 : Math.max(0.4, 1 - p.lift * 0.8);
      _p.set(p.x, p.y + 0.03, p.z);
      _s.set(k, 1, k);
      _m.compose(_p, _q.identity(), _s);
      this.shadows.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.shadows.instanceMatrix.needsUpdate = true;
    for (const c of this.copies) c.count = n;
  }

  /** A copy of the crowd for a VAST hall copy (shares matrices and looks). */
  copy(): THREE.InstancedMesh {
    const c = new THREE.InstancedMesh(this.geometry, this.material, this.capacity);
    c.instanceMatrix = this.mesh.instanceMatrix;
    c.count = this.mesh.count;
    c.frustumCulled = false;
    this.copies.push(c);
    return c;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.atlas.texture.dispose();
    this.shadows.geometry.dispose();
    (this.shadows.material as THREE.MeshBasicMaterial).map?.dispose();
    (this.shadows.material as THREE.Material).dispose();
  }
}
