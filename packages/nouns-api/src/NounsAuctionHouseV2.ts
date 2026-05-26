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
  // Per-tx event ordering can fire AuctionBidWithClientId before AuctionBid, so
  // a guarded `update` would silently drop the clientId. Upsert instead: insert
  // a placeholder bid row carrying the clientId, or set clientId on the
  // existing row. AuctionBid's own onConflictDoUpdate will overwrite the
  // placeholder bidder/timestamps when it fires later in the same tx.
  await context.db
    .insert(bid)
    .values({
      nounId: event.args.nounId,
      value: event.args.value,
      bidder: event.transaction.from,
      clientId: event.args.clientId,
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoUpdate({
      clientId: event.args.clientId,
    });
});

// Zero address as the winner + zero amount = reserve-price auction that
// ended with no qualifying bid. Historically the AuctionHouse burned the
// noun to 0x0; as of Noun #1914 it transfers the unsold noun to the Nouns
// DAO treasury (nouns.eth) instead. We confirm by reading ownerOf — only
// flag burned when ownerOf reverts (no owner = actually burned).
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
const NOUNS_TOKEN_ADDRESS = '0x9C8fF314C9Bc7F6e59A9d9225Fb22946427eDC03' as const;
const NOUNS_TOKEN_OWNER_OF_ABI = [
  {
    type: 'function',
    name: 'ownerOf',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const;

ponder.on('NounsAuctionHouseV2:AuctionSettled', async ({ event, context }) => {
  const winner = event.args.winner;
  const amount = event.args.amount;
  const noQualifyingBid = winner === ZERO_ADDRESS && amount === 0n;

  let actuallyBurned = false;
  if (noQualifyingBid) {
    try {
      await context.client.readContract({
        abi: NOUNS_TOKEN_OWNER_OF_ABI,
        address: NOUNS_TOKEN_ADDRESS,
        functionName: 'ownerOf',
        args: [event.args.nounId],
      });
    } catch {
      actuallyBurned = true;
    }
  }

  await context.db.update(auction, { nounId: event.args.nounId }).set({
    settled: true,
    // settler: event.transaction.from, // TODO: enable after initial sync
    winner: noQualifyingBid ? null : winner,
    amount,
    burned: actuallyBurned,
  });
});

ponder.on('NounsAuctionHouseV2:AuctionSettledWithClientId', async ({ event, context }) => {
  await context.db.update(auction, { nounId: event.args.nounId }).set({
    clientId: event.args.clientId,
  });
});
