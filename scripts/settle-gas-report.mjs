// Sum the ETH a wallet has spent on gas settling Nouns auctions.
//
// Usage: node scripts/settle-gas-report.mjs 0xabc... 0xdef...
// Env:   ETHERSCAN_API_KEY (optional, Etherscan V2 fallback), RPC_URL (optional)
//
// Method: pull every outgoing tx for the address (Blockscout, Etherscan fallback),
// keep the ones that (a) call settleCurrentAndCreateNewAuction / settleAuction on
// any contract, or (b) target a contract the address itself deployed (e.g. the
// nounirl ExactBlockSettler helper), then price each one from its receipt
// (gasUsed * effectiveGasPrice). Reverted attempts are counted separately.

const RPC = process.env.RPC_URL || 'https://ethereum-rpc.publicnode.com';
const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY || '';
const KNOWN_AUCTION_HOUSES = [
  '0x830bd73e4184cef73443c15111a1df14e495c706', // Nouns AuctionHouse proxy
  '0x9a6ddb16e23967d5482e5bfd7444a04a5d5145fc', // NounV2 AuctionHouse
];
const SETTLE_SELECTORS = new Set([
  '0xf25efffc', // settleCurrentAndCreateNewAuction()
  '0x87e2f6ee', // settleAuction()  (fallback; functionName match is primary)
]);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json' } });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}

async function txlistBlockscout(address) {
  const out = [];
  const seen = new Set();
  let page = 1;
  const offset = 1000;
  for (;;) {
    const url = `https://eth.blockscout.com/api?module=account&action=txlist&address=${address}&sort=asc&page=${page}&offset=${offset}`;
    const j = await getJson(url);
    if (j.status !== '1' && !(Array.isArray(j.result) && j.result.length === 0)) {
      if (String(j.message || '').toLowerCase().includes('no transactions')) break;
      throw new Error(`blockscout: ${j.message} ${JSON.stringify(j.result).slice(0, 200)}`);
    }
    const rows = j.result || [];
    for (const t of rows) if (!seen.has(t.hash)) { seen.add(t.hash); out.push(t); }
    if (rows.length < offset) break;
    page++;
    await sleep(300);
  }
  return out;
}

async function txlistEtherscan(address) {
  const out = [];
  const seen = new Set();
  let page = 1;
  const offset = 10000;
  for (;;) {
    const url = `https://api.etherscan.io/v2/api?chainid=1&module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=${page}&offset=${offset}&sort=asc&apikey=${ETHERSCAN_KEY}`;
    const j = await getJson(url);
    if (j.status !== '1') {
      if (String(j.message || '').toLowerCase().includes('no transactions')) break;
      throw new Error(`etherscan: ${j.message} ${j.result}`);
    }
    for (const t of j.result) if (!seen.has(t.hash)) { seen.add(t.hash); out.push(t); }
    if (j.result.length < offset) break;
    page++;
    await sleep(300);
  }
  return out;
}

async function txlist(address) {
  try {
    const rows = await txlistBlockscout(address);
    return { source: 'blockscout', rows };
  } catch (e) {
    console.error(`blockscout failed for ${address}: ${e.message}`);
    if (!ETHERSCAN_KEY) throw e;
    const rows = await txlistEtherscan(address);
    return { source: 'etherscan', rows };
  }
}

const RPCS = [RPC, 'https://eth.llamarpc.com', 'https://1rpc.io/eth', 'https://eth.drpc.org', 'https://cloudflare-eth.com'];

async function rpcBatch(hashes) {
  const body = hashes.map((h, k) => ({ jsonrpc: '2.0', id: k, method: 'eth_getTransactionReceipt', params: [h] }));
  for (const url of RPCS) {
    for (let t = 0; t < 3; t++) {
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        const res = await r.json();
        if (!Array.isArray(res)) throw new Error(JSON.stringify(res).slice(0, 160));
        const out = new Map();
        for (const x of res) if (x && x.result) out.set(hashes[x.id], x.result);
        if (out.size === hashes.length) return out;
        // partial: fetch the rest individually from the same node
        for (const h of hashes) {
          if (out.has(h)) continue;
          const r2 = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [h] }) });
          const j2 = await r2.json();
          if (j2 && j2.result) out.set(h, j2.result);
          await sleep(120);
        }
        if (out.size === hashes.length) return out;
        throw new Error(`only ${out.size}/${hashes.length} receipts from ${url}`);
      } catch (e) {
        console.error(`receipts via ${url} attempt ${t + 1}: ${e.message}`);
        await sleep(1000 * (t + 1));
      }
    }
  }
  throw new Error('all RPCs failed for a receipt batch');
}

async function receipts(hashes) {
  const out = new Map();
  for (let i = 0; i < hashes.length; i += 20) {
    const chunk = hashes.slice(i, i + 20);
    const m = await rpcBatch(chunk);
    for (const [k, v] of m) out.set(k, v);
    await sleep(150);
  }
  return out;
}

const fmtEth = wei => (Number(wei) / 1e18).toFixed(6);

async function report(address) {
  const addr = address.toLowerCase();
  const { source, rows } = await txlist(addr);
  const outgoing = rows.filter(t => (t.from || '').toLowerCase() === addr);

  // Contracts this wallet deployed (helper settlers etc).
  const deployed = new Set(
    outgoing.filter(t => (!t.to || t.to === '') && t.contractAddress).map(t => t.contractAddress.toLowerCase()),
  );

  const isDirect = t => {
    const sel = (t.input || '').slice(0, 10).toLowerCase();
    const fn = String(t.functionName || '').toLowerCase();
    return SETTLE_SELECTORS.has(sel) || fn.startsWith('settle');
  };
  const direct = outgoing.filter(isDirect);
  const helperCalls = outgoing.filter(t => !isDirect(t) && t.to && deployed.has(t.to.toLowerCase()));
  const rec = await receipts([...direct, ...helperCalls].map(t => t.hash));

  // Learn auction-house addresses + their settle-related topics from the direct settle txs.
  const auctionHouses = new Set([...KNOWN_AUCTION_HOUSES, ...direct.map(t => t.to.toLowerCase())]);
  const settleTopics = new Set();
  for (const t of direct) {
    const r = rec.get(t.hash);
    if (!r || r.status !== '0x1') continue;
    for (const l of r.logs) if (auctionHouses.has(l.address.toLowerCase())) settleTopics.add(l.topics[0]);
  }
  const ahFromLogs = t => {
    const r = rec.get(t.hash);
    if (!r) return null;
    for (const l of r.logs) if (auctionHouses.has(l.address.toLowerCase()) && settleTopics.has(l.topics[0])) return l.address.toLowerCase();
    return null;
  };
  // A helper call counts if it succeeded and emitted settle logs on an auction house, or if it
  // reverted and the helper has at least one successful settle (so failed attempts are counted).
  const settlingHelpers = new Set(helperCalls.filter(t => ahFromLogs(t)).map(t => t.to.toLowerCase()));
  const viaHelper = helperCalls.filter(t => ahFromLogs(t) || settlingHelpers.has(t.to.toLowerCase()));
  const settleTxs = [...direct, ...viaHelper].sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber));
  const isSettle = t => settleTxs.includes(t);

  let okWei = 0n, okCount = 0, revWei = 0n, revCount = 0, missing = 0;
  const byTarget = {};
  const rowsOut = [];
  for (const t of settleTxs) {
    const r = rec.get(t.hash);
    let fee, ok;
    if (r) {
      fee = BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice);
      ok = r.status === '0x1';
    } else {
      missing++;
      fee = BigInt(t.gasUsed) * BigInt(t.gasPrice);
      ok = t.isError === '0';
    }
    if (ok) { okWei += fee; okCount++; } else { revWei += fee; revCount++; }
    const to = (t.to || '').toLowerCase();
    const ah = isDirect(t) ? to : (ahFromLogs(t) || `helper:${to}`);
    const key = isDirect(t) ? ah : `${ah} via ${to}`;
    byTarget[key] ??= { count: 0, ok: 0, reverted: 0, wei: 0n, firstTs: Number(t.timeStamp), lastTs: Number(t.timeStamp) };
    byTarget[key].count++;
    byTarget[key][ok ? 'ok' : 'reverted']++;
    byTarget[key].wei += fee;
    byTarget[key].lastTs = Number(t.timeStamp);
    rowsOut.push({ hash: t.hash, block: Number(t.blockNumber), ts: Number(t.timeStamp), ok, feeEth: fmtEth(fee), to, ah });
  }

  // Everything else outgoing, grouped, so misclassification is visible.
  const otherByTarget = {};
  for (const t of outgoing) {
    if (isSettle(t)) continue;
    const key = `${(t.to || 'CREATE').toLowerCase()} ${(t.functionName || t.input.slice(0, 10) || 'transfer').split('(')[0]}`;
    otherByTarget[key] ??= 0;
    otherByTarget[key]++;
  }

  // Label each auction house by the ERC721 it mints (Transfer log in a successful settle tx).
  const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f3163c4a1b1c76d3aecbc4ac0b';
  const ahLabels = {};
  for (const t of settleTxs) {
    const ah = isDirect(t) ? (t.to || '').toLowerCase() : ahFromLogs(t);
    if (!ah || ahLabels[ah]) continue;
    const r = rec.get(t.hash);
    if (!r || r.status !== '0x1') continue;
    const mint = r.logs.find(l => l.topics[0] === TRANSFER && l.topics.length === 4 && l.address.toLowerCase() !== ah);
    let label = { token: mint?.address?.toLowerCase() ?? null };
    try {
      if (mint) {
        const tk = await getJson(`https://eth.blockscout.com/api/v2/tokens/${mint.address}`);
        label.tokenName = tk.name; label.tokenSymbol = tk.symbol;
      }
      const ad = await getJson(`https://eth.blockscout.com/api/v2/addresses/${ah}`);
      label.contractName = ad.name ?? null;
      label.implementation = ad.implementations?.map(x => x.name).filter(Boolean).join(',') || null;
    } catch (e) { label.error = e.message; }
    ahLabels[ah] = label;
    await sleep(200);
  }

  const first = rowsOut[0], last = rowsOut[rowsOut.length - 1];
  return {
    address: addr,
    source,
    totalOutgoingTxs: outgoing.length,
    deployedContracts: [...deployed],
    settle: {
      successful: { count: okCount, eth: fmtEth(okWei) },
      reverted: { count: revCount, eth: fmtEth(revWei) },
      total: { count: okCount + revCount, eth: fmtEth(okWei + revWei) },
      receiptsMissing: missing,
      first: first && { block: first.block, date: new Date(first.ts * 1000).toISOString(), hash: first.hash },
      last: last && { block: last.block, date: new Date(last.ts * 1000).toISOString(), hash: last.hash },
    },
    settleTopics: [...settleTopics],
    auctionHouseLabels: ahLabels,
    settleByTarget: Object.fromEntries(Object.entries(byTarget).map(([k, v]) => [k, { count: v.count, ok: v.ok, reverted: v.reverted, eth: fmtEth(v.wei), first: new Date(v.firstTs * 1000).toISOString().slice(0, 10), last: new Date(v.lastTs * 1000).toISOString().slice(0, 10) }])),
    otherOutgoingGroups: Object.keys(otherByTarget).length,
    txs: rowsOut,
  };
}

async function resolveEns(name) {
  const tries = [
    async () => (await getJson(`https://api.ensideas.com/ens/resolve/${name}`)).address,
    async () => (await getJson(`https://api.ensdata.net/${name}`)).address,
    async () => {
      const j = await getJson(`https://eth.blockscout.com/api/v2/search?q=${name}`);
      const hit = (j.items || []).find(i => i.type === 'ens_domain' && String(i.ens_info?.name || i.name || '').toLowerCase() === name.toLowerCase());
      return hit?.address || hit?.ens_info?.address_hash;
    },
  ];
  for (const t of tries) {
    try {
      const a = await t();
      if (a && /^0x[0-9a-fA-F]{40}$/.test(a)) return a;
    } catch (e) { console.error(`ens resolve ${name}: ${e.message}`); }
  }
  throw new Error(`could not resolve ${name}`);
}

const addresses = [];
for (const a of process.argv.slice(2)) {
  if (a.toLowerCase().endsWith('.eth')) {
    const r = await resolveEns(a);
    console.log(`resolved ${a} -> ${r}`);
    addresses.push(r);
  } else addresses.push(a);
}
if (!addresses.length) {
  console.error('usage: node scripts/settle-gas-report.mjs <address> [address...]');
  process.exit(1);
}
const results = [];
for (let i = 0; i < addresses.length; i++) {
  const r = await report(addresses[i]);
  r.input = process.argv[2 + i];
  results.push(r);
}
console.log('=== SETTLE GAS REPORT ===');
console.log(JSON.stringify(results.map(({ txs, ...rest }) => rest), null, 1));
console.log('=== TXS ===');
for (const r of results) for (const t of r.txs) console.log(`${r.address},${t.hash},${t.block},${t.ts},${t.ok ? 1 : 0},${t.feeEth},${t.to},${t.ah}`);
console.log('=== END REPORT ===');
