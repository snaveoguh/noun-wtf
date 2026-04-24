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
  const v1 = useReadNounsAuctionHouseReservePrice({
    query: { enabled: !dao.isV2 },
  });
  const v2 = useReadContract({
    address: dao.auctionHouseAddress,
    abi: dao.auctionHouseAbi,
    functionName: 'reservePrice',
    query: { enabled: dao.isV2 && dao.isConfigured },
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
  const v1 = useReadNounsAuctionHouseMinBidIncrementPercentage({
    query: { enabled: !dao.isV2 },
  });
  const v2 = useReadContract({
    address: dao.auctionHouseAddress,
    abi: dao.auctionHouseAbi,
    functionName: 'minBidIncrementPercentage',
    query: { enabled: dao.isV2 && dao.isConfigured },
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
        isPending: v2.isPending,
        isIdle: v2.isIdle,
        isError: v2.isError,
        isSuccess: v2.isSuccess,
        error: v2.error,
      }
    : {
        writeContract,
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

  const v1 = useReadNounsTokenSeeds({
    args: nounId !== undefined ? [nounId] : undefined,
    query: { enabled: !dao.isV2 && enabledCommon, retry: 1 },
  });
  const v2 = useReadContract({
    address: dao.tokenAddress,
    abi: dao.tokenAbi,
    functionName: 'seeds',
    args: nounId !== undefined ? [nounId] : undefined,
    query: { enabled: dao.isV2 && enabledCommon, retry: 1 },
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

// Re-export so downstream consumers don't need to import wagmi directly.
export { useReadContracts };
