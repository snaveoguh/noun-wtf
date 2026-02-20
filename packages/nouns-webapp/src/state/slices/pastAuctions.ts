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
  startTime: string;
  endTime: string;
  clientId?: number | null;
  noun?: { id: string; owner: string } | null;
  bids?: {
    items: Array<{
      value: string;
      bidder: string;
      createdAtBlock: string;
      createdAt: string;
      createdAtTransaction: string;
    }>;
  };
}

const reduxSafePastAuctions = (auctions: PonderAuction[]): AuctionState[] => {
  if (!auctions) return [];
  return auctions.map(auction => {
    return {
      activeAuction: {
        amount: auction.amount ? BigInt(auction.amount).toString() : undefined,
        bidder: auction.winner ? (auction.winner as Address) : undefined,
        startTime: BigInt(auction.startTime).toString(),
        endTime: BigInt(auction.endTime).toString(),
        nounId: BigInt(auction.nounId).toString(),
        settled: auction.settled ?? false,
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
        };
      }),
    };
  });
};

const pastAuctionsSlice = createSlice({
  name: 'pastAuctions',
  initialState: initialState,
  reducers: {
    addPastAuctions: (state, action: PayloadAction<PonderAuction[]>) => {
      state.pastAuctions = reduxSafePastAuctions(action.payload);
    },
  },
});

export const { addPastAuctions } = pastAuctionsSlice.actions;

export default pastAuctionsSlice.reducer;
