/**
 * React hook for loading curated 3D Noun heads.
 *
 * Returns a curated GLB head if available (3DNouns → Noundry),
 * or null if none exists (caller should render its own voxel fallback).
 *
 * Usage:
 *   const { headObject, source, isLoading } = useNounHead3D(seed);
 *   if (headObject) return <primitive object={headObject} />;
 *   else return <VoxelHead />;
 */

import { useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';

import type { HeadSource, INounSeed, LoadedHead } from '@/lib/headAssets';

interface UseNounHead3DResult {
  /** The loaded curated 3D head object, or null if none available */
  headObject: THREE.Object3D | null;
  /** Which tier the head came from: '3dnouns' | 'noundry' | 'voxel' (voxel = no curated head) */
  source: HeadSource;
  /** True while loading a curated GLB */
  isLoading: boolean;
}

export function useNounHead3D(
  seed: INounSeed | null | undefined,
): UseNounHead3DResult {
  const [result, setResult] = useState<LoadedHead | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!seed) {
      setResult(null);
      return;
    }

    cancelRef.current = false;
    setIsLoading(true);

    // Dynamic import to avoid polluting the module graph
    // (headAssets imports THREE + GLTFLoader which can conflict with voxel-engine)
    import('@/lib/headAssets').then(({ loadNounHead }) => {
      if (cancelRef.current) return;
      loadNounHead(seed).then(loaded => {
        if (!cancelRef.current) {
          setResult(loaded); // null if no curated head available
        }
      }).catch(() => {
        if (!cancelRef.current) setResult(null);
      }).finally(() => {
        if (!cancelRef.current) setIsLoading(false);
      });
    }).catch(() => {
      if (!cancelRef.current) {
        setResult(null);
        setIsLoading(false);
      }
    });

    return () => {
      cancelRef.current = true;
    };
  }, [seed?.head, seed?.glasses]);

  return {
    headObject: result?.object ?? null,
    source: result?.source ?? 'voxel',
    isLoading,
  };
}
