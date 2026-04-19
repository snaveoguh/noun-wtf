// Marker: fat solid line with feathered edge, smooth path interpolation.

import type { MarkerOptions, Stroke } from '../core/types.js';

import { parseColor, rgbaCss } from '../core/math.js';
import { DEFAULT_MARKER_OPTIONS } from '../core/types.js';

export function applyMarker(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  width: number,
  height: number,
  opts: MarkerOptions = DEFAULT_MARKER_OPTIONS,
): void {
  if (stroke.points.length === 0) return;
  const [r, g, b, a] = parseColor(stroke.color);
  ctx.save();
  ctx.strokeStyle = rgbaCss(r, g, b, a * opts.opacity);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Feathered core: draw twice — a wider translucent pass + a sharp center pass.
  const widthPx = stroke.size;
  drawSmoothPath(ctx, stroke, width, height, widthPx + opts.feather * 2, () => {
    ctx.strokeStyle = rgbaCss(r, g, b, a * opts.opacity * 0.35);
  });
  drawSmoothPath(ctx, stroke, width, height, widthPx, () => {
    ctx.strokeStyle = rgbaCss(r, g, b, a * opts.opacity);
  });

  ctx.restore();
}

function drawSmoothPath(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  width: number,
  height: number,
  lineWidth: number,
  setStyle: () => void,
): void {
  ctx.lineWidth = lineWidth;
  setStyle();
  const pts = stroke.points;
  ctx.beginPath();
  const first = pts[0];
  ctx.moveTo(first.u * width, first.v * height);
  if (pts.length === 1) {
    // Degenerate — just paint a dot
    ctx.arc(first.u * width, first.v * height, lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // Quadratic smoothing through midpoints for silky strokes
  for (let i = 1; i < pts.length - 1; i++) {
    const x0 = pts[i].u * width;
    const y0 = pts[i].v * height;
    const x1 = pts[i + 1].u * width;
    const y1 = pts[i + 1].v * height;
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    ctx.quadraticCurveTo(x0, y0, mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.u * width, last.v * height);
  ctx.stroke();
}
