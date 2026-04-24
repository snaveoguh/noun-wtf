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

  const amount = auction.amount;
  const amountIsZero =
    amount === undefined || amount === null || BigInt(amount.toString()) === 0n;

  return !!auction.settled && !auction.bidder && amountIsZero;
}
