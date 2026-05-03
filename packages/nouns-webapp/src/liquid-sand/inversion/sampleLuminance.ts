/**
 * Liquid Sand UI — Approach 2 (sampling): measure the luminance of the
 * background sitting directly behind a DOM element, then return a label
 * + numeric value that consumers can use to swap colors.
 *
 * The expensive way to do this is full-DOM screenshot (html2canvas, etc.).
 * We deliberately avoid that. Instead we walk up the ancestor chain and
 * read the *first* ancestor with a non-transparent background. If it's a
 * solid color or gradient we parse the CSS string. If it's an image we
 * paint a 16×16 thumbnail to an offscreen canvas, sample the pixel under
 * the element's center, and compute luminance from the RGB.
 *
 * This is the cheap approximation. It misses things like videos, sibling
 * elements that paint behind the target, or deeply layered translucent
 * surfaces. Good enough for dock icons over a wallpaper.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';

// ─── Public types ───────────────────────────────────────────────────────────

export type LuminanceBucket = 'dark' | 'mid' | 'light';

export interface LuminanceSample {
  /** Bucketed label for `data-bg-luminance` / class swaps. */
  bucket: LuminanceBucket;
  /** 0..1 relative luminance (sRGB → linear → ITU-R BT.709 weights). */
  value: number;
  /** True if we hit a sampling failure (cross-origin image, no canvas). */
  fallback: boolean;
}

export interface UseBackgroundLuminanceOptions {
  /**
   * Where to put the bucket boundaries. Tuned so pure middle gray (#808080,
   * ~0.21 linear) lands in `mid`. Override if your wallpapers run hot/cold.
   */
  thresholds?: { dark: number; light: number };
  /** Override the default sample point (element center). 0..1 in element space. */
  samplePoint?: { x: number; y: number };
  /** If `false`, the hook never re-samples on scroll. Defaults to `true`. */
  resampleOnScroll?: boolean;
}

const DEFAULT_THRESHOLDS = { dark: 0.18, light: 0.55 };
const DEFAULT_SAMPLE_POINT = { x: 0.5, y: 0.5 };
const DEFAULT_SAMPLE: LuminanceSample = {
  bucket: 'mid',
  value: 0.5,
  fallback: true,
};

// ─── Color → luminance helpers ──────────────────────────────────────────────

/** sRGB component (0..1) to linear-light. */
function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** ITU-R BT.709 luminance from 0..255 sRGB ints. */
export function rgbToLuminance(r: number, g: number, b: number): number {
  return (
    0.2126 * srgbToLinear(r) +
    0.7152 * srgbToLinear(g) +
    0.0722 * srgbToLinear(b)
  );
}

export function bucketize(
  value: number,
  thresholds: { dark: number; light: number } = DEFAULT_THRESHOLDS,
): LuminanceBucket {
  if (value <= thresholds.dark) return 'dark';
  if (value >= thresholds.light) return 'light';
  return 'mid';
}

// ─── CSS color parsing (tiny, intentionally not exhaustive) ─────────────────

interface ParsedColor {
  r: number;
  g: number;
  b: number;
  /** 0..1; treat <=0 as fully transparent (skip). */
  a: number;
}

const HEX_SHORT = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/i;
const HEX_LONG =
  /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i;
const RGB_FN = /^rgba?\(\s*([^)]+)\)$/i;

function parseColor(input: string): ParsedColor | null {
  const s = input.trim().toLowerCase();
  if (!s || s === 'transparent') return null;

  const short = HEX_SHORT.exec(s);
  if (short) {
    const r = parseInt(short[1] + short[1], 16);
    const g = parseInt(short[2] + short[2], 16);
    const b = parseInt(short[3] + short[3], 16);
    const a = short[4] ? parseInt(short[4] + short[4], 16) / 255 : 1;
    return { r, g, b, a };
  }

  const long = HEX_LONG.exec(s);
  if (long) {
    return {
      r: parseInt(long[1], 16),
      g: parseInt(long[2], 16),
      b: parseInt(long[3], 16),
      a: long[4] ? parseInt(long[4], 16) / 255 : 1,
    };
  }

  const rgb = RGB_FN.exec(s);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length >= 3) {
      const r = parseChannel(parts[0]);
      const g = parseChannel(parts[1]);
      const b = parseChannel(parts[2]);
      const a = parts[3] !== undefined ? parseAlpha(parts[3]) : 1;
      if (r !== null && g !== null && b !== null && a !== null) {
        return { r, g, b, a };
      }
    }
  }

  return null;
}

function parseChannel(raw: string): number | null {
  const v = raw.trim();
  if (v.endsWith('%')) {
    const pct = parseFloat(v.slice(0, -1));
    return Number.isFinite(pct) ? Math.max(0, Math.min(255, (pct / 100) * 255)) : null;
  }
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(255, n)) : null;
}

function parseAlpha(raw: string): number | null {
  const v = raw.trim();
  if (v.endsWith('%')) {
    const pct = parseFloat(v.slice(0, -1));
    return Number.isFinite(pct) ? Math.max(0, Math.min(1, pct / 100)) : null;
  }
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
}

// ─── Background extraction from a single element ────────────────────────────

interface SourceBackground {
  kind: 'color' | 'gradient' | 'image' | 'none';
  /** For `color` and `gradient`, the raw CSS string. For `image`, a URL. */
  raw: string;
  element: Element;
}

function readBackground(el: Element): SourceBackground {
  const cs = window.getComputedStyle(el);
  const bgImage = cs.backgroundImage;
  const bgColor = cs.backgroundColor;

  if (bgImage && bgImage !== 'none') {
    const urlMatch = /url\((['"]?)(.*?)\1\)/i.exec(bgImage);
    if (urlMatch) {
      return { kind: 'image', raw: urlMatch[2], element: el };
    }
    if (/gradient\(/i.test(bgImage)) {
      return { kind: 'gradient', raw: bgImage, element: el };
    }
  }

  const parsed = parseColor(bgColor);
  if (parsed && parsed.a > 0) {
    return { kind: 'color', raw: bgColor, element: el };
  }

  return { kind: 'none', raw: '', element: el };
}

/** Walk up from `target` to find the first opaque-ish background. */
function findBackgroundSource(target: Element): SourceBackground {
  let node: Element | null = target.parentElement;
  while (node) {
    const bg = readBackground(node);
    if (bg.kind !== 'none') return bg;
    node = node.parentElement;
  }
  // Fall back to body / html.
  const body = document.body;
  if (body) {
    const bg = readBackground(body);
    if (bg.kind !== 'none') return bg;
  }
  return { kind: 'color', raw: 'rgb(255, 255, 255)', element: body };
}

// ─── Luminance from a gradient string (cheap: average all parsed stops) ─────

function luminanceFromGradient(raw: string): number | null {
  // Strip the function name + parens, then pull out anything that looks
  // like a color token. Don't try to be fancy with positions — if there
  // are 3 colors in the gradient, the average of all 3 is a reasonable
  // approximation of "what's behind the icon" for our purposes.
  const inner = raw.replace(/^[a-z-]+gradient\(/i, '').replace(/\)$/, '');
  const tokens = inner.split(/,(?![^(]*\))/);
  const lums: number[] = [];
  for (const tok of tokens) {
    // A stop looks like "rgba(...) 30%" or "#fff 0%" — take the first chunk.
    const colorPart = tok.trim().split(/\s+(?=[\d.]+(%|px|em|rem|deg)?$)/)[0];
    const c = parseColor(colorPart.trim());
    if (c && c.a > 0) {
      lums.push(rgbToLuminance(c.r, c.g, c.b));
    }
  }
  if (lums.length === 0) return null;
  return lums.reduce((a, b) => a + b, 0) / lums.length;
}

// ─── Luminance from a background image (canvas pixel sample) ────────────────

const imageLumCache = new Map<string, number | 'failed'>();

async function luminanceFromImage(url: string): Promise<number | null> {
  const cached = imageLumCache.get(url);
  if (cached === 'failed') return null;
  if (typeof cached === 'number') return cached;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          imageLumCache.set(url, 'failed');
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, 16, 16);
        // Average the entire 16x16 — we don't need pixel-perfect alignment,
        // and the wallpaper's overall feel is what matters for dock icons.
        const data = ctx.getImageData(0, 0, 16, 16).data;
        let sum = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          sum += rgbToLuminance(data[i], data[i + 1], data[i + 2]);
          count += 1;
        }
        const avg = count > 0 ? sum / count : null;
        if (avg !== null) imageLumCache.set(url, avg);
        else imageLumCache.set(url, 'failed');
        resolve(avg);
      } catch {
        // Cross-origin taint: getImageData throws SecurityError.
        imageLumCache.set(url, 'failed');
        resolve(null);
      }
    };
    img.onerror = () => {
      imageLumCache.set(url, 'failed');
      resolve(null);
    };
    img.src = url;
  });
}

// ─── The one-shot sampling function (no React) ──────────────────────────────

export async function sampleBackgroundLuminance(
  el: Element,
  options: UseBackgroundLuminanceOptions = {},
): Promise<LuminanceSample> {
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  void (options.samplePoint ?? DEFAULT_SAMPLE_POINT); // reserved for future per-pixel sampling

  const source = findBackgroundSource(el);

  if (source.kind === 'color') {
    const c = parseColor(source.raw);
    if (c) {
      const value = rgbToLuminance(c.r, c.g, c.b);
      return { value, bucket: bucketize(value, thresholds), fallback: false };
    }
  }

  if (source.kind === 'gradient') {
    const value = luminanceFromGradient(source.raw);
    if (value !== null) {
      return { value, bucket: bucketize(value, thresholds), fallback: false };
    }
  }

  if (source.kind === 'image') {
    const value = await luminanceFromImage(source.raw);
    if (value !== null) {
      return { value, bucket: bucketize(value, thresholds), fallback: false };
    }
  }

  return DEFAULT_SAMPLE;
}

// ─── React hook: subscribes to scroll/resize and re-samples ─────────────────

export function useBackgroundLuminance(
  ref: RefObject<Element | null>,
  options: UseBackgroundLuminanceOptions = {},
): LuminanceSample {
  const [sample, setSample] = useState<LuminanceSample>(DEFAULT_SAMPLE);
  const rafRef = useRef<number | null>(null);
  const cancelRef = useRef(false);

  // Stable serialized options so the effect doesn't re-fire on object identity changes.
  const serialized = JSON.stringify(options);

  const run = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = ref.current;
      if (!el) return;
      sampleBackgroundLuminance(el, options).then((next) => {
        if (cancelRef.current) return;
        setSample((prev) =>
          prev.value === next.value &&
          prev.bucket === next.bucket &&
          prev.fallback === next.fallback
            ? prev
            : next,
        );
      });
    });
    // We intentionally include `options` via `serialized` below, not the
    // raw object, to avoid re-creating the rAF callback every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, serialized]);

  useEffect(() => {
    cancelRef.current = false;
    if (typeof window === 'undefined') return;
    run();

    const resampleOnScroll = options.resampleOnScroll ?? true;
    const onScroll = () => run();
    const onResize = () => run();

    if (resampleOnScroll) {
      window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    }
    window.addEventListener('resize', onResize);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && ref.current) {
      ro = new ResizeObserver(() => run());
      ro.observe(ref.current);
    }

    return () => {
      cancelRef.current = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (resampleOnScroll) {
        window.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
      }
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, serialized, run]);

  return sample;
}
