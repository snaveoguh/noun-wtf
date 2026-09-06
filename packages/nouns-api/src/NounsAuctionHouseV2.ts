import { desc, eq } from 'ponder';
import { type Context, type Event, ponder } from 'ponder:registry';
import { auction, auctionConfigEvent, bid } from 'ponder:schema';

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

type AuctionCreatedEvent = Event<'NounsAuctionHouseV2:AuctionCreated'>;
type AuctionContext = Context<'NounsAuctionHouseV2:AuctionCreated'>;

/** `ownerOf` reverts only when the token no longer exists, i.e. it was burned. */
async function isBurned(nounId: bigint, context: AuctionContext): Promise<boolean> {
  try {
    await context.client.readContract({
      abi: NOUNS_TOKEN_OWNER_OF_ABI,
      address: NOUNS_TOKEN_ADDRESS,
      functionName: 'ownerOf',
      args: [nounId],
    });
    return false;
  } catch {
    return true;
  }
}

// ── Settlement self-heal ──────────────────────────────────────────────────────
// The AuctionHouse can only create auction N+1 once auction N is settled
// (settleCurrentAndCreateNewAuction, or unpause() after an explicit
// settleAuction()). So an auction row that is still `settled=false` when a
// LATER AuctionCreated arrives is a hole in our event stream, never on-chain
// state.
//
// Holes are real and sticky. Ponder's RPC sync cache (`ponder_sync.*`) is
// shared by every deploy — only the app schema is per-`railway up` — so a
// single eth_getLogs response that came back one log short gets written to
// the cache with its block range marked complete, and every re-index after
// that trusts the cache instead of asking the RPC again. Noun 1682 was lost
// this way: its AuctionSettled (tx 0xf4cbb2c7…, block 23591845, logIndex 269)
// never made it into ponder_sync.logs while AuctionCreated(1683) from the very
// same tx did.
//
// Reconcile from what we know for certain:
//   • winner / amount / clientId — the highest AuctionBid we indexed. That is
//     exactly what _settleAuction emits (`_auction.bidder`, `_auction.amount`);
//     no bid at all means a reserve-not-met settle (winner 0x0, amount 0).
//   • settler / settledAt — the AuctionCreated tx itself. Exact for the
//     settleCurrentAndCreateNewAuction path, which is every settle since 2021
//     bar a handful of pause/unpause incidents. getSettlements() on the AH is
//     consulted best-effort to confirm; if its blockTimestamp disagrees we keep
//     the on-chain winner/amount/timestamp but leave settler and the settle tx
//     null rather than credit the wrong wallet.

const AH_GET_SETTLEMENTS_ABI = [
  {
    type: 'function',
    name: 'getSettlements',
    stateMutability: 'view',
    inputs: [
      { name: 'startId', type: 'uint256' },
      { name: 'endId', type: 'uint256' },
      { name: 'skipEmptyValues', type: 'bool' },
    ],
    outputs: [
      {
        name: 'settlements',
        type: 'tuple[]',
        components: [
          { name: 'blockTimestamp', type: 'uint32' },
          { name: 'amount', type: 'uint256' },
          { name: 'winner', type: 'address' },
          { name: 'nounId', type: 'uint256' },
          { name: 'clientId', type: 'uint32' },
        ],
      },
    ],
  },
] as const;

/** NounsToken mints every 10th noun to nounders while `_currentNounId <= 1820`; those ids never had an auction. */
const isV1NounderNoun = (id: bigint): boolean => id % 10n === 0n && id <= 1820n;

/** The auction the AH had to settle before it could create `nounId` (null for the first auction). */
function previousAuctionedNounId(nounId: bigint): bigint | null {
  if (nounId === 0n) return null;
  const prev = nounId - 1n;
  if (!isV1NounderNoun(prev)) return prev;
  return prev === 0n ? null : prev - 1n;
}

async function healSettlement(nounId: bigint, event: AuctionCreatedEvent, context: AuctionContext) {
  const [topBid] = await context.db.sql
    .select({ bidder: bid.bidder, value: bid.value, clientId: bid.clientId })
    .from(bid)
    .where(eq(bid.nounId, nounId))
    .orderBy(desc(bid.value))
    .limit(1);

  let winner: `0x${string}` | null = topBid?.bidder ?? null;
  let amount = topBid?.value ?? 0n;
  let clientId: number | null = topBid?.clientId ?? null;
  let settledAtSec = Number(event.block.timestamp);
  // settleCurrentAndCreateNewAuction: the settle and this AuctionCreated share a tx.
  let sameTx = true;

  try {
    const [onchain] = await context.client.readContract({
      abi: AH_GET_SETTLEMENTS_ABI,
      address: event.log.address,
      functionName: 'getSettlements',
      args: [nounId, nounId + 1n, false], // endId is exclusive
    });
    if (onchain && onchain.blockTimestamp !== 0) {
      winner = onchain.winner === ZERO_ADDRESS ? null : onchain.winner;
      amount = onchain.amount;
      if (onchain.clientId !== 0) clientId = onchain.clientId;
      settledAtSec = onchain.blockTimestamp;
      sameTx = BigInt(onchain.blockTimestamp) === event.block.timestamp;
    }
  } catch (err) {
    // Archive eth_call can time out on the free dRPC plan; the indexed bids are
    // authoritative for winner/amount anyway, so carry on with those.
    console.warn(
      `[auction-heal] getSettlements(${nounId}) failed, reconciling from indexed bids:`,
      err instanceof Error ? err.message : err,
    );
  }

  console.warn(
    `[auction-heal] auction ${nounId} was still unsettled when auction ${event.args.nounId} was created ` +
      `(block ${event.block.number}) — AuctionSettled log missing from the sync cache; reconciled` +
      (sameTx ? ` from tx ${event.transaction.hash}` : ' (settle tx unknown, settler left null)'),
  );

  await context.db.update(auction, { nounId }).set({
    settled: true,
    settler: sameTx ? event.transaction.from : null,
    settledAt: new Date(settledAtSec),
    settledAtBlock: sameTx ? event.block.number : null,
    settledAtTransaction: sameTx ? event.transaction.hash : null,
    winner,
    amount,
    burned: winner === null ? await isBurned(nounId, context) : false,
    ...(clientId === null ? {} : { clientId }),
  });
}

/**
 * Walk back from the auction that had to be settled for this one to exist and
 * reconcile any that we still hold as unsettled. Normal path: a single cached
 * `find()` returns a settled row and we stop.
 */
async function healUnsettledAuctionsBefore(event: AuctionCreatedEvent, context: AuctionContext) {
  let prevId = previousAuctionedNounId(event.args.nounId);
  while (prevId !== null) {
    const prev = await context.db.find(auction, { nounId: prevId });
    if (!prev || prev.settled) break;
    await healSettlement(prev.nounId, event, context);
    prevId = previousAuctionedNounId(prevId);
  }
}

ponder.on('NounsAuctionHouseV2:AuctionCreated', async ({ event, context }) => {
  await healUnsettledAuctionsBefore(event, context);

  await context.db.insert(auction).values({
    nounId: event.args.nounId,
    startTime: new Date(Number(event.args.startTime)),
    endTime: new Date(Number(event.args.endTime)),
    settled: false,
    // settleCurrentAndCreateNewAuction is one tx: whoever settled the previous
    // auction "curates" this one.
    curator: event.transaction.from,
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

ponder.on('NounsAuctionHouseV2:AuctionSettled', async ({ event, context }) => {
  const winner = event.args.winner;
  const amount = event.args.amount;
  const noQualifyingBid = winner === ZERO_ADDRESS && amount === 0n;
  const actuallyBurned = noQualifyingBid ? await isBurned(event.args.nounId, context) : false;

  await context.db.update(auction, { nounId: event.args.nounId }).set({
    settled: true,
    settler: event.transaction.from,
    settledAt: new Date(Number(event.block.timestamp)),
    settledAtBlock: event.block.number,
    settledAtTransaction: event.transaction.hash,
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

// ── Auction config changes ──────────────────────────────────────────────────
// The AH events only carry the new value. We back-fill `oldValue` from the
// most recent row for the same param so the feed can render "X → Y".

ponder.on('NounsAuctionHouseV2:AuctionReservePriceUpdated', async ({ event, context }) => {
  const param = 'reservePrice';
  const prev = await context.db.sql
    .select({ newValue: auctionConfigEvent.newValue })
    .from(auctionConfigEvent)
    .where(eq(auctionConfigEvent.param, param))
    .orderBy(desc(auctionConfigEvent.createdAtBlock))
    .limit(1);
  await context.db
    .insert(auctionConfigEvent)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      param,
      oldValue: prev[0]?.newValue ?? null,
      newValue: event.args.reservePrice.toString(),
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});

ponder.on('NounsAuctionHouseV2:AuctionTimeBufferUpdated', async ({ event, context }) => {
  const param = 'timeBuffer';
  const prev = await context.db.sql
    .select({ newValue: auctionConfigEvent.newValue })
    .from(auctionConfigEvent)
    .where(eq(auctionConfigEvent.param, param))
    .orderBy(desc(auctionConfigEvent.createdAtBlock))
    .limit(1);
  await context.db
    .insert(auctionConfigEvent)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      param,
      oldValue: prev[0]?.newValue ?? null,
      newValue: event.args.timeBuffer.toString(),
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});

ponder.on(
  'NounsAuctionHouseV2:AuctionMinBidIncrementPercentageUpdated',
  async ({ event, context }) => {
    const param = 'minBidIncrement';
    const prev = await context.db.sql
      .select({ newValue: auctionConfigEvent.newValue })
      .from(auctionConfigEvent)
      .where(eq(auctionConfigEvent.param, param))
      .orderBy(desc(auctionConfigEvent.createdAtBlock))
      .limit(1);
    await context.db
      .insert(auctionConfigEvent)
      .values({
        id: `${event.transaction.hash}-${event.log.logIndex}`,
        param,
        oldValue: prev[0]?.newValue ?? null,
        newValue: event.args.minBidIncrementPercentage.toString(),
        createdAt: new Date(Number(event.block.timestamp)),
        createdAtBlock: event.block.number,
        createdAtTransaction: event.transaction.hash,
      })
      .onConflictDoNothing();
  },
);
