// Handlers for the homepage onchain feed: CryptoPunks sales, ENS
// registrations + secondary moves, CrypToadz secondary moves.
//
// Price heuristic for plain ERC721 transfers: `event.transaction.value` — a
// non-zero ETH value on the transfer tx is treated as the sale price. This
// catches native-ETH Seaport/marketplace fills without indexing the
// marketplaces themselves; WETH/Blur-pool fills surface as transfers.
import { ponder } from 'ponder:registry';
import { onchainEvent } from 'ponder:schema';

const ZERO = '0x0000000000000000000000000000000000000000';
// The active ETHRegistrarController mints to itself mid-registration before
// forwarding to the registrant — skip those internal hops.
const ENS_CONTROLLER = '0x59e16fccd424cc24e280be16e11bcd56fb0ce547';

ponder.on('CryptoPunks:PunkBought', async ({ event, context }) => {
  // acceptBidForPunk emits PunkBought with value=0 and toAddress=0x0 (the
  // well-known punks quirk) — the true price isn't in the event, so skip
  // rather than show a bogus 0 ETH sale.
  if (event.args.toAddress === ZERO || event.args.value === 0n) return;
  await context.db.insert(onchainEvent).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    source: 'punks',
    kind: 'sale',
    actor: event.args.toAddress,
    counterparty: event.args.fromAddress,
    tokenId: event.args.punkIndex,
    name: null,
    value: event.args.value,
    createdAt: new Date(Number(event.block.timestamp) * 1000),
    createdAtBlock: event.block.number,
    createdAtTransaction: event.transaction.hash,
  });
});

ponder.on('ENSController:NameRegistered', async ({ event, context }) => {
  await context.db.insert(onchainEvent).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    source: 'ens',
    kind: 'registration',
    actor: event.args.owner,
    counterparty: null,
    tokenId: null,
    name: `${event.args.name}.eth`,
    value: event.args.baseCost + event.args.premium,
    createdAt: new Date(Number(event.block.timestamp) * 1000),
    createdAtBlock: event.block.number,
    createdAtTransaction: event.transaction.hash,
  });
});

ponder.on('ENSRegistrar:Transfer', async ({ event, context }) => {
  const from = event.args.from.toLowerCase();
  const to = event.args.to.toLowerCase();
  // Mint path (0x0 → controller → registrant) is covered by NameRegistered.
  if (from === ZERO || from === ENS_CONTROLLER || to === ENS_CONTROLLER) return;
  const paid = event.transaction.value;
  await context.db.insert(onchainEvent).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    source: 'ens',
    kind: paid > 0n ? 'sale' : 'transfer',
    actor: event.args.to,
    counterparty: event.args.from,
    tokenId: event.args.tokenId,
    name: null, // token id is the labelhash; the name isn't recoverable from the event
    value: paid,
    createdAt: new Date(Number(event.block.timestamp) * 1000),
    createdAtBlock: event.block.number,
    createdAtTransaction: event.transaction.hash,
  });
});

ponder.on('CrypToadz:Transfer', async ({ event, context }) => {
  const from = event.args.from.toLowerCase();
  if (from === ZERO) return; // fully minted collection; ignore any residual mints
  const paid = event.transaction.value;
  await context.db.insert(onchainEvent).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    source: 'toadz',
    kind: paid > 0n ? 'sale' : 'transfer',
    actor: event.args.to,
    counterparty: event.args.from,
    tokenId: event.args.tokenId,
    name: null,
    value: paid,
    createdAt: new Date(Number(event.block.timestamp) * 1000),
    createdAtBlock: event.block.number,
    createdAtTransaction: event.transaction.hash,
  });
});
