import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import {
  Address,
  AuctionCreateEvent,
  AuctionExtendedEvent,
  AuctionSettledEvent,
  BidEvent,
  BigNumberish,
} from '@/utils/types';
import { Auction as IAuction } from '@/wrappers/nounsAuction';

export interface AuctionState {
  activeAuction?: IAuction;
  bids: BidEvent[];
}

const initialState: AuctionState = {
  activeAuction: undefined,
  bids: [],
};

export const reduxSafeNewAuction = (auction: AuctionCreateEvent): IAuction => ({
  amount: BigInt(0).toString(),
  bidder: '0x' as `0x${string}`,
  startTime: BigInt(auction.startTime).toString(),
  endTime: BigInt(auction.endTime).toString(),
  nounId: BigInt(auction.nounId).toString(),
  settled: false,
});

export const reduxSafeAuction = (auction: IAuction): IAuction => ({
  amount: auction.amount ? BigInt(auction.amount).toString() : undefined,
  bidder: auction.bidder ? (auction.bidder as Address) : undefined,
  startTime: BigInt(auction.startTime).toString(),
  endTime: BigInt(auction.endTime).toString(),
  nounId: BigInt(auction.nounId).toString(),
  settled: auction.settled,
});

export const reduxSafeBid = (bid: BidEvent): BidEvent => ({
  nounId: BigInt(bid.nounId).toString(),
  sender: bid.sender,
  value: BigInt(bid.value).toString(),
  extended: bid.extended,
  transactionHash: bid.transactionHash,
  transactionIndex: bid.transactionIndex,
  timestamp: bid.timestamp.toString(),
  clientId: bid.clientId ?? null,
});

const maxBid = (bids: BidEvent[]): BidEvent => {
  if (bids.length === 0) {
    throw new Error('Cannot find maximum bid in an empty array');
  }
  return bids.reduce((prev, current) => {
    return BigInt(prev.value) > BigInt(current.value) ? prev : current;
  }, bids[0]);
};

const auctionsEqual = (
  a: IAuction,
  b: AuctionSettledEvent | AuctionCreateEvent | BidEvent | AuctionExtendedEvent,
) => BigInt(a.nounId) === BigInt(b.nounId);

const containsBid = (bidEvents: BidEvent[], bidEvent: BidEvent) =>
  bidEvents.map(bid => bid.transactionHash).indexOf(bidEvent.transactionHash) >= 0;

/**
 * State of **current** auction (sourced via websocket)
 */
export const auctionSlice = createSlice({
  name: 'auction',
  initialState,
  reducers: {
    setActiveAuction: (state, action: PayloadAction<AuctionCreateEvent>) => {
      state.activeAuction = reduxSafeNewAuction(action.payload);
      state.bids = [];
    },
    setFullAuction: (state, action: PayloadAction<IAuction>) => {
      state.activeAuction = reduxSafeAuction(action.payload);
    },
    appendBid: (state, action: PayloadAction<BidEvent>) => {
      if (!(state.activeAuction && auctionsEqual(state.activeAuction, action.payload))) return;
      if (containsBid(state.bids, action.payload)) return;
      state.bids = [reduxSafeBid(action.payload), ...state.bids];
      const maxBid_ = maxBid(state.bids);
      state.activeAuction.amount = BigInt(maxBid_.value).toString();
      state.activeAuction.bidder = maxBid_.sender;
    },
    setAuctionSettled: (state, action: PayloadAction<AuctionSettledEvent>) => {
      if (!(state.activeAuction && auctionsEqual(state.activeAuction, action.payload))) return;
      state.activeAuction.settled = true;
      state.activeAuction.bidder = action.payload.winner;
      state.activeAuction.amount = BigInt(action.payload.amount).toString();
    },
    setAuctionExtended: (state, action: PayloadAction<AuctionExtendedEvent>) => {
      if (!(state.activeAuction && auctionsEqual(state.activeAuction, action.payload))) return;
      state.activeAuction.endTime = BigInt(action.payload.endTime).toString();
    },
    // Attach a clientId to a bid already in state, matched by nounId + value.
    // The NounsAuctionHouseV2 contract emits both AuctionBid and
    // AuctionBidWithClientId — the former populates the bid row, the latter
    // provides the clientId for the favicon.
    setBidClientId: (
      state,
      action: PayloadAction<{ nounId: BigNumberish; value: BigNumberish; clientId: number }>,
    ) => {
      const { nounId, value, clientId } = action.payload;
      const targetNounId = BigInt(nounId).toString();
      const targetValue = BigInt(value).toString();
      state.bids = state.bids.map(bid =>
        BigInt(bid.nounId).toString() === targetNounId &&
        BigInt(bid.value).toString() === targetValue &&
        (bid.clientId == null || bid.clientId === 0)
          ? { ...bid, clientId }
          : bid,
      );
    },
  },
});

export const {
  setActiveAuction,
  appendBid,
  setAuctionExtended,
  setAuctionSettled,
  setBidClientId,
  setFullAuction,
} = auctionSlice.actions;

export default auctionSlice.reducer;
