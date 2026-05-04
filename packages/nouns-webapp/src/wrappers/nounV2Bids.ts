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
  bids: PonderBid[];
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
