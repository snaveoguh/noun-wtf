// Snapshot the Borgs contract (Polygon) into static JSON served from public/borgs/.
// Borgs are fully on-chain 24x24 pixel NFTs: each borg is a stack of layer attributes,
// each attribute is a sparse set of AARRGGBB pixels. We snapshot attributes once and
// per-borg attribute lists, so the client composites images locally.
//
// Usage: node scripts/snapshot-borgs.mjs
//
// Birth timestamps come from GeneratedBorg/BredBorg event logs via the
// Etherscan v2 API (Polygon). Set ETHERSCAN_API_KEY to refresh them; without
// a key the script preserves whatever births the previous snapshot had.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPublicClient, fallback, http, parseAbi } from 'viem';
import { polygon } from 'viem/chains';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../public/borgs');

const BORGS_ADDRESS = '0xa88E5cfA0257460490Ce54052B4faeE1b3d7f410';

const abi = parseAbi([
  'function getCurrentGenerationCount() view returns (uint256)',
  'function getCurrentBredCount() view returns (uint256)',
  'function getClaimedFreeBorgCount() view returns (uint256)',
  'function getBorg(uint256 borgId) view returns (string name, bytes8[] image, string[] attributes, uint256 parentId1, uint256 parentId2, uint256 childId)',
  'function combineBorgAttributes(string[] borgAttributeNames) view returns (bytes8[] hexPixals)',
  'function getAttributesUsedCount(string[] attributes) view returns (uint256[])',
  'function ownerOf(uint256 tokenId) view returns (address)',
]);

const client = createPublicClient({
  chain: polygon,
  transport: fallback([
    http('https://polygon-bor-rpc.publicnode.com'),
    http('https://polygon-rpc.com'),
    http('https://1rpc.io/matic'),
  ]),
});

const contract = { address: BORGS_ADDRESS, abi };

/** bytes8 hex ("0x4646...") -> 8-char ascii string like "FF000000" (AARRGGBB), '' when blank */
function decodePixel(bytes8Hex) {
  const raw = bytes8Hex.slice(2);
  let out = '';
  for (let i = 0; i < raw.length; i += 2) {
    const code = parseInt(raw.slice(i, i + 2), 16);
    if (code === 0) break; // null-terminated on-chain
    out += String.fromCharCode(code);
  }
  return out.trim();
}

async function multicallChunked(calls, { chunk, label }) {
  const results = [];
  for (let i = 0; i < calls.length; i += chunk) {
    const slice = calls.slice(i, i + chunk);
    let attempt = 0;
    for (;;) {
      try {
        const res = await client.multicall({ contracts: slice, allowFailure: true });
        results.push(...res);
        break;
      } catch (err) {
        attempt += 1;
        if (attempt >= 5) throw err;
        console.warn(`${label} chunk ${i / chunk} failed (attempt ${attempt}): ${err.shortMessage ?? err.message}`);
        await new Promise(r => setTimeout(r, 1500 * attempt));
      }
    }
    if ((i / chunk) % 10 === 0) console.log(`${label}: ${Math.min(i + chunk, calls.length)}/${calls.length}`);
  }
  return results;
}

// getBorg/combineBorgAttributes rebuild the whole 576-pixel image in-contract,
// so they're too gas-heavy to batch through multicall (inner calls blow the
// RPC's eth_call gas cap and all revert). Call them one by one, N in flight.
async function readEach(calls, { concurrency, label }) {
  const results = new Array(calls.length);
  let next = 0;
  let done = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= calls.length) return;
      let attempt = 0;
      for (;;) {
        try {
          results[i] = { status: 'success', result: await client.readContract(calls[i]) };
          break;
        } catch (err) {
          attempt += 1;
          if (attempt >= 5) {
            results[i] = { status: 'failure', error: err };
            break;
          }
          await new Promise(r => setTimeout(r, 1000 * attempt));
        }
      }
      done += 1;
      if (done % 200 === 0) console.log(`${label}: ${done}/${calls.length}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

const GENERATED_TOPIC = '0xf9c4d022d16b7cd17b6adc0fac78166a0b2a01764182d6d6b21908cc18d08d02'; // GeneratedBorg(uint256,address,uint256)
const BRED_TOPIC = '0xf1f96f272d2f40dc65c7d28da982e36bdf51f2761a03d90dfe5868cd18be911e'; // BredBorg(uint256,uint256,uint256,address,uint256)

/** borgId -> unix birth timestamp, from Polygonscan event logs (both event types). */
async function fetchBirths() {
  const key = process.env.ETHERSCAN_API_KEY;
  if (!key) {
    console.warn('ETHERSCAN_API_KEY not set — preserving births from previous snapshot');
    return null;
  }
  const births = new Map();
  for (const topic of [GENERATED_TOPIC, BRED_TOPIC]) {
    let fromBlock = 0;
    for (;;) {
      const url =
        `https://api.etherscan.io/v2/api?chainid=137&module=logs&action=getLogs` +
        `&address=${BORGS_ADDRESS}&topic0=${topic}&fromBlock=${fromBlock}&toBlock=latest` +
        `&page=1&offset=1000&apikey=${key}`;
      const res = await fetch(url).then(r => r.json());
      if (res.status !== '1' && res.message !== 'No records found') {
        throw new Error(`etherscan logs: ${res.message} ${res.result}`);
      }
      const logs = Array.isArray(res.result) ? res.result : [];
      for (const log of logs) {
        // borgId / childId is topic1 for both events
        births.set(parseInt(log.topics[1], 16), parseInt(log.timeStamp, 16));
      }
      if (logs.length < 1000) break;
      // paginate by block cursor (page=1 with advancing fromBlock avoids the
      // etherscan 10k-result page window); events on the boundary block are
      // re-fetched and harmlessly overwrite.
      fromBlock = parseInt(logs[logs.length - 1].blockNumber, 16);
      await new Promise(r => setTimeout(r, 250)); // free tier: 5 req/s
    }
  }
  return births;
}

function previousBirths() {
  const prev = join(OUT_DIR, 'borgs.json');
  if (!existsSync(prev)) return new Map();
  try {
    const { borgs } = JSON.parse(readFileSync(prev, 'utf8'));
    return new Map(borgs.filter(b => b[7] > 0).map(b => [b[0], b[7]]));
  } catch {
    return new Map();
  }
}

async function main() {
  const [blockNumber, generated, bred, freeClaimed] = await Promise.all([
    client.getBlockNumber(),
    client.readContract({ ...contract, functionName: 'getCurrentGenerationCount' }),
    client.readContract({ ...contract, functionName: 'getCurrentBredCount' }),
    client.readContract({ ...contract, functionName: 'getClaimedFreeBorgCount' }),
  ]);
  const maxId = Number(generated) + Number(bred);
  console.log(`block ${blockNumber} | generated ${generated} | bred ${bred} | maxId ${maxId}`);

  const ids = Array.from({ length: maxId }, (_, i) => i + 1);

  const borgResults = await readEach(
    ids.map(id => ({ ...contract, functionName: 'getBorg', args: [BigInt(id)] })),
    { concurrency: 8, label: 'getBorg' },
  );
  // Second pass over failures — transient RPC windows can take out whole ranges.
  const failedIdx = borgResults.map((r, i) => (r.status === 'failure' ? i : -1)).filter(i => i >= 0);
  if (failedIdx.length) {
    console.log(`retrying ${failedIdx.length} failed getBorg calls...`);
    await new Promise(r => setTimeout(r, 5000));
    const retried = await readEach(
      failedIdx.map(i => ({ ...contract, functionName: 'getBorg', args: [BigInt(ids[i])] })),
      { concurrency: 2, label: 'getBorg-retry' },
    );
    failedIdx.forEach((origIdx, j) => {
      borgResults[origIdx] = retried[j];
    });
  }
  const ownerResults = await multicallChunked(
    ids.map(id => ({ ...contract, functionName: 'ownerOf', args: [BigInt(id)] })),
    { chunk: 400, label: 'ownerOf' },
  );

  // Collect unique attributes and the layer index they appear at.
  const attrLayer = new Map(); // name -> layer index
  const failures = [];
  const rawBorgs = ids.map((id, i) => {
    const r = borgResults[i];
    if (r.status !== 'success') {
      failures.push(id);
      return null;
    }
    const [name, , attributes, parentId1, parentId2, childId] = r.result;
    attributes.forEach((attrName, layer) => {
      if (!attrLayer.has(attrName)) attrLayer.set(attrName, layer);
    });
    const ownerRes = ownerResults[i];
    return {
      id,
      name,
      attributes,
      parent1: Number(parentId1),
      parent2: Number(parentId2),
      child: Number(childId),
      owner: ownerRes.status === 'success' ? ownerRes.result.toLowerCase() : null,
    };
  }).filter(Boolean);
  if (failures.length) console.warn(`getBorg failed for ids: ${failures.join(', ')}`);

  const attrNames = [...attrLayer.keys()];
  console.log(`${rawBorgs.length} borgs, ${attrNames.length} unique attributes`);

  // Pixel data per attribute (shared across every borg wearing it).
  const pixelResults = await readEach(
    attrNames.map(n => ({ ...contract, functionName: 'combineBorgAttributes', args: [[n]] })),
    { concurrency: 8, label: 'attributePixels' },
  );
  const usedCounts = await client.readContract({
    ...contract,
    functionName: 'getAttributesUsedCount',
    args: [attrNames],
  });

  const attributes = attrNames.map((name, i) => {
    const px = {};
    if (pixelResults[i].status === 'success') {
      pixelResults[i].result.forEach((p, pos) => {
        const hex = decodePixel(p);
        if (!hex) return;
        (px[hex] ??= []).push(pos);
      });
    } else {
      console.warn(`combineBorgAttributes failed for "${name}"`);
    }
    return { n: name, l: attrLayer.get(name), u: Number(usedCounts[i]), px };
  });

  const births = (await fetchBirths().catch(err => {
    console.warn(`birth fetch failed (${err.message}) — preserving previous births`);
    return null;
  })) ?? previousBirths();
  console.log(`${births.size} birth timestamps`);

  const attrIndex = new Map(attrNames.map((n, i) => [n, i]));
  const owners = [];
  const ownerIndex = new Map();
  const borgs = rawBorgs.map(b => {
    let oi = -1;
    if (b.owner) {
      if (!ownerIndex.has(b.owner)) {
        ownerIndex.set(b.owner, owners.length);
        owners.push(b.owner);
      }
      oi = ownerIndex.get(b.owner);
    }
    return [
      b.id,
      b.attributes.map(a => attrIndex.get(a)),
      b.parent1,
      b.parent2,
      b.child,
      oi,
      b.name,
      births.get(b.id) ?? 0,
    ];
  });

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'attributes.json'), JSON.stringify({ attributes }));
  writeFileSync(join(OUT_DIR, 'borgs.json'), JSON.stringify({ owners, borgs }));
  writeFileSync(
    join(OUT_DIR, 'meta.json'),
    JSON.stringify({
      contract: BORGS_ADDRESS,
      chainId: 137,
      snapshotBlock: Number(blockNumber),
      generated: Number(generated),
      bred: Number(bred),
      freeClaimed: Number(freeClaimed),
      maxId,
      updatedAt: new Date().toISOString(),
    }),
  );
  console.log(`wrote ${OUT_DIR} (${borgs.length} borgs, ${attributes.length} attributes, ${owners.length} owners)`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
