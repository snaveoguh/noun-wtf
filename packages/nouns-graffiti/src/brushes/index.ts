import type { BrushKind, Stroke } from '../core/types.js';

import { applyMarker } from './marker.js';
import { applySkinny } from './skinny.js';
import { applySpray } from './spray.js';

export { applySpray } from './spray.js';
export { applyMarker } from './marker.js';
export { applySkinny } from './skinny.js';

export type BrushRasterizer = (
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  width: number,
  height: number,
) => void;

export const BRUSHES: Record<BrushKind, BrushRasterizer> = {
  spray: applySpray,
  marker: applyMarker,
  skinny: applySkinny,
};

export const BRUSH_LABELS: Record<BrushKind, string> = {
  spray: 'Spray',
  marker: 'Marker',
  skinny: 'Skinny',
};
