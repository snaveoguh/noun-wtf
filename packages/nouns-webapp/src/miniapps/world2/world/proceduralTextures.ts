// ── Procedural canvas textures for the fallback level + props ───────────
//
// Cheap value-noise based generators. Only used when the Blender-baked
// level assets aren't available (or for small runtime props).

import * as THREE from 'three';

function hash(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x: number, y: number, seed: number, period: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const w = (v: number) => ((v % period) + period) % period;
  const a = hash(w(xi), w(yi), seed);
  const b = hash(w(xi + 1), w(yi), seed);
  const c = hash(w(xi), w(yi + 1), seed);
  const d = hash(w(xi + 1), w(yi + 1), seed);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Tileable fBm in [0,1]. */
function fbm(x: number, y: number, seed: number, octaves: number, basePeriod: number) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let period = basePeriod;
  let fx = x * basePeriod;
  let fy = y * basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(fx, fy, seed + o * 17, period);
    norm += amp;
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
    period *= 2;
  }
  return sum / norm;
}

export interface SurfaceSpec {
  base: [number, number, number];
  variation: number;
  speckle: number;
  seams?: { every: number; width: number; darken: number };
  stains?: number;
  seed: number;
}

const cache = new Map<string, THREE.CanvasTexture>();

export function surfaceTexture(key: string, spec: SurfaceSpec, size = 512): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const [br, bg, bb] = spec.base;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n = fbm(u, v, spec.seed, 5, 8) - 0.5;
      const fine = hash(x, y, spec.seed + 99) - 0.5;
      let k = 1 + n * spec.variation + fine * spec.speckle;
      if (spec.stains !== undefined && spec.stains > 0) {
        const s = fbm(u, v, spec.seed + 300, 3, 3);
        if (s > 0.62) k *= 1 - (s - 0.62) * spec.stains;
      }
      if (spec.seams) {
        const gx = (u * spec.seams.every) % 1;
        const gy = (v * spec.seams.every) % 1;
        const w = spec.seams.width;
        if (gx < w || gy < w) k *= 1 - spec.seams.darken;
      }
      const i = (y * size + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, br * k));
      img.data[i + 1] = Math.max(0, Math.min(255, bg * k));
      img.data[i + 2] = Math.max(0, Math.min(255, bb * k));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  cache.set(key, tex);
  return tex;
}

export const SURFACES = {
  concrete: () =>
    surfaceTexture('concrete', {
      base: [178, 174, 166],
      variation: 0.22,
      speckle: 0.1,
      stains: 0.5,
      seams: { every: 2, width: 0.006, darken: 0.35 },
      seed: 1,
    }),
  plazaTile: () =>
    surfaceTexture('plazaTile', {
      base: [196, 186, 172],
      variation: 0.12,
      speckle: 0.08,
      stains: 0.35,
      seams: { every: 4, width: 0.008, darken: 0.4 },
      seed: 7,
    }),
  asphalt: () =>
    surfaceTexture('asphalt', {
      base: [70, 70, 74],
      variation: 0.3,
      speckle: 0.35,
      stains: 0.3,
      seed: 3,
    }),
  granite: () =>
    surfaceTexture('granite', { base: [128, 126, 130], variation: 0.15, speckle: 0.45, seed: 11 }),
  wood: () =>
    surfaceTexture('wood', {
      base: [176, 128, 84],
      variation: 0.35,
      speckle: 0.05,
      seams: { every: 6, width: 0.01, darken: 0.45 },
      seed: 5,
    }),
  grass: () =>
    surfaceTexture('grass', { base: [92, 140, 62], variation: 0.4, speckle: 0.3, seed: 13 }),
  stucco: () =>
    surfaceTexture('stucco', {
      base: [228, 214, 190],
      variation: 0.12,
      speckle: 0.12,
      stains: 0.25,
      seed: 21,
    }),
};

/**
 * Assign world-space box-projected UVs (1 unit = 1/scale metres) so tiling
 * textures have consistent texel density regardless of mesh size.
 */
export function applyBoxUVs(
  geometry: THREE.BufferGeometry,
  matrixWorld: THREE.Matrix4,
  scale = 0.25,
) {
  const pos = geometry.attributes.position;
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) {
    geometry.copy(g);
  }
  geometry.computeVertexNormals();
  const p = geometry.attributes.position;
  const n = geometry.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  const v = new THREE.Vector3();
  const nm = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrixWorld);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(matrixWorld);
    nm.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize();
    const ax = Math.abs(nm.x);
    const ay = Math.abs(nm.y);
    const az = Math.abs(nm.z);
    let s: number;
    let t: number;
    if (ay >= ax && ay >= az) {
      s = v.x;
      t = v.z;
    } else if (ax >= az) {
      s = v.z;
      t = v.y;
    } else {
      s = v.x;
      t = v.y;
    }
    uv[i * 2] = s * scale;
    uv[i * 2 + 1] = t * scale;
  }
  void pos;
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
