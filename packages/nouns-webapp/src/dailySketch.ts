import { useCallback, useEffect, useMemo, useState } from 'react';

export interface DailySketchConfig {
  /** The Noun ID this sketch is for */
  nounId: number;
  /** URL to the GIF (Farcaster CDN or local /sketches/ path) */
  gifUrl: string;
  /** Artist credit */
  artist: string;
  /** Mint price in ETH */
  mintPrice: string;
  /** Whether minting is live (contract deployed + connected) */
  mintEnabled: boolean;
  /** Optional: contract address for the sketch NFT mint */
  mintContract?: string;
  /** Optional: Farcaster cast hash for "View on Warpcast" link */
  castHash?: string;
}

/**
 * Registry of all sketches, keyed by nounId.
 * Add new entries here each day.
 */
const SKETCH_REGISTRY: Record<number, DailySketchConfig> = {
  1822: {
    nounId: 1822,
    gifUrl: '/sketches/1822.gif',
    artist: 'pip',
    mintPrice: '0.01',
    mintEnabled: false,
  },
  1823: {
    nounId: 1823,
    gifUrl: '/sketches/1823.gif',
    artist: 'pip',
    mintPrice: '0.01',
    mintEnabled: false,
  },
  1824: {
    nounId: 1824,
    gifUrl: '/sketches/1824.gif',
    artist: 'pip',
    mintPrice: '0.01',
    mintEnabled: false,
  },
};

const EMPTY_SKETCH: DailySketchConfig = {
  nounId: 0,
  gifUrl: '',
  artist: 'pip',
  mintPrice: '0.01',
  mintEnabled: false,
};

const API_URL =
  import.meta.env.VITE_API_URL ||
  'https://spirited-flexibility-production-3c30.up.railway.app';

const REFETCH_INTERVAL = 5 * 60_000; // 5 minutes

/**
 * Returns the sketch for a specific nounId.
 * Checks the local registry first, then the API for the latest from @pip's casts.
 */
export function useSketchForNoun(nounId: number): {
  sketch: DailySketchConfig;
  isLoading: boolean;
} {
  // Check static registry first
  const registrySketch = SKETCH_REGISTRY[nounId];

  const [apiSketch, setApiSketch] = useState<DailySketchConfig | null>(null);
  const [isLoading, setIsLoading] = useState(!registrySketch);

  const fetchSketch = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/sketch/latest`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.nounId && data.nounId > 0) {
        setApiSketch({
          nounId: data.nounId,
          gifUrl: data.gifUrl,
          artist: data.artist || 'pip',
          mintPrice: data.mintPrice || '0.01',
          mintEnabled: Boolean(data.mintEnabled),
          mintContract: data.mintContract || undefined,
          castHash: data.castHash || undefined,
        });
      }
    } catch {
      // Keep whatever we have
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Only fetch from API if we don't have a registry entry
    if (!registrySketch) {
      fetchSketch();
      const interval = setInterval(fetchSketch, REFETCH_INTERVAL);
      return () => clearInterval(interval);
    } else {
      setIsLoading(false);
    }
  }, [fetchSketch, registrySketch]);

  const sketch = useMemo(() => {
    // Registry entry for this exact noun takes priority
    if (registrySketch) return registrySketch;
    // API sketch if it matches this nounId
    if (apiSketch && apiSketch.nounId === nounId) return apiSketch;
    // No sketch for this noun
    return EMPTY_SKETCH;
  }, [registrySketch, apiSketch, nounId]);

  return { sketch, isLoading };
}

/** @deprecated Use useSketchForNoun(nounId) hook instead */
export function useDailySketch(): { sketch: DailySketchConfig; isLoading: boolean } {
  return useSketchForNoun(0);
}

/** @deprecated Use useSketchForNoun(nounId) hook instead */
export const dailySketch = EMPTY_SKETCH;
