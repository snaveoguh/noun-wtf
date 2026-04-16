import type { NounMarketItem } from '@/lib/marketplace/nouns-marketplace';

import { useMemo } from 'react';

import { mainnet } from 'viem/chains';
import { useAccount, useReadContract, useReadContracts } from 'wagmi';

import { NOUNS_CONTRACT, NOUNS_TOKEN_ABI } from '@/lib/marketplace/nouns-marketplace';

import { NounCard } from './NounCard';

/**
 * Shows Nouns owned by the connected wallet.
 * Uses ERC721Enumerable: balanceOf → tokenOfOwnerByIndex for each index.
 */
export function YourNouns() {
  const { address, isConnected } = useAccount();

  // 1. Get balance (how many Nouns does this wallet own?)
  const { data: balanceData } = useReadContract({
    address: NOUNS_CONTRACT,
    abi: NOUNS_TOKEN_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: mainnet.id,
    query: { enabled: isConnected && address != null },
  });

  const balance = balanceData != null ? Number(balanceData) : 0;

  // 2. Build multicall to get tokenOfOwnerByIndex for each index
  const tokenCalls = useMemo(() => {
    if (address == null || balance === 0) return [];
    return Array.from({ length: balance }, (_, i) => ({
      address: NOUNS_CONTRACT,
      abi: NOUNS_TOKEN_ABI,
      functionName: 'tokenOfOwnerByIndex' as const,
      args: [address, BigInt(i)] as const,
      chainId: mainnet.id,
    }));
  }, [address, balance]);

  const { data: tokenResults } = useReadContracts({
    contracts: tokenCalls,
    query: { enabled: tokenCalls.length > 0 },
  });

  // 3. Convert to NounMarketItem[]
  const ownedNouns: NounMarketItem[] = useMemo(() => {
    if (!tokenResults || !address) return [];
    return tokenResults
      .filter(r => r.status === 'success' && r.result !== undefined)
      .map(r => ({
        nounId: Number(r.result),
        owner: address,
        seed: null,
        traits: null,
        listedPriceEth: null,
        orderHash: null,
      }))
      .sort((a, b) => b.nounId - a.nounId);
  }, [tokenResults, address]);

  if (!isConnected || !address) return null;
  if (balance === 0 && balanceData !== undefined) return null;

  return (
    <div className="mb-8">
      <div className="mb-4 border-b border-[var(--rule-light)] pb-2">
        <h2 className="font-headline text-xl text-[var(--ink)]">Your Nouns</h2>
        <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--ink-faint)]">
          {balance > 0
            ? `${balance} Noun${balance !== 1 ? 's' : ''} in your wallet — click to list for sale`
            : 'Loading...'}
        </p>
      </div>

      {ownedNouns.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {ownedNouns.map(item => (
            <NounCard key={item.nounId} noun={item} />
          ))}
        </div>
      ) : balance > 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: Math.min(balance, 5) }).map((_, i) => (
            <div
              key={i}
              className="aspect-square animate-pulse border border-[var(--rule-light)] bg-[var(--paper-dark)]"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
