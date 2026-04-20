// Stroke primitives: id generation, point interpolation, apply-to-canvas.
// applyStroke is the cross-platform replay unit — same inputs → same pixels.

import type { BrushKind, HexColor, Stroke } from './types.js';

import { applyMarker } from '../brushes/marker.js';
import { applySkinny } from '../brushes/skinny.js';
import { applySpray } from '../brushes/spray.js';

/** Cheap unique id; not cryptographic. */
export function makeStrokeId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function newStroke(params: {
  surfaceId: string;
  brush: BrushKind;
  color: HexColor;
  size: number;
  authorId?: string;
}): Stroke {
  return {
    id: makeStrokeId(),
    surfaceId: params.surfaceId,
    brush: params.brush,
    color: params.color,
    size: params.size,
    points: [],
    authorId: params.authorId,
    startedAt: Date.now(),
  };
}

/**
 * Replay an entire stroke against a canvas context.
 * Rasterization is deterministic-ish (brushes use a seeded RNG from point t),
 * so replay on any platform with the same canvas size produces the same image.
 */
export function applyStroke(
  stroke: Stroke,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  if (stroke.points.length === 0) return;
  switch (stroke.brush) {
    case 'spray':
      applySpray(ctx, stroke, width, height);
      break;
    case 'marker':
      applyMarker(ctx, stroke, width, height);
      break;
    case 'skinny':
      applySkinny(ctx, stroke, width, height);
      break;
  }
}

/**
 * Apply an incremental point segment against a live canvas (between two points)
 * while the user is drawing. Uses the same brush impls as replay but only for
 * the new tail.
 */
export function applyStrokeTail(
  stroke: Stroke,
  prevIdx: number,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  if (prevIdx >= stroke.points.length - 1) return;
  const tail: Stroke = {
    ...stroke,
    points: stroke.points.slice(Math.max(0, prevIdx)),
  };
  applyStroke(tail, ctx, width, height);
}
