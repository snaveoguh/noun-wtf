import { useQuery } from '@tanstack/react-query';

import config from '@/config';
import { NOUNV2_AUCTION_HOUSE_ADDRESS } from '@/contracts/nounv2-auction-house';
import { Address, Bid } from '@/utils/types';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const PONDER_BASE =
  config.app.subgraphApiUri || 'https://spirited-flexibility-production-3c30.up.railway.app';

interface PonderBid {
  bidder: Address;
  value: string;
  extended: boolean;
  timestamp: string;
  transactionHash: string;
  createdAtBlock: string;
}

interface PonderAuctionResponse {
  nounId: string;
  startTime?: string;
  endTime?: string;
  settled?: boolean;
  winner?: Address | null;
  amount?: string | null;
  bids: PonderBid[];
}

/** Settled-auction summary for a past V2 noun, sourced from the indexer. */
export interface V2SettledAuction {
  nounId: bigint;
  amount: bigint;
  winner: Address | undefined;
  startTime: bigint;
  endTime: bigint;
  settled: boolean;
}

/**
 * Read the full bid history for a NounV2 auction from the Ponder indexer
 * REST endpoint (`/api/nounv2-auctions/:nounId`). Returns rows in the
 * mainnet `Bid[]` shape so `<BidHistoryModal>` can render v2 bids with no
 * downstream code changes.
 *
 * Replaces the previous `getContractEvents` scan, which capped coverage
 * at the last ~8k blocks because public RPCs reject larger ranges. Using
 * the indexer means every historical V2 auction is queryable.
 */
export function useV2AuctionBids(nounId: bigint): Bid[] | undefined {
  const isConfigured = NOUNV2_AUCTION_HOUSE_ADDRESS !== ZERO_ADDRESS;

  const { data } = useQuery({
    queryKey: ['nounv2-bids', String(nounId)],
    queryFn: async (): Promise<Bid[]> => {
      const res = await fetch(`${PONDER_BASE}/api/nounv2-auctions/${String(nounId)}`);
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(`ponder returned ${res.status}`);
      const payload = (await res.json()) as PonderAuctionResponse;
      const bids: Bid[] = (payload.bids ?? []).map(b => ({
        nounId,
        sender: b.bidder,
        value: BigInt(b.value),
        extended: !!b.extended,
        transactionHash: b.transactionHash,
        transactionIndex: 0,
        timestamp: BigInt(b.timestamp),
        clientId: null,
      }));
      return bids.sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0));
    },
    enabled: isConfigured,
    refetchInterval: 12_000,
    staleTime: 8_000,
  });

  return data;
}

/**
 * Read the settled-auction summary (winning bid amount, winner, times) for a
 * past V2 noun from the same indexer endpoint. V2 has no on-chain history for
 * past auctions — the AuctionHouse only exposes the live `auction()` tuple —
 * so without this the `/v2/noun/:id` page shows a hardcoded "0.00 ETH"
 * placeholder. The indexer captures `amount`/`winner` on `AuctionSettled`.
 *
 * `nounId === undefined` (or the live noun, handled by the caller) disables
 * the query. Returns `undefined` while loading or when the indexer has no row
 * (e.g. a not-yet-indexed or no-bid/burned auction) — the caller keeps its
 * placeholder in that case.
 *
 * The endpoint serialises times via `Date.getTime()`, but the underlying
 * column stores raw Unix *seconds* (same quirk `useV2AuctionBids` relies on
 * for bid timestamps), so the values already match the on-chain `auction()`
 * seconds convention that every consumer (AuctionTimer, date headline) expects
 * — no unit conversion needed.
 */
export function useV2SettledAuction(nounId: bigint | undefined): V2SettledAuction | undefined {
  const isConfigured = NOUNV2_AUCTION_HOUSE_ADDRESS !== ZERO_ADDRESS;

  const { data } = useQuery({
    queryKey: ['nounv2-settled-auction', nounId !== undefined ? String(nounId) : 'none'],
    queryFn: async (): Promise<V2SettledAuction | null> => {
      const res = await fetch(`${PONDER_BASE}/api/nounv2-auctions/${String(nounId)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`ponder returned ${res.status}`);
      const p = (await res.json()) as PonderAuctionResponse;
      const toSec = (s?: string): bigint => (s ? BigInt(Math.floor(Number(s))) : 0n);
      const winner =
        p.winner && p.winner.toLowerCase() !== ZERO_ADDRESS ? (p.winner as Address) : undefined;
      return {
        nounId: BigInt(p.nounId),
        amount: p.amount != null ? BigInt(p.amount) : 0n,
        winner,
        startTime: toSec(p.startTime),
        endTime: toSec(p.endTime),
        settled: p.settled ?? true,
      };
    },
    enabled: isConfigured && nounId !== undefined,
    // Past settled auctions are immutable — cache hard, no polling.
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: 2,
  });

  return data ?? undefined;
}
