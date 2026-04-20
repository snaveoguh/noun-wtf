// Skinny: thin precise line, no feather. For detail/outlines.

import type { SkinnyOptions, Stroke } from '../core/types.js';

import { parseColor, rgbaCss } from '../core/math.js';
import { DEFAULT_SKINNY_OPTIONS } from '../core/types.js';

export function applySkinny(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  width: number,
  height: number,
  opts: SkinnyOptions = DEFAULT_SKINNY_OPTIONS,
): void {
  if (stroke.points.length === 0) return;
  const [r, g, b, a] = parseColor(stroke.color);
  ctx.save();
  ctx.strokeStyle = rgbaCss(r, g, b, a * opts.opacity);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, stroke.size * 0.25);

  ctx.beginPath();
  const first = stroke.points[0];
  ctx.moveTo(first.u * width, first.v * height);
  if (stroke.points.length === 1) {
    ctx.arc(first.u * width, first.v * height, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  for (let i = 1; i < stroke.points.length; i++) {
    const p = stroke.points[i];
    ctx.lineTo(p.u * width, p.v * height);
  }
  ctx.stroke();
  ctx.restore();
}
