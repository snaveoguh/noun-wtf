// Subscribe a React component to a Surface. Returns the Surface + a THREE.CanvasTexture
// that flushes at most once per frame when the surface is dirty.

import type { Surface } from '../../core/surface.js';

import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { surfaces } from '../../core/registry.js';

export interface UseSurfaceResult {
  surface: Surface;
  texture: THREE.CanvasTexture;
}

export function useSurface(
  surfaceId: string,
  width: number,
  height: number,
  baseFill?: string,
): UseSurfaceResult {
  const surface = useMemo(() => {
    const s = surfaces.getOrCreate(surfaceId, width, height);
    // First time: fill with base color if provided.
    if (baseFill && s.getStrokes().length === 0) {
      s.ctx.fillStyle = baseFill;
      s.ctx.fillRect(0, 0, s.width, s.height);
      s.notify();
    }
    return s;
  }, [surfaceId, width, height, baseFill]);

  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(surface.canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }, [surface]);

  // Subscribe to surface notifies just so React knows something happened —
  // the actual texture flush is driven by useFrame below.
  useSyncExternalStore(
    cb => surface.subscribe(cb),
    () => (surface.dirty ? 1 : 0),
    () => 0,
  );

  useFrame(() => {
    if (surface.dirty) {
      texture.needsUpdate = true;
      surface.dirty = false;
    }
  });

  useEffect(() => {
    return () => {
      texture.dispose();
    };
  }, [texture]);

  return { surface, texture };
}
