// Delta-refresh public/probe-dreams/settlers.json + curated.json from chain.
//
// Settler of noun N = tx.from of the AuctionSettled(N) transaction. Nounder
// nouns (id % 10 == 0, skipped by the auction) inherit the settler of N-1 —
// the same tx minted them. Curated is the +1 shift: settling N rolls the
// block hash that seeds N+1's traits, so settler of N "curated" N+1.
//
// Usage: ETHERSCAN_API_KEY=... node scripts/snapshot-settlers.mjs
// (key needed for the event-log sweep; free tier is plenty for the delta)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPublicClient, fallback, http } from 'viem';
import { mainnet } from 'viem/chains';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../public/probe-dreams');
const AUCTION_HOUSE = '0x830BD73E4184ceF73443C15111a1DF14e495C706';
const AUCTION_SETTLED_TOPIC = '0xc9f72b276a388619c6d185d146697036241880c36654b1a3ffdad07c24038d99';

const key = process.env.ETHERSCAN_API_KEY;
if (!key) throw new Error('ETHERSCAN_API_KEY required (event-log sweep)');

const client = createPublicClient({
  chain: mainnet,
  transport: fallback([
    http('https://ethereum-rpc.publicnode.com', { timeout: 10_000 }),
    http('https://1rpc.io/eth', { timeout: 10_000 }),
    http('https://eth.merkle.io', { timeout: 10_000 }),
  ]),
});

const settlers = JSON.parse(readFileSync(join(DATA_DIR, 'settlers.json'), 'utf8'));
const maxKnown = Math.max(...Object.keys(settlers).map(Number));
console.log(`existing entries: ${Object.keys(settlers).length}, max noun id: ${maxKnown}`);

// Full paginated sweep of AuctionSettled events (cheap — a few pages), but we
// only hit the RPC for tx.from on nouns we don't already have.
const events = []; // { nounId, txHash }
let fromBlock = 0;
for (;;) {
  const url =
    `https://api.etherscan.io/v2/api?chainid=1&module=logs&action=getLogs` +
    `&address=${AUCTION_HOUSE}&topic0=${AUCTION_SETTLED_TOPIC}` +
    `&fromBlock=${fromBlock}&toBlock=latest&page=1&offset=1000&apikey=${key}`;
  const res = await fetch(url).then(r => r.json());
  if (res.status !== '1' && res.message !== 'No records found') {
    throw new Error(`etherscan logs: ${res.message} ${res.result}`);
  }
  const logs = Array.isArray(res.result) ? res.result : [];
  for (const log of logs) {
    events.push({ nounId: parseInt(log.topics[1], 16), txHash: log.transactionHash });
  }
  if (logs.length < 1000) break;
  fromBlock = parseInt(logs[logs.length - 1].blockNumber, 16);
  await new Promise(r => setTimeout(r, 250));
}
console.log(`${events.length} AuctionSettled events on-chain`);

// Sanity: on-chain event coverage should include everything we already have
// (bar nounder/derived entries), and extend past it.
const newEvents = events.filter(e => e.nounId > maxKnown);
console.log(`${newEvents.length} settlements newer than snapshot`);

for (const { nounId, txHash } of newEvents) {
  const tx = await client.getTransaction({ hash: txHash });
  settlers[String(nounId)] = tx.from.toLowerCase();
}

// Nounder fill: every 10th noun is minted by the settlement tx of the
// preceding auction — same settler as N-1.
const maxNow = Math.max(...Object.keys(settlers).map(Number));
for (let id = 0; id <= maxNow; id++) {
  if (settlers[String(id)] === undefined && id % 10 === 0 && settlers[String(id - 1)]) {
    settlers[String(id)] = settlers[String(id - 1)];
  }
}

// Curated = +1 shift; preserve any hand-set entry for noun 0.
const curatedPrev = JSON.parse(readFileSync(join(DATA_DIR, 'curated.json'), 'utf8'));
const curated = {};
if (curatedPrev['0'] !== undefined) curated['0'] = curatedPrev['0'];
for (const [id, settler] of Object.entries(settlers)) {
  curated[String(Number(id) + 1)] = settler;
}

writeFileSync(join(DATA_DIR, 'settlers.json'), JSON.stringify(settlers));
writeFileSync(join(DATA_DIR, 'curated.json'), JSON.stringify(curated));
console.log(
  `wrote settlers.json (${Object.keys(settlers).length}) + curated.json (${Object.keys(curated).length}), max noun ${maxNow}`,
);
