import { useAppSelector } from '@/hooks';
import { compareBids } from '@/utils/compareBids';
import { generateEmptyNounderAuction, isNounderNoun } from '@/utils/nounderNoun';
import { Address, Bid, BidEvent } from '@/utils/types';

import { Auction } from './nounsAuction';

const deserializeAuction = (reduxSafeAuction: Auction): Auction => {
  return {
    amount: reduxSafeAuction.amount ? BigInt(reduxSafeAuction.amount) : undefined,
    bidder: reduxSafeAuction.bidder ? (reduxSafeAuction.bidder as Address) : undefined,
    startTime: BigInt(reduxSafeAuction.startTime),
    endTime: BigInt(reduxSafeAuction.endTime),
    nounId: BigInt(reduxSafeAuction.nounId),
    settled: false,
    clientId: reduxSafeAuction.clientId ?? null,
  };
};

const deserializeBid = (reduxSafeBid: BidEvent): Bid => {
  return {
    nounId: BigInt(reduxSafeBid.nounId),
    sender: reduxSafeBid.sender,
    value: BigInt(reduxSafeBid.value),
    extended: reduxSafeBid.extended,
    transactionHash: reduxSafeBid.transactionHash,
    transactionIndex: reduxSafeBid.transactionIndex,
    timestamp: BigInt(reduxSafeBid.timestamp),
    clientId: reduxSafeBid.clientId ?? null,
  };
};
const deserializeBids = (reduxSafeBids: BidEvent[]): Bid[] => {
  return reduxSafeBids.map(bid => deserializeBid(bid)).sort((a: Bid, b: Bid) => compareBids(a, b));
};

const useOnDisplayAuction = (): Auction | undefined => {
  const lastAuctionNounId = useAppSelector(state => state.auction.activeAuction?.nounId);
  const onDisplayAuctionNounId = useAppSelector(
    state => state.onDisplayAuction.onDisplayAuctionNounId,
  );
  const currentAuction = useAppSelector(state => state.auction.activeAuction);
  const pastAuctions = useAppSelector(state => state.pastAuctions.pastAuctions);

  // Minimum requirements: we need to know WHICH noun to show and the active auction
  if (onDisplayAuctionNounId === undefined || !lastAuctionNounId || !currentAuction) {
    return undefined;
  }

  // Current auction — does NOT require pastAuctions to be loaded
  // Compare as numbers — lastAuctionNounId is a string after Redux serialisation
  if (Number(onDisplayAuctionNounId) === Number(lastAuctionNounId)) {
    return deserializeAuction(currentAuction);
  }

  // Past/nounder auctions need pastAuctions — if not loaded yet, return a
  // stub so the page still renders (the Noun image fetches its seed on-chain).
  if (!pastAuctions) {
    return {
      nounId: BigInt(onDisplayAuctionNounId),
      startTime: 0n,
      endTime: 0n,
      settled: true,
      amount: 0n,
      bidder: undefined,
    };
  }

  // nounder auction
  if (isNounderNoun(BigInt(onDisplayAuctionNounId))) {
    const emptyNounderAuction = generateEmptyNounderAuction(
      BigInt(onDisplayAuctionNounId),
      pastAuctions,
    );

    return deserializeAuction(emptyNounderAuction);
  }

  // past auction — look up in Ponder data
  const pastAuction = pastAuctions.find(auction => {
    if (!auction.activeAuction) return false;
    const nounId = BigInt(auction.activeAuction.nounId);
    return Number(nounId) === onDisplayAuctionNounId;
  });
  const reduxSafeAuction = pastAuction?.activeAuction;

  if (reduxSafeAuction) {
    return deserializeAuction(reduxSafeAuction);
  }

  // Fallback: Ponder hasn't indexed this noun yet — return a stub so the
  // page still renders (the Noun image loads its seed on-chain independently).
  return {
    nounId: BigInt(onDisplayAuctionNounId),
    startTime: 0n,
    endTime: 0n,
    settled: true,
    amount: 0n,
    bidder: undefined,
  };
};

export const useAuctionBids = (auctionNounId: bigint): Bid[] | undefined => {
  const lastAuctionNounId = useAppSelector(state => state.onDisplayAuction.lastAuctionNounId);
  const lastAuctionBids = useAppSelector(state => state.auction.bids);
  const pastAuctions = useAppSelector(state => state.pastAuctions.pastAuctions);

  // auction requested is active auction
  if (lastAuctionNounId === Number(auctionNounId)) {
    return deserializeBids(lastAuctionBids);
  } else {
    // find bids for past auction requested
    const bidEvents: BidEvent[] | undefined = pastAuctions?.find(auction => {
      const nounId = auction.activeAuction && BigInt(auction.activeAuction.nounId);
      return !!nounId && nounId === auctionNounId;
    })?.bids;

    return bidEvents ? deserializeBids(bidEvents) : undefined;
  }
};

export default useOnDisplayAuction;
