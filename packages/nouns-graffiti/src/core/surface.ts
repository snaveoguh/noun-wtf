// Surface — a paintable texture backed by an HTMLCanvasElement.
// The canvas is the single source of truth for pixels; strokes are composited
// on top (alpha-blended) so prior tags are preserved.

import type { Stroke } from './types.js';

export interface SurfaceInit {
  id: string;
  width: number;
  height: number;
}

type Listener = () => void;

export class Surface {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;

  /** All strokes applied to this surface, in order. Used for undo + replay. */
  private readonly strokes: Stroke[] = [];
  /** Baseline PNG data URL (from server snapshot) to restore on undo/replay. */
  private baseline: string | null = null;

  /** Dirty flag flipped by paint ops, cleared by the consumer (e.g. r3f useFrame). */
  dirty = true;

  private readonly listeners = new Set<Listener>();

  constructor(init: SurfaceInit) {
    this.id = init.id;
    this.width = init.width;
    this.height = init.height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = init.width;
    this.canvas.height = init.height;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) throw new Error(`Surface ${init.id}: could not acquire 2D context`);
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = true;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Call after any paint op. Sets dirty and notifies subscribers. */
  notify(): void {
    this.dirty = true;
    for (const fn of this.listeners) fn();
  }

  /** Push a completed stroke to the history stack. Caller already painted it. */
  recordStroke(stroke: Stroke): void {
    this.strokes.push(stroke);
  }

  getStrokes(): readonly Stroke[] {
    return this.strokes;
  }

  /** Remove last stroke and re-rasterize from baseline + remaining strokes. */
  async undoLast(
    rasterize: (s: Stroke, ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  ): Promise<void> {
    if (this.strokes.length === 0) return;
    this.strokes.pop();
    await this.restoreFromHistory(rasterize);
  }

  async restoreFromHistory(
    rasterize: (s: Stroke, ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  ): Promise<void> {
    // 1. Clear
    this.ctx.clearRect(0, 0, this.width, this.height);
    // 2. Draw baseline if any
    if (this.baseline) {
      await this.drawBaseline();
    }
    // 3. Replay strokes
    for (const s of this.strokes) rasterize(s, this.ctx, this.width, this.height);
    this.notify();
  }

  clear(): void {
    this.strokes.length = 0;
    this.baseline = null;
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.notify();
  }

  /** Set the baseline from a PNG (server snapshot). Draws it and keeps strokes on top. */
  async applyBaseline(pngDataUrl: string): Promise<void> {
    this.baseline = pngDataUrl;
    await this.drawBaseline();
    this.notify();
  }

  private async drawBaseline(): Promise<void> {
    if (!this.baseline) return;
    const img = await loadImage(this.baseline);
    this.ctx.drawImage(img, 0, 0, this.width, this.height);
  }

  /** Export current canvas as PNG data URL (for snapshot upload). */
  toPng(): string {
    return this.canvas.toDataURL('image/png');
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
