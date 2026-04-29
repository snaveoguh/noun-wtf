import type { Auction } from '@/wrappers/nounsAuction';

/**
 * Reserve-not-met settlement detector.
 *
 * Mainnet governance prop raised NounsAuctionHouse.reservePrice to 2.8 ETH.
 * When an auction ends with no bid meeting the reserve, the contract's
 * `_settleAuction` fires `AuctionSettled(winner=address(0), amount=0)` and
 * burns the noun. The indexer persists this as `burned=true, winner=null` —
 * but we still need a client-side fallback for cached/legacy rows that never
 * got the flag written, and for the live Redux slice during the short window
 * between the settle event and the next Ponder refresh.
 *
 * An auction is considered burned when ANY of:
 *   1. Indexer explicitly set `burned: true`
 *   2. It's settled but has no bidder AND amount is 0/undefined (nounder
 *      noun mint also matches this shape — callers must gate with
 *      `!isNounderNoun(nounId)` when that distinction matters)
 */
export function isBurnedAuction(auction: Auction | undefined): boolean {
  if (!auction) return false;
  if (auction.burned === true) return true;
  // Explicit `burned: false` is authoritative — used by the V2 stub for
  // past auctions where amount/bidder are zero only because there's no
  // indexer to populate them, NOT because the auction was actually burned.
  if (auction.burned === false) return false;

  const amount = auction.amount;
  const amountIsZero =
    amount === undefined || amount === null || BigInt(amount.toString()) === 0n;

  // Stubs with startTime=0 (no real auction data fetched yet) must not
  // trip the heuristic — epoch-zero is a sentinel, not a real settlement.
  if (auction.startTime !== undefined && BigInt(auction.startTime.toString()) === 0n) {
    return false;
  }

  return !!auction.settled && !auction.bidder && amountIsZero;
}
