// ── Softening a pixel-art head atlas, in plain JS ───────────────────────
//
// The smooth head's texture is its 72×32 pixel atlas upscaled, lightly
// blurred and posterised (SmoothHead.ts). That used to be a 2D canvas with
// `filter: blur()` and a getImageData read back: in Chrome the filtered draw
// + readback cost ~40 ms a head unthrottled (550 ms the first time), so
// every rider, resident or crowd Noun with a new head was a 0.2–2 s hitch on
// an Android tablet. This does the same in one pass over typed arrays:
// bilinear upscale (nearest for crisp art), a separable Gaussian with the
// same σ as the CSS blur, then posterise the colour to steps of 12.
// Premultiplied throughout, like the canvas, so colour never bleeds dark
// into transparent texels. Pure: tested in softenAtlas.test.ts.

/** Posterise step (colour channels round to multiples of this). */
export const POSTER_STEP = 12;

/**
 * Upscale `src` (RGBA, w×h, straight alpha) by `up`, blur with Gaussian std
 * dev `sigma` (output px; 0 = none), posterise. `smooth` false = nearest
 * (pixel-sharp). Returns straight-alpha RGBA, (w·up)×(h·up).
 */
export function softenAtlas(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  up: number,
  sigma: number,
  smooth: boolean,
): Uint8ClampedArray<ArrayBuffer> {
  const W = w * up;
  const H = h * up;
  const kernel = sigma > 0.05 ? gaussian(sigma) : null;
  // Premultiply the source
  const pre = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h * 4; i += 4) {
    const al = src[i + 3] / 255;
    pre[i] = src[i] * al;
    pre[i + 1] = src[i + 1] * al;
    pre[i + 2] = src[i + 2] * al;
    pre[i + 3] = src[i + 3];
  }
  // Upscale-then-blur is linear and separable, so each axis is one filter
  // straight from source texels: a few taps per output texel, not ~7 over
  // the whole upscaled image twice
  const fx = axisTaps(w, up, kernel, smooth);
  const fy = axisTaps(h, up, kernel, smooth);
  // Across: h source rows × W
  const rows = new Float32Array(h * W * 4);
  for (let y = 0; y < h; y++) {
    const srow = y * w * 4;
    const drow = y * W * 4;
    for (let x = 0; x < W; x++) {
      let s0 = 0;
      let s1 = 0;
      let s2 = 0;
      let s3 = 0;
      for (let t = fx.start[x]; t < fx.start[x + 1]; t++) {
        const i = srow + fx.idx[t] * 4;
        const k = fx.wt[t];
        s0 += pre[i] * k;
        s1 += pre[i + 1] * k;
        s2 += pre[i + 2] * k;
        s3 += pre[i + 3] * k;
      }
      const o = drow + x * 4;
      rows[o] = s0;
      rows[o + 1] = s1;
      rows[o + 2] = s2;
      rows[o + 3] = s3;
    }
  }
  // Down, then un-premultiply + posterise (fully transparent stays 0,0,0,0)
  const out = new Uint8ClampedArray(W * H * 4);
  const acc = new Float32Array(W * 4);
  const rowLen = W * 4;
  const q = POSTER_STEP;
  for (let y = 0; y < H; y++) {
    acc.fill(0);
    for (let t = fy.start[y]; t < fy.start[y + 1]; t++) {
      const r0 = fy.idx[t] * rowLen;
      const k = fy.wt[t];
      for (let i = 0; i < rowLen; i++) acc[i] += rows[r0 + i] * k;
    }
    const o0 = y * rowLen;
    for (let i = 0; i < rowLen; i += 4) {
      const al = acc[i + 3];
      if (al <= 0.5) continue;
      const inv = 255 / al / q;
      const o = o0 + i;
      out[o] = ((acc[i] * inv + 0.5) | 0) * q;
      out[o + 1] = ((acc[i + 1] * inv + 0.5) | 0) * q;
      out[o + 2] = ((acc[i + 2] * inv + 0.5) | 0) * q;
      out[o + 3] = al;
    }
  }
  return out;
}

/**
 * One axis's combined filter: for each of the n·up output texels, the
 * source texels it reads and their weights (upscale at pixel centres,
 * clamped to the edge, then the Gaussian, with transparent beyond the
 * image). CSR form: output i uses idx/wt[start[i] .. start[i+1]).
 */
export function axisTaps(
  n: number,
  up: number,
  kernel: Float32Array | null,
  smooth: boolean,
): { start: Int32Array; idx: Int32Array; wt: Float32Array } {
  const N = n * up;
  // The upscale alone: output j = (1 - f)·src[j0] + f·src[j1]
  const j0 = new Int32Array(N);
  const j1 = new Int32Array(N);
  const jf = new Float32Array(N);
  for (let j = 0; j < N; j++) {
    const s = smooth ? Math.min(n - 1, Math.max(0, (j + 0.5) / up - 0.5)) : Math.floor(j / up);
    j0[j] = Math.floor(s);
    j1[j] = Math.min(n - 1, j0[j] + 1);
    jf[j] = smooth ? s - j0[j] : 0;
  }
  const r = kernel === null ? 0 : (kernel.length - 1) / 2;
  const start = new Int32Array(N + 1);
  const idx: number[] = [];
  const wt: number[] = [];
  const w = new Map<number, number>();
  for (let i = 0; i < N; i++) {
    w.clear();
    for (let t = -r; t <= r; t++) {
      const j = i + t;
      if (j < 0 || j >= N) continue; // transparent outside the image
      const k = kernel === null ? 1 : kernel[t + r];
      w.set(j0[j], (w.get(j0[j]) ?? 0) + k * (1 - jf[j]));
      if (jf[j] > 0) w.set(j1[j], (w.get(j1[j]) ?? 0) + k * jf[j]);
    }
    start[i] = idx.length;
    for (const [j, v] of w)
      if (v > 1e-7) {
        idx.push(j);
        wt.push(v);
      }
  }
  start[N] = idx.length;
  return { start, idx: Int32Array.from(idx), wt: Float32Array.from(wt) };
}

/** Normalised 1D Gaussian kernel for std dev `sigma`, radius ⌈3σ⌉. */
export function gaussian(sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(r * 2 + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

/** 'rgb(r,g,b)' (as the head atlas stores its colours) → [r, g, b]; null if not that form. */
export function parseRgb(c: string): [number, number, number] | null {
  const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(c);
  return m === null ? null : [+m[1], +m[2], +m[3]];
}
