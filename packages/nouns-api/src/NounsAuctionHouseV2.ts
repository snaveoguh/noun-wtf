import { ponder } from 'ponder:registry';
import { auction, bid } from 'ponder:schema';

ponder.on('NounsAuctionHouseV2:AuctionCreated', async ({ event, context }) => {
  await context.db.insert(auction).values({
    nounId: event.args.nounId,
    startTime: new Date(Number(event.args.startTime)),
    endTime: new Date(Number(event.args.endTime)),
    settled: false,
    createdAt: new Date(Number(event.block.timestamp)),
    createdAtBlock: event.block.number,
    createdAtTransaction: event.transaction.hash,
  });
});

ponder.on('NounsAuctionHouseV2:AuctionExtended', async ({ event, context }) => {
  await context.db.update(auction, { nounId: event.args.nounId }).set({
    endTime: new Date(Number(event.args.endTime)),
  });
});

ponder.on('NounsAuctionHouseV2:AuctionBid', async ({ event, context }) => {
  // Use onConflictDoUpdate to handle duplicate (nounId, value) pairs
  // that can occur during reorgs/re-syncs (PK is nounId+value).
  await context.db
    .insert(bid)
    .values({
      nounId: event.args.nounId,
      bidder: event.args.sender,
      value: event.args.value,
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoUpdate({
      bidder: event.args.sender,
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    });
});

ponder.on('NounsAuctionHouseV2:AuctionBidWithClientId', async ({ event, context }) => {
  // Guard: bid record may not exist yet if AuctionBid hasn't been processed
  const existing = await context.db.find(bid, { nounId: event.args.nounId, value: event.args.value });
  if (existing) {
    await context.db.update(bid, { nounId: event.args.nounId, value: event.args.value }).set({
      clientId: event.args.clientId,
    });
  }
});

// Zero address as the winner + zero amount = reserve-price auction that
// ended with no qualifying bid. The NounsAuctionHouse contract burns the
// noun in _settleAuction when the bidder is the zero address. We persist
// burned=true and winner=null so the webapp can render a burned placeholder
// instead of a "won by 0x000..." row.
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

ponder.on('NounsAuctionHouseV2:AuctionSettled', async ({ event, context }) => {
  const winner = event.args.winner;
  const amount = event.args.amount;
  const isBurned = winner === ZERO_ADDRESS && amount === 0n;
  await context.db.update(auction, { nounId: event.args.nounId }).set({
    settled: true,
    // settler: event.transaction.from, // TODO: enable after initial sync
    winner: isBurned ? null : winner,
    amount,
    burned: isBurned,
  });
});

ponder.on('NounsAuctionHouseV2:AuctionSettledWithClientId', async ({ event, context }) => {
  await context.db.update(auction, { nounId: event.args.nounId }).set({
    clientId: event.args.clientId,
  });
});
