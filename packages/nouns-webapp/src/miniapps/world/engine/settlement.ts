// ── Settlement Window Detection ──────────────────────────────────────
//
// Reads the NounsAuctionHouse contract to detect when the auction
// has ended but hasn't been settled yet. During this window, VOIP
// crowd-settle can trigger the nounirl.eth agent to settle.

import { createPublicClient, http, type Address } from 'viem';
import { mainnet } from 'viem/chains';

// Nouns Auction House proxy on mainnet
const AUCTION_HOUSE_ADDRESS = '0x830BD73E4184ceF73443C15111a1DF14e7bdADF9' as Address;

// Minimal ABI for auction() view function
const AUCTION_ABI = [
  {
    name: 'auction',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'nounId', type: 'uint96' },
      { name: 'amount', type: 'uint128' },
      { name: 'startTime', type: 'uint40' },
      { name: 'endTime', type: 'uint40' },
      { name: 'bidder', type: 'address' },
      { name: 'settled', type: 'bool' },
    ],
  },
] as const;

export interface AuctionState {
  nounId: number;
  amount: bigint;
  endTime: number;
  bidder: string;
  settled: boolean;
  isSettlementWindow: boolean; // endTime passed && !settled
  secondsUntilEnd: number; // negative = ended
}

// Public client for reading mainnet
const client = createPublicClient({
  chain: mainnet,
  transport: http('https://ethereum-rpc.publicnode.com'),
});

let _lastFetch = 0;
let _cached: AuctionState | null = null;
const CACHE_TTL = 15000; // 15 seconds

/**
 * Get current auction state. Cached for 15 seconds.
 */
export async function getAuctionState(): Promise<AuctionState> {
  const now = Date.now();
  if (_cached && now - _lastFetch < CACHE_TTL) return _cached;

  try {
    const result = await client.readContract({
      address: AUCTION_HOUSE_ADDRESS,
      abi: AUCTION_ABI,
      functionName: 'auction',
    });

    const [nounId, amount, , endTime, bidder, settled] = result as unknown as [bigint, bigint, bigint, bigint, string, boolean];
    const endTimeSec = Number(endTime);
    const nowSec = Math.floor(Date.now() / 1000);
    const secondsUntilEnd = endTimeSec - nowSec;
    const isSettlementWindow = secondsUntilEnd < 0 && !settled;

    _cached = {
      nounId: Number(nounId),
      amount,
      endTime: endTimeSec,
      bidder,
      settled,
      isSettlementWindow,
      secondsUntilEnd,
    };
    _lastFetch = now;
    return _cached;
  } catch (err) {
    console.warn('[Settlement] Failed to read auction state:', err);
    return _cached ?? {
      nounId: 0,
      amount: 0n,
      endTime: 0,
      bidder: '',
      settled: true,
      isSettlementWindow: false,
      secondsUntilEnd: 0,
    };
  }
}

/**
 * Check if we're in the settlement window. Fast (uses cache).
 */
export function isInSettlementWindow(): boolean {
  if (!_cached) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return nowSec > _cached.endTime && !_cached.settled;
}

/**
 * Get the current auction Noun ID for the crystal ball.
 */
export function getCurrentNounId(): number {
  return _cached?.nounId ?? 0;
}
