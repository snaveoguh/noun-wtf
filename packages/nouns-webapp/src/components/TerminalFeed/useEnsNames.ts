import { useCallback, useEffect, useRef, useState } from 'react';

import { stripNoggles } from '@/utils/addressAndENSDisplayUtils';

const API_BASE = import.meta.env.VITE_MAINNET_SUBGRAPH
  || 'https://spirited-flexibility-production-3c30.up.railway.app';

// Module-level cache shared across all hook instances
const ensNameCache = new Map<string, string | null>();
const pendingAddresses = new Set<string>();
let batchTimer: ReturnType<typeof setTimeout> | null = null;
let subscribers: Array<() => void> = [];

function notifySubscribers() {
  for (const cb of subscribers) cb();
}

async function resolveBatch() {
  const addrs = Array.from(pendingAddresses).slice(0, 50);
  pendingAddresses.clear();
  batchTimer = null;

  if (addrs.length === 0) return;

  try {
    const res = await fetch(`${API_BASE}/api/ens?addresses=${addrs.join(',')}`);
    if (!res.ok) return;
    const { names } = await res.json() as { names: Record<string, string | null> };

    for (const [addr, name] of Object.entries(names)) {
      // Strip `.noggles` namespace so the terminal feed never surfaces it.
      const cleaned = name ? stripNoggles(name) || null : null;
      ensNameCache.set(addr.toLowerCase(), cleaned);
    }
    notifySubscribers();
  } catch {
    // silent — addresses stay unresolved, will retry next batch
  }
}

function requestResolution(addr: string) {
  const key = addr.toLowerCase();
  if (ensNameCache.has(key) || pendingAddresses.has(key)) return;
  pendingAddresses.add(key);

  // Debounce batch requests (wait 300ms to collect more addresses)
  if (!batchTimer) {
    batchTimer = setTimeout(resolveBatch, 300);
  }
}

/**
 * Hook that resolves ENS names for addresses seen in the feed.
 * Returns a lookup function that:
 * - Returns the ENS name if resolved
 * - Returns null if not resolved yet (triggers resolution)
 * - All instances share a module-level cache
 */
export function useEnsNames(addresses: string[]): (addr: string) => string | null {
  const [, setTick] = useState(0);
  const tickRef = useRef(0);

  // Subscribe to cache updates
  useEffect(() => {
    const cb = () => {
      tickRef.current++;
      setTick(tickRef.current);
    };
    subscribers.push(cb);
    return () => {
      subscribers = subscribers.filter(s => s !== cb);
    };
  }, []);

  // Queue addresses for resolution
  useEffect(() => {
    for (const addr of addresses) {
      if (addr && addr.startsWith('0x') && addr.length === 42) {
        requestResolution(addr);
      }
    }
  }, [addresses]);

  return useCallback((addr: string) => {
    if (!addr) return null;
    const key = addr.toLowerCase();
    if (ensNameCache.has(key)) return ensNameCache.get(key) || null;
    requestResolution(addr);
    return null;
  }, []);
}
