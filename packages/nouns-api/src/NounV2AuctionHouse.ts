import { ponder } from 'ponder:registry';
import { nounV2Auction, nounV2Bid } from 'ponder:schema';

// Mirrors the NounsAuctionHouseV2 handlers but writes into the NounV2 tables.
// Events on NounV2AuctionHouse: AuctionCreated, AuctionBid, AuctionExtended,
// AuctionSettled, BeneficiaryUpdated (ignored — governance-only).
//
// NOTE on dates: this file follows the repo's legacy convention of
// `new Date(Number(timestampSecs))` — i.e. it stores chain seconds in the
// Date as if they were milliseconds, so the persisted Date represents some
// time in Jan 1970, BUT its `.getTime()` numerically equals the original
// Unix-seconds value. NounsAuctionHouseV2, SmallGrantsTreasury, NounsDAOV4,
// etc. all do the same.
//
// To round-trip safely, downstream REST handlers must output `.getTime()`
// directly (which equals chain seconds) — DO NOT also divide by 1000, or the
// consumer's `new Date(value * 1000)` reconstruction lands in 1970. The V2
// bid history popover bug (see api/index.ts `/api/nounv2-auctions/:nounId`)
// was caused by the extra `/1000`. Prefer the correct pattern in new code:
//
//   indexer:  createdAt: new Date(Number(secs) * 1000)   ← stores real date
//   REST:     timestamp: String(Math.floor(d.getTime()/1000))   ← real seconds
//
// but only when nothing else is reading the table (a schema/data migration
// is required to switch a table over).

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
