// <Paintable /> — a paintable plane registered as a Surface.
// Handles pointer events, converts to UV, and drives a stroke on the paint session.

import type { StrokePoint } from '../../core/types.js';
import type { ThreeEvent } from '@react-three/fiber';

import { useCallback, useEffect, useMemo, useRef } from 'react';

import * as THREE from 'three';

import { usePaintSession } from './usePaintSession.js';
import { useSurface } from './useSurface.js';

export interface PaintableProps {
  surfaceId: string;
  /** Plane dimensions in world units. */
  width: number;
  height: number;
  /** Texture pixel resolution. 1024x512 for wide, 512x512 for square. */
  resolutionWidth?: number;
  resolutionHeight?: number;
  /** Initial fill color if the surface is new. */
  baseFill?: string;
  /** Optional: only enable painting when this flag is true (UI can gate). */
  enabled?: boolean;
  /** Fires when a stroke is finished — consume for network broadcast. */
  onStrokeEnd?: (strokeId: string) => void;
  /** Fires when painter begins a stroke — consume to lock camera etc. */
  onStrokeStart?: () => void;
  /** World-space position + rotation passthrough. */
  position?: [number, number, number];
  rotation?: [number, number, number];
  /** Optional author id threaded into the stroke (wallet / player id). */
  authorId?: string;
  /** side for MeshStandardMaterial */
  side?: THREE.Side;
  /** border color behind (defaults to wall-grey). Set to null to omit frame. */
  frameColor?: string | null;
  /** frame padding (world units) */
  framePad?: number;
}

/**
 * Surface-wrapping paint component. Registers with the global surface registry
 * under `surfaceId`. Call <Paintable /> wherever you want a sprayable wall.
 */
export function Paintable(props: PaintableProps) {
  const {
    surfaceId,
    width,
    height,
    resolutionWidth,
    resolutionHeight,
    baseFill = '#d4cfc4',
    enabled = true,
    onStrokeEnd,
    onStrokeStart,
    position = [0, 0, 0],
    rotation = [0, 0, 0],
    authorId,
    side = THREE.DoubleSide,
    frameColor = '#9a9488',
    framePad = 0.15,
  } = props;

  // Default resolution: wide if the plane is wide.
  const [texW, texH] = useMemo<[number, number]>(() => {
    if (resolutionWidth && resolutionHeight) return [resolutionWidth, resolutionHeight];
    const aspect = width / height;
    if (aspect > 1.4) return [1024, 512];
    if (aspect < 0.7) return [512, 1024];
    return [512, 512];
  }, [width, height, resolutionWidth, resolutionHeight]);

  const { texture } = useSurface(surfaceId, texW, texH, baseFill);
  const session = usePaintSession();
  const paintingRef = useRef(false);

  // Cleanup on unmount — flush last stroke if still going.
  useEffect(() => {
    return () => {
      if (paintingRef.current) {
        session.endStroke();
        paintingRef.current = false;
      }
    };
  }, [session]);

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!enabled) return;
      if (!e.uv) return;
      e.stopPropagation();
      // Try to capture the pointer on the underlying DOM element for smoother drags.
      const el = e.nativeEvent.target as Element | null;
      if (
        el &&
        typeof (el as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture ===
          'function'
      ) {
        try {
          (el as Element & { setPointerCapture: (id: number) => void }).setPointerCapture(
            e.pointerId,
          );
        } catch {
          // no-op; some browsers throw if already captured
        }
      }
      session.setActive(surfaceId);
      const stroke = session.startStroke({ surfaceId, authorId });
      if (!stroke) return;
      paintingRef.current = true;
      onStrokeStart?.();
      const p: Omit<StrokePoint, 't'> = {
        u: e.uv.x,
        v: 1 - e.uv.y,
        pressure: readPressure(e.nativeEvent),
      };
      session.addPoint(p);
    },
    [enabled, onStrokeStart, session, surfaceId, authorId],
  );

  const onPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!paintingRef.current) return;
      if (!e.uv) return;
      session.addPoint({
        u: e.uv.x,
        v: 1 - e.uv.y,
        pressure: readPressure(e.nativeEvent),
      });
    },
    [session],
  );

  const onPointerUp = useCallback(() => {
    if (!paintingRef.current) return;
    paintingRef.current = false;
    const done = session.endStroke();
    if (done) onStrokeEnd?.(done.id);
  }, [onStrokeEnd, session]);

  return (
    <group position={position} rotation={rotation}>
      {frameColor && (
        <mesh position={[0, 0, -0.02]}>
          <planeGeometry args={[width + framePad, height + framePad]} />
          <meshStandardMaterial color={frameColor} roughness={1} metalness={0} side={side} />
        </mesh>
      )}
      <mesh
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial
          map={texture}
          color={'#ffffff'}
          roughness={0.92}
          metalness={0.02}
          side={side}
          transparent={false}
        />
      </mesh>
    </group>
  );
}

function readPressure(e: PointerEvent | MouseEvent | TouchEvent): number {
  const maybePressure = (e as PointerEvent).pressure;
  if (typeof maybePressure === 'number' && maybePressure > 0) return Math.min(1, maybePressure);
  return 1;
}
