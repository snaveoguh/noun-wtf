// ── Texture diet: fit the world on 4 GB phones ─────────────────────────
//
// A weak device (deviceTier isWeakDevice) renders at ~0.75x on a ~400 px
// wide screen, so its framebuffer is barely 300 px across: textures past
// 512 px (or 256 for the plaza's tiling materials) never show their extra
// detail there, they only cost GPU memory. A Moto G06 (Mali-G52, 4 GB)
// crashed the tab with ~170 MB of textures resident. On a diet:
//   - every image / canvas upload is capped at UPLOAD_CAP (three resizes it
//     on upload through capabilities.maxTextureSize, live canvases included);
//   - static textures the generators or the level own are shrunk on the CPU
//     before upload (shrinkTexture), which also drops the full-size copy;
//   - texture builders read `textureDiet.on` to paint at a smaller size.
// Desktop never diets. Phones and tablets that aren't weak go on the light
// diet (textureDiet.light, LIGHT_CAP); weak ones, and any device whose
// context was lost in the last half hour, on the full one.

import * as THREE from 'three';

export const textureDiet = {
  /** Set once by Game on a weak device (or after a lost context), before anything loads. */
  on: false,
  /**
   * The light diet: every phone and tablet on auto 'low' that isn't on the
   * full one. iPad Safari lost its WebGL context (black world, heads gone,
   * then a tab crash) with ~270 MB of GL + ~130 MB of canvases resident;
   * uploads are capped at LIGHT_CAP, the env map bakes at 128 and the big
   * static atlases paint at half size or free their canvas once uploaded.
   */
  light: false,
};

/** Largest edge any texture is uploaded with on the light diet (a tablet's screen at ~0.75 scale). */
export const LIGHT_CAP = 1024;

/** The upload cap in force (px; Infinity off the diet). */
export function uploadCap(d: { on: boolean; light: boolean } = textureDiet): number {
  return d.on ? UPLOAD_CAP : d.light ? LIGHT_CAP : Infinity;
}

/**
 * A static texture whose canvas is never drawn again: once it's on the GPU,
 * shrink the canvas to 1×1 so its backing store (16 MB for the door-sign
 * atlas) is freed. Only on a diet, where a lost context reloads the page
 * rather than re-uploading (watchContextLoss), so nothing re-reads it.
 */
export function releaseAfterUpload(tex: THREE.Texture) {
  if (!textureDiet.on && !textureDiet.light) return;
  tex.onUpdate = () => {
    tex.onUpdate = null;
    const img = tex.image as HTMLCanvasElement | null;
    if (img !== null && typeof img === 'object' && 'getContext' in img) {
      img.width = 1;
      img.height = 1;
    }
  };
}

/** Largest edge any texture is uploaded with on a diet. */
export const UPLOAD_CAP = 512;
/** Largest edge for minor textures (tiling materials, foliage, shirts). */
export const MINOR_CAP = 256;
/**
 * Estimated texture memory a weak device should stay under (bytes,
 * estimateTextureBytes). The dev build warns past it (Game).
 */
export const WEAK_TEXTURE_BUDGET = 50e6;

/**
 * PMREM bake size for the environment map: a smooth gradient sky, so a
 * weak phone bakes it at 64 px (768×1024 half-float → 192×256).
 */
export function envMapSize(): number {
  return textureDiet.on ? 64 : textureDiet.light ? 128 : 256;
}

/** The size `w`×`h` fits in `cap` (aspect kept, never upscaled, ≥ 1 px). */
export function fitSize(w: number, h: number, cap: number): [number, number] {
  const m = Math.max(w, h);
  if (m <= cap || m <= 0) return [w, h];
  const k = cap / m;
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

/** Box-filter downsample of tightly packed RGBA8 pixels (any ratio ≤ 1). */
export function downsampleRGBA(
  src: ArrayLike<number>,
  w: number,
  h: number,
  nw: number,
  nh: number,
): Uint8Array {
  const out = new Uint8Array(nw * nh * 4);
  const sx = w / nw;
  const sy = h / nh;
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * w + xx) * 4;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          a += src[i + 3];
        }
      }
      const n = (x1 - x0) * (y1 - y0);
      const o = (y * nw + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

const shrunk = new WeakSet<THREE.Source<unknown>>();

type Drawable = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

function drawable(im: unknown): im is Drawable {
  return (
    (typeof HTMLImageElement !== 'undefined' && im instanceof HTMLImageElement) ||
    (typeof HTMLCanvasElement !== 'undefined' && im instanceof HTMLCanvasElement) ||
    (typeof ImageBitmap !== 'undefined' && im instanceof ImageBitmap)
  );
}

/**
 * Shrink a static texture to fit `cap`, on the CPU, in place: a DataTexture
 * (RGBA8, no hand-made mipmaps) is box-filtered, an image / bitmap / canvas
 * is redrawn into a smaller canvas (an ImageBitmap is closed). Call it before
 * the texture is first drawn, and never on a canvas something keeps painting
 * (graffiti, deck art): the texture stops following that canvas. Shared
 * sources are shrunk once. Returns true when it shrank.
 */
export function shrinkTexture(tex: THREE.Texture, cap: number): boolean {
  const src = tex.source;
  if (shrunk.has(src)) return false;
  const im = tex.image as unknown;
  if (im === null || im === undefined) return false;
  if ((tex as THREE.DataTexture).isDataTexture === true) {
    const d = im as { data: ArrayLike<number> | null; width: number; height: number };
    if (
      d.data === null ||
      !(d.data instanceof Uint8Array || d.data instanceof Uint8ClampedArray) ||
      tex.format !== THREE.RGBAFormat ||
      tex.type !== THREE.UnsignedByteType ||
      tex.mipmaps.length > 0
    )
      return false;
    const [nw, nh] = fitSize(d.width, d.height, cap);
    if (nw === d.width && nh === d.height) return false;
    tex.image = { data: downsampleRGBA(d.data, d.width, d.height, nw, nh), width: nw, height: nh };
  } else if (drawable(im)) {
    const [nw, nh] = fitSize(im.width, im.height, cap);
    if (nw === im.width && nh === im.height) return false;
    const c = document.createElement('canvas');
    c.width = nw;
    c.height = nh;
    const ctx = c.getContext('2d');
    if (ctx === null) return false;
    ctx.imageSmoothingEnabled = tex.magFilter !== THREE.NearestFilter;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(im, 0, 0, nw, nh);
    if (typeof ImageBitmap !== 'undefined' && im instanceof ImageBitmap) im.close();
    tex.image = c;
  } else {
    return false;
  }
  shrunk.add(tex.source);
  tex.needsUpdate = true;
  return true;
}

/** Texture-valued properties of a material (maps and shader uniforms). */
export function materialTextures(m: THREE.Material): [string, THREE.Texture][] {
  const out: [string, THREE.Texture][] = [];
  const rec = m as unknown as Record<string, unknown>;
  for (const k of Object.keys(rec)) {
    const v = rec[k] as THREE.Texture | null | undefined;
    if (v !== null && typeof v === 'object' && v.isTexture === true) out.push([k, v]);
  }
  const u = (m as THREE.ShaderMaterial).uniforms as Record<string, { value: unknown }> | undefined;
  if (u !== undefined)
    for (const k of Object.keys(u)) {
      const v = u[k]?.value as THREE.Texture | null | undefined;
      if (v !== null && typeof v === 'object' && v.isTexture === true) out.push([k, v]);
    }
  return out;
}

/**
 * Estimated GPU bytes of one texture as uploaded: RGBA8, a third more with a
 * mip chain, six faces for a cube, clamped to `uploadCap` when set (three's
 * upload resize; DataTextures aren't resized).
 */
export function textureBytes(t: THREE.Texture, uploadCap = Infinity): number {
  const im = t.image as {
    width?: number;
    height?: number;
    videoWidth?: number;
    videoHeight?: number;
  } | null;
  if (im === null || im === undefined) return 0;
  let w = (im.videoWidth ?? 0) > 0 ? im.videoWidth! : (im.width ?? 0);
  let h = (im.videoHeight ?? 0) > 0 ? im.videoHeight! : (im.height ?? 0);
  if ((t as THREE.DataTexture).isDataTexture !== true) [w, h] = fitSize(w, h, uploadCap);
  const mips =
    t.generateMipmaps && t.minFilter !== THREE.NearestFilter && t.minFilter !== THREE.LinearFilter
      ? 4 / 3
      : 1;
  return w * h * 4 * mips * ((t as THREE.CubeTexture).isCubeTexture === true ? 6 : 1);
}

/** Estimated texture memory of everything under `root` (unique textures). */
export function estimateTextureBytes(root: THREE.Object3D, uploadCap = Infinity): number {
  const seen = new Set<THREE.Source<unknown>>();
  let bytes = 0;
  const add = (t: THREE.Texture | null | undefined) => {
    if (t === null || t === undefined || seen.has(t.source)) return;
    seen.add(t.source);
    bytes += textureBytes(t, uploadCap);
  };
  root.traverse(o => {
    const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (mat === undefined) return;
    for (const m of Array.isArray(mat) ? mat : [mat])
      for (const [, t] of materialTextures(m)) add(t);
  });
  const s = root as THREE.Scene;
  if (s.isScene === true) {
    if ((s.background as THREE.Texture | null)?.isTexture === true)
      add(s.background as THREE.Texture);
    add(s.environment);
  }
  return bytes;
}

let quiet = false;

/**
 * Cap every texture upload on this renderer at `cap` px. three reads
 * capabilities.maxTextureSize on each upload and redraws a bigger image /
 * canvas / bitmap into a scratch canvas first (the shadow map took its own
 * copy of the limit at construction, so shadows don't change). Its
 * per-upload "has been resized" warning is silenced.
 */
export function capUploads(renderer: THREE.WebGLRenderer, cap = UPLOAD_CAP) {
  const caps = renderer.capabilities as { maxTextureSize: number };
  caps.maxTextureSize = Math.min(caps.maxTextureSize, cap);
  if (quiet) return;
  quiet = true;
  type Log = (type: 'log' | 'warn' | 'error', message: string, ...params: unknown[]) => void;
  const prev = THREE.getConsoleFunction() as Log | null;
  THREE.setConsoleFunction((type, message, ...params) => {
    if (type === 'warn' && /Texture has been resized/.test(message)) return;
    if (prev !== null) return prev(type, message, ...params);
    const c = console as unknown as Record<string, (...a: unknown[]) => void>;
    (c[type] ?? console.log)(message, ...params);
  });
}

// ── Lost GPU context (every device) ─────────────────────────────────────

const LOST_KEY = 'noun-world-context-lost';
/** A second loss this soon after a reload gives up instead of looping. */
export const RELOAD_WINDOW_MS = 120_000;
/** A page loaded this soon after a loss boots on the full diet (afterLoss). */
export const LIGHTER_FOR_MS = 30 * 60_000;

/** Reload after a lost WebGL context, unless the last reload for one was recent. */
export function reloadAfterLoss(now: number, last: number | null): boolean {
  return last === null || !Number.isFinite(last) || now - last >= RELOAD_WINDOW_MS;
}

/** When the last lost-context reload happened (ms), or null. */
export function lastLoss(): number | null {
  try {
    const v = sessionStorage.getItem(LOST_KEY);
    const n = v === null ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** This page load follows a lost context (boot lighter: full diet / no High). */
export function bootsAfterLoss(now: number, last: number | null): boolean {
  return last !== null && now - last >= 0 && now - last < LIGHTER_FOR_MS;
}

/** What to do when the context goes: reload (lighter), or stop and say so. */
export function lossAction(now: number, last: number | null): 'reload' | 'notice' {
  return reloadAfterLoss(now, last) ? 'reload' : 'notice';
}

/** A plain overlay over the game (no React: the page may be in a bad way). */
function lossNotice(canvas: HTMLCanvasElement, text: string, button: boolean): HTMLDivElement {
  const el = document.createElement('div');
  el.dataset.w2ContextLost = '1';
  el.style.cssText =
    'position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;' +
    'align-items:center;justify-content:center;gap:16px;background:#111;color:#fff;' +
    'font:700 18px/1.35 system-ui,sans-serif;text-align:center;padding:24px';
  const p = document.createElement('div');
  p.textContent = text;
  el.appendChild(p);
  if (button) {
    const b = document.createElement('button');
    b.textContent = 'RELOAD';
    b.style.cssText =
      'font:900 18px system-ui,sans-serif;padding:12px 28px;border-radius:10px;' +
      'border:0;background:#f3c71b;color:#111;cursor:pointer';
    b.onclick = () => window.location.reload();
    el.appendChild(b);
  }
  (canvas.ownerDocument?.body ?? document.body).appendChild(el);
  return el;
}

/**
 * A lost WebGL context (the GPU ran out of memory, the OS took it back, or
 * the driver reset) on any device. three's own restore re-uploads from
 * whatever sources are left, and some are gone by then (shrunk or freed
 * after upload): on an iPad that was the black world with the heads
 * missing, then a tab crash. So: say so, and reload once; the new page
 * boots lighter (bootsAfterLoss: the full texture diet, no High). A
 * second loss inside RELOAD_WINDOW_MS stops on a notice with a RELOAD
 * button instead of looping. Returns the unbind (call it before disposing,
 * so leaving the page doesn't count as a loss).
 */
export function watchContextLoss(canvas: HTMLCanvasElement): () => void {
  let notice: HTMLDivElement | null = null;
  const lost = (e: Event) => {
    e.preventDefault(); // keep the context restorable while we decide
    if (notice !== null) return;
    const now = Date.now();
    if (lossAction(now, lastLoss()) === 'notice') {
      notice = lossNotice(
        canvas,
        'Graphics memory ran out again. Close other tabs and apps, then reload.',
        true,
      );
      return;
    }
    try {
      sessionStorage.setItem(LOST_KEY, String(now));
    } catch {
      // can't remember it: don't risk a reload loop
      notice = lossNotice(canvas, 'Graphics memory ran out. Reload to keep playing.', true);
      return;
    }
    notice = lossNotice(canvas, 'Graphics memory ran out. Reloading lighter…', false);
    window.setTimeout(() => window.location.reload(), 600);
  };
  canvas.addEventListener('webglcontextlost', lost);
  return () => canvas.removeEventListener('webglcontextlost', lost);
}

/**
 * Dev guard: warn when a weak device's scene holds more texture memory than
 * WEAK_TEXTURE_BUDGET (a new feature shipping full-size textures to phones).
 * Returns the estimate in bytes.
 */
export function checkTextureBudget(scene: THREE.Object3D): number {
  const bytes = estimateTextureBytes(scene, UPLOAD_CAP);
  if (bytes > WEAK_TEXTURE_BUDGET)
    console.warn(
      `[noun world] weak-device textures ≈ ${(bytes / 1e6).toFixed(0)} MB, over the ` +
        `${WEAK_TEXTURE_BUDGET / 1e6} MB budget: shrink new textures with render/textureDiet`,
    );
  return bytes;
}
