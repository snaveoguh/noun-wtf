// ── Procedural canvas textures for foliage, bark, pebbles, water ────────
//
// Everything is generated at runtime (no downloads). Alpha-tested sprites are
// converted to DataTextures with their transparent texels re-coloured to the
// average leaf colour, so mipmaps don't bleed dark fringes into the cards.

import * as THREE from 'three';

import { Rng, fbm2, hash3 } from './shared';

const cache = new Map<string, THREE.Texture>();

function cached<T extends THREE.Texture>(key: string, make: () => T): T {
  const hit = cache.get(key);
  if (hit !== undefined) return hit as T;
  const t = make();
  cache.set(key, t);
  return t;
}

function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (ctx === null) throw new Error('2d canvas unavailable');
  return [c, ctx];
}

/**
 * Canvas → DataTexture (flipped so canvas-top = v 1), replacing the RGB of
 * (semi)transparent texels with `bleed` so mip levels stay leaf-coloured.
 */
function spriteTexture(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  bleed: [number, number, number] | null,
): THREE.DataTexture {
  const img = ctx.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h * 4);
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let n = 0;
  if (bleed === null) {
    for (let i = 0; i < w * h; i++) {
      if (img[i * 4 + 3] > 200) {
        sr += img[i * 4];
        sg += img[i * 4 + 1];
        sb += img[i * 4 + 2];
        n++;
      }
    }
  }
  const br = bleed !== null ? bleed[0] : n > 0 ? sr / n : 128;
  const bg = bleed !== null ? bleed[1] : n > 0 ? sg / n : 128;
  const bb = bleed !== null ? bleed[2] : n > 0 ? sb / n : 128;
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4;
    const dst = y * w * 4;
    for (let x = 0; x < w; x++) {
      const s = src + x * 4;
      const d = dst + x * 4;
      const a = img[s + 3];
      const k = Math.min(1, a / 200);
      out[d] = img[s] * k + br * (1 - k);
      out[d + 1] = img[s + 1] * k + bg * (1 - k);
      out[d + 2] = img[s + 2] * k + bb * (1 - k);
      out[d + 3] = a;
    }
  }
  const t = new THREE.DataTexture(out, w, h, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function tileable(t: THREE.Texture, srgb: boolean): THREE.Texture {
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Height field → tangent-space normal map (tileable). */
export function heightToNormal(
  heights: Float32Array,
  w: number,
  h: number,
  strength: number,
): THREE.DataTexture {
  const out = new Uint8Array(w * h * 4);
  const at = (x: number, y: number) => heights[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      out[i] = (-dx / len) * 127.5 + 127.5;
      out[i + 1] = (-dy / len) * 127.5 + 127.5;
      out[i + 2] = (1 / len) * 127.5 + 127.5;
      out[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(out, w, h, THREE.RGBAFormat);
  return tileable(t, false) as THREE.DataTexture;
}

// ── Leaves ──────────────────────────────────────────────────────────────

interface LeafStyle {
  hue: [number, number];
  sat: [number, number];
  light: [number, number];
  length: [number, number];
  width: number;
}

const BROADLEAF: LeafStyle = {
  hue: [74, 96],
  sat: [78, 92],
  light: [38, 56],
  length: [62, 86],
  width: 0.42,
};

const BUSH: LeafStyle = {
  hue: [92, 125],
  sat: [66, 82],
  light: [34, 50],
  length: [40, 56],
  width: 0.5,
};

/** 512² card: a few twigs fanning from the bottom-centre, ~20 leaves. */
export function leafClusterTexture(kind: 'broadleaf' | 'bush' = 'broadleaf'): THREE.DataTexture {
  return cached(`leaf-${kind}`, () => {
    // Stylised leaf CLUMP (JSR / cel look): a solid scalloped blob whose
    // rim is made of leaf tips, with flat two-tone leaves drawn inside and a
    // few thin ink lines. No see-through gaps inside the clump, so the
    // screen-space ink pass only traces clump silhouettes.
    const S = 512;
    const [, ctx] = canvas2d(S, S);
    const rng = new Rng(kind === 'broadleaf' ? 11 : 23);
    const st = kind === 'broadleaf' ? BROADLEAF : BUSH;
    const hue = (st.hue[0] + st.hue[1]) / 2;
    const sat = (st.sat[0] + st.sat[1]) / 2;
    const L0 = st.light[0];
    const L1 = st.light[1];
    const cx = 256;
    const cy = 262;
    const R = 200;
    const leafPath = (len: number, wid: number) => {
      const p = new Path2D();
      p.moveTo(0, 0);
      p.bezierCurveTo(wid * 0.95, -len * 0.2, wid * 0.6, -len * 0.8, 0, -len);
      p.bezierCurveTo(-wid * 0.6, -len * 0.8, -wid * 0.95, -len * 0.2, 0, 0);
      return p;
    };
    const leafAt = (
      x: number,
      y: number,
      ang: number,
      len: number,
      fill: string,
      ink: string | null,
    ) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      const p = leafPath(len, len * st.width * 1.1);
      ctx.fillStyle = fill;
      ctx.fill(p);
      if (ink !== null) {
        ctx.strokeStyle = ink;
        ctx.lineWidth = 2.4;
        ctx.stroke(p);
        ctx.beginPath();
        ctx.moveTo(0, -len * 0.1);
        ctx.lineTo(0, -len * 0.7);
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
      ctx.restore();
    };
    const base = `hsl(${hue}, ${sat}%, ${(L0 + L1) / 2}%)`;
    const dark = `hsl(${hue + 10}, ${sat}%, ${L0 - 4}%)`;
    const light = `hsl(${hue - 8}, ${Math.min(100, sat + 8)}%, ${L1 + 6}%)`;
    const ink = `hsla(${hue + 20}, 80%, 13%, 0.9)`;
    // 1. solid core
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.ellipse(cx, cy, R * 0.78, R * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
    // 2. scalloped rim of leaf tips
    const rim = kind === 'broadleaf' ? 26 : 32;
    for (let i = 0; i < rim; i++) {
      const a = (i / rim) * Math.PI * 2 + rng.range(-0.08, 0.08);
      const r0 = R * rng.range(0.5, 0.62);
      const x = cx + Math.cos(a) * r0;
      const y = cy + Math.sin(a) * r0 * 0.92;
      const len = R * rng.range(0.42, 0.55) * (kind === 'bush' ? 0.8 : 1);
      // canvas leaves point along -y; rotate so they point outward
      const below = Math.sin(a) > 0.35;
      leafAt(x, y, a + Math.PI / 2, len, below ? dark : base, null);
    }
    // 3. interior leaves: lit (upper-left) vs shaded (lower-right), some inked
    const inner = kind === 'broadleaf' ? 34 : 44;
    for (let i = 0; i < inner; i++) {
      const a = rng.range(0, Math.PI * 2);
      const rr = Math.sqrt(rng.next()) * R * 0.62;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr * 0.9;
      const lit = (cx - x) * 0.7 + (cy - y) * 0.7 + rng.range(-40, 40) > 10;
      const len = R * rng.range(0.24, 0.34) * (kind === 'bush' ? 0.85 : 1);
      const ang = Math.atan2(y - cy, x - cx) + Math.PI / 2 + rng.range(-0.6, 0.6);
      leafAt(
        x,
        y,
        ang,
        len,
        lit ? light : rng.next() < 0.5 ? base : dark,
        rng.next() < 0.45 ? ink : null,
      );
    }
    return spriteTexture(ctx, S, S, null);
  });
}

/** Palm frond (256×1024): rachis up the middle, leaflets angled toward the tip. */
export function palmFrondTexture(): THREE.DataTexture {
  return cached('palm-frond', () => {
    const W = 256;
    const H = 1024;
    const [, ctx] = canvas2d(W, H);
    const rng = new Rng(77);
    const n = 46;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const y = H - 30 - t * (H - 60);
      const env = Math.sin(Math.min(1, t * 1.15 + 0.08) * Math.PI) * 0.9 + 0.1;
      for (const side of [-1, 1]) {
        const len = (95 + rng.range(-12, 12)) * env + 14;
        const ang = side * (0.95 - t * 0.35 + rng.range(-0.08, 0.08));
        const hue = rng.range(70, 95);
        const li = rng.range(30, 44);
        ctx.save();
        ctx.translate(W / 2, y);
        ctx.rotate(ang);
        const p = new Path2D();
        const wd = rng.range(7, 10);
        p.moveTo(0, 0);
        p.quadraticCurveTo(wd, -len * 0.4, side * 4, -len);
        p.quadraticCurveTo(-wd * 0.4, -len * 0.5, 0, 0);
        const g = ctx.createLinearGradient(0, 0, 0, -len);
        g.addColorStop(0, `hsl(${hue}, 55%, ${li - 6}%)`);
        g.addColorStop(0.7, `hsl(${hue - 4}, 62%, ${li + 4}%)`);
        const dry = rng.next() < 0.18;
        g.addColorStop(1, dry ? `hsl(42, 45%, 48%)` : `hsl(${hue - 10}, 66%, ${li + 10}%)`);
        ctx.fillStyle = g;
        ctx.fill(p);
        ctx.strokeStyle = `hsla(${hue}, 50%, ${li + 20}%, 0.35)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(side * 3, -len * 0.95);
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.strokeStyle = '#8a8a45';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(W / 2, H - 4);
    ctx.lineTo(W / 2, 22);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(230,230,170,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    return spriteTexture(ctx, W, H, null);
  });
}

// ── Flowers (atlas: 4 cols × 2 rows of 256²) ────────────────────────────
// Row 0 (cells 0-3): side-view plants for meadow sprites.
// Row 1 (cells 4-7): blossom clusters for bushes.

export const FLOWER_CELLS = {
  pinkPlant: 0,
  daisyPlant: 1,
  yellowPlant: 2,
  lavenderPlant: 3,
  pinkBlossom: 4,
  whiteBlossom: 5,
  yellowBlossom: 6,
  blueBlossom: 7,
} as const;

function petalFlower(
  ctx: CanvasRenderingContext2D,
  rng: Rng,
  x: number,
  y: number,
  r: number,
  petals: number,
  color: string,
  centre: string,
  petalW = 0.45,
  tilt = 1,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, tilt);
  const rot = rng.range(0, Math.PI);
  for (let i = 0; i < petals; i++) {
    ctx.save();
    ctx.rotate(rot + (i / petals) * Math.PI * 2);
    const g = ctx.createLinearGradient(0, 0, 0, -r);
    g.addColorStop(0, color);
    g.addColorStop(1, color);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.55, r * petalW * 0.6, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = centre;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.24, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function stem(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  bend: number,
  w = 3,
) {
  ctx.strokeStyle = '#4f7a26';
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo((x0 + x1) / 2 + bend, (y0 + y1) / 2, x1, y1);
  ctx.stroke();
}

export function flowerAtlasTexture(): THREE.DataTexture {
  return cached('flowers', () => {
    const C = 256;
    const [, ctx] = canvas2d(C * 4, C * 2);
    const rng = new Rng(5);
    // Canvas row 1 (bottom) = uv row 0 after the flip.
    const plantCell = (col: number, draw: (x: number, y: number) => void) => {
      const ox = col * C;
      const oy = C;
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, C, C);
      ctx.clip();
      draw(ox, oy);
      ctx.restore();
    };
    const plant = (
      ox: number,
      oy: number,
      heads: number,
      head: (x: number, y: number, r: number) => void,
    ) => {
      for (let i = 0; i < heads; i++) {
        const bx = ox + C / 2 + rng.range(-30, 30);
        const tx = ox + 40 + rng.range(0, C - 80);
        const ty = oy + rng.range(40, 120);
        stem(ctx, bx, oy + C, tx, ty, rng.range(-25, 25));
        // leaves on stem
        ctx.fillStyle = '#5b8c2a';
        for (let k = 0; k < 2; k++) {
          const ly = oy + C - rng.range(30, 110);
          const lx = bx + (tx - bx) * ((oy + C - ly) / (oy + C - ty));
          ctx.save();
          ctx.translate(lx, ly);
          ctx.rotate(rng.range(-1.2, 1.2));
          ctx.beginPath();
          ctx.ellipse(0, -14, 5, 15, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        head(tx, ty, rng.range(20, 30));
      }
    };
    plantCell(0, (ox, oy) =>
      plant(ox, oy, 4, (x, y, r) =>
        petalFlower(
          ctx,
          rng,
          x,
          y,
          r,
          8,
          `hsl(${rng.range(325, 345)}, 75%, 70%)`,
          '#e8b52a',
          0.8,
          0.75,
        ),
      ),
    );
    plantCell(1, (ox, oy) =>
      plant(ox, oy, 5, (x, y, r) =>
        petalFlower(ctx, rng, x, y, r * 0.9, 14, '#fbfbf4', '#f2c21b', 0.42, 0.7),
      ),
    );
    plantCell(2, (ox, oy) =>
      plant(ox, oy, 5, (x, y, r) =>
        petalFlower(
          ctx,
          rng,
          x,
          y,
          r * 0.75,
          5,
          `hsl(${rng.range(46, 54)}, 95%, 56%)`,
          '#d08a10',
          1.1,
          0.8,
        ),
      ),
    );
    plantCell(3, (ox, oy) => {
      for (let i = 0; i < 6; i++) {
        const bx = ox + C / 2 + rng.range(-20, 20);
        const tx = ox + 30 + rng.range(0, C - 60);
        const ty = oy + rng.range(30, 90);
        stem(ctx, bx, oy + C, tx, ty, rng.range(-15, 15), 2.5);
        for (let k = 0; k < 16; k++) {
          const t = k / 16;
          const px = tx + (bx - tx) * t * 0.35 + rng.range(-5, 5);
          const py = ty + t * 70;
          ctx.fillStyle = `hsl(${rng.range(262, 280)}, 55%, ${rng.range(55, 70)}%)`;
          ctx.beginPath();
          ctx.ellipse(px, py, 6 - t * 2, 7 - t * 2, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
    // Blossom clusters (canvas row 0 = uv row 1)
    const blossom = (col: number, hue: number, sat: number, li: number, petals: number) => {
      const ox = col * C;
      const oy = 0;
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, C, C);
      ctx.clip();
      for (let i = 0; i < 46; i++) {
        const a = rng.range(0, Math.PI * 2);
        const rr = Math.sqrt(rng.next()) * 92;
        const x = ox + C / 2 + Math.cos(a) * rr;
        const y = oy + C / 2 + Math.sin(a) * rr * 0.85;
        const shade = li + rng.range(-10, 8) - (rr / 92) * 6;
        petalFlower(
          ctx,
          rng,
          x,
          y,
          rng.range(13, 19),
          petals,
          `hsl(${hue + rng.range(-8, 8)}, ${sat}%, ${shade}%)`,
          `hsl(${hue + 20}, ${sat}%, ${li - 25}%)`,
          1.05,
          1,
        );
      }
      ctx.restore();
    };
    blossom(0, 335, 70, 72, 5);
    blossom(1, 60, 25, 94, 5);
    blossom(2, 48, 92, 60, 4);
    blossom(3, 228, 55, 70, 4);
    return spriteTexture(ctx, C * 4, C * 2, [120, 150, 70]);
  });
}

// ── Bark ────────────────────────────────────────────────────────────────

export function barkTextures(kind: 'broadleaf' | 'palm'): {
  map: THREE.Texture;
  normal: THREE.Texture;
} {
  const key = `bark-${kind}`;
  const hitMap = cache.get(`${key}-map`);
  const hitN = cache.get(`${key}-n`);
  if (hitMap !== undefined && hitN !== undefined) return { map: hitMap, normal: hitN };
  const W = 256;
  const H = 512;
  const heights = new Float32Array(W * H);
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const v = y / H;
      let h: number;
      let r: number;
      let g: number;
      let b: number;
      if (kind === 'broadleaf') {
        // Vertical fissured bark: stretched noise + ridges
        const n1 = fbm2(u, v * 0.25, 3, 4, 8);
        const ridge = 1 - Math.abs(fbm2(u, v * 0.12, 9, 3, 6) * 2 - 1);
        h = n1 * 0.4 + Math.pow(ridge, 3) * 0.6;
        const k = 0.55 + h * 0.6;
        r = 96 * k;
        g = 82 * k;
        b = 66 * k;
        const lich = fbm2(u, v, 41, 4, 4);
        if (lich > 0.62) {
          const m = Math.min(1, (lich - 0.62) * 6);
          r += (150 - r) * m * 0.5;
          g += (160 - g) * m * 0.5;
          b += (120 - b) * m * 0.4;
        }
      } else {
        // Palm: horizontal ring scars with a diamond weave
        const ring = v * 24 + fbm2(u, v, 5, 3, 4) * 0.6;
        const fr = ring - Math.floor(ring);
        const scar = Math.pow(Math.abs(fr - 0.5) * 2, 6);
        const weave = Math.abs(Math.sin((u * 16 + Math.floor(ring) * 0.5) * Math.PI)) * 0.25;
        const n = fbm2(u, v, 13, 4, 8);
        h = 1 - scar * 0.9 - weave * (1 - scar) * 0.4 + n * 0.25;
        const k = 0.62 + n * 0.35 - scar * 0.35;
        r = 150 * k;
        g = 132 * k;
        b = 108 * k;
      }
      heights[y * W + x] = h;
      // Posterise to 3 flat tones (cel look)
      const lum = (r + g + b) / 3;
      const q = lum < 70 ? 0.7 : lum < 95 ? 0.88 : 1.05;
      const avg = kind === 'broadleaf' ? [104, 78, 58] : [160, 128, 96];
      r = avg[0] * q;
      g = avg[1] * q;
      b = avg[2] * q;
      const i = (y * W + x) * 4;
      rgba[i] = Math.min(255, r);
      rgba[i + 1] = Math.min(255, g);
      rgba[i + 2] = Math.min(255, b);
      rgba[i + 3] = 255;
    }
  }
  const map = tileable(new THREE.DataTexture(rgba, W, H, THREE.RGBAFormat), true);
  const normal = heightToNormal(heights, W, H, kind === 'broadleaf' ? 6 : 4);
  cache.set(`${key}-map`, map);
  cache.set(`${key}-n`, normal);
  return { map, normal };
}

// ── Ground textures ─────────────────────────────────────────────────────

/** Tileable pebble/stream-bed colour + normal (rounded stones in sand). */
export function pebbleTextures(): { map: THREE.Texture; normal: THREE.Texture } {
  const hitMap = cache.get('pebble-map');
  const hitN = cache.get('pebble-n');
  if (hitMap !== undefined && hitN !== undefined) return { map: hitMap, normal: hitN };
  const S = 512;
  const [, cctx] = canvas2d(S, S);
  const [, hctx] = canvas2d(S, S);
  const rng = new Rng(99);
  // Sandy base
  const base = cctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = fbm2(x / S, y / S, 7, 5, 8);
      const i = (y * S + x) * 4;
      base.data[i] = 150 * (n > 0.5 ? 1.0 : 0.9);
      base.data[i + 1] = 136 * (n > 0.5 ? 1.0 : 0.9);
      base.data[i + 2] = 112 * (n > 0.5 ? 1.0 : 0.9);
      base.data[i + 3] = 255;
    }
  }
  cctx.putImageData(base, 0, 0);
  hctx.fillStyle = '#000';
  hctx.fillRect(0, 0, S, S);
  const palette = [
    [228, 222, 208],
    [205, 196, 180],
    [176, 170, 160],
    [140, 138, 132],
    [196, 170, 140],
    [120, 112, 104],
    [236, 232, 224],
    [168, 150, 124],
  ];
  const stones: { x: number; y: number; r: number; e: number; a: number; c: number[] }[] = [];
  for (let i = 0; i < 520; i++) {
    const r = Math.pow(rng.next(), 2.2) * 26 + 6;
    stones.push({
      x: rng.range(0, S),
      y: rng.range(0, S),
      r,
      e: rng.range(0.6, 1),
      a: rng.range(0, Math.PI),
      c: rng.pick(palette),
    });
  }
  stones.sort((a, b) => b.r - a.r);
  for (const s of stones) {
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        const x = s.x + ox;
        const y = s.y + oy;
        if (x < -40 || x > S + 40 || y < -40 || y > S + 40) continue;
        // shadow
        cctx.save();
        cctx.translate(x + 2, y + 3);
        cctx.rotate(s.a);
        cctx.fillStyle = 'rgba(40,30,20,0.35)';
        cctx.beginPath();
        cctx.ellipse(0, 0, s.r * 1.05, s.r * s.e * 1.05, 0, 0, Math.PI * 2);
        cctx.fill();
        cctx.restore();
        cctx.save();
        cctx.translate(x, y);
        cctx.rotate(s.a);
        const [r, gg, b] = s.c;
        // Flat pebble + light crescent + dark outline (cel style)
        cctx.fillStyle = `rgb(${r},${gg},${b})`;
        cctx.beginPath();
        cctx.ellipse(0, 0, s.r, s.r * s.e, 0, 0, Math.PI * 2);
        cctx.fill();
        cctx.fillStyle = `rgb(${Math.min(255, r + 28)},${Math.min(255, gg + 28)},${Math.min(255, b + 24)})`;
        cctx.beginPath();
        cctx.ellipse(
          -s.r * 0.18,
          -s.r * s.e * 0.2,
          s.r * 0.62,
          s.r * s.e * 0.55,
          0,
          0,
          Math.PI * 2,
        );
        cctx.fill();
        cctx.strokeStyle = 'rgba(52,40,30,0.9)';
        cctx.lineWidth = 2;
        cctx.beginPath();
        cctx.ellipse(0, 0, s.r, s.r * s.e, 0, 0, Math.PI * 2);
        cctx.stroke();
        cctx.restore();
        hctx.save();
        hctx.translate(x, y);
        hctx.rotate(s.a);
        hctx.scale(1, s.e);
        const hg = hctx.createRadialGradient(0, 0, 0, 0, 0, s.r);
        hg.addColorStop(0, 'rgb(255,255,255)');
        hg.addColorStop(0.6, 'rgb(205,205,205)');
        hg.addColorStop(1, 'rgb(40,40,40)');
        hctx.fillStyle = hg;
        hctx.beginPath();
        hctx.arc(0, 0, s.r, 0, Math.PI * 2);
        hctx.fill();
        hctx.restore();
      }
    }
  }
  const map = tileable(new THREE.CanvasTexture(cctx.canvas), true);
  const hd = hctx.getImageData(0, 0, S, S).data;
  const heights = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) heights[i] = hd[i * 4] / 255;
  const normal = heightToNormal(heights, S, S, 3.5);
  cache.set('pebble-map', map);
  cache.set('pebble-n', normal);
  return { map, normal };
}

/** Lush lawn ground: mottled greens with a few dry/dirt patches. */
export function lawnTexture(): THREE.Texture {
  return cached('lawn', () => {
    const S = 512;
    const data = new Uint8Array(S * S * 4);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        const n = fbm2(u, v, 21, 5, 6);
        const fine = hash3(x, y, 7, 2);
        const dirt = fbm2(u, v, 55, 4, 3);
        const d = dirt > 0.72 ? 1 : 0;
        const i = (y * S + x) * 4;
        const k = (n > 0.5 ? 1.08 : 0.9) + (fine > 0.93 ? 0.18 : 0);
        const gr = [86 * k, 150 * k, 34 * k];
        const dr = [118 * k, 98 * k, 64 * k];
        data[i] = gr[0] + (dr[0] - gr[0]) * d;
        data[i + 1] = gr[1] + (dr[1] - gr[1]) * d;
        data[i + 2] = gr[2] + (dr[2] - gr[2]) * d;
        data[i + 3] = 255;
      }
    }
    return tileable(new THREE.DataTexture(data, S, S, THREE.RGBAFormat), true);
  });
}

/** Soft tileable rock detail (normal map) for boulders. */
export function rockNormalTexture(): THREE.Texture {
  return cached('rock-n', () => {
    const S = 256;
    const h = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        const n = fbm2(u, v, 61, 5, 4);
        const pits = Math.pow(1 - fbm2(u, v, 67, 2, 16), 6);
        h[y * S + x] = n - pits * 0.6;
      }
    }
    return heightToNormal(h, S, S, 5);
  });
}

// ── Water ───────────────────────────────────────────────────────────────

/** Tileable ripple normal map (rounded wavelets, no directional bias). */
export function waterNormalTexture(): THREE.Texture {
  return cached('water-n', () => {
    const S = 256;
    const h = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        const a = fbm2(u, v, 81, 4, 4);
        const b = 1 - Math.abs(fbm2(u, v, 83, 3, 6) * 2 - 1);
        h[y * S + x] = a * 0.7 + b * b * 0.3;
      }
    }
    return heightToNormal(h, S, S, 4.5);
  });
}

/**
 * Tileable caustics: R = Voronoi cell-edge network (bright filaments),
 * G = soft fBm (foam breakup), B = second Voronoi with a different seed.
 */
export function causticsTexture(): THREE.Texture {
  return cached('caustics', () => {
    const S = 256;
    const data = new Uint8Array(S * S * 4);
    const voronoi = (u: number, v: number, cells: number, seed: number) => {
      const x = u * cells;
      const y = v * cells;
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      let f1 = 9;
      let f2 = 9;
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const cx = xi + i;
          const cy = yi + j;
          const wx = ((cx % cells) + cells) % cells;
          const wy = ((cy % cells) + cells) % cells;
          const px = cx + 0.15 + 0.7 * hash3(wx, wy, 0, seed);
          const py = cy + 0.15 + 0.7 * hash3(wx, wy, 1, seed);
          const d = Math.hypot(px - x, py - y);
          if (d < f1) {
            f2 = f1;
            f1 = d;
          } else if (d < f2) f2 = d;
        }
      }
      return f2 - f1;
    };
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        const w1 = voronoi(u, v, 7, 3);
        const w2 = voronoi(u, v, 9, 8);
        const c1 = Math.pow(Math.max(0, 1 - w1 / 0.32), 3.2);
        const c2 = Math.pow(Math.max(0, 1 - w2 / 0.32), 3.2);
        const i = (y * S + x) * 4;
        data[i] = Math.min(255, c1 * 255);
        data[i + 1] = fbm2(u, v, 91, 5, 6) * 255;
        data[i + 2] = Math.min(255, c2 * 255);
        data[i + 3] = 255;
      }
    }
    return tileable(new THREE.DataTexture(data, S, S, THREE.RGBAFormat), false);
  });
}

/** Radial soft spot (for lamp light pools / glows). */
export function softSpotTexture(): THREE.Texture {
  return cached('spot', () => {
    const S = 128;
    const [c, ctx] = canvas2d(S, S);
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    // Cel light pool: bright core, flat mid ring, faint outer ring (hard steps)
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.42, 'rgba(255,255,255,1)');
    g.addColorStop(0.44, 'rgba(255,255,255,0.5)');
    g.addColorStop(0.72, 'rgba(255,255,255,0.5)');
    g.addColorStop(0.74, 'rgba(255,255,255,0.18)');
    g.addColorStop(0.96, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}
