import { useMemo } from 'react';

import { useReadContract, useWriteContract, useReadContracts } from 'wagmi';

import {
  useReadNounsAuctionHouseMinBidIncrementPercentage,
  useReadNounsAuctionHouseReservePrice,
  useReadNounsTokenSeeds,
  useWriteNounsAuctionHouseCreateBid,
  useWriteNounsAuctionHouseSettleCurrentAndCreateNewAuction,
} from '@/contracts';
import type { DaoContext } from '@/hooks/useDaoContext';
import type { INounSeed } from '@/wrappers/nounToken';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

/**
 * Read the reserve price for the active DAO.
 *
 * Branches on `dao.isV2` but keeps hook order stable by always calling
 * both hooks — the inactive one is disabled via its `query.enabled`
 * flag so it's a no-op on the network.
 */
export function useDaoReservePrice(dao: DaoContext): bigint | undefined {
  // Reserve price changes only via governance, so a 30s staleTime is plenty
  // and lets the UI hydrate from cache on tab focus without re-querying RPC.
  // `retry: 2` keeps a hung publicnode call from blocking the bid form via
  // TanStack's default 3-retry exponential backoff.
  const v1 = useReadNounsAuctionHouseReservePrice({
    query: { enabled: !dao.isV2, retry: 2, staleTime: 30_000, gcTime: 5 * 60_000 },
  });
  const v2 = useReadContract({
    address: dao.auctionHouseAddress,
    abi: dao.auctionHouseAbi,
    functionName: 'reservePrice',
    query: {
      enabled: dao.isV2 && dao.isConfigured,
      retry: 2,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    },
  });

  const raw = dao.isV2 ? v2.data : v1.data;
  if (raw === undefined || raw === null) return undefined;
  return BigInt(raw.toString());
}

/**
 * Read `minBidIncrementPercentage` for the active DAO. Returned as a
 * bigint so callers can use it in the `(amount * (inc + 100n)) / 100n`
 * formula without mixing types.
 */
export function useDaoMinBidIncrementPercentage(dao: DaoContext): bigint | undefined {
  // Same stability profile as reservePrice — only governance changes it. Cap
  // retries so a slow transport doesn't gate the bid form's increment math.
  const v1 = useReadNounsAuctionHouseMinBidIncrementPercentage({
    query: { enabled: !dao.isV2, retry: 2, staleTime: 30_000, gcTime: 5 * 60_000 },
  });
  const v2 = useReadContract({
    address: dao.auctionHouseAddress,
    abi: dao.auctionHouseAbi,
    functionName: 'minBidIncrementPercentage',
    query: {
      enabled: dao.isV2 && dao.isConfigured,
      retry: 2,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    },
  });

  const raw = dao.isV2 ? v2.data : v1.data;
  if (raw === undefined || raw === null) return undefined;
  return BigInt(raw.toString());
}

/**
 * `useWriteContract` bound to the active DAO's auction house, pre-loaded
 * with `createBid`. v1 accepts `(nounId, clientId)`, v2 only accepts
 * `(nounId)` — the caller pass `argsForNounId(id)` to construct the
 * correct tuple for the active DAO.
 */
export function useDaoCreateBidWriter(dao: DaoContext) {
  const v1 = useWriteNounsAuctionHouseCreateBid();
  const v2 = useWriteContract();

  // v2 needs an explicit address/abi on every call; v1 is already bound.
  const writeContract = (args: {
    args: readonly unknown[];
    value: bigint;
  }) => {
    if (dao.isV2) {
      v2.writeContract({
        address: dao.auctionHouseAddress,
        abi: dao.auctionHouseAbi,
        functionName: 'createBid',
        args: args.args,
        value: args.value,
      });
      return;
    }
    // Cast for v1 — the gen'd writer types args tightly but our caller
    // builds the tuple dynamically.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    v1.writeContract({ args: args.args as any, value: args.value });
  };

  return dao.isV2
    ? {
        writeContract,
        isPending: v2.isPending,
        isError: v2.isError,
        isSuccess: v2.isSuccess,
        error: v2.error,
      }
    : {
        writeContract,
        isPending: v1.isPending,
        isError: v1.isError,
        isSuccess: v1.isSuccess,
        error: v1.error,
      };
}

/**
 * `useWriteContract` bound to the active DAO's auction house for
 * `settleCurrentAndCreateNewAuction`. Same contract method name on
 * both v1 and v2 so the only thing changing is the address.
 */
export function useDaoSettleWriter(dao: DaoContext) {
  const v1 = useWriteNounsAuctionHouseSettleCurrentAndCreateNewAuction();
  const v2 = useWriteContract();

  const writeContract = () => {
    if (dao.isV2) {
      v2.writeContract({
        address: dao.auctionHouseAddress,
        abi: dao.auctionHouseAbi,
        functionName: 'settleCurrentAndCreateNewAuction',
        args: [],
      });
      return;
    }
    v1.writeContract({});
  };

  return dao.isV2
    ? {
        writeContract,
        // The hash exposed here is the submitted tx — callers pair this with
        // `useWaitForTransactionReceipt` to flip a success toast on receipt
        // confirmation rather than on submission.
        data: v2.data,
        isPending: v2.isPending,
        isIdle: v2.isIdle,
        isError: v2.isError,
        isSuccess: v2.isSuccess,
        error: v2.error,
      }
    : {
        writeContract,
        data: v1.data,
        isPending: v1.isPending,
        isIdle: v1.isIdle,
        isError: v1.isError,
        isSuccess: v1.isSuccess,
        error: v1.error,
      };
}

/**
 * Read `seeds(nounId)` for the active DAO. Returns the seed in the
 * normalised `INounSeed` shape used across the webapp.
 *
 * On v2 the token contract is a different address but the ABI shape of
 * `seeds(uint256)` matches mainnet Nouns 1:1, so we can reuse the same
 * decoding.
 */
export function useDaoNounSeed(
  dao: DaoContext,
  nounId: bigint | undefined,
): INounSeed | undefined {
  const enabledCommon = nounId !== undefined && dao.tokenAddress !== ZERO_ADDRESS;

  // Seeds are immutable once a noun is minted — cache aggressively. retry
  // bumped to 2 (was 1) so a single transport blip doesn't wipe the hero
  // image; the data never changes so a generous 5min staleTime is safe.
  const v1 = useReadNounsTokenSeeds({
    args: nounId !== undefined ? [nounId] : undefined,
    query: {
      enabled: !dao.isV2 && enabledCommon,
      retry: 2,
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
    },
  });
  const v2 = useReadContract({
    address: dao.tokenAddress,
    abi: dao.tokenAbi,
    functionName: 'seeds',
    args: nounId !== undefined ? [nounId] : undefined,
    query: {
      enabled: dao.isV2 && enabledCommon,
      retry: 2,
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
    },
  });

  const data = dao.isV2 ? v2.data : v1.data;
  if (!data) return undefined;
  const tuple = data as readonly [number | bigint, number | bigint, number | bigint, number | bigint, number | bigint];
  const [background, body, accessory, head, glasses] = tuple;
  return {
    background: Number(background),
    body: Number(body),
    accessory: Number(accessory),
    head: Number(head),
    glasses: Number(glasses),
  };
}

/**
 * Detect whether a V2 noun has been burned by calling `ownerOf(nounId)`.
 *
 * Burned nouns revert on `ownerOf` (ERC721 standard: "query for nonexistent
 * token"). When the call errors we interpret it as burned. Returns:
 *   - `true` if ownerOf reverted (burned)
 *   - `false` if ownerOf returned a valid address (not burned)
 *   - `undefined` while the query is still loading
 *
 * Only enabled for V2 past nouns (where `nounId` is provided). For mainnet
 * Nouns the Ponder indexer sets the `burned` flag on the auction object, so
 * this hook is a no-op.
 */
export function useV2NounBurnedStatus(
  dao: DaoContext,
  nounId: bigint | undefined,
): boolean | undefined {
  const enabled =
    dao.isV2 && dao.isConfigured && nounId !== undefined && dao.tokenAddress !== ZERO_ADDRESS;

  const { error, isLoading, data } = useReadContract({
    address: dao.tokenAddress,
    abi: dao.tokenAbi,
    functionName: 'ownerOf',
    args: nounId !== undefined ? [nounId] : undefined,
    query: {
      enabled,
      retry: 1,
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
    },
  });

  if (!enabled) return undefined;
  if (isLoading) return undefined;
  // If ownerOf reverted, the noun doesn't exist (burned)
  if (error != null) return true;
  // ownerOf returned successfully — noun exists
  if (data !== undefined && data !== null) return false;
  return undefined;
}

/**
 * Read the on-chain SVG image for a V2 noun via `dataURI(tokenId)`.
 *
 * Why on-chain instead of building from a bundled snapshot: V2's descriptor
 * can be re-upgraded by governance (last ceremony 2026-05-09). The chain
 * is single source of truth — `dataURI` survives future descriptor swaps
 * with no client redeploy. Mirrors the BerryOS V2 render pattern.
 *
 * Returns the `data:image/svg+xml;base64,…` URL ready to drop into <img>,
 * or `undefined` while loading. Cached aggressively — per-token metadata
 * is immutable for the lifetime of the current descriptor.
 */
export function useV2NounImage(
  dao: DaoContext,
  nounId: bigint | undefined,
): string | undefined {
  const enabled =
    dao.isV2 && nounId !== undefined && dao.tokenAddress !== ZERO_ADDRESS;

  const { data } = useReadContract({
    address: dao.tokenAddress,
    abi: dao.tokenAbi,
    functionName: 'dataURI',
    args: nounId !== undefined ? [nounId] : undefined,
    query: {
      enabled,
      retry: 2,
      staleTime: Infinity,
      gcTime: Infinity,
    },
  });

  return useMemo(() => {
    if (typeof data !== 'string') return undefined;
    const prefix = 'data:application/json;base64,';
    if (!data.startsWith(prefix)) return undefined;
    try {
      const json = JSON.parse(atob(data.slice(prefix.length)));
      return typeof json.image === 'string' ? json.image : undefined;
    } catch {
      return undefined;
    }
  }, [data]);
}

// Re-export so downstream consumers don't need to import wagmi directly.
export { useReadContracts };
