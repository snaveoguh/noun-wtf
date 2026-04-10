/**
 * useDerivativeBidComments — fetches all bid comments for a derivative auction
 * from AuctionBidWithReason event logs.
 *
 * The NounDerivatives contract stores only the *latest* highest bidder's reason
 * in `bidReasons[tokenId]`, but every bid emits an AuctionBidWithReason event
 * containing the full reason text. This hook reads those events to build a
 * complete comment thread.
 *
 * Derivative auctions are short-lived (~24h) so the block range is small enough
 * for a single getLogs call — no chunking needed.
 */
import type { Address } from '@/utils/types';

import { useMemo } from 'react';

import { useQuery as useReactQuery } from '@tanstack/react-query';
import { decodeEventLog } from 'viem';
import { useBlockNumber, usePublicClient } from 'wagmi';

import nounDerivativesABI from '@/contracts/nounDerivatives.abi.json';

const abi = nounDerivativesABI;

const rawDerivativesAddress = String(import.meta.env.VITE_NOUN_DERIVATIVES_ADDRESS ?? '');
const DERIVATIVES_ADDRESS = rawDerivativesAddress as Address;

// ~33 hours of blocks at 12s/block — covers a full 24h auction plus buffer
const LOOKBACK_BLOCKS = 10_000n;

// Timestamp estimation (same anchor as useFeedbackFromLogs)
const ANCHOR_BLOCK = 17_812_145n;
const ANCHOR_TIMESTAMP = 1691049600;
const AVG_BLOCK_TIME = 12;

function estimateTimestamp(blockNumber: bigint): number {
  return ANCHOR_TIMESTAMP + Number(blockNumber - ANCHOR_BLOCK) * AVG_BLOCK_TIME;
}

// ── localStorage cache for settled auctions ────────────────────────────

const CACHE_PREFIX = 'deriv-bids-';

export interface BidComment {
  bidder: Address;
  amount: bigint;
  reason: string;
  blockNumber: bigint;
  timestamp: number;
}

interface SerializedBidComment {
  bidder: string;
  amount: string;
  reason: string;
  blockNumber: string;
  timestamp: number;
}

function loadCache(tokenId: number): BidComment[] | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${tokenId}`);
    if (!raw) return null;
    const entries = JSON.parse(raw) as SerializedBidComment[];
    return entries.map(e => ({
      bidder: e.bidder as Address,
      amount: BigInt(e.amount),
      reason: e.reason,
      blockNumber: BigInt(e.blockNumber),
      timestamp: e.timestamp,
    }));
  } catch {
    return null;
  }
}

function saveCache(tokenId: number, comments: BidComment[]): void {
  try {
    const serialized: SerializedBidComment[] = comments.map(c => ({
      bidder: c.bidder,
      amount: c.amount.toString(),
      reason: c.reason,
      blockNumber: c.blockNumber.toString(),
      timestamp: c.timestamp,
    }));
    localStorage.setItem(`${CACHE_PREFIX}${tokenId}`, JSON.stringify(serialized));
  } catch {
    // localStorage full — silently fail
  }
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useDerivativeBidComments(tokenId: number | undefined, isSettled: boolean) {
  const publicClient = usePublicClient();
  const { data: currentBlock } = useBlockNumber();

  const cachedComments = useMemo(
    () => (tokenId !== undefined && isSettled ? loadCache(tokenId) : null),
    [tokenId, isSettled],
  );

  const { data: fetchedComments, isLoading } = useReactQuery({
    queryKey: [
      'derivativeBidComments',
      tokenId,
      currentBlock !== undefined ? currentBlock.toString() : '',
    ],
    queryFn: async (): Promise<BidComment[]> => {
      if (
        publicClient === undefined ||
        currentBlock === undefined ||
        currentBlock === 0n ||
        tokenId === undefined
      )
        return [];
      if (rawDerivativesAddress === undefined) return [];

      const fromBlock = currentBlock > LOOKBACK_BLOCKS ? currentBlock - LOOKBACK_BLOCKS : 0n;

      const logs = await publicClient.getLogs({
        address: DERIVATIVES_ADDRESS,
        event: {
          type: 'event',
          name: 'AuctionBidWithReason',
          inputs: [
            { name: 'tokenId', type: 'uint256', indexed: true },
            { name: 'bidder', type: 'address', indexed: false },
            { name: 'amount', type: 'uint256', indexed: false },
            { name: 'extended', type: 'bool', indexed: false },
            { name: 'reason', type: 'string', indexed: false },
          ],
        },
        args: { tokenId: BigInt(tokenId) },
        fromBlock,
        toBlock: currentBlock,
      });

      const comments: BidComment[] = [];
      for (const log of logs) {
        try {
          const decoded = decodeEventLog({
            abi,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === 'AuctionBidWithReason') {
            const args = decoded.args as unknown as {
              tokenId: bigint;
              bidder: Address;
              amount: bigint;
              extended: boolean;
              reason: string;
            };
            comments.push({
              bidder: args.bidder,
              amount: args.amount,
              reason: args.reason,
              blockNumber: log.blockNumber ?? 0n,
              timestamp: estimateTimestamp(log.blockNumber ?? 0n),
            });
          }
        } catch {
          // Skip undecodable logs
        }
      }

      // Cache settled auctions (immutable)
      if (isSettled && comments.length > 0) {
        saveCache(tokenId, comments);
      }

      return comments;
    },
    enabled:
      publicClient !== undefined &&
      currentBlock !== undefined &&
      currentBlock > 0n &&
      tokenId !== undefined &&
      rawDerivativesAddress !== undefined &&
      // Skip fetch if we already have a cached result for a settled auction
      cachedComments === null,
    staleTime: 15_000,
    refetchInterval: isSettled ? false : 15_000,
    retry: 2,
  });

  const comments = cachedComments ?? fetchedComments ?? [];

  return { comments, isLoading: !cachedComments && isLoading };
}
