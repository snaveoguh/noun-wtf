/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * /api/wallet-map/:identity — Wallet investigation pipeline.
 *
 * Resolves an ENS or address into a full identity graph:
 *   1. Canonicalise input → primary address
 *   2. Pull Farcaster verified wallets (Neynar)
 *   3. Probe brand ENS names that resolve to this person
 *   4. Detect Safe co-signing memberships (via getOwners() RPC reads)
 *   5. Identify on/off-ramp CEX deposits (labelled address list)
 *   6. Pull Nouns DAO treasury flows for the linked address set
 *   7. Emit { nodes, links } in the same shape as /api/treasury/flows
 *      so the frontend can reuse the existing TreasuryScene renderer.
 *
 * Gated to addresses with ≥ 4 Nouns delegated voting weight (see frontend).
 */
import type { Hono } from 'hono';

import { eq } from 'drizzle-orm';
import schema from 'ponder:schema';
import { createPublicClient, http, parseAbi, isAddress, getAddress } from 'viem';
import { mainnet, base, optimism } from 'viem/chains';

type Db = any;

// ─── Public clients (free public RPCs; replace with paid for prod) ──────────
// batch.multicall collapses parallel reads via multicall3 — important because the
// Safe candidate probe can fan out to hundreds of (safe, chain) pairs in one request.
const mainnetClient = createPublicClient({
  chain: mainnet,
  transport: http('https://ethereum-rpc.publicnode.com'),
  batch: { multicall: { wait: 16 } },
});
const baseClient = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org'),
  batch: { multicall: { wait: 16 } },
});
const optimismClient = createPublicClient({
  chain: optimism,
  transport: http('https://mainnet.optimism.io'),
  batch: { multicall: { wait: 16 } },
});
type SafeChain = 'mainnet' | 'base' | 'optimism';
// Viem's chain-specific PublicClient types don't unify under a single Record;
// we only use readContract here, which has the same signature on all three.
const safeClients: Record<SafeChain, any> = {
  mainnet: mainnetClient,
  base: baseClient,
  optimism: optimismClient,
};

const SAFE_ABI = parseAbi([
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
]);

// ─── Known CEX / on-ramp address labels (extend over time) ──────────────────
// Keys are lowercased addresses; values are display labels.
// Public hot-wallet sources: Etherscan name tags + Arkham public attributions.
const KNOWN_EXCHANGES: Record<string, string> = {
  // Coinbase
  '0x71660c4005ba85c37ccec55d0c4493e66fe775d3': 'Coinbase 1',
  '0xa090e606e30bd747d4e6245a1517ebe430f0057e': 'Coinbase 2',
  '0x503828976d22510aad0201ac7ec88293211d23da': 'Coinbase 3',
  '0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740': 'Coinbase 4',
  '0x3cd751e6b0078be393132286c442345e5dc49699': 'Coinbase 5',
  '0xb5d85cbf7cb3ee0d56b3bb207d5fc4b82f43f511': 'Coinbase 6',
  '0xeb2629a2734e272bcc07bda959863f316f4bd4cf': 'Coinbase 7',
  '0xd688aea8f7d450909ade10c47faa95707b0682d9': 'Coinbase Custody',
  '0x77696bb39917c91a0c3908d577d5e322095425ca': 'Coinbase Wrap',
  '0xf6874c88757721a02f47592140905c4336dfbc61': 'Coinbase Base',
  // Binance
  '0x28c6c06298d514db089934071355e5743bf21d60': 'Binance 14',
  '0x21a31ee1afc51d94c2efccaa2092ad1028285549': 'Binance 15',
  '0xdfd5293d8e347dfe59e90efd55b2956a1343963d': 'Binance 16',
  '0x56eddb7aa87536c09ccc2793473599fd21a8b17f': 'Binance 17',
  '0xbe0eb53f46cd790cd13851d5eff43d12404d33e8': 'Binance 7',
  '0xf977814e90da44bfa03b6295a0616a897441acec': 'Binance 8',
  '0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be': 'Binance 1',
  // Kraken
  '0x267be1c1d684f78cb4f6a176c4911b741e4ffdc0': 'Kraken 4',
  '0xfa52274dd61e1643d2205169732f29114bc240b3': 'Kraken 5',
  '0xe853c56864a2ebe4576a807d26fdc4a0ada63919': 'Kraken 13',
  // MEXC
  '0x9642b23ed1e01df1092b92641051881a322f5d4e': 'MEXC',
  '0x75e89d5979e4f6fba9f97c104c2f0afb3f1dcb88': 'MEXC 2',
  // OKX
  '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b': 'OKX 1',
  '0x236f9f97e0e62388479bf9e5ba4889e46b0273c3': 'OKX 2',
  // Bybit
  '0xf89d7b9c864f589bbf53a82105107622b35eaa40': 'Bybit Hot',
  // KuCoin
  '0x2b5634c42055806a59e9107ed44d43c426e58258': 'KuCoin',
  '0x689c56aef474df92d44a1b70850f808488f9769c': 'KuCoin 2',
};

// Bridges
const KNOWN_BRIDGES: Record<string, string> = {
  '0xf70da97812cb96acdf810712aa562db8dfa3dbef': 'Relay: Solver',
  '0x4cd00e387622c35bddb9b4c962c136462338bc31': 'Relay: Depository',
  '0x99c9fc46f92e8a1c0dec1b1747d010903e884be1': 'Optimism: Standard Bridge',
  '0x3154cf16ccdb4c6d922629664174b904d80f2c35': 'Base: Standard Bridge',
};

const NEYNAR_BASE = 'https://api.neynar.com/v2/farcaster';
const ENS_IDEAS_BASE = 'https://api.ensideas.com/ens';

const BLOCKSCOUT: Record<'mainnet' | 'base', string> = {
  mainnet: 'https://eth.blockscout.com',
  base: 'https://base.blockscout.com',
};

// Cap fetches so a busy address doesn't blow up the request budget. Each page
// is 50 items on Blockscout v2; 200 covers ~6 months for most active wallets.
const SCAN_TX_PAGES = 4;
const SCAN_DUST_WEI = 10_000_000_000_000n; // 0.00001 ETH — skip dust/gas refunds

// ─── Identity discovery helpers ─────────────────────────────────────────────

export async function resolveEnsToAddress(name: string): Promise<string | null> {
  try {
    const r = await fetch(`${ENS_IDEAS_BASE}/resolve/${encodeURIComponent(name)}`);
    if (!r.ok) return null;
    const d = (await r.json()) as { address?: string };
    return d.address ?? null;
  } catch {
    return null;
  }
}

async function reverseResolveAddress(
  addr: string,
): Promise<{ name: string | null; avatar: string | null }> {
  try {
    const r = await fetch(`${ENS_IDEAS_BASE}/resolve/${addr}`);
    if (!r.ok) return { name: null, avatar: null };
    const d = (await r.json()) as { name?: string; avatar?: string };
    return { name: d.name ?? null, avatar: d.avatar ?? null };
  } catch {
    return { name: null, avatar: null };
  }
}

export async function getFarcasterIdentity(address: string): Promise<{
  fid: number;
  username: string;
  displayName: string;
  verifiedAddresses: string[];
  custodyAddress?: string;
} | null> {
  const key = process.env.NEYNAR_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(`${NEYNAR_BASE}/user/bulk-by-address?addresses=${address}`, {
      headers: { 'x-api-key': key, accept: 'application/json' },
    });
    if (!r.ok) return null;
    const d = (await r.json()) as Record<
      string,
      Array<{
        fid: number;
        username: string;
        display_name: string;
        custody_address: string;
        verified_addresses: { eth_addresses: string[] };
      }>
    >;
    const users = d[address.toLowerCase()];
    if (!users || users.length === 0) return null;
    const u = users[0]!;
    return {
      fid: u.fid,
      username: u.username,
      displayName: u.display_name,
      verifiedAddresses: u.verified_addresses?.eth_addresses ?? [],
      custodyAddress: u.custody_address,
    };
  } catch {
    return null;
  }
}

/** Probe candidate brand ENS names that might resolve to addresses linked to this identity */
async function probeBrandEnses(
  username: string | null,
): Promise<Array<{ name: string; address: string }>> {
  if (!username) return [];
  const probes = [
    `${username}.eth`,
    `${username}media.eth`,
    `${username}-media.eth`,
    `${username}collective.eth`,
    `${username}studio.eth`,
    `${username}labs.eth`,
    `${username}dao.eth`,
  ];
  const results: Array<{ name: string; address: string }> = [];
  await Promise.all(
    probes.map(async name => {
      const addr = await resolveEnsToAddress(name);
      if (addr) results.push({ name, address: addr });
    }),
  );
  return results;
}

/** Check candidate Safes — does the given address appear in getOwners()? */
async function checkSafeMembership(
  safeAddr: string,
  chain: SafeChain,
  candidateOwner: string,
): Promise<{ isOwner: boolean; threshold?: number; owners?: string[] }> {
  const client = safeClients[chain];
  try {
    const [owners, threshold] = await Promise.all([
      client.readContract({
        address: safeAddr as `0x${string}`,
        abi: SAFE_ABI,
        functionName: 'getOwners',
      }),
      client.readContract({
        address: safeAddr as `0x${string}`,
        abi: SAFE_ABI,
        functionName: 'getThreshold',
      }),
    ]);
    const lc = candidateOwner.toLowerCase();
    const ownerList = (owners as string[]).map(o => o.toLowerCase());
    return {
      isOwner: ownerList.includes(lc),
      threshold: Number(threshold),
      owners: ownerList,
    };
  } catch {
    return { isOwner: false };
  }
}

// ─── CEX / bridge flow scanner ──────────────────────────────────────────────
//
// For each identity address, pull recent normal + internal transactions from
// Blockscout v2 on both Ethereum and Base. Any counterparty matching our
// KNOWN_EXCHANGES / KNOWN_BRIDGES table is collapsed into a single edge per
// (identity, counterparty, direction, chain) tuple. This is what surfaces the
// "this person funds via Coinbase 4 and offramps via Kraken" pattern in the 3D
// map; without it the explorer can label CEXes but can't draw lines to them.

interface CexFlow {
  identity: string; // lowercased identity-set address
  counterparty: string; // lowercased CEX / bridge address
  label: string; // human label from KNOWN_*
  kind: 'cex' | 'bridge';
  direction: 'deposit' | 'withdrawal'; // identity → CEX vs CEX → identity
  chain: 'mainnet' | 'base';
  valueEth: number; // summed across all matching txs
  txCount: number;
  firstAt: string | null; // ISO timestamp of earliest tx in this aggregate
  lastAt: string | null;
}

interface BlockscoutTxItem {
  hash?: string;
  value?: string | number;
  result?: string; // normal-tx success/error
  success?: boolean; // internal-tx success
  from?: { hash?: string };
  to?: { hash?: string };
  timestamp?: string;
}

async function fetchBlockscoutPages(
  base: string,
  addr: string,
  endpoint: 'transactions' | 'internal-transactions',
  pages: number,
): Promise<BlockscoutTxItem[]> {
  const out: BlockscoutTxItem[] = [];
  let next: Record<string, string> | null = null;
  for (let i = 0; i < pages; i++) {
    const qs = next ? '?' + new URLSearchParams(next).toString() : '';
    try {
      const r = await fetch(`${base}/api/v2/addresses/${addr}/${endpoint}${qs}`);
      if (!r.ok) break;
      const d = (await r.json()) as {
        items?: BlockscoutTxItem[];
        next_page_params?: Record<string, string> | null;
      };
      if (d.items) out.push(...d.items);
      if (!d.next_page_params) break;
      next = d.next_page_params;
    } catch {
      break;
    }
  }
  return out;
}

async function scanCexFlowsForAddress(addr: string, chain: 'mainnet' | 'base'): Promise<CexFlow[]> {
  const base = BLOCKSCOUT[chain];
  const lc = addr.toLowerCase();
  const [normal, internal] = await Promise.all([
    fetchBlockscoutPages(base, addr, 'transactions', SCAN_TX_PAGES),
    fetchBlockscoutPages(base, addr, 'internal-transactions', SCAN_TX_PAGES),
  ]);

  type Agg = Pick<
    CexFlow,
    'identity' | 'counterparty' | 'label' | 'kind' | 'direction' | 'chain'
  > & {
    valueWei: bigint;
    txCount: number;
    firstAt: string | null;
    lastAt: string | null;
  };
  const aggregates = new Map<string, Agg>();

  const considerItem = (it: BlockscoutTxItem, source: 'normal' | 'internal') => {
    const ok = source === 'normal' ? it.result === 'success' : it.success === true;
    if (!ok) return;
    const raw = it.value;
    if (raw === undefined || raw === null) return;
    let wei: bigint;
    try {
      wei = typeof raw === 'string' ? BigInt(raw) : BigInt(Math.trunc(raw));
    } catch {
      return;
    }
    if (wei <= SCAN_DUST_WEI) return;
    const from = it.from?.hash?.toLowerCase();
    const to = it.to?.hash?.toLowerCase();
    if (!from || !to || from === to) return;

    let counterparty: string;
    let direction: 'deposit' | 'withdrawal';
    if (from === lc) {
      counterparty = to;
      direction = 'deposit';
    } else if (to === lc) {
      counterparty = from;
      direction = 'withdrawal';
    } else {
      return; // internal-tx might list a tx where addr is neither endpoint
    }

    const exchangeLabel = KNOWN_EXCHANGES[counterparty];
    const bridgeLabel = KNOWN_BRIDGES[counterparty];
    if (!exchangeLabel && !bridgeLabel) return;
    const kind: 'cex' | 'bridge' = exchangeLabel ? 'cex' : 'bridge';
    const label = exchangeLabel ?? bridgeLabel!;

    const key = `${lc}|${counterparty}|${direction}|${chain}`;
    const existing = aggregates.get(key);
    const ts = it.timestamp ?? null;
    if (existing) {
      existing.valueWei += wei;
      existing.txCount += 1;
      if (ts && (!existing.firstAt || ts < existing.firstAt)) existing.firstAt = ts;
      if (ts && (!existing.lastAt || ts > existing.lastAt)) existing.lastAt = ts;
    } else {
      aggregates.set(key, {
        identity: lc,
        counterparty,
        label,
        kind,
        direction,
        chain,
        valueWei: wei,
        txCount: 1,
        firstAt: ts,
        lastAt: ts,
      });
    }
  };

  for (const it of normal) considerItem(it, 'normal');
  for (const it of internal) considerItem(it, 'internal');

  return Array.from(aggregates.values()).map(a => ({
    identity: a.identity,
    counterparty: a.counterparty,
    label: a.label,
    kind: a.kind,
    direction: a.direction,
    chain: a.chain,
    valueEth: Number(a.valueWei) / 1e18,
    txCount: a.txCount,
    firstAt: a.firstAt,
    lastAt: a.lastAt,
  }));
}

async function scanCexFlows(addresses: string[]): Promise<CexFlow[]> {
  const pairs: Array<[string, 'mainnet' | 'base']> = [];
  for (const a of addresses) {
    pairs.push([a, 'mainnet']);
    pairs.push([a, 'base']);
  }
  // Parallel but capped — N addresses × 2 chains, each chain pulls 2 endpoints.
  const results = await Promise.all(pairs.map(([a, c]) => scanCexFlowsForAddress(a, c)));
  return results.flat();
}

// ─── Flow builder — reuses treasury data filtered to the identity set ──────

interface NodeOut {
  id: string;
  name: string;
  type: string;
  description: string;
  totalIn: number;
  totalOut: number;
  netFlow: number;
  color: string;
  size: number;
  proposals: string[];
  auctionCount: number;
  votesCount: number;
  totalVotingWeight: number;
  proposalsCreated: number;
  proposalsCreatedIds: string[];
  participationRate: number;
  flowRole: number;
  outboundConnections: number;
  inboundConnections: number;
  ensName: string | null;
  ensAvatar: string | null;
  nounIds: string[];
  firstNounSeed: unknown | null;
  delegatedVotes: number;
  identityRole?:
    | 'primary'
    | 'verified'
    | 'suspected'
    | 'safe'
    | 'brand'
    | 'cosigner'
    | 'cex'
    | 'bridge'
    | 'counterparty';
}

interface LinkOut {
  source: string;
  target: string;
  value: number;
  label: string;
  direction: string;
}

// ─── Public entry point — registers the route on the Hono app ──────────────

export function registerWalletMapRoute(app: Hono, db: Db) {
  app.get('/api/wallet-map/:identity', async c => {
    const identity = c.req.param('identity');

    // 1. Resolve to primary address ------------------------------------------------
    let primary: string | null = null;
    if (identity.endsWith('.eth')) {
      primary = await resolveEnsToAddress(identity);
    } else if (isAddress(identity)) {
      primary = getAddress(identity);
    }
    if (!primary) return c.json({ error: 'could not resolve identity' }, 400);
    const primaryLower = primary.toLowerCase();

    // 2. Farcaster verified wallets ------------------------------------------------
    const fc = await getFarcasterIdentity(primary);
    const fcVerified = (fc?.verifiedAddresses ?? []).map(a => a.toLowerCase());
    const fcCustody = fc?.custodyAddress?.toLowerCase();

    // 3. Brand ENS probes ----------------------------------------------------------
    const brands = await probeBrandEnses(fc?.username ?? null);
    const brandAddrs = brands.map(b => b.address.toLowerCase());

    // 4. Build candidate address set -----------------------------------------------
    const identitySet = new Set<string>([primaryLower, ...fcVerified, ...brandAddrs]);
    if (fcCustody) identitySet.add(fcCustody);

    // 5. Pull treasury flow nodes that touch any address in identitySet ------------
    // Mirror /api/treasury/flows logic but filtered to identity-relevant rows.
    const allProposals = await db.select().from(schema.proposal);
    const allTransactions = await db.select().from(schema.transaction);
    const executedIds = new Set(
      allProposals
        .filter((p: any) => p.status === 'EXECUTED' || p.status === 'QUEUED')
        .map((p: any) => String(p.id)),
    );

    // Treasury -> identity address inflows
    const treasuryInflows = new Map<string, { eth: number; proposals: Set<string> }>();
    for (const tx of allTransactions) {
      if (!executedIds.has(String(tx.proposalId))) continue;
      const eth = Number(tx.value) / 1e18;
      if (eth <= 0) continue;
      const target = String(tx.target).toLowerCase();
      if (!identitySet.has(target)) continue;
      const cur = treasuryInflows.get(target) ?? { eth: 0, proposals: new Set<string>() };
      cur.eth += eth;
      cur.proposals.add(String(tx.proposalId));
      treasuryInflows.set(target, cur);
    }

    // Proposals proposed by primary
    const proposedIds = allProposals
      .filter((p: any) => String(p.proposer).toLowerCase() === primaryLower)
      .map((p: any) => String(p.id));

    // Proposals voted on by primary (any direction) — used to widen Safe candidate set.
    const votedRows = await db
      .select()
      .from(schema.vote)
      .where(eq(schema.vote.voter, primary as `0x${string}`));
    const votedIds = new Set(votedRows.map((v: any) => String(v.proposalId)));

    // 6. Detect Safe memberships (candidate Safes = recipients of any tx in props that ----
    //    primary proposed OR voted on). The on-chain getOwners() probe across mainnet,
    //    base, and optimism filters out non-Safes and Safes the primary doesn't co-sign.
    const candidateSafes = new Set<string>();
    for (const tx of allTransactions) {
      const pid = String(tx.proposalId);
      if (!executedIds.has(pid)) continue;
      const prop = allProposals.find((p: any) => String(p.id) === pid);
      const proposerLc = prop ? String(prop.proposer).toLowerCase() : '';
      if (proposerLc === primaryLower || votedIds.has(pid)) {
        candidateSafes.add(String(tx.target).toLowerCase());
      }
    }
    // Cap candidate set so a delegate with 1000+ votes doesn't trigger 3000+ RPC reads.
    const SAFE_CANDIDATE_CAP = 200;
    const candidateList = Array.from(candidateSafes).slice(0, SAFE_CANDIDATE_CAP);

    const safeChains: SafeChain[] = ['mainnet', 'base', 'optimism'];
    const safeMemberships: Array<{
      address: string;
      threshold: number;
      owners: string[];
      chain: SafeChain;
    }> = [];
    // Probe (safe, chain) pairs in parallel.
    const probeResults = await Promise.all(
      candidateList.flatMap(safeAddr =>
        safeChains.map(async chain => {
          const m = await checkSafeMembership(safeAddr, chain, primary);
          return { safeAddr, chain, ...m };
        }),
      ),
    );
    // De-dupe: same Safe address can exist on multiple chains with different owners — keep
    // each (address, chain) pair where membership is confirmed.
    for (const r of probeResults) {
      if (r.isOwner && r.threshold && r.owners) {
        safeMemberships.push({
          address: r.safeAddr,
          threshold: r.threshold,
          owners: r.owners,
          chain: r.chain,
        });
      }
    }

    // 7. Build node + link arrays in TreasuryScene format -------------------------
    const nodes: NodeOut[] = [];
    const links: LinkOut[] = [];

    const baseNode = (overrides: Partial<NodeOut>): NodeOut => ({
      id: overrides.id!,
      name: overrides.name ?? `${overrides.id?.slice(0, 6)}…${overrides.id?.slice(-4)}`,
      type: overrides.type ?? 'wallet',
      description: overrides.description ?? '',
      totalIn: 0,
      totalOut: 0,
      netFlow: 0,
      color: '#64748b',
      size: 8,
      proposals: [],
      auctionCount: 0,
      votesCount: 0,
      totalVotingWeight: 0,
      proposalsCreated: 0,
      proposalsCreatedIds: [],
      participationRate: 0,
      flowRole: 0,
      outboundConnections: 0,
      inboundConnections: 0,
      ensName: null,
      ensAvatar: null,
      nounIds: [],
      firstNounSeed: null,
      delegatedVotes: 0,
      ...overrides,
    });

    nodes.push(
      baseNode({
        id: 'treasury',
        name: 'Nouns Treasury',
        type: 'treasury',
        color: '#f59e0b',
        size: 20,
      }),
    );

    // Primary
    const primaryEns = await reverseResolveAddress(primary);
    nodes.push(
      baseNode({
        id: primaryLower,
        name: primaryEns.name ?? `${primary.slice(0, 6)}…${primary.slice(-4)}`,
        type: 'builder',
        color: '#ef4444',
        size: 14,
        ensName: primaryEns.name,
        ensAvatar: primaryEns.avatar,
        identityRole: 'primary',
        proposalsCreated: proposedIds.length,
        proposalsCreatedIds: proposedIds,
      }),
    );

    // Other verified Farcaster wallets
    for (const a of fcVerified) {
      if (a === primaryLower) continue;
      nodes.push(
        baseNode({ id: a, type: 'wallet', color: '#ef4444', size: 9, identityRole: 'verified' }),
      );
      links.push({
        source: primaryLower,
        target: a,
        value: 1,
        label: 'Farcaster verified',
        direction: 'identity',
      });
    }

    // Brand ENSes
    for (const b of brands) {
      const addr = b.address.toLowerCase();
      if (identitySet.has(addr) && addr !== primaryLower) {
        // already added; tag as brand
      }
      if (!nodes.find(n => n.id === addr)) {
        nodes.push(
          baseNode({
            id: addr,
            name: b.name,
            type: 'culture',
            color: '#10b981',
            size: 8,
            ensName: b.name,
            identityRole: 'brand',
          }),
        );
      }
      links.push({
        source: primaryLower,
        target: addr,
        value: 1,
        label: `Brand: ${b.name}`,
        direction: 'identity',
      });
    }

    // Safes — multiple chains possible. Each (address, chain) becomes its own node
    // because Safe owners can differ across chains for the same address.
    for (const safe of safeMemberships) {
      const isUnilateral = safe.threshold === 1;
      const chainTag = safe.chain === 'mainnet' ? '' : ` · ${safe.chain}`;
      const nodeId = safe.chain === 'mainnet' ? safe.address : `${safe.address}:${safe.chain}`;
      nodes.push(
        baseNode({
          id: nodeId,
          name: `Safe ${safe.threshold}/${safe.owners.length}${chainTag}`,
          type: 'subdao',
          color: isUnilateral ? '#dc2626' : '#fb923c',
          size: isUnilateral ? 13 : 10,
          identityRole: 'safe',
          description: `Multisig ${safe.threshold}/${safe.owners.length} on ${safe.chain}${isUnilateral ? ' — UNILATERAL signer' : ''}`,
        }),
      );
      links.push({
        source: primaryLower,
        target: nodeId,
        value: isUnilateral ? 2 : 1,
        label: `Co-signer (${safe.threshold}/${safe.owners.length}${chainTag})`,
        direction: 'ownership',
      });
    }

    // Treasury inflows
    for (const [target, info] of treasuryInflows.entries()) {
      links.push({
        source: 'treasury',
        target,
        value: info.eth,
        label: `Props #${Array.from(info.proposals).join(', #')}`,
        direction: 'out',
      });
      const n = nodes.find(x => x.id === target);
      if (n) {
        n.totalIn = info.eth;
        n.proposals = Array.from(info.proposals);
      }
    }

    // 8. CEX / bridge flow scan — pull Blockscout v2 history for every identity
    //    address and draw edges to any KNOWN_EXCHANGES / KNOWN_BRIDGES counterparty.
    const cexFlows = await scanCexFlows(Array.from(identitySet));

    // Collapse multi-chain edges to one node-per-counterparty but keep per-chain
    // edges so the map shows separate mainnet vs base flows.
    const counterpartyNodes = new Map<
      string,
      {
        label: string;
        kind: 'cex' | 'bridge';
        depositEth: number;
        withdrawalEth: number;
        txCount: number;
      }
    >();
    for (const f of cexFlows) {
      const cur = counterpartyNodes.get(f.counterparty) ?? {
        label: f.label,
        kind: f.kind,
        depositEth: 0,
        withdrawalEth: 0,
        txCount: 0,
      };
      if (f.direction === 'deposit') cur.depositEth += f.valueEth;
      else cur.withdrawalEth += f.valueEth;
      cur.txCount += f.txCount;
      counterpartyNodes.set(f.counterparty, cur);
    }

    for (const [addr, info] of counterpartyNodes.entries()) {
      const isBridge = info.kind === 'bridge';
      nodes.push(
        baseNode({
          id: addr,
          name: info.label,
          type: isBridge ? 'bridge' : 'cex',
          color: isBridge ? '#a78bfa' : '#10b981',
          size: 9 + Math.min(4, Math.log10(info.depositEth + info.withdrawalEth + 1)),
          identityRole: isBridge ? 'bridge' : 'cex',
          description: `${info.label} · ${info.depositEth.toFixed(2)}Ξ in / ${info.withdrawalEth.toFixed(2)}Ξ out · ${info.txCount} txs`,
          totalIn: info.depositEth,
          totalOut: info.withdrawalEth,
          netFlow: info.depositEth - info.withdrawalEth,
        }),
      );
    }

    for (const f of cexFlows) {
      const arrow = f.direction === 'deposit' ? '→' : '←';
      const chainTag = f.chain === 'base' ? ' (Base)' : '';
      links.push({
        source: f.direction === 'deposit' ? f.identity : f.counterparty,
        target: f.direction === 'deposit' ? f.counterparty : f.identity,
        value: f.valueEth,
        label: `${f.valueEth.toFixed(3)}Ξ ${arrow} ${f.label}${chainTag} · ${f.txCount} tx`,
        direction: f.kind === 'bridge' ? 'bridge' : f.direction,
      });
    }

    const totalCexDeposited = cexFlows
      .filter(f => f.direction === 'deposit')
      .reduce((a, b) => a + b.valueEth, 0);
    const totalCexWithdrawn = cexFlows
      .filter(f => f.direction === 'withdrawal')
      .reduce((a, b) => a + b.valueEth, 0);

    return c.json({
      identity: {
        input: identity,
        primary,
        farcaster: fc,
        brands,
        verifiedSet: Array.from(identitySet),
      },
      nodes,
      links,
      stats: {
        proposalsProposed: proposedIds.length,
        safesAsSigner: safeMemberships.length,
        unilateralSafes: safeMemberships.filter(s => s.threshold === 1).length,
        totalEthFromTreasury: Array.from(treasuryInflows.values()).reduce((a, b) => a + b.eth, 0),
        verifiedWallets: fcVerified.length,
        brandsResolved: brands.length,
        cexCounterparties: Array.from(counterpartyNodes.values()).filter(c => c.kind === 'cex')
          .length,
        bridgeCounterparties: Array.from(counterpartyNodes.values()).filter(
          c => c.kind === 'bridge',
        ).length,
        totalCexDeposited,
        totalCexWithdrawn,
      },
    });
  });
}
