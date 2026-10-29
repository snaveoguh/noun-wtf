// ── Device tier: which quality to boot with, and how far 'low' may step down ──
//
// Phones already boot on 'low'. That was still too heavy for older Android
// (Mali-G52 / Adreno 5xx class, 3–4 GB): 1x pixels, a 1024 shadow map and a
// full-screen ink pass. A *weak* device boots one step lighter (render scale
// below 1), and the runtime ladder keeps stepping down while the frame rate
// stays bad: render scale → no shadows → no ink pass (straight render).
// Pure functions; Game/Graphics apply them.

import type { Quality } from './Graphics';

export interface DeviceInfo {
  ua: string;
  /** navigator.deviceMemory (GB, Chrome/Android only; rounded down to a power of two). */
  memory?: number;
  cores?: number;
  /** WEBGL_debug_renderer_info UNMASKED_RENDERER string (may be empty). */
  gpu?: string;
  touchFirst?: boolean;
  maxTouchPoints?: number;
  width?: number;
}

const MOBILE_UA = /android|iphone|ipad|ipod/i;

/** Low-end GPU families (Mali Midgard/early Bifrost, older Adreno, PowerVR, software). */
const WEAK_GPU =
  /mali-(t\d|g31|g51|g52|g57|g71|g72|g76)\b|adreno \(tm\) [2-5]\d\d|adreno [2-5]\d\d|powervr|sgx|swiftshader|llvmpipe|softpipe|microsoft basic render/i;

/**
 * Touch-first devices get the light path whatever their screen size. iPadOS
 * Safari reports a Mac user agent and iPads are wider than any phone, so they
 * used to fall through to high (2x pixels, 4K shadows, AO, half-float
 * buffers), run out of memory and get the tab reloaded mid-game.
 */
export function isMobile(d: DeviceInfo): boolean {
  const ipad = /macintosh/i.test(d.ua) && (d.maxTouchPoints ?? 0) > 1;
  return (
    MOBILE_UA.test(d.ua) ||
    ipad ||
    d.touchFirst === true ||
    ((d.maxTouchPoints ?? 0) > 1 && (d.width ?? 9999) < 1100)
  );
}

/**
 * A device that struggles even on 'low': a known weak GPU, or an Android
 * phone with ≤ 4 GB / ≤ 4 cores. iPhones never report deviceMemory and their
 * GPUs are fine, so they're only weak when the GPU string says so.
 */
export function isWeakDevice(d: DeviceInfo): boolean {
  if (d.gpu !== undefined && d.gpu !== '' && WEAK_GPU.test(d.gpu)) return true;
  const android = /android/i.test(d.ua);
  if (!android) return false;
  if (d.memory !== undefined && d.memory <= 4) return true;
  if (d.cores !== undefined && d.cores <= 4) return true;
  return false;
}

/** The quality 'auto' boots with. */
export function autoQuality(d: DeviceInfo): Quality {
  if (isMobile(d)) return 'low';
  const cores = d.cores ?? 4;
  return cores >= 8 ? 'high' : 'medium';
}

export interface BootPlan {
  /** Phone protections: the weak check (boot scale, texture diet) on 'low'. */
  phone: boolean;
  /** Which adaptive ladder runs (null: none, quality stays as chosen). */
  ladder: 'phone' | 'desktop' | null;
}

/**
 * What a booted quality turns on. `explicit`: the player picked it (Settings
 * or ?q=), not auto. A phone is never worse off for picking Low: the weak
 * check, the texture diet and the full phone ladder all run on an explicit
 * Low exactly as on auto (which boots phones on Low anyway). A player who
 * picks Low is asking for speed, and every rung of the ladder is lighter
 * than Low, so it never undoes the choice. An explicit Low off a phone
 * (a desktop's ?q=low, scripts) stays as chosen, as before.
 */
export function bootPlan(quality: Quality, explicit: boolean, mobile: boolean): BootPlan {
  if (quality !== 'low') return { phone: false, ladder: 'desktop' };
  if (!explicit || mobile) return { phone: true, ladder: 'phone' };
  return { phone: false, ladder: null };
}

/** ?perf=1's device line: the weak verdict and what it was judged on. */
export function deviceLine(d: DeviceInfo, phone: boolean, weak: boolean): string {
  const verdict = weak ? 'WEAK' : phone ? 'not weak' : 'not checked';
  const gpu = d.gpu !== undefined && d.gpu !== '' ? d.gpu : 'gpu hidden';
  const mem = d.memory !== undefined ? `${d.memory} GB` : '? GB';
  return `${verdict} · ${gpu} · ${mem} · ${d.cores ?? '?'} cores${isMobile(d) ? ' · mobile' : ''}`;
}

/** Read the device from the browser (GPU string best effort). */
export function readDevice(gl?: WebGLRenderingContext | WebGL2RenderingContext | null): DeviceInfo {
  const nav = navigator as Navigator & { deviceMemory?: number };
  let gpu = '';
  try {
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '');
  } catch {
    // privacy-hardened browsers hide it
  }
  return {
    ua: navigator.userAgent,
    memory: nav.deviceMemory,
    cores: navigator.hardwareConcurrency,
    gpu,
    touchFirst: window.matchMedia?.('(pointer: coarse)').matches === true,
    maxTouchPoints: navigator.maxTouchPoints,
    width: window.innerWidth,
  };
}

// ── The runtime ladder (low tier only) ──────────────────────────────────

/** Render scale a weak device boots with on 'low'. */
export const WEAK_BOOT_SCALE = 0.75;
/** Lowest render scale the ladder goes to before dropping features. */
export const MIN_SCALE = 0.6;
/**
 * A weak phone's last resort, after shadows and the ink pass are gone. Not
 * before them: 0.5 on a ~410 px wide phone is a ~205 px picture, and the
 * features cost more per pixel than the last 0.1 of scale saves.
 */
export const WEAK_LAST_SCALE = 0.5;
/** Each rung of render scale. */
export const SCALE_STEP = 0.15;

export interface LiteState {
  /** Pixel ratio the renderer uses. */
  scale: number;
  shadows: boolean;
  /** Ink outline + post (off = straight render, no composer). */
  post: boolean;
  /** Desktop: the SMAA pass (absent = as built). */
  aa?: boolean;
  /** Desktop: the sun's shadow map size in texels (absent = as built). */
  shadowMap?: number;
}

/** The next rung down, or null at the bottom. */
export function stepDown(s: LiteState): LiteState | null {
  if (s.scale > MIN_SCALE + 1e-6)
    return { ...s, scale: Math.max(MIN_SCALE, +(s.scale - SCALE_STEP).toFixed(2)) };
  if (s.shadows) return { ...s, shadows: false };
  if (s.post) return { ...s, post: false };
  return null;
}
