import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { Address } from '@/utils/types';

import { AuctionState } from './auction';

interface PastAuctionsState {
  pastAuctions: AuctionState[];
}

const initialState: PastAuctionsState = {
  pastAuctions: [],
};

// Ponder auction shape from auctions query
interface PonderAuction {
  nounId: string;
  amount: string;
  settled: boolean;
  winner: string | null;
  /** Reserve-not-met settlement — emitted with winner=0x0, amount=0. */
  burned?: boolean;
  startTime: string;
  endTime: string;
  clientId?: number | null;
  noun?: { id: string; owner: string } | null;
  bids?: {
    items: Array<{
      value: string;
      bidder: string;
      clientId?: number | null;
      createdAtBlock: string;
      createdAt: string;
      createdAtTransaction: string;
    }>;
  };
}

const ZERO_ADDRESS_LC = '0x0000000000000000000000000000000000000000';

/**
 * Treat the zero-address winner as "no bidder" (reserve-not-met burns).
 * Prior to the mainnet reservePrice raise this couldn't happen — now it can,
 * and the indexer may emit winner='0x000...' for historical rows before we
 * started writing null explicitly.
 */
const normalizeWinner = (winner: string | null): Address | undefined => {
  if (!winner) return undefined;
  if (winner.toLowerCase() === ZERO_ADDRESS_LC) return undefined;
  return winner as Address;
};

const reduxSafePastAuctions = (auctions: PonderAuction[]): AuctionState[] => {
  if (!auctions) return [];
  return auctions.map(auction => {
    return {
      activeAuction: {
        amount: auction.amount ? BigInt(auction.amount).toString() : undefined,
        bidder: normalizeWinner(auction.winner),
        startTime: BigInt(auction.startTime).toString(),
        endTime: BigInt(auction.endTime).toString(),
        nounId: BigInt(auction.nounId).toString(),
        settled: auction.settled ?? false,
        burned: auction.burned ?? false,
        clientId: auction.clientId ?? null,
      },
      bids: (auction.bids?.items ?? []).map(bid => {
        return {
          nounId: BigInt(auction.nounId).toString(),
          sender: bid.bidder as Address,
          value: BigInt(bid.value).toString(),
          extended: false,
          transactionHash: bid.createdAtTransaction ?? '',
          transactionIndex: 0,
          timestamp: BigInt(bid.createdAt ?? 0).toString(),
          clientId: bid.clientId ?? null,
        };
      }),
    };
  });
};

const pastAuctionsSlice = createSlice({
  name: 'pastAuctions',
  initialState: initialState,
  reducers: {
    // Merge the bulk latestAuctionsQuery result into existing state rather
    // than replacing it. Replacing would wipe any on-demand single-auction
    // fetches (see upsertPastAuction) that land before or after the bulk
    // query re-fires (e.g. TanStack Query's refetchOnWindowFocus).
    addPastAuctions: (state, action: PayloadAction<PonderAuction[]>) => {
      const incoming = reduxSafePastAuctions(action.payload);
      const byId = new Map<string, AuctionState>();
      for (const entry of state.pastAuctions) {
        const id = entry.activeAuction?.nounId;
        if (id != null) byId.set(String(id), entry);
      }
      for (const entry of incoming) {
        const id = entry.activeAuction?.nounId;
        if (id != null) byId.set(String(id), entry);
      }
      state.pastAuctions = [...byId.values()];
    },
    // Merge a single on-demand fetched auction into the cache. Used when the
    // user navigates to an old noun (e.g. #1) that falls outside the initial
    // latestAuctionsQuery window.
    upsertPastAuction: (state, action: PayloadAction<PonderAuction>) => {
      const [transformed] = reduxSafePastAuctions([action.payload]);
      if (!transformed) return;
      const targetNounId = transformed.activeAuction?.nounId;
      if (!targetNounId) return;
      const idx = state.pastAuctions.findIndex(
        a => a.activeAuction?.nounId === targetNounId,
      );
      if (idx === -1) {
        state.pastAuctions.push(transformed);
      } else {
        state.pastAuctions[idx] = transformed;
      }
    },
  },
});

export const { addPastAuctions, upsertPastAuction } = pastAuctionsSlice.actions;

export default pastAuctionsSlice.reducer;
