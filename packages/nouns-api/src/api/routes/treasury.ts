import type { Hono } from 'hono';

import { db } from 'ponder:api';
import schema from 'ponder:schema';

import { computeDerivedStatus } from '../lib/proposalStatus.js';

// ============================================================
// Treasury Flows — node diagram data for nouns.eth
// ============================================================

// Treasury addresses — merged into the virtual "treasury" central node
const TREASURY_ADDRESSES = new Set([
  '0x0bc3807ec262cb779b38d65b38158acc3bfede10', // Legacy Treasury
  '0xb1a32fc9f9d8b2cf86c068cae13108809547ef71', // Current Treasury
  '0x4f2acdc74f6941390d9b1804fabc3e780388cfe5', // Token Buyer
]);

const KNOWN_ENTITIES: Record<
  string,
  { name: string; type: string; description: string; url?: string }
> = {
  // ── Governance ──
  '0x6f3e6272a167e8accb32072d08e0957f9c79223d': {
    name: 'Nouns DAO Proxy',
    type: 'governance',
    description: 'NounsDAOProxy — governance execution',
  },
  // ── Nounders ──
  '0x2573c60a6d127755aa2dc85e342f7da2378a0cc5': {
    name: 'Nounders',
    type: 'nounder',
    description: 'Nounders multisig — founding team',
  },
  '0xfcb177a083c9015adf3cef26fee3e3fc24b993c1': {
    name: '4156.eth',
    type: 'nounder',
    description: 'Nounder — punk4156',
  },
  '0x83fce6e68e2f7e58f1d40de12f50ec86e104e94b': {
    name: 'cryptoseneca.eth',
    type: 'nounder',
    description: 'Nounder — cryptoseneca',
  },
  '0x1f790c60a21b1d07a041fbc7eb31e36e8457c77a': {
    name: 'vapeape.eth',
    type: 'nounder',
    description: 'Nounder — vapeape',
  },
  '0x454cfaa623a629cc0b4017aeb85d54c42e91479d': {
    name: 'lastpunk9999.eth',
    type: 'nounder',
    description: 'Nounder — lastpunk9999',
  },
  '0x2c44b726adf1963ca47af88b284c06f30380fc78': {
    name: 'eboyarts.eth',
    type: 'nounder',
    description: 'Nounder — eBoy',
  },
  '0xfc7935920789a02b3ee3d7cb768a5f2585f6f383': {
    name: 'gremplin.eth',
    type: 'nounder',
    description: 'Nounder — gremplin',
  },
  '0x179a862703a4adfb29681631bd2bae4432e8d5e1': {
    name: 'devcarrot.eth',
    type: 'nounder',
    description: 'Nounder — devcarrot',
  },
  '0xc3fdadbae46798cd8762185a09c5b672a7aa36bb': {
    name: 'solimander.eth',
    type: 'nounder',
    description: 'Nounder — solimander',
  },
  // ── Sub-DAOs & Forks ──
  '0x4b10701bfd7bfedc47d50562b76b436fbb5bdb3b': {
    name: 'Lil Nouns DAO',
    type: 'subdao',
    description: 'Lil Nouns — sold by VRGDA',
    url: 'https://lilnouns.wtf',
  },
  '0x880fb3cf5c6cc2d7dfc13a993e839a9411200c17': {
    name: 'Gnars DAO',
    type: 'subdao',
    description: 'Gnars — action sports DAO',
    url: 'https://gnars.wtf',
  },
  '0xfcb981feaac69b56ff89403ac669b2e1a64fdebb': {
    name: 'Nouns Fork #0',
    type: 'subdao',
    description: 'First Nouns Fork treasury',
  },
  '0x7559038535f3d6ed6bac5e54bd6dbe3d4e3fc052': {
    name: 'Nouns Fork #1',
    type: 'subdao',
    description: 'Second Nouns Fork treasury',
  },
  '0xd2a838b800b5f7cf4d4769bbf6e3730e1a113e27': {
    name: 'Purple DAO',
    type: 'subdao',
    description: 'Farcaster-aligned Nouns DAO',
    url: 'https://purple.construction',
  },
  '0xe93ff6c15c1a456225e1c642e2fea760f0b0d803': {
    name: 'Builder DAO',
    type: 'subdao',
    description: 'Nouns Builder sub-DAO',
  },
  // ── Infrastructure ──
  '0xf29ff96aaea6c9a1fba851f74737f3c069d4f1a9': {
    name: 'Protocol Guild',
    type: 'infra',
    description: 'Ethereum core dev funding',
    url: 'https://protocol-guild.readthedocs.io',
  },
  '0x65a3870f48b5237f27f674ec42ea1e017e111d63': {
    name: 'Prop House',
    type: 'infra',
    description: 'Permissionless funding rounds',
    url: 'https://prop.house',
  },
  '0x830bd73e4184cef73443c15111a1df14e495c706': {
    name: 'Gitcoin',
    type: 'infra',
    description: 'Gitcoin — public goods funding',
    url: 'https://gitcoin.co',
  },
  '0x44d97d22b3d37d837ce4b22773aad9d1566055d9': {
    name: 'Nouns Builder',
    type: 'infra',
    description: 'Deploy your own Nouns DAO',
    url: 'https://nouns.build',
  },
  '0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae': {
    name: 'Ethereum Foundation',
    type: 'infra',
    description: 'Ethereum Foundation',
  },
  // ── Culture ──
  '0x13ae6e44908e094d4de51d6580b3570ab3c1e360': {
    name: 'Nouns Movie (Atrium)',
    type: 'culture',
    description: 'Nouns: A Movie — feature film',
  },
  '0xa3557e3f89063e4bdc1aa4de85fcced4487a4e03': {
    name: 'Nounish Agency',
    type: 'culture',
    description: 'The agency for Nounish brands',
  },
  '0x281ec184e704ce57570d4d14cba258cf2a69e7b3': {
    name: 'Nouns Coffee',
    type: 'culture',
    description: 'Nouns-branded coffee experience',
  },
  '0x5b2f39f1135485f3f221454a264cd4f023b3e8cb': {
    name: 'SharkDAO',
    type: 'culture',
    description: 'Shark-themed Nouns community',
  },
  '0xd5f7818f553e1d1ef0c51e16a13df6691b3b1702': {
    name: 'Nouns Esports',
    type: 'culture',
    description: 'Competitive gaming team',
  },
  // ── Education ──
  '0x1a9c8182c09f50c8318d769245bea52c32be35bc': {
    name: 'Nouns Center',
    type: 'education',
    description: 'Community information hub',
  },
  '0x40de806b864b502aa5283a8d662e42684f76ce17': {
    name: 'Glasses for Kids',
    type: 'education',
    description: 'Real Noggles — glasses for children',
  },
};

// ─── ENS Resolution (background, non-blocking) ─────────────────────────
const ensNameCache = new Map<string, string | null>();

const FALLBACK_RPC = 'https://eth.llamarpc.com';

async function resolveOneEns(rpcUrl: string, addr: string): Promise<string | null> {
  try {
    const reverseName = addr.slice(2).toLowerCase() + '.addr.reverse';
    let encoded = '0x';
    for (const label of reverseName.split('.')) {
      encoded += label.length.toString(16).padStart(2, '0');
      for (let i = 0; i < label.length; i++) {
        encoded += label.charCodeAt(i).toString(16).padStart(2, '0');
      }
    }
    encoded += '00';
    const calldata =
      '0xec11c823' +
      '0000000000000000000000000000000000000000000000000000000000000020' +
      (encoded.length / 2 - 1).toString(16).padStart(64, '0') +
      encoded.slice(2).padEnd(Math.ceil((encoded.length - 2) / 64) * 64, '0');

    const doCall = async (url: string) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_call',
          params: [{ to: '0xce01f8eee7E0a9588E56A9b3b055b42eAf49D12a', data: calldata }, 'latest'],
          id: 1,
        }),
      });
      return (await res.json()) as { result?: string; error?: unknown };
    };

    let json = await doCall(rpcUrl);
    // Fallback to public RPC if primary fails
    if (json.error || !json.result || json.result === '0x') {
      json = await doCall(FALLBACK_RPC);
    }

    if (json.result && json.result !== '0x' && json.result.length > 130) {
      const hex = json.result.slice(2);
      const nameOffset = parseInt(hex.slice(0, 64), 16) * 2;
      const nameLen = parseInt(hex.slice(nameOffset, nameOffset + 64), 16);
      if (nameLen > 0 && nameLen < 100) {
        const nameHex = hex.slice(nameOffset + 64, nameOffset + 64 + nameLen * 2);
        const name = Buffer.from(nameHex, 'hex').toString('utf8');
        if (name && name.includes('.')) return name;
      }
    }
    return null;
  } catch (err) {
    console.error(`ENS resolution failed for ${addr}:`, err);
    return null;
  }
}

async function resolveEnsNames(addresses: string[]): Promise<void> {
  const rpcUrl = process.env.PONDER_RPC_URL_1;
  if (!rpcUrl) return;
  const toResolve = addresses.filter(a => !ensNameCache.has(a));
  // Process in batches of 20 with 300ms delay between batches
  for (let i = 0; i < toResolve.length; i += 20) {
    const batch = toResolve.slice(i, i + 20);
    await Promise.all(
      batch.map(async addr => {
        const name = await resolveOneEns(rpcUrl, addr);
        ensNameCache.set(addr, name);
      }),
    );
    if (i + 20 < toResolve.length) await new Promise(r => setTimeout(r, 300));
  }
}

function flowColor(netRatio: number): string {
  const t = (1 - netRatio) / 2;
  const r = Math.round(34 + (239 - 34) * t);
  const g = Math.round(197 + (68 - 197) * t);
  const b = Math.round(94 + (68 - 94) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// ─── Weighted composite node sizing ──────────────────────────────────────
// Noun-centric: nodes with more Nouns (held + delegated) are bigger
function computeNodeSize(
  totalIn: number,
  totalOut: number,
  votesCount: number,
  totalVotingWeight: number,
  proposalsCreated: number,
  connectionCount: number,
  nounsHeld: number,
  delegatedVotes: number,
): number {
  const ethScore = Math.log(1 + totalIn + totalOut);
  const voteScore = Math.log(1 + votesCount) * 0.5 + Math.log(1 + totalVotingWeight) * 0.5;
  const propScore = Math.log(1 + proposalsCreated * 10);
  const connScore = Math.log(1 + connectionCount);
  // Noun ownership is the primary sizing factor
  const nounScore = Math.log(1 + nounsHeld * 5 + delegatedVotes * 3);

  const composite =
    nounScore * 0.3 + ethScore * 0.25 + voteScore * 0.2 + propScore * 0.15 + connScore * 0.1;
  return Math.max(6, Math.min(55, 4 + composite * 3.8));
}

let treasuryFlowCache: { data: unknown; fetchedAt: number } | null = null;
const TREASURY_FLOW_CACHE_TTL = 30 * 60_000;

export function registerTreasuryRoutes(app: Hono) {
  app.get('/api/treasury/flows', async c => {
    if (treasuryFlowCache && Date.now() - treasuryFlowCache.fetchedAt < TREASURY_FLOW_CACHE_TTL) {
      return c.json(treasuryFlowCache.data);
    }

    try {
      const allProposals = await db.select().from(schema.proposal);
      const allTransactions = await db.select().from(schema.transaction);
      const settledAuctions = await db.select().from(schema.auction);
      let allBids: unknown[] = [];
      try {
        allBids = await db.select().from(schema.bid);
      } catch {
        /* bid table may not exist yet */
      }
      let allVotes: { voter: string; proposalId: bigint; support: number; votes: number }[] = [];
      try {
        allVotes = (await db.select().from(schema.vote)) as typeof allVotes;
      } catch {
        /* vote table may not exist yet */
      }
      let allStreams: {
        payer: string;
        recipient: string;
        tokenAmount: bigint;
        tokenAddress: string;
        proposalId: bigint | null;
        status: string;
        streamAddress: string;
      }[] = [];
      try {
        allStreams = (await db.select().from(schema.stream)) as typeof allStreams;
      } catch {
        /* stream table may not exist yet */
      }

      // ── Derived proposal statuses ──────────────────────────────────────
      const latestBlock = allProposals.reduce((max, p) => {
        const b = Number(p.createdAtBlock);
        return b > max ? b : max;
      }, 0);
      const latestBlockBi = BigInt(latestBlock || 0);

      const derivedStatuses = allProposals.map(p => computeDerivedStatus(p, latestBlockBi));
      const propsPassed = derivedStatuses.filter(
        s => s === 'EXECUTED' || s === 'QUEUED' || s === 'SUCCEEDED',
      ).length;
      const propsFailed = derivedStatuses.filter(s => s === 'DEFEATED').length;
      const propsCancelled = derivedStatuses.filter(
        s => s === 'CANCELLED' || s === 'VETOED',
      ).length;
      const propsExpired = derivedStatuses.filter(s => s === 'EXPIRED').length;
      const nounsSettled = settledAuctions.filter(a => a.settled).length;
      const totalBids = allBids.length;

      // ── Vote stats per address ─────────────────────────────────────────
      const voteStats = new Map<
        string,
        { count: number; weight: number; proposals: Set<string> }
      >();
      for (const v of allVotes) {
        const addr = v.voter.toLowerCase();
        if (!voteStats.has(addr))
          voteStats.set(addr, { count: 0, weight: 0, proposals: new Set() });
        const stats = voteStats.get(addr)!;
        stats.count++;
        stats.weight += v.votes;
        stats.proposals.add(String(v.proposalId));
      }
      const totalVotableProposals = allProposals.filter(p => p.status !== 'PENDING').length;

      // ── Proposer stats per address ─────────────────────────────────────
      const proposerStats = new Map<string, string[]>();
      for (const p of allProposals) {
        const addr = p.proposer.toLowerCase();
        if (!proposerStats.has(addr)) proposerStats.set(addr, []);
        proposerStats.get(addr)!.push(String(p.id));
      }

      // Build executed proposal ID set + proposer map
      const executedIds = new Set(
        allProposals
          .filter(p => p.status === 'EXECUTED' || p.status === 'QUEUED')
          .map(p => String(p.id)),
      );
      const proposalProposerMap = new Map<string, string>();
      for (const p of allProposals) {
        proposalProposerMap.set(String(p.id), p.proposer.toLowerCase());
      }

      // ── Aggregate flows per address ────────────────────────────────────
      const flows = new Map<
        string,
        { ethIn: number; ethOut: number; proposals: Set<string>; auctions: number }
      >();
      const getFlow = (addr: string) => {
        const k = addr.toLowerCase();
        if (!flows.has(k)) flows.set(k, { ethIn: 0, ethOut: 0, proposals: new Set(), auctions: 0 });
        return flows.get(k)!;
      };

      for (const tx of allTransactions) {
        if (!executedIds.has(String(tx.proposalId))) continue;
        const eth = Number(tx.value) / 1e18;
        if (eth <= 0) continue;
        const f = getFlow(tx.target);
        f.ethIn += eth;
        f.proposals.add(String(tx.proposalId));
      }

      for (const auc of settledAuctions) {
        if (!auc.winner || !auc.amount || !auc.settled) continue;
        const eth = Number(auc.amount) / 1e18;
        if (eth <= 0) continue;
        const f = getFlow(auc.winner);
        f.ethOut += eth;
        f.auctions++;
      }

      // ── Stream flows ───────────────────────────────────────────────────
      const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
      const streamLinks: {
        source: string;
        target: string;
        value: number;
        label: string;
        direction: string;
      }[] = [];
      for (const s of allStreams) {
        const payer = s.payer.toLowerCase();
        const recipient = s.recipient.toLowerCase();
        const isEth = s.tokenAddress.toLowerCase() === WETH;
        const amount = Number(s.tokenAmount) / 1e18;
        if (amount <= 0) continue;
        if (isEth) {
          getFlow(payer); // ensure node exists
          getFlow(recipient);
          const pf = getFlow(payer);
          pf.ethOut += amount;
          const rf = getFlow(recipient);
          rf.ethIn += amount;
        } else {
          getFlow(payer);
          getFlow(recipient);
        }
        const propLabel = s.proposalId ? ` (Prop #${s.proposalId})` : '';
        streamLinks.push({
          source: payer,
          target: recipient,
          value: isEth ? amount : 0.1,
          label: `Stream: ${amount.toFixed(1)} ${isEth ? 'WETH' : 'tokens'}${propLabel}`,
          direction: 'stream',
        });
      }

      // ── Proposer → recipient links ─────────────────────────────────────
      const proposerRecipientAgg = new Map<
        string,
        Map<string, { eth: number; proposals: Set<string> }>
      >();
      for (const prop of allProposals) {
        if (prop.status !== 'EXECUTED' && prop.status !== 'QUEUED') continue;
        const proposer = prop.proposer.toLowerCase();
        // Ensure proposer node exists (even with zero eth flow)
        getFlow(proposer);
        const propTxs = allTransactions.filter(tx => String(tx.proposalId) === String(prop.id));
        for (const tx of propTxs) {
          const eth = Number(tx.value) / 1e18;
          if (eth <= 0) continue;
          const target = tx.target.toLowerCase();
          if (target === proposer) continue; // skip self-funding
          if (!proposerRecipientAgg.has(proposer)) proposerRecipientAgg.set(proposer, new Map());
          const inner = proposerRecipientAgg.get(proposer)!;
          if (!inner.has(target)) inner.set(target, { eth: 0, proposals: new Set() });
          const entry = inner.get(target)!;
          entry.eth += eth;
          entry.proposals.add(String(prop.id));
        }
      }

      // ── Noun ownership data ────────────────────────────────────────────
      interface NounSeedData {
        background: number;
        body: number;
        accessory: number;
        head: number;
        glasses: number;
      }
      let allNouns: {
        id: bigint;
        owner: string;
        background: number;
        body: number;
        accessory: number;
        head: number;
        glasses: number;
        createdAt: number;
      }[] = [];
      try {
        allNouns = (await db.select().from(schema.noun)) as typeof allNouns;
      } catch {
        /* noun table may not exist yet */
      }
      const nounsByOwner = new Map<string, { id: string; seed: NounSeedData }[]>();
      for (const n of allNouns) {
        const owner = (n.owner as string).toLowerCase();
        if (!nounsByOwner.has(owner)) nounsByOwner.set(owner, []);
        nounsByOwner.get(owner)!.push({
          id: String(n.id),
          seed: {
            background: n.background,
            body: n.body,
            accessory: n.accessory,
            head: n.head,
            glasses: n.glasses,
          },
        });
      }

      // ── Delegation data ────────────────────────────────────────────────
      let allDelegates: { id: string; delegatedVotes: number }[] = [];
      try {
        allDelegates = (await db.select().from(schema.delegate)) as typeof allDelegates;
      } catch {
        /* delegate table may not exist yet */
      }
      const delegatedVotesMap = new Map<string, number>();
      for (const d of allDelegates) {
        delegatedVotesMap.set((d.id as string).toLowerCase(), d.delegatedVotes);
      }

      // ── Build graph nodes and links ────────────────────────────────────
      interface GNode {
        id: string;
        name: string;
        type: string;
        description: string;
        url?: string;
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
        firstNounSeed: NounSeedData | null;
        delegatedVotes: number;
        fx?: number;
        fy?: number;
      }
      interface GLink {
        source: string;
        target: string;
        value: number;
        label: string;
        direction: string;
      }

      const nodes: GNode[] = [];
      const links: GLink[] = [];
      let totalInflow = 0,
        totalOutflow = 0;

      for (const [addr, f] of flows) {
        // Skip treasury addresses — they're merged into the virtual treasury node
        if (TREASURY_ADDRESSES.has(addr)) continue;
        const vol = f.ethIn + f.ethOut;
        const hasGovernance = voteStats.has(addr) || proposerStats.has(addr);
        // Include node if it has ETH flow OR governance activity
        if (vol < 0.01 && !hasGovernance) continue;
        totalInflow += f.ethOut;
        totalOutflow += f.ethIn;
        const net = f.ethOut - f.ethIn;
        const ratio = vol > 0 ? net / vol : 0;
        const known = KNOWN_ENTITIES[addr];
        const ensName = ensNameCache.get(addr) ?? null;
        const displayName = known?.name ?? (ensName || `${addr.slice(0, 6)}...${addr.slice(-4)}`);
        const vs = voteStats.get(addr);
        const ps = proposerStats.get(addr);
        const ownedNouns = nounsByOwner.get(addr) ?? [];

        // Auto-classify unknown addresses into smart categories
        let nodeType = known?.type ?? 'wallet';
        if (!known) {
          if ((ps?.length ?? 0) > 0 || f.proposals.size > 0) {
            nodeType = 'builder';
          } else if ((vs?.count ?? 0) > 10 && (vs?.weight ?? 0) > 50) {
            nodeType = 'delegate';
          } else if (f.auctions > 5 && (vs?.count ?? 0) === 0 && f.ethIn === 0) {
            nodeType = 'bidder';
          }
        }

        nodes.push({
          id: addr,
          name: displayName,
          type: nodeType,
          description: known?.description ?? '',
          url: known?.url,
          totalIn: Math.round(f.ethIn * 100) / 100,
          totalOut: Math.round(f.ethOut * 100) / 100,
          netFlow: Math.round(net * 100) / 100,
          color: flowColor(ratio),
          size: 10, // placeholder — recomputed after links are built
          proposals: Array.from(f.proposals),
          auctionCount: f.auctions,
          votesCount: vs?.count ?? 0,
          totalVotingWeight: vs?.weight ?? 0,
          proposalsCreated: ps?.length ?? 0,
          proposalsCreatedIds: ps ?? [],
          participationRate:
            totalVotableProposals > 0
              ? Math.round(((vs?.count ?? 0) / totalVotableProposals) * 10000) / 100
              : 0,
          flowRole: 0,
          outboundConnections: 0,
          inboundConnections: 0,
          ensName,
          ensAvatar: ensName ? `https://metadata.ens.domains/mainnet/avatar/${ensName}` : null,
          nounIds: ownedNouns.map(n => n.id),
          firstNounSeed: ownedNouns.length > 0 ? ownedNouns[0].seed : null,
          delegatedVotes: delegatedVotesMap.get(addr) ?? 0,
        });

        if (f.ethIn > 0) {
          const pLabels = Array.from(f.proposals)
            .slice(0, 5)
            .map(id => `#${id}`);
          links.push({
            source: 'treasury',
            target: addr,
            value: f.ethIn,
            label: pLabels.join(', ') || 'Funding',
            direction: 'out',
          });
        }
        if (f.ethOut > 0) {
          links.push({
            source: addr,
            target: 'treasury',
            value: f.ethOut,
            label: `${f.auctions} auction${f.auctions !== 1 ? 's' : ''}`,
            direction: 'in',
          });
        }
      }

      // ── Add proposer → recipient links ─────────────────────────────────
      const nodeIds = new Set(nodes.map(n => n.id));
      for (const [proposer, recipients] of proposerRecipientAgg) {
        if (!nodeIds.has(proposer)) continue;
        for (const [recipient, data] of recipients) {
          if (!nodeIds.has(recipient)) continue;
          links.push({
            source: proposer,
            target: recipient,
            value: data.eth,
            label: `Proposed: ${Array.from(data.proposals)
              .slice(0, 3)
              .map(id => `#${id}`)
              .join(', ')}`,
            direction: 'proposed',
          });
        }
      }

      // ── Add stream links ───────────────────────────────────────────────
      for (const sl of streamLinks) {
        if (nodeIds.has(sl.source) && nodeIds.has(sl.target)) {
          links.push(sl);
        }
      }

      // ── Compute connection counts + flow role ──────────────────────────
      const outboundPartners = new Map<string, Set<string>>();
      const inboundPartners = new Map<string, Set<string>>();
      for (const link of links) {
        const s = link.source;
        const t = link.target;
        if (!outboundPartners.has(s)) outboundPartners.set(s, new Set());
        if (!inboundPartners.has(t)) inboundPartners.set(t, new Set());
        outboundPartners.get(s)!.add(t);
        inboundPartners.get(t)!.add(s);
      }

      // ── Update node sizes + flow roles ─────────────────────────────────
      for (const node of nodes) {
        if (node.id === 'treasury') continue;
        const outCount = outboundPartners.get(node.id)?.size ?? 0;
        const inCount = inboundPartners.get(node.id)?.size ?? 0;
        const totalConns = outCount + inCount;
        node.outboundConnections = outCount;
        node.inboundConnections = inCount;
        node.flowRole = totalConns > 0 ? (outCount - inCount) / totalConns : 0;
        node.size = computeNodeSize(
          node.totalIn,
          node.totalOut,
          node.votesCount,
          node.totalVotingWeight,
          node.proposalsCreated,
          totalConns,
          node.nounIds.length,
          node.delegatedVotes,
        );
      }

      // Central treasury node
      nodes.unshift({
        id: 'treasury',
        name: 'Nouns Treasury',
        type: 'treasury',
        description: 'Nouns DAO Treasury (nouns.eth)',
        totalIn: Math.round(totalInflow),
        totalOut: Math.round(totalOutflow),
        netFlow: Math.round(totalInflow - totalOutflow),
        color: '#f59e0b',
        size: 60,
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
        ensName: 'nouns.eth',
        ensAvatar: 'https://metadata.ens.domains/mainnet/avatar/nouns.eth',
        nounIds: [],
        firstNounSeed: null,
        delegatedVotes: 0,
        fx: 0,
        fy: 0,
      });

      nodes.sort((a, b) => {
        if (a.id === 'treasury') return -1;
        if (b.id === 'treasury') return 1;
        return b.totalIn + b.totalOut - (a.totalIn + a.totalOut);
      });

      // Resolve ENS names for ALL unknown addresses (awaited, batched)
      const unknownAddrs = nodes
        .filter(n => !KNOWN_ENTITIES[n.id] && !ensNameCache.has(n.id) && n.id !== 'treasury')
        .sort((a, b) => b.totalIn + b.totalOut - (a.totalIn + a.totalOut))
        .map(n => n.id);
      if (unknownAddrs.length > 0) {
        await resolveEnsNames(unknownAddrs);
        // Patch node names & avatar URLs with freshly resolved ENS
        for (const node of nodes) {
          const ens = ensNameCache.get(node.id);
          if (ens && !KNOWN_ENTITIES[node.id]) {
            node.name = ens;
            node.ensName = ens;
            node.ensAvatar = `https://metadata.ens.domains/mainnet/avatar/${ens}`;
          }
        }
      }

      // ── Timeline events for time slider ──────────────────────────────
      interface TimelineEvent {
        t: number; // unix timestamp (seconds)
        type: string; // 'auction' | 'funding' | 'stream' | 'noun_mint'
        from: string;
        to: string;
        value: number; // ETH
        nounId?: string;
        proposalId?: string;
      }
      const timeline: TimelineEvent[] = [];

      // Auction settlements → value from bidder to treasury
      for (const auc of settledAuctions) {
        if (!auc.winner || !auc.amount || !auc.settled) continue;
        const winner = (auc.winner as string).toLowerCase();
        if (TREASURY_ADDRESSES.has(winner)) continue;
        timeline.push({
          t: Number(auc.endTime),
          type: 'auction',
          from: winner,
          to: 'treasury',
          value: Number(auc.amount) / 1e18,
          nounId: String(auc.nounId),
        });
      }

      // Proposal funding → value from treasury to recipients
      for (const prop of allProposals) {
        if (prop.status !== 'EXECUTED' && prop.status !== 'QUEUED') continue;
        const propTxs = allTransactions.filter(tx => String(tx.proposalId) === String(prop.id));
        for (const tx of propTxs) {
          const eth = Number(tx.value) / 1e18;
          if (eth <= 0) continue;
          const target = (tx.target as string).toLowerCase();
          if (TREASURY_ADDRESSES.has(target)) continue;
          timeline.push({
            t: Number(prop.createdAt),
            type: 'funding',
            from: 'treasury',
            to: target,
            value: eth,
            proposalId: String(prop.id),
          });
        }
      }

      // Stream creations
      for (const s of allStreams) {
        const payer = (s.payer as string).toLowerCase();
        const recipient = (s.recipient as string).toLowerCase();
        const isEth = (s.tokenAddress as string).toLowerCase() === WETH;
        const amount = Number(s.tokenAmount) / 1e18;
        if (amount <= 0) continue;
        timeline.push({
          t: Number(s.createdAt),
          type: 'stream',
          from: TREASURY_ADDRESSES.has(payer) ? 'treasury' : payer,
          to: TREASURY_ADDRESSES.has(recipient) ? 'treasury' : recipient,
          value: isEth ? amount : 0,
        });
      }

      // Noun mints (for provenance tracking)
      for (const n of allNouns) {
        timeline.push({
          t: Number(n.createdAt),
          type: 'noun_mint',
          from: 'treasury',
          to: (n.owner as string).toLowerCase(),
          value: 0,
          nounId: String(n.id),
        });
      }

      timeline.sort((a, b) => a.t - b.t);

      const result = {
        nodes,
        links,
        timeline,
        stats: {
          totalInflow: Math.round(totalInflow),
          totalOutflow: Math.round(totalOutflow),
          uniqueAddresses: nodes.length - 1,
          totalTransactions: links.length,
          nounsSettled,
          totalBids,
          propsPassed,
          propsFailed,
          propsCancelled,
          propsExpired,
          totalVotes: allVotes.length,
          uniqueVoters: new Set(allVotes.map(v => v.voter.toLowerCase())).size,
          totalStreams: allStreams.length,
          activeStreams: allStreams.filter(s => s.status === 'active').length,
        },
      };

      treasuryFlowCache = { data: result, fetchedAt: Date.now() };
      return c.json(result);
    } catch (err) {
      console.error('Treasury flows error:', err);
      return c.json(
        { error: 'Failed to compute treasury flows', nodes: [], links: [], stats: {} },
        500,
      );
    }
  });
}
