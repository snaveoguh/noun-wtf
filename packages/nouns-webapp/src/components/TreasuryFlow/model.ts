// Pure helpers for the Nonsense page: labels, formatting, filtering and the
// per-view totals. Everything here is computed from the /api/treasury/flows
// response; nothing is guessed client-side.

import type {
  EntityType,
  Flow,
  FlowKind,
  FlowNode,
  Reconciliation,
  TreasuryFlowsResponse,
} from './types';

// Flow-kind colours: validated as a categorical palette on the dark surface
// (dataviz validate_palette.js — lightness band, chroma, CVD ΔE, contrast all pass).
export const KIND_META: Record<FlowKind, { label: string; color: string; explain: string }> = {
  auction: {
    label: 'auctions',
    color: '#78a000',
    explain: 'Winning bids for the daily Noun. The only money coming in that this page counts.',
  },
  direct: {
    label: 'direct transfers',
    color: '#e0408a',
    explain: 'A proposal sent ETH, WETH, stETH, USDC or a Noun straight to someone.',
  },
  payer: {
    label: 'USDC payments',
    color: '#c86a10',
    explain:
      "Paid in USDC through the DAO's Payer contract. If the Payer is out of USDC it records an IOU and pays it later.",
  },
  stream: {
    label: 'streams',
    color: '#0098b0',
    explain:
      'Paid out gradually over months (vesting). Counted at what was promised, minus anything returned when a stream was cancelled.',
  },
  call: {
    label: 'contract calls',
    color: '#8466e8',
    explain: 'ETH sent along with a call to a contract, e.g. buying something on-chain.',
  },
  fork: {
    label: 'forks',
    color: '#d04040',
    explain:
      'When members left in a fork, their share of the treasury went with them to the new DAO.',
  },
};

export const OUT_KINDS: Exclude<FlowKind, 'auction'>[] = [
  'direct',
  'payer',
  'stream',
  'call',
  'fork',
];

export const TYPE_META: Record<EntityType, { label: string; explain: string; glyph: string }> = {
  treasury: {
    label: 'treasury',
    glyph: '◆',
    explain: 'nouns.eth, plus the original timelock it replaced.',
  },
  person: {
    label: 'people',
    glyph: '●',
    explain: 'A plain wallet (no contract code) that received money.',
  },
  multisig: {
    label: 'team multisigs',
    glyph: '■',
    explain: 'A Safe multisig wallet that received money: usually a team or grant committee.',
  },
  contract: {
    label: 'contracts',
    glyph: '▲',
    explain:
      "Nouns DAO's own contracts, or any recipient with contract code that isn't a Safe (apps, smart wallets).",
  },
  subdao: {
    label: 'forks & DAO programs',
    glyph: '⬢',
    explain:
      'Fork treasuries, and wallets with a DAO-issued *.nouns.eth name (e.g. foundation.nouns.eth).',
  },
  nounders: {
    label: 'nounders',
    glyph: '✚',
    explain: "The founders' multisig: got every 10th Noun for the first five years, not ETH.",
  },
  bidder: { label: 'bidders', glyph: '○', explain: 'Won auctions and never received money back.' },
};

// ── Formatting ──
export function fmtEth(n: number, opts: { sign?: boolean } = {}): string {
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 0 : abs >= 1 ? 1 : abs >= 0.01 ? 2 : 3;
  const s = abs.toLocaleString('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
  let sign = '';
  if (n < 0) sign = '−';
  else if (opts.sign === true && n > 0) sign = '+';
  return `${sign}Ξ${s}`;
}

export function fmtUsd(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(abs >= 1e7 ? 1 : 2)}M`;
  if (abs >= 1e4) return `$${Math.round(abs / 1e3)}k`;
  return `$${abs.toLocaleString('en-US', { maximumFractionDigits: abs >= 100 ? 0 : 2 })}`;
}

export function fmtAmount(f: Pick<Flow, 'asset' | 'amount' | 'eth' | 'usd'>): string {
  if (f.asset === 'NOUN') return f.amount === 1 ? '1 Noun' : `${f.amount} Nouns`;
  if (f.asset === 'ETH') return fmtEth(f.amount);
  if (f.asset === 'USDC') return fmtUsd(f.amount);
  const n = f.amount.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return `${n} ${f.asset === 'TOKEN' ? 'tokens' : f.asset}`;
}

export const fmtDate = (t: number) => (t ? new Date(t * 1000).toISOString().slice(0, 10) : '');

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const etherscanAddr = (a: string) => `https://etherscan.io/address/${a}`;
export const etherscanTx = (h: string) => `https://etherscan.io/tx/${h}`;

// ── Filters ──
export interface ViewFilter {
  year: number | null;
  types: ReadonlySet<EntityType>; // empty = all
  query: string;
}

export const yearOf = (t: number) => new Date(t * 1000).getUTCFullYear();

export const inYear = (f: Flow, year: number | null) => year === null || yearOf(f.t) === year;

export interface ViewTotals {
  inEth: number;
  auctions: number;
  outEth: number;
  outUsd: number;
  ethToUsdc: number;
  netEth: number;
  byKind: Record<Exclude<FlowKind, 'auction'>, { eth: number; usd: number; count: number }>;
  recipients: number;
  proposals: number;
}

/** Headline numbers for a year (or all time). Matches the API's stats when year = null. */
export function viewTotals(data: TreasuryFlowsResponse, year: number | null): ViewTotals {
  const byKind = Object.fromEntries(
    OUT_KINDS.map(k => [k, { eth: 0, usd: 0, count: 0 }]),
  ) as ViewTotals['byKind'];
  let inEth = 0;
  let auctions = 0;
  const recipients = new Set<string>();
  const proposals = new Set<number>();
  for (const f of data.flows) {
    if (!inYear(f, year)) continue;
    if (f.kind === 'auction') {
      inEth += f.eth;
      auctions++;
      continue;
    }
    const k = byKind[f.kind];
    k.eth += f.eth;
    k.usd += f.usd;
    k.count++;
    recipients.add(f.to);
    if (f.proposalId !== undefined) proposals.add(f.proposalId);
  }
  const outEth = OUT_KINDS.reduce((s, k) => s + byKind[k].eth, 0);
  const outUsd = OUT_KINDS.reduce((s, k) => s + byKind[k].usd, 0);
  const ethToUsdc =
    year === null ? data.stats.ethToUsdc : (data.years.find(y => y.year === year)?.ethToUsdc ?? 0);
  return {
    inEth,
    auctions,
    outEth,
    outUsd,
    ethToUsdc,
    netEth: inEth - outEth - ethToUsdc,
    byKind,
    recipients: recipients.size,
    proposals: proposals.size,
  };
}

export function matchesQuery(
  node: FlowNode,
  query: string,
  proposals: TreasuryFlowsResponse['proposals'],
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (node.name.toLowerCase().includes(q)) return true;
  if (node.ens?.toLowerCase().includes(q) === true) return true;
  if (node.label?.toLowerCase().includes(q) === true) return true;
  if (node.id.startsWith(q) || (q.length >= 4 && node.id.includes(q))) return true;
  const pid = q.replace(/^(prop\s*)?#?/, '');
  if (/^\d+$/.test(pid) && node.proposals.includes(Number(pid))) return true;
  if (q.length >= 3) {
    return node.proposals.some(id => proposals[id]?.title.toLowerCase().includes(q));
  }
  return false;
}

export interface RecipientRow {
  node: FlowNode;
  eth: number;
  usd: number;
  nouns: number;
  kinds: FlowKind[];
  proposals: number[];
  lastT: number;
  payments: number;
}

/** One row per address that received money in the view, with view-scoped totals. */
export function recipientRows(data: TreasuryFlowsResponse, filter: ViewFilter): RecipientRow[] {
  const byId = new Map(data.nodes.map(n => [n.id, n]));
  const rows = new Map<string, RecipientRow>();
  for (const f of data.flows) {
    if (f.kind === 'auction' || !inYear(f, filter.year)) continue;
    const node = byId.get(f.to);
    if (!node) continue;
    let r = rows.get(f.to);
    if (!r) {
      r = { node, eth: 0, usd: 0, nouns: 0, kinds: [], proposals: [], lastT: 0, payments: 0 };
      rows.set(f.to, r);
    }
    r.eth += f.eth;
    r.usd += f.usd;
    if (f.asset === 'NOUN') r.nouns += f.amount;
    if (!r.kinds.includes(f.kind)) r.kinds.push(f.kind);
    if (f.proposalId !== undefined && !r.proposals.includes(f.proposalId))
      r.proposals.push(f.proposalId);
    r.lastT = Math.max(r.lastT, f.t);
    r.payments++;
  }
  return [...rows.values()].filter(
    r =>
      (filter.types.size === 0 || filter.types.has(r.node.type)) &&
      matchesQuery(r.node, filter.query, data.proposals),
  );
}

export interface BidderRow {
  node: FlowNode;
  eth: number;
  auctions: number;
  lastT: number;
}

export function bidderRows(data: TreasuryFlowsResponse, filter: ViewFilter): BidderRow[] {
  const byId = new Map(data.nodes.map(n => [n.id, n]));
  const rows = new Map<string, BidderRow>();
  for (const f of data.flows) {
    if (f.kind !== 'auction' || !inYear(f, filter.year)) continue;
    const node = byId.get(f.from);
    if (!node) continue;
    let r = rows.get(f.from);
    if (!r) {
      r = { node, eth: 0, auctions: 0, lastT: 0 };
      rows.set(f.from, r);
    }
    r.eth += f.eth;
    r.auctions++;
    r.lastT = Math.max(r.lastT, f.t);
  }
  return [...rows.values()].filter(
    r =>
      (filter.types.size === 0 || filter.types.has(r.node.type)) &&
      matchesQuery(r.node, filter.query, data.proposals),
  );
}

export type SortKey = 'eth' | 'usd' | 'proposals' | 'lastT' | 'name';

export function sortRows<T extends { node: FlowNode; lastT: number }>(
  rows: T[],
  key: SortKey,
  dir: 1 | -1,
  pick: (r: T, k: SortKey) => number,
): T[] {
  return [...rows].sort((a, b) => {
    if (key === 'name') return dir * a.node.name.localeCompare(b.node.name);
    return dir * (pick(a, key) - pick(b, key)) || a.node.name.localeCompare(b.node.name);
  });
}

/** Flows touching a node (both directions), newest first. */
export function flowsOf(data: TreasuryFlowsResponse, id: string, year: number | null): Flow[] {
  return data.flows
    .filter(f => (f.to === id || f.from === id) && inYear(f, year))
    .sort((a, b) => b.t - a.t);
}

// ── Treasury now + reconciliation ──

export interface WaterfallStep {
  key: string;
  label: string;
  /** Signed change; for the two totals (first and last), the total itself. */
  eth: number;
  /** The bar runs from → to on one shared ETH scale. */
  from: number;
  to: number;
  total?: boolean;
  /** Worked out as the balancing item, not counted. */
  derived?: boolean;
  color: string;
  explain: string;
  tip: string;
}

const fmtUnits = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });

/** The reconciliation as a waterfall: in, the outs, the residual, now. */
export function waterfallSteps(r: Reconciliation): WaterfallStep[] {
  const steps: WaterfallStep[] = [];
  let level = 0;
  const push = (s: Omit<WaterfallStep, 'from' | 'to'>) => {
    const from = s.total === true ? 0 : level;
    const to = s.total === true ? s.eth : level + s.eth;
    steps.push({ ...s, from, to });
    level = to;
  };
  push({
    key: 'in',
    label: 'auction proceeds',
    eth: r.inEth,
    total: true,
    color: KIND_META.auction.color,
    explain: 'every winning bid for a Noun since 2021',
    tip: 'All the ETH paid for Nouns at auction. The only income this page counts directly.',
  });
  push({
    key: 'paid',
    label: 'paid out',
    eth: -r.paidOutEth,
    color: KIND_META.direct.color,
    explain: 'ETH, WETH and stETH that proposals sent to people, teams and contracts',
    tip: 'Direct transfers, streams and ETH sent with contract calls by executed proposals. Dollar (USDC) payments are not in this figure: they were paid with the USDC from the next step.',
  });
  push({
    key: 'usdc',
    label: 'sold for USDC to pay grants in dollars',
    eth: -r.soldForUsdcEth,
    color: KIND_META.payer.color,
    explain: 'ETH the Token Buyer swapped into USDC, which then paid the dollar grants',
    tip: "Many proposals ask for dollars. The DAO's Token Buyer sells treasury ETH for USDC and hands it to the USDC Payer, which pays them. The dollar payments themselves are listed under WHAT WAS SPENT.",
  });
  push({
    key: 'fork',
    label: 'fork payouts',
    eth: -r.forkEth,
    color: KIND_META.fork.color,
    explain: 'what members took with them when they left in the 2023 forks',
    tip: 'When Nouners forked away, each took their share of the treasury in ETH and stETH. (Their USDC and other tokens are not in this ETH figure.)',
  });
  if (r.stakedOutEth > 0) {
    push({
      key: 'staked',
      label: 'staked ETH paid out',
      eth: -r.stakedOutEth,
      color: KIND_META.stream.color,
      explain: `${r.stakedOut.map(s => `${fmtUnits(s.amount)} ${s.symbol}`).join(' + ')}, valued at today's rate`,
      tip: "wstETH and rETH sent out by proposals and forks. They're priced at today's on-chain rate, so older payouts are counted a few % high.",
    });
  }
  push({
    key: 'residual',
    label: 'staking yield & other (derived)',
    eth: r.residualEth,
    derived: true,
    color: '#8d8c84',
    explain: 'the difference that is left: mostly interest earned on staked ETH',
    tip: "Not counted, worked out: treasury now minus everything above. Staked ETH earns about 3–4% a year and most of the treasury has been staked for years (stETH grows; wstETH, rETH and mETH rise in value). Token payouts we can't price, refunds, other income and small items land here too.",
  });
  push({
    key: 'now',
    label: 'treasury now',
    eth: r.nowEth,
    total: true,
    color: '#d4ff3a',
    explain: 'what the DAO holds today in ETH and staked ETH (USDC shown separately)',
    tip: "Live balances of nouns.eth and the DAO's other contracts, with staked tokens converted at their on-chain rates. USDC is not added in: its ETH already left in the USDC step.",
  });
  return steps;
}

/** Share of the ETH-equivalent total, 0..1 (0 when the total is 0 or the value unknown). */
export const shareOf = (eth: number | null, total: number) =>
  eth === null || total <= 0 ? 0 : Math.max(0, Math.min(1, eth / total));

export function fmtToken(amount: number, symbol: string): string {
  if (symbol === 'USDC') return `$${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  const d = amount >= 1000 ? 0 : amount >= 1 ? 2 : 4;
  return `${amount.toLocaleString('en-US', { maximumFractionDigits: d })} ${symbol}`;
}

export const etherscanToken = (token: string, holder: string) =>
  `https://etherscan.io/token/${token}?a=${holder}`;
