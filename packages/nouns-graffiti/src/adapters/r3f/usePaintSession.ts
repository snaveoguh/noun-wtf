// React hook bridging the global paintSession store.
// Exposes brush/color/size state + stroke lifecycle helpers.

import type { BrushKind, HexColor, Stroke, StrokePoint } from '../../core/types.js';

import { useCallback, useRef, useSyncExternalStore } from 'react';

import { BRUSHES } from '../../brushes/index.js';
import { surfaces } from '../../core/registry.js';
import { paintSession } from '../../core/store.js';
import { applyStrokeTail, newStroke } from '../../core/stroke.js';

export interface PaintSessionHook {
  brush: BrushKind;
  color: HexColor;
  size: number;
  activeSurfaceId: string | null;
  setBrush(b: BrushKind): void;
  setColor(c: HexColor): void;
  setSize(n: number): void;
  setActive(id: string | null): void;
  /** Begin a stroke on the active surface. Returns the in-progress Stroke. */
  startStroke(params: { surfaceId: string; authorId?: string }): Stroke | null;
  /** Push a new point; incrementally rasterizes the tail. */
  addPoint(point: Omit<StrokePoint, 't'> & Partial<Pick<StrokePoint, 't'>>): void;
  /** End the current stroke; returns the completed Stroke (for persistence). */
  endStroke(): Stroke | null;
  /** Currently-painting stroke id, or null. */
  currentStrokeId: string | null;
}

export function usePaintSession(): PaintSessionHook {
  const state = useSyncExternalStore(
    cb => paintSession.subscribe(cb as () => void),
    () => paintSession.get(),
    () => paintSession.get(),
  );

  const inProgress = useRef<{ stroke: Stroke; lastRasterIdx: number } | null>(null);

  const startStroke = useCallback<PaintSessionHook['startStroke']>(
    ({ surfaceId, authorId }) => {
      const s = surfaces.get(surfaceId);
      if (!s) return null;
      const stroke = newStroke({
        surfaceId,
        brush: state.brush,
        color: state.color,
        size: state.size,
        authorId,
      });
      inProgress.current = { stroke, lastRasterIdx: 0 };
      return stroke;
    },
    [state.brush, state.color, state.size],
  );

  const addPoint = useCallback<PaintSessionHook['addPoint']>(point => {
    const ip = inProgress.current;
    if (!ip) return;
    const p: StrokePoint = {
      u: point.u,
      v: point.v,
      pressure: point.pressure ?? 1,
      t: point.t ?? Date.now() - ip.stroke.startedAt,
    };
    ip.stroke.points.push(p);
    const surface = surfaces.get(ip.stroke.surfaceId);
    if (!surface) return;
    // Paint incrementally. For spray we resample during replay so partial paints look right.
    // Use the "tail" variant which uses the same math as full replay.
    const rasterize = BRUSHES[ip.stroke.brush];
    if (ip.stroke.brush === 'spray') {
      // Spray: repaint only the most recent segment (interpolated inside applySpray).
      applyStrokeTail(
        ip.stroke,
        Math.max(0, ip.lastRasterIdx - 1),
        surface.ctx,
        surface.width,
        surface.height,
      );
    } else {
      // Marker/skinny: cheaper to repaint full path each point (bezier smoothing stays continuous).
      rasterize(surface.ctx, ip.stroke, surface.width, surface.height);
    }
    ip.lastRasterIdx = ip.stroke.points.length - 1;
    surface.notify();
  }, []);

  const endStroke = useCallback<PaintSessionHook['endStroke']>(() => {
    const ip = inProgress.current;
    if (!ip) return null;
    const surface = surfaces.get(ip.stroke.surfaceId);
    if (surface) {
      // Final rerasterize so drips + end-of-stroke effects are clean.
      const rasterize = BRUSHES[ip.stroke.brush];
      rasterize(surface.ctx, ip.stroke, surface.width, surface.height);
      surface.recordStroke(ip.stroke);
      surface.notify();
    }
    const done = ip.stroke;
    inProgress.current = null;
    return done;
  }, []);

  return {
    brush: state.brush,
    color: state.color,
    size: state.size,
    activeSurfaceId: state.activeSurfaceId,
    setBrush: paintSession.setBrush.bind(paintSession),
    setColor: paintSession.setColor.bind(paintSession),
    setSize: paintSession.setSize.bind(paintSession),
    setActive: paintSession.setActive.bind(paintSession),
    startStroke,
    addPoint,
    endStroke,
    currentStrokeId: inProgress.current?.stroke.id ?? null,
  };
}
