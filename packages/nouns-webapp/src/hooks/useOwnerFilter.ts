import { useCallback, useEffect, useState } from 'react';

import { isAddress } from 'viem';

const API_BASE =
  import.meta.env.VITE_MAINNET_SUBGRAPH ||
  'https://spirited-flexibility-production-3c30.up.railway.app';

/**
 * Fetches noun IDs owned by a given address.
 * Returns undefined when no address is set (i.e., no filter active).
 */
export function useOwnerFilter() {
  const [ownerAddress, setOwnerAddress] = useState('');
  const [ownedNounIds, setOwnedNounIds] = useState<Set<bigint> | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const trimmed = ownerAddress.trim().toLowerCase();
    if (!trimmed || !isAddress(trimmed)) {
      setOwnedNounIds(undefined);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const fetchOwned = async () => {
      try {
        const query = `{ nouns(limit: 1000, where: { owner: "${trimmed}" }) { items { id } } }`;
        const res = await fetch(API_BASE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
        });
        const json = await res.json();
        const items = json?.data?.nouns?.items ?? [];
        if (!cancelled) {
          setOwnedNounIds(new Set(items.map((n: { id: string }) => BigInt(n.id))));
        }
      } catch {
        if (!cancelled) setOwnedNounIds(new Set());
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const timer = setTimeout(fetchOwned, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ownerAddress]);

  const clearOwner = useCallback(() => {
    setOwnerAddress('');
    setOwnedNounIds(undefined);
  }, []);

  return { ownerAddress, setOwnerAddress, ownedNounIds, ownerLoading: loading, clearOwner };
}
