// Shared math + color helpers for brushes and stroke replay.
// No DOM, no Three.js — safe to import anywhere.

import type { StrokePoint } from './types.js';

/** Uniformly sample between two points if they're too far apart. */
export function interpolatePoints(
  a: StrokePoint,
  b: StrokePoint,
  maxStepPx: number,
  width: number,
  height: number,
): StrokePoint[] {
  const ax = a.u * width;
  const ay = a.v * height;
  const bx = b.u * width;
  const by = b.v * height;
  const d = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(d / maxStepPx));
  if (steps === 1) return [b];
  const out: StrokePoint[] = [];
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    out.push({
      u: a.u + (b.u - a.u) * k,
      v: a.v + (b.v - a.v) * k,
      pressure: a.pressure + (b.pressure - a.pressure) * k,
      t: a.t + (b.t - a.t) * k,
    });
  }
  return out;
}

/** Parse a hex color into rgba tuple [0..1]. Accepts #rgb, #rrggbb, #rrggbbaa. */
export function parseColor(hex: string): [number, number, number, number] {
  let s = hex.trim();
  if (s.startsWith('#')) s = s.slice(1);
  if (s.length === 3)
    s = s
      .split('')
      .map(c => c + c)
      .join('');
  if (s.length === 6) s += 'ff';
  if (s.length !== 8) return [1, 1, 1, 1];
  const r = parseInt(s.slice(0, 2), 16) / 255;
  const g = parseInt(s.slice(2, 4), 16) / 255;
  const b = parseInt(s.slice(4, 6), 16) / 255;
  const a = parseInt(s.slice(6, 8), 16) / 255;
  return [r, g, b, a];
}

/** Format rgba tuple to 'rgba(r,g,b,a)' css string. */
export function rgbaCss(r: number, g: number, b: number, a: number): string {
  const ri = Math.round(r * 255);
  const gi = Math.round(g * 255);
  const bi = Math.round(b * 255);
  return `rgba(${ri},${gi},${bi},${a.toFixed(3)})`;
}

/** Small deterministic PRNG; brush droplets use it seeded from stroke id. */
export function mulberry32(seed: number): () => number {
  let a = Math.imul(seed | 0, 0x9e3779b1) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
