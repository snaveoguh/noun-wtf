// Spray brush: radial gaussian droplets + drip-on-hold.
// Pure function on a 2D context; Swift can mirror this with Core Graphics.

import type { SprayOptions, Stroke, StrokePoint } from '../core/types.js';

import { interpolatePoints, mulberry32, parseColor, rgbaCss } from '../core/math.js';
import { DEFAULT_SPRAY_OPTIONS } from '../core/types.js';

const TWO_PI = Math.PI * 2;

/** Apply a whole stroke (for replay). */
export function applySpray(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  width: number,
  height: number,
  opts: SprayOptions = DEFAULT_SPRAY_OPTIONS,
): void {
  const rng = mulberry32(hashStr(stroke.id));
  // Resample points so gaps are filled with dense emissions.
  const samples: StrokePoint[] = [stroke.points[0]];
  const maxStep = Math.max(2, stroke.size * 0.35);
  for (let i = 1; i < stroke.points.length; i++) {
    const interp = interpolatePoints(
      stroke.points[i - 1],
      stroke.points[i],
      maxStep,
      width,
      height,
    );
    for (const p of interp) samples.push(p);
  }

  // Emit droplets along the resampled path.
  for (const p of samples) {
    emitDroplets(ctx, p, stroke.color, stroke.size, opts, rng, width, height);
  }

  // Drips: look for "held" stretches where consecutive points stay within 1px for >dripAfterMs.
  emitDrips(ctx, stroke, opts, rng, width, height);
}

function emitDroplets(
  ctx: CanvasRenderingContext2D,
  p: StrokePoint,
  color: string,
  sizePx: number,
  opts: SprayOptions,
  rng: () => number,
  width: number,
  height: number,
): void {
  const cx = p.u * width;
  const cy = p.v * height;
  const radius = sizePx * (0.5 + 0.5 * p.pressure);
  const n = Math.max(3, Math.round(opts.densityPerTick * p.pressure));
  const [r, g, b, a] = parseColor(color);

  for (let i = 0; i < n; i++) {
    // Gaussian-ish radius: rejection sampling on (0..1) biased toward center.
    // Equivalent to radius = r_max * |N(0, 1)| clamped, but done cheaply.
    const u1 = rng();
    const u2 = rng();
    // Box-Muller for a genuinely normal sample
    const z = Math.sqrt(-2 * Math.log(u1 || 1e-6)) * Math.cos(TWO_PI * u2);
    const sigma = radius * (1 - opts.hardness * 0.6);
    const dist = Math.min(radius, Math.abs(z) * sigma);
    const ang = rng() * TWO_PI;
    const x = cx + Math.cos(ang) * dist;
    const y = cy + Math.sin(ang) * dist;
    // Alpha falls off smoothly with distance from center.
    const falloff = Math.max(0, 1 - dist / radius);
    const alpha = a * (0.15 + falloff * 0.6) * p.pressure;
    const dropR = 0.4 + rng() * opts.dropletMax;
    ctx.fillStyle = rgbaCss(r, g, b, alpha);
    ctx.beginPath();
    ctx.arc(x, y, dropR, 0, TWO_PI);
    ctx.fill();
  }
}

/**
 * Spawn vertical drip streaks from points where the sprayer lingered.
 * Heuristic: any stretch of points where the cursor moved <1px for >dripAfterMs.
 */
function emitDrips(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  opts: SprayOptions,
  rng: () => number,
  width: number,
  height: number,
): void {
  const pts = stroke.points;
  if (pts.length < 2) return;
  const [r, g, b, a] = parseColor(stroke.color);
  let lingerStart = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = (pts[i].u - pts[lingerStart].u) * width;
    const dy = (pts[i].v - pts[lingerStart].v) * height;
    const moved = Math.hypot(dx, dy);
    const dt = pts[i].t - pts[lingerStart].t;
    if (moved > 1.5) {
      lingerStart = i;
      continue;
    }
    if (dt < opts.dripAfterMs) continue;
    // We've lingered long enough — spawn drips.
    const intensity = Math.min(1, (dt - opts.dripAfterMs) / 800);
    const streaks = Math.max(1, Math.round(opts.dripStreaks * intensity));
    const cx = pts[i].u * width;
    const cy = pts[i].v * height;
    const rad = stroke.size * 0.5;
    for (let s = 0; s < streaks; s++) {
      const startX = cx + (rng() - 0.5) * rad * 1.2;
      const startY = cy + rad * 0.3;
      // Drip grows with intensity
      const length = rad * (0.6 + rng() * 1.4) * (1 + intensity);
      ctx.strokeStyle = rgbaCss(r, g, b, a * 0.75);
      ctx.lineWidth = Math.max(1, stroke.size * 0.08);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      // Slight sway
      const midX = startX + (rng() - 0.5) * 1.5;
      const midY = startY + length * 0.5;
      ctx.quadraticCurveTo(midX, midY, startX + (rng() - 0.5) * 2, startY + length);
      ctx.stroke();
      // Bead at the tip
      ctx.fillStyle = rgbaCss(r, g, b, a * 0.9);
      ctx.beginPath();
      ctx.arc(startX, startY + length, Math.max(1, stroke.size * 0.09), 0, TWO_PI);
      ctx.fill();
    }
    lingerStart = i; // reset so we don't spawn every frame
  }
  // opts.tickMs / opts.dripSpeed are used by live-paint for incremental animation;
  // during replay we bake them into the streak length above.
  void opts.tickMs;
  void opts.dripSpeed;
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
