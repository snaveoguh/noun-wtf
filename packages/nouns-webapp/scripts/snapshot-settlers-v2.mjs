// Build public/probe-dreams/settlers-v2.json + curated-v2.json for NounV2.
//
// V2 has no nounder reward — every noun is auctioned. The tx that settles
// auction N also creates auction N+1, so:
//   settler(N)  = tx.from of auction N+1's createdAtTransaction
//   curated(N)  = settler(N-1) = tx.from of auction N's createdAtTransaction
// (same +1 shift as V1: settling N rolls the block hash that seeds N+1.)
//
// Source: the indexer's /api/nounv2-auctions (createdAtTransaction per noun) +
// RPC for tx.from. Only ~70 nouns, so no Etherscan sweep needed.
//
// Usage: node scripts/snapshot-settlers-v2.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, fallback, http } from 'viem';
import { mainnet } from 'viem/chains';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../public/probe-dreams');
const API = 'https://spirited-flexibility-production-3c30.up.railway.app';

const client = createPublicClient({
  chain: mainnet,
  transport: fallback([
    http('https://ethereum-rpc.publicnode.com', { timeout: 10_000 }),
    http('https://1rpc.io/eth', { timeout: 10_000 }),
    http('https://eth.merkle.io', { timeout: 10_000 }),
  ]),
});

// Pull every V2 auction (endpoint returns a bare array).
const auctions = [];
for (let page = 1; ; page++) {
  const batch = await fetch(`${API}/api/nounv2-auctions?page=${page}&per_page=100`).then(r => r.json());
  if (!Array.isArray(batch) || batch.length === 0) break;
  auctions.push(...batch);
  if (batch.length < 100) break;
}
const txByNoun = new Map();
for (const a of auctions) {
  if (a.createdAtTransaction) txByNoun.set(Number(a.nounId), a.createdAtTransaction);
}
console.log(`fetched ${auctions.length} V2 auctions, ${txByNoun.size} with a creation tx`);

// tx.from cache to avoid duplicate lookups.
const fromCache = new Map();
async function txFrom(hash) {
  if (fromCache.has(hash)) return fromCache.get(hash);
  const tx = await client.getTransaction({ hash });
  const from = tx.from.toLowerCase();
  fromCache.set(hash, from);
  return from;
}

const settlers = {}; // nounId -> settler
const curated = {}; // nounId -> curator
const ids = [...txByNoun.keys()].sort((a, b) => a - b);
for (const m of ids) {
  const tx = txByNoun.get(m);
  const from = await txFrom(tx);
  // creating auction m settled auction m-1
  if (m - 1 >= 0) settlers[m - 1] = from;
  curated[m] = from; // curated(m) = settler(m-1)
}

writeFileSync(join(DATA_DIR, 'settlers-v2.json'), JSON.stringify(settlers) + '\n');
writeFileSync(join(DATA_DIR, 'curated-v2.json'), JSON.stringify(curated) + '\n');
const uniq = new Set(Object.values(settlers)).size;
console.log(`wrote settlers-v2.json (${Object.keys(settlers).length}) + curated-v2.json (${Object.keys(curated).length}), ${uniq} distinct settlers`);
