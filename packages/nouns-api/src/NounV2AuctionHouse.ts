import { ponder } from 'ponder:registry';
import { nounV2Auction, nounV2Bid } from 'ponder:schema';

// Mirrors the NounsAuctionHouseV2 handlers but writes into the NounV2 tables.
// Events on NounV2AuctionHouse: AuctionCreated, AuctionBid, AuctionExtended,
// AuctionSettled, BeneficiaryUpdated (ignored — governance-only).
//
// NOTE: Date fields follow the repo convention of `new Date(Number(timestampSecs))`
// without multiplying by 1000. The rest of the codebase (NounsAuctionHouseV2,
// SmallGrantsTreasury, etc.) treats chain seconds as ms when building Date objects;
// downstream REST endpoints divide the stored Date by 1000 on the way out, so
// matching that convention keeps all tables consistent.

ponder.on('NounV2AuctionHouse:AuctionCreated', async ({ event, context }) => {
  await context.db.insert(nounV2Auction).values({
    nounId: event.args.nounId,
    startTime: new Date(Number(event.args.startTime)),
    endTime: new Date(Number(event.args.endTime)),
    settled: false,
    createdAt: new Date(Number(event.block.timestamp)),
    createdAtBlock: event.block.number,
    createdAtTransaction: event.transaction.hash,
  });
});

ponder.on('NounV2AuctionHouse:AuctionExtended', async ({ event, context }) => {
  // Same defensive pattern as AuctionSettled — if the original
  // AuctionCreated row is missing (startBlock skew), insert a stub so the
  // indexer doesn't crash. startTime is approximate (we don't have it
  // from the Extended event); the API surfaces show it as the extension
  // block which is acceptable until a re-sync from earlier blocks.
  await context.db
    .insert(nounV2Auction)
    .values({
      nounId: event.args.nounId,
      startTime: new Date(Number(event.block.timestamp)),
      endTime: new Date(Number(event.args.endTime)),
      settled: false,
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoUpdate({
      endTime: new Date(Number(event.args.endTime)),
    });
});

ponder.on('NounV2AuctionHouse:AuctionBid', async ({ event, context }) => {
  // Use onConflictDoUpdate to handle duplicate (nounId, value) pairs
  // that can occur during reorgs/re-syncs (PK is nounId+value).
  await context.db
    .insert(nounV2Bid)
    .values({
      nounId: event.args.nounId,
      bidder: event.args.sender,
      value: event.args.value,
      extended: event.args.extended,
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoUpdate({
      bidder: event.args.sender,
      extended: event.args.extended,
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    });
});

ponder.on('NounV2AuctionHouse:AuctionSettled', async ({ event, context }) => {
  // Use insert + onConflictDoUpdate so a missing AuctionCreated row (e.g.
  // when the indexer's startBlock lands AFTER the original AuctionCreated
  // for nounId=0) doesn't crash the entire indexer in a loop. We can
  // backfill the timestamps from the settle event itself — they aren't
  // perfectly accurate (settle is the *end* not the start) but the row
  // exists and downstream API queries don't blow up.
  await context.db
    .insert(nounV2Auction)
    .values({
      nounId: event.args.nounId,
      startTime: new Date(Number(event.block.timestamp)),
      endTime: new Date(Number(event.block.timestamp)),
      settled: true,
      winner: event.args.winner,
      amount: event.args.amount,
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoUpdate({
      settled: true,
      winner: event.args.winner,
      amount: event.args.amount,
    });
});
