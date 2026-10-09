// ── Smooth head: reinterpret a Noun's pixel head as a sculpted 3D form ──
//
// The 32×32 head silhouette is upsampled, distance-transformed and
// "inflated" into a rounded slab: flat front/back plateaus, rounded bevels,
// vertical-ish side walls with smoothed (non-staircase) outlines. The
// original pixel art is kept crisp on top as a nearest-filtered texture
// projected from the front. Glasses stay voxel and sit on the front face.

import type { VoxelPixel } from '@nouns/voxel-engine';

import * as THREE from 'three';

const S = 4; // sub-samples per pixel
const N = 32 * S;

export interface SmoothHeadOptions {
  /** Half depth of the head, in pixels (width of a typical head ≈ 16-20 px). */
  halfDepth?: number;
  /** Bevel radius in pixels. */
  bevel?: number;
  /** Texture softening blur (px at 256²); lower keeps object detail. */
  blur?: number;
  /** Print the art pixel-sharp (cards, signs): no smoothing, no blur. */
  crisp?: boolean;
}

const FLAT = new Set(
  'index-card calendar chart-bars chipboard film-strip film-35mm cd cassettetape goldcoin hockeypuck maze mirror paperclip ruler-triangular saw wall fence rainbow lightning-bolt bubble-speech star-sparkles smile road abstract void wallet skateboard outlet vent console-handheld laptop dictionary chocolate sponge cookie pizza'.split(
    ' ',
  ),
);
const OBJECT = new Set(
  'bank boombox box calculator camcorder cash-register crt-bsod fax-machine factory-dark house mailbox microwave piano robot stapler toaster trashcan vending-machine wallsafe washingmachine treasurechest taxi car couch lock fan weight mixer drill chainsaw rangefinder satellite tuba backpack cordlessphone pirateship sailboat snowmobile helicopter plane ufo piggybank mug milk ketchup mustard beer wine-barrel toiletpaper-full trashcan firehydrant shower skilift crane tooth watch pill bell bomb clutch hardhat chefhat wizardhat queencrown crown'.split(
    ' ',
  ),
);

/** Shape profile per head: flat things stay thin, objects keep crisp
 * edges and detail, everything organic gets the soft pillow. */
export function headProfile(name: string): SmoothHeadOptions {
  const n = name.replace(/^head-/, '');
  if (FLAT.has(n)) return { halfDepth: 1.6, bevel: 1.2, blur: 0, crisp: true };
  if (OBJECT.has(n)) return { halfDepth: 6, bevel: 1.8, blur: 0.6 };
  return { blur: 0.8 };
}

export interface SmoothHead {
  geometry: THREE.BufferGeometry;
  texture: THREE.CanvasTexture;
  /** Front plateau z (pixel units) — glasses go just in front of this. */
  frontZ: number;
}

/** Two-pass chamfer distance transform (distance to nearest outside cell). */
function distanceField(mask: Uint8Array): Float32Array {
  const d = new Float32Array(N * N);
  const INF = 1e9;
  for (let i = 0; i < N * N; i++) d[i] = mask[i] === 1 ? INF : 0;
  const a = 1;
  const b = Math.SQRT2;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= N || y >= N ? 0 : d[y * N + x]);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (d[i] === 0) continue;
      d[i] = Math.min(
        d[i],
        at(x - 1, y) + a,
        at(x, y - 1) + a,
        at(x - 1, y - 1) + b,
        at(x + 1, y - 1) + b,
      );
    }
  }
  for (let y = N - 1; y >= 0; y--) {
    for (let x = N - 1; x >= 0; x--) {
      const i = y * N + x;
      if (d[i] === 0) continue;
      d[i] = Math.min(
        d[i],
        at(x + 1, y) + a,
        at(x, y + 1) + a,
        at(x + 1, y + 1) + b,
        at(x - 1, y + 1) + b,
      );
    }
  }
  return d;
}

export function buildSmoothHead(
  pixels: VoxelPixel[],
  opts: SmoothHeadOptions = {},
): SmoothHead | null {
  if (pixels.length === 0) return null;
  const D = opts.halfDepth ?? 6;
  // Full-radius bevel → soft pillow profile, no hard edges anywhere
  const R = Math.min(opts.bevel ?? 5.5, D);

  // Pixel mask (x right, y up) → upsampled cell mask
  const pix = new Uint8Array(32 * 32);
  for (const p of pixels) pix[p.y * 32 + p.x] = 1;
  // Upsample, then blur + re-threshold so the silhouette has rounded
  // corners instead of pixel stair-steps.
  let field = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) field[y * N + x] = pix[Math.floor(y / S) * 32 + Math.floor(x / S)];
  }
  const blurR = Math.round(S * 1.1);
  for (const axis of [0, 1]) {
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let sum = 0;
        let n = 0;
        for (let k = -blurR; k <= blurR; k++) {
          const xx = axis === 0 ? x + k : x;
          const yy = axis === 1 ? y + k : y;
          if (xx >= 0 && yy >= 0 && xx < N && yy < N) sum += field[yy * N + xx];
          n++;
        }
        out[y * N + x] = sum / n;
      }
    }
    field = out;
  }
  const mask = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) mask[i] = field[i] > 0.5 ? 1 : 0;
  const dist = distanceField(mask);
  const inside = (cx: number, cy: number) =>
    cx >= 0 && cy >= 0 && cx < N && cy < N && mask[cy * N + cx] === 1;

  // Grid vertices (N+1)², z from the distance at the vertex (min of touching cells)
  const V = N + 1;
  const vertDist = (vx: number, vy: number) => {
    let m = Infinity;
    let any = false;
    for (const [cx, cy] of [
      [vx - 1, vy - 1],
      [vx, vy - 1],
      [vx - 1, vy],
      [vx, vy],
    ]) {
      if (inside(cx, cy)) {
        any = true;
        m = Math.min(m, dist[cy * N + cx]);
      } else {
        m = 0;
      }
    }
    return any ? m : -1;
  };
  const profile = (dPx: number) => {
    // Rounded bevel: wall height (D-R) at the outline, plateau D after R px
    const t = Math.min(1, dPx / R);
    return D - R + R * Math.sqrt(1 - (1 - t) * (1 - t));
  };

  const positions: number[] = [];
  const uvs: number[] = [];
  const frontIdx = new Int32Array(V * V).fill(-1);
  const backIdx = new Int32Array(V * V).fill(-1);
  const isBoundary = new Uint8Array(V * V);
  const xy: [number, number][] = [];

  const vIndex = (vx: number, vy: number, back: boolean) => {
    const arr = back ? backIdx : frontIdx;
    const k = vy * V + vx;
    if (arr[k] >= 0) return arr[k];
    const dv = vertDist(vx, vy);
    const dPx = Math.max(0, dv) / S;
    const z = profile(dPx);
    const px = vx / S;
    const py = vy / S;
    const idx = positions.length / 3;
    positions.push(px - 16, py - 16, back ? -z : z);
    uvs.push(px / 32, py / 32);
    xy.push([vx, vy]);
    arr[k] = idx;
    if (dv === 0) isBoundary[k] = 1;
    return idx;
  };

  const index: number[] = [];
  for (let cy = 0; cy < N; cy++) {
    for (let cx = 0; cx < N; cx++) {
      if (!inside(cx, cy)) continue;
      // Front (+z) and back (-z) faces
      const f00 = vIndex(cx, cy, false);
      const f10 = vIndex(cx + 1, cy, false);
      const f01 = vIndex(cx, cy + 1, false);
      const f11 = vIndex(cx + 1, cy + 1, false);
      index.push(f00, f10, f11, f00, f11, f01);
      const b00 = vIndex(cx, cy, true);
      const b10 = vIndex(cx + 1, cy, true);
      const b01 = vIndex(cx, cy + 1, true);
      const b11 = vIndex(cx + 1, cy + 1, true);
      index.push(b00, b11, b10, b00, b01, b11);
      // Side walls where the neighbour cell is outside
      const wall = (ax: number, ay: number, bx: number, by: number) => {
        const fa = vIndex(ax, ay, false);
        const fb = vIndex(bx, by, false);
        const ba = vIndex(ax, ay, true);
        const bb = vIndex(bx, by, true);
        index.push(fa, ba, bb, fa, bb, fb);
      };
      if (!inside(cx, cy - 1)) wall(cx, cy, cx + 1, cy); // bottom
      if (!inside(cx + 1, cy)) wall(cx + 1, cy, cx + 1, cy + 1); // right
      if (!inside(cx, cy + 1)) wall(cx + 1, cy + 1, cx, cy + 1); // top
      if (!inside(cx - 1, cy)) wall(cx, cy + 1, cx, cy); // left
    }
  }

  // Smooth the staircase outline: relax boundary vertices in XY toward the
  // average of their boundary neighbours (front + back share the same XY).
  const pos = new Float32Array(positions);
  const nb = new Map<number, number[]>();
  const keyOf = (vx: number, vy: number) => vy * V + vx;
  for (let vy = 0; vy < V; vy++) {
    for (let vx = 0; vx < V; vx++) {
      const k = keyOf(vx, vy);
      if (isBoundary[k] !== 1 || frontIdx[k] < 0) continue;
      const list: number[] = [];
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const k2 = keyOf(vx + dx, vy + dy);
        if (
          vx + dx >= 0 &&
          vy + dy >= 0 &&
          vx + dx < V &&
          vy + dy < V &&
          isBoundary[k2] === 1 &&
          frontIdx[k2] >= 0
        )
          list.push(k2);
      }
      nb.set(k, list);
    }
  }
  for (let iter = 0; iter < 10; iter++) {
    const next = new Map<number, [number, number]>();
    for (const [k, list] of nb) {
      if (list.length < 2) continue;
      const i = frontIdx[k];
      let sx = 0;
      let sy = 0;
      for (const k2 of list) {
        sx += pos[frontIdx[k2] * 3];
        sy += pos[frontIdx[k2] * 3 + 1];
      }
      const ax = sx / list.length;
      const ay = sy / list.length;
      next.set(k, [pos[i * 3] * 0.5 + ax * 0.5, pos[i * 3 + 1] * 0.5 + ay * 0.5]);
    }
    for (const [k, [x, y]] of next) {
      for (const i of [frontIdx[k], backIdx[k]]) {
        if (i < 0) continue;
        pos[i * 3] = x;
        pos[i * 3 + 1] = y;
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();

  // Pixel-art texture (dilated so edge texels never sample transparency)
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const grid: (string | null)[] = new Array(32 * 32).fill(null);
  for (const p of pixels) grid[p.y * 32 + p.x] = `rgb(${p.r},${p.g},${p.b})`;
  for (let pass = 0; pass < 3; pass++) {
    const copy = grid.slice();
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        if (copy[y * 32 + x] !== null) continue;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx;
          const ny = y + dy;
          const c = nx >= 0 && ny >= 0 && nx < 32 && ny < 32 ? copy[ny * 32 + nx] : null;
          if (c !== null) {
            grid[y * 32 + x] = c;
            break;
          }
        }
      }
    }
  }
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const c = grid[y * 32 + x];
      if (c === null) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x, 31 - y, 1, 1);
    }
  }
  // Soften the pixel art into smooth colour regions: upscale bilinearly,
  // blur, then gently posterise so it reads as painted shapes, not pixels.
  const big = document.createElement('canvas');
  big.width = big.height = 256;
  const bctx = big.getContext('2d')!;
  bctx.imageSmoothingEnabled = opts.crisp !== true;
  bctx.imageSmoothingQuality = 'high';
  // Light blur only: enough to lose the pixel staircase, not enough to
  // average 1px stripes/spots (zebra, checkers) into a muddy mid-tone.
  bctx.filter = opts.crisp === true ? 'none' : `blur(${opts.blur ?? 1.6}px)`;
  bctx.drawImage(canvas, 0, 0, 256, 256);
  bctx.filter = 'none';
  const img = bctx.getImageData(0, 0, 256, 256);
  for (let p = 0; p < img.data.length; p += 4) {
    for (let k = 0; k < 3; k++) img.data[p + k] = Math.round(img.data[p + k] / 12) * 12;
  }
  bctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(big);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { geometry, texture, frontZ: D };
}
