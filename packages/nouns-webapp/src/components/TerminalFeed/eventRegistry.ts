/**
 * Terminal feed event registry.
 *
 * One `EventDef` per on-chain event type emitted by `/api/activity` and
 * `/api/nounv2-feed`. Everything the row renderer needs — label, colour,
 * filter key, description, internal link, expandable payload — lives here so
 * adding a new event type is a single entry, not a switch-case plus three
 * parallel sets.
 *
 * Every `describe` guards its own data access: the API contract is being
 * built in parallel, so a missing / differently-shaped key must degrade to a
 * slightly vaguer sentence, never a crash.
 */
import type { ReactNode } from 'react';

export type EventData = Record<string, unknown>;

export type EnsLookup = (addr: string) => string | null;
/** Look up a candidate's title by its candidateId (`${proposer}-${slug}`). */
export type CandidateTitleLookup = (candidateId: string) => string | null;
/** Look up a proposal's title by its numeric proposalId. */
export type ProposalTitleLookup = (proposalId: number | string) => string | null;

export interface DescribeCtx {
  /** ENS-resolved (or shortened) address. Tolerates junk input. */
  addr: (a: unknown) => string;
  /** Candidate title from the feed's CANDIDATE_CREATED cache, else a prettified slug. */
  candTitle: (candidateId: unknown) => string;
}

export type ExpandMode = 'markdown' | 'reason';

export interface EventDef {
  label: string;
  color: string;
  filterKey: string;
  /** Single-glyph icon shown in dense feed modes (sunset shells). */
  icon?: string;
  describe: (data: EventData, ctx: DescribeCtx) => ReactNode;
  /** Internal react-router route for the `view` link, if any. */
  link?: (data: EventData) => string | null;
  /** Which long-form payload the row can expand into. */
  expand?: ExpandMode;
  /**
   * Data-dependent overrides — e.g. AUCTION_SETTLED with `treasury:true`
   * relabels to TREASURY. `key` feeds `data-event-type` for the disco CSS.
   */
  variant?: (
    data: EventData,
  ) => (Partial<Pick<EventDef, 'label' | 'color' | 'expand'>> & { key?: string }) | null;
}

// ─── Palette ───────────────────────────────────────────────────────────────
// Families: auction=green, bids=blue, proposals=yellow, votes=purple,
// candidates=cyan, delegations=magenta, transfers/sales=orange/amber,
// forks=red, streams/grants=teal, dao config=grey-blue, nounder=gold,
// treasury=slate, burned=orange. Lil = pastel siblings, V2 = red family.
const C = {
  auction: '#4ade80',
  auctionSoft: '#86efac',
  bid: '#60a5fa',
  nounder: '#e0b040',
  treasury: '#94a3b8',
  burned: '#f97316',
  prop: '#facc15',
  propSoft: '#fde68a',
  voting: '#fbbf24',
  objection: '#f59e0b',
  pass: '#34d399',
  fail: '#f87171',
  veto: '#fb923c',
  vote: '#c084fc',
  feedback: '#9ca3af',
  cand: '#22d3ee',
  candSoft: '#a5f3fc',
  topic: '#67e8f9',
  sponsor: '#38bdf8',
  promoted: '#fde047',
  deleg: '#e879f9',
  undeleg: '#d946ef',
  xfer: '#fdba74',
  sale: '#f97316',
  fork: '#ef4444',
  forkSoft: '#f87171',
  stream: '#2dd4bf',
  streamSoft: '#5eead4',
  grant: '#14b8a6',
  grantSoft: '#99f6e4',
  config: '#8da2c4',
  lilBid: '#93c5fd',
  lilAuction: '#86efac',
  lilVote: '#d8b4fe',
  lilProp: '#fde047',
  lilXfer: '#fbcfe8',
  v2: '#ef4444',
  v2Dark: '#dc2626',
  v2Soft: '#f87171',
  v2Prop: '#b91c1c',
  v2Vote: '#fca5a5',
  v2Sale: '#fb7185',
} as const;

export const BURNED_COLOR = C.burned;

// ─── Safe accessors ────────────────────────────────────────────────────────

const str = (v: unknown, fallback = ''): string =>
  v == null || v === '' ? fallback : typeof v === 'string' ? v : String(v);

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1 || v === '1';

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
const isZeroAddr = (v: unknown): boolean => str(v).toLowerCase() === ZERO_ADDR;

export const isAddress = (v: unknown): v is string =>
  typeof v === 'string' && /^0x[\dA-Fa-f]{40}$/.test(v);

// ─── Formatting helpers ────────────────────────────────────────────────────

export function prettifyCandidateId(candidateId: string): string {
  // candidateId = `${proposer}-${slug}` where proposer is a 42-char 0x address.
  const slug =
    candidateId.startsWith('0x') && candidateId.length > 43 ? candidateId.slice(43) : candidateId;
  return slug.replace(/-/g, ' ').slice(0, 60);
}

export function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr || '???';
  return `${addr.slice(0, 6)}..${addr.slice(-4)}`;
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** Ξ-prefixed ETH amount from a float. */
export function fmtEth(eth: number | null): string {
  if (eth == null || !Number.isFinite(eth)) return 'Ξ?';
  if (eth === 0) return 'Ξ0';
  if (eth < 0.001) return 'Ξ<0.001';
  const fixed = eth < 1 ? eth.toFixed(4) : eth < 100 ? eth.toFixed(2) : eth.toFixed(1);
  return `Ξ${trimZeros(fixed)}`;
}

/** Ξ-prefixed ETH amount from a wei string/number/bigint. */
export function ethFromWei(wei: unknown): string {
  const n = num(wei);
  return fmtEth(n == null ? null : n / 1e18);
}

// USDC/stablecoins use 6 decimals, not 18
function usdcFromUnits(units: unknown): string {
  const n = num(units);
  if (n == null) return '?';
  const amount = n / 1e6;
  if (amount === 0) return '0';
  if (amount < 0.01) return '<0.01';
  return amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

const USDC_ADDRESS = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const STETH_ADDRESS = '0xae7ab96520de3a18e5e111b5eaab095312d7fe84';
const WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

export function formatStreamAmount(tokenAmount: unknown, tokenAddress?: unknown): string {
  const addr = str(tokenAddress).toLowerCase();
  if (addr === USDC_ADDRESS) return `${usdcFromUnits(tokenAmount)} USDC`;
  if (addr === STETH_ADDRESS) return `${ethFromWei(tokenAmount).replace('Ξ', '')} stETH`;
  if (addr === WETH_ADDRESS) return `${ethFromWei(tokenAmount).replace('Ξ', '')} WETH`;
  return ethFromWei(tokenAmount);
}

export function supportLabel(support: unknown): string {
  const s = num(support);
  if (s === 0) return 'AGAINST';
  if (s === 1) return 'FOR';
  if (s === 2) return 'ABSTAIN';
  return '?';
}

// Reservoir returns marketplace source as host strings like "opensea.io",
// "blur.io", "looksrare.org", "x2y2.io", "sudoswap.xyz". Pretty-print them.
const MARKETPLACE_DISPLAY: Record<string, string> = {
  'opensea.io': 'OpenSea',
  opensea: 'OpenSea',
  seaport: 'OpenSea',
  'blur.io': 'Blur',
  blur: 'Blur',
  'looksrare.org': 'LooksRare',
  looksrare: 'LooksRare',
  'x2y2.io': 'X2Y2',
  x2y2: 'X2Y2',
  'sudoswap.xyz': 'Sudoswap',
  'reservoir.tools': 'Reservoir',
  'rarible.com': 'Rarible',
  'magiceden.io': 'Magic Eden',
  magiceden: 'Magic Eden',
};

export function formatMarketplace(raw: unknown): string {
  const s = str(raw);
  if (!s) return '';
  const lower = s.toLowerCase();
  if (MARKETPLACE_DISPLAY[lower]) return MARKETPLACE_DISPLAY[lower];
  const stripped = lower.replace(/\.(io|xyz|org|com|tools|app|wtf|dev)$/i, '');
  if (!stripped) return s;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

/** `— "text…"` suffix for reasons/comments, or '' when empty. */
function quote(text: unknown, max = 80): string {
  const t = str(text).trim();
  if (!t) return '';
  return ` — "${t.slice(0, max)}${t.length > max ? '…' : ''}"`;
}

const n = (v: number): string => v.toLocaleString('en-US');

/** Compact duration: 45s / 12m / 5h / 3d. */
export function humanDuration(seconds: number): string {
  const s = Math.abs(Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.max(1, Math.round(h / 24))}d`;
}

/** Parse a unix-seconds / unix-ms / ISO timestamp into ms, or null. */
function toMs(v: unknown): number | null {
  const asNum = num(v);
  if (asNum != null) return asNum > 1e12 ? asNum : asNum * 1000;
  const parsed = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** "in ~2d" / "now" / "3h ago" relative to the wall clock. */
function relative(v: unknown): string | null {
  const ms = toMs(v);
  if (ms == null) return null;
  const diff = (ms - Date.now()) / 1000;
  if (Math.abs(diff) < 60) return 'now';
  return diff > 0 ? `in ~${humanDuration(diff)}` : `${humanDuration(diff)} ago`;
}

const plural = (count: number, word: string): string =>
  `${n(count)} ${word}${count === 1 ? '' : 's'}`;

/** "Noun 12" / "Nouns 12, 34" / "Nouns 1, 2, 3, 4, 5 +7 more" from nounIds[] or nounId. */
function nounList(data: EventData, prefix = 'Noun'): string {
  const ids = arr(data.nounIds)
    .map(v => str(v))
    .filter(Boolean);
  if (ids.length === 0) {
    const single = str(data.nounId ?? data.tokenId);
    return single ? `${prefix} ${single}` : `${prefix}`;
  }
  if (ids.length === 1) return `${prefix} ${ids[0]}`;
  const shown = ids.slice(0, 6).join(', ');
  const more = ids.length > 6 ? ` +${ids.length - 6} more` : '';
  return `${prefix}s ${shown}${more}`;
}

const firstNounId = (data: EventData): string =>
  str(arr(data.nounIds)[0] ?? data.nounId ?? data.tokenId);

const propTitle = (data: EventData): string => {
  const t = str(data.title).trim();
  return t ? ` — ${t}` : '';
};

const propRef = (data: EventData, dao = ''): string => `${dao}Prop ${str(data.proposalId, '?')}`;

// ─── Config-change humanizers ──────────────────────────────────────────────

function humanizeParam(param: string): string {
  const cleaned = param
    .replace(/inblocks$/i, '')
    .replace(/bps$/i, '')
    .replace(/percentage$/i, '')
    .replace(/([\da-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function formatConfigValue(
  param: string,
  raw: unknown,
  ctx: DescribeCtx,
): { text: string; unit?: string; approx?: string } {
  const p = param.toLowerCase();
  if (isAddress(raw)) return { text: ctx.addr(raw) };
  if (Array.isArray(raw))
    return { text: raw.map(v => (isAddress(v) ? ctx.addr(v) : str(v))).join(', ') || '∅' };
  const v = num(raw);
  if (v == null) return { text: str(raw, '?') };
  if (p.includes('price')) return { text: ethFromWei(raw) };
  if (p.includes('bps')) return { text: `${trimZeros((v / 100).toFixed(2))}%` };
  if (p.includes('percent')) return { text: `${trimZeros(v.toFixed(2))}%` };
  if (p.includes('coefficient')) return { text: trimZeros((v / 1e6).toFixed(4)) };
  // Block-denominated governor params (votingPeriod, votingDelay,
  // proposalUpdatablePeriodInBlocks, objectionPeriodDurationInBlocks,
  // lastMinuteWindowInBlocks) — show blocks plus ≈ wall-clock at 12s/block.
  const isBlocks =
    p.includes('block') ||
    p.includes('voting') ||
    p.includes('objection') ||
    p.includes('updatable') ||
    p.includes('window') ||
    p.includes('delay');
  if (isBlocks) return { text: n(v), unit: 'blocks', approx: humanDuration(v * 12) };
  // Seconds-denominated (AH timeBuffer / duration, DAO forkPeriod).
  if (p.includes('timebuffer') || p.includes('duration') || p.includes('period')) {
    return { text: n(v), unit: 's', approx: humanDuration(v) };
  }
  return { text: n(v) };
}

function describeConfigChange(prefix: string, data: EventData, ctx: DescribeCtx): string {
  const param = str(data.param, 'setting');
  const oldV = formatConfigValue(param, data.oldValue, ctx);
  const newV = formatConfigValue(param, data.newValue, ctx);
  const unit = newV.unit ? ` ${newV.unit}` : '';
  const approx = oldV.approx && newV.approx ? ` (≈${oldV.approx} → ${newV.approx})` : '';
  const hasOld = data.oldValue != null && data.oldValue !== '';
  const change = hasOld ? `${oldV.text} → ${newV.text}${unit}` : `set to ${newV.text}${unit}`;
  return `${prefix}${humanizeParam(param)} ${change}${approx}`;
}

// ─── Shared describers ─────────────────────────────────────────────────────

/**
 * Settle outcome. Explicit `treasury` / `burned` flags win. Without them:
 * V4 (live since 2026-05-25) routes a no-bid noun to the treasury and the
 * indexer emits `winner: ""` + `amount: "0"` for it; pre-V4 no-bid settles
 * emitted `winner: 0x000…0` and burned the noun.
 */
function settleOutcome(data: EventData): 'treasury' | 'burned' | 'won' {
  if (bool(data.treasury)) return 'treasury';
  if (bool(data.burned)) return 'burned';
  const noBid = (num(data.amount) ?? 0) === 0;
  if (!noBid) return 'won';
  const winner = str(data.winner);
  if (!winner) return 'treasury';
  if (isZeroAddr(winner)) return 'burned';
  return 'won';
}

function describeSettled(data: EventData, ctx: DescribeCtx, dao = ''): string {
  const noun = `${dao}Noun ${str(data.nounId, '?')}`;
  const settler =
    isAddress(data.settler) && !isZeroAddr(data.settler)
      ? ` · settled by ${ctx.addr(data.settler)}`
      : '';
  const outcome = settleOutcome(data);
  if (outcome === 'treasury') return `${noun} had no bids → held by Nouns DAO treasury${settler}`;
  if (outcome === 'burned') return `${noun} burned 🔥${settler}`;
  return `${noun} won by ${ctx.addr(data.winner)} for ${ethFromWei(data.amount)}${settler}`;
}

function settledVariant(data: EventData) {
  const outcome = settleOutcome(data);
  if (outcome === 'treasury') return { key: 'TREASURY', label: 'TREASURY', color: C.treasury };
  if (outcome === 'burned') return { key: 'BURNED', label: 'BURNED', color: C.burned };
  return null;
}

function describeVote(data: EventData, ctx: DescribeCtx, propLabel: string): string {
  const support = supportLabel(data.support);
  const weight = num(data.votes);
  const w = weight != null ? ` (${n(weight)})` : '';
  const prop = `${propLabel} ${str(data.proposalId, '?')}`;
  const voter = ctx.addr(data.voter);
  let base: string;
  if (isAddress(data.replyTo)) {
    base = `${voter} replied to ${ctx.addr(data.replyTo)} and voted ${support}${w} on ${prop}`;
  } else if (bool(data.isRevote)) {
    base = `${voter} revoted ${support}${w} on ${prop}`;
  } else {
    base = `${voter} voted ${support}${w} on ${prop}`;
  }
  return `${base}${quote(data.reason)}`;
}

function describeProposalCreated(data: EventData, ctx: DescribeCtx, dao = ''): string {
  const signers = arr(data.signers).length;
  const withSigners = signers > 0 ? ` · with ${plural(signers, 'signer')}` : '';
  return `New ${dao}proposal #${str(data.proposalId, '?')} by ${ctx.addr(data.proposer)}: ${str(data.title, 'untitled')}${withSigners}`;
}

function describeDelegation(data: EventData, ctx: DescribeCtx): string {
  const delegator = ctx.addr(data.delegator);
  const count = num(data.nounCount);
  const nouns = count != null ? plural(count, 'noun') : 'votes';
  const kind = (() => {
    const k = str(data.kind).toLowerCase();
    if (k) return k;
    const from = str(data.fromDelegate).toLowerCase();
    const to = str(data.toDelegate).toLowerCase();
    const self = str(data.delegator).toLowerCase();
    if (!from || from === ZERO_ADDR || from === self) return 'delegate';
    if (to === self || to === ZERO_ADDR) return 'undelegate';
    return 'redelegate';
  })();
  if (kind === 'undelegate') {
    const paren = count != null ? ` (${nouns})` : '';
    return `${delegator} removed delegation from ${ctx.addr(data.fromDelegate)}${paren}`;
  }
  if (kind === 'redelegate') {
    return `${delegator} redelegated ${nouns} from ${ctx.addr(data.fromDelegate)} → ${ctx.addr(data.toDelegate)}`;
  }
  return `${delegator} delegated ${nouns} to ${ctx.addr(data.toDelegate)}`;
}

function describeSale(data: EventData, ctx: DescribeCtx, dao = ''): string {
  const hasNounIds = arr(data.nounIds).length > 0;
  const subject = hasNounIds
    ? nounList(data, `${dao}Noun`)
    : (() => {
        const name = str(data.collectionName) || str(data.collection) || `${dao}Noun`;
        const tokenId = str(data.tokenId ?? data.nounId);
        return tokenId ? `${name} ${tokenId}` : name;
      })();
  const price = fmtEth(num(data.priceEth));
  const currency = str(data.currency, 'ETH');
  const priceStr =
    currency === 'ETH' || currency === 'WETH' ? price : `${price.replace('Ξ', '')} ${currency}`;
  const market = formatMarketplace(data.marketplace);
  const marketSuffix = market ? ` on ${market}` : '';
  const seller = isAddress(data.from) ? ctx.addr(data.from) : '';
  const buyer = isAddress(data.to) ? ctx.addr(data.to) : '';
  const party =
    seller && buyer
      ? ` — ${seller} → ${buyer}`
      : buyer
        ? ` → ${buyer}`
        : seller
          ? ` — from ${seller}`
          : '';
  return `${subject} sold for ${priceStr}${marketSuffix}${party}`;
}

function describeEnded(data: EventData): string {
  const forV = num(data.forVotes) ?? 0;
  const against = num(data.againstVotes) ?? 0;
  const abstain = num(data.abstainVotes);
  const quorum = num(data.quorumVotes);
  const succeeded = endedSucceeded(data);
  const extras = [
    abstain != null ? `${n(abstain)} abstain` : null,
    quorum != null ? `quorum ${n(quorum)}` : null,
  ].filter(Boolean);
  const paren = extras.length ? ` (${extras.join(', ')})` : '';
  return `${propRef(data)} ${succeeded ? 'succeeded' : 'defeated'} ${n(forV)}–${n(against)}${paren}${propTitle(data)}`;
}

function endedSucceeded(data: EventData): boolean {
  const r = str(data.result).toLowerCase();
  if (r) return r.startsWith('succ') || r.startsWith('pass');
  const forV = num(data.forVotes) ?? 0;
  const against = num(data.againstVotes) ?? 0;
  const quorum = num(data.quorumVotes) ?? 0;
  return forV > against && forV >= quorum;
}

function forkNouns(data: EventData): string {
  const ids = arr(data.nounIds);
  if (ids.length === 0) {
    const count = num(data.nounCount ?? data.tokensInEscrow);
    return count != null ? plural(count, 'Noun') : 'Nouns';
  }
  return nounList(data);
}

const forkRef = (data: EventData): string => `fork #${str(data.forkId, '?')}`;

// ─── Links ─────────────────────────────────────────────────────────────────

const nounLink = (base: string) => (data: EventData) => {
  const id = firstNounId(data);
  return id ? `${base}/${id}` : null;
};
const propLink = (base: string) => (data: EventData) => {
  const id = str(data.proposalId);
  return id ? `${base}/${id}` : null;
};
const candidateLink = (data: EventData): string | null => {
  const id = str(data.candidateId);
  return id ? `/candidates/${id}` : null;
};
const forkLink = (data: EventData): string | null => {
  const id = str(data.forkId);
  return id ? `/fork/${id}` : null;
};

// ─── Registry ──────────────────────────────────────────────────────────────

const def = (d: EventDef): EventDef => d;

export const EVENT_REGISTRY: Record<string, EventDef> = {
  // ── Auctions ────────────────────────────────────────────────────────────
  AUCTION_CREATED: def({
    label: 'AUCTION',
    color: C.auctionSoft,
    filterKey: 'AUCTION_CREATED',
    icon: '🔔',
    describe: (d, ctx) => {
      const curator =
        isAddress(d.curator) && !isZeroAddr(d.curator)
          ? ` · curated by ${ctx.addr(d.curator)}`
          : '';
      return `Auction for Noun ${str(d.nounId, '?')} started${curator}`;
    },
    link: nounLink('/noun'),
  }),
  AUCTION_SETTLED: def({
    label: 'SETTLED',
    color: C.auction,
    filterKey: 'AUCTION_SETTLED',
    icon: '🔥',
    describe: (d, ctx) => describeSettled(d, ctx),
    variant: settledVariant,
    link: nounLink('/noun'),
  }),
  BID: def({
    label: 'BID',
    color: C.bid,
    filterKey: 'BID',
    icon: '💰',
    describe: (d, ctx) =>
      `${ctx.addr(d.bidder)} bid ${ethFromWei(d.value)} on Noun ${str(d.nounId, '?')}${bool(d.extended) ? ' · extended auction' : ''}`,
    link: nounLink('/noun'),
  }),
  NOUN_CREATED: def({
    label: 'NOUN',
    color: C.auction,
    filterKey: 'NOUN_CREATED',
    icon: '🔔',
    describe: (d, ctx) => `Noun ${str(d.nounId, '?')} minted to ${ctx.addr(d.owner)}`,
    link: nounLink('/noun'),
  }),
  NOUNDER_NOUN: def({
    label: 'NOUNDER',
    color: C.nounder,
    filterKey: 'NOUNDER_NOUN',
    icon: '👑',
    describe: (d, ctx) => `Noun ${str(d.nounId, '?')} rewarded to ${ctx.addr(d.owner ?? d.to)}`,
    link: nounLink('/noun'),
  }),
  AUCTION_CONFIG_CHANGED: def({
    label: 'AH-CONFIG',
    color: C.config,
    filterKey: 'AUCTION_CONFIG_CHANGED',
    icon: '⚙️',
    describe: (d, ctx) => describeConfigChange('Auction ', d, ctx),
  }),

  // ── Token ───────────────────────────────────────────────────────────────
  TRANSFER: def({
    label: 'XFER',
    color: C.xfer,
    filterKey: 'TRANSFER',
    icon: '↔️',
    describe: (d, ctx) => `${nounList(d)} transferred ${ctx.addr(d.from)} → ${ctx.addr(d.to)}`,
    link: nounLink('/noun'),
  }),
  SALE: def({
    label: 'SALE',
    color: C.sale,
    filterKey: 'SALE',
    icon: '🏷',
    describe: (d, ctx) => describeSale(d, ctx),
    link: d => (arr(d.nounIds).length > 0 ? nounLink('/noun')(d) : null),
  }),
  DELEGATION: def({
    label: 'DELEG',
    color: C.deleg,
    filterKey: 'DELEGATION',
    icon: '🤝',
    describe: describeDelegation,
    variant: d => {
      const k = str(d.kind).toLowerCase();
      if (k === 'undelegate') return { key: 'UNDELEG', label: 'UNDELEG', color: C.undeleg };
      if (k === 'redelegate') return { key: 'REDELEG', label: 'REDELEG' };
      return null;
    },
  }),

  // ── Proposals ───────────────────────────────────────────────────────────
  PROPOSAL_CREATED: def({
    label: 'PROP',
    color: C.prop,
    filterKey: 'PROPOSAL_CREATED',
    icon: '📜',
    describe: (d, ctx) => describeProposalCreated(d, ctx),
    link: propLink('/vote'),
    expand: 'markdown',
  }),
  PROPOSAL_UPDATED: def({
    label: 'PROP-UPD',
    color: C.propSoft,
    filterKey: 'PROPOSAL_UPDATED',
    icon: '✏️',
    describe: d => {
      const kind = str(d.kind);
      const k = kind ? ` (${kind})` : '';
      return `${propRef(d)} updated${k}${quote(d.updateMessage, 80)}${kind ? '' : propTitle(d)}`;
    },
    link: propLink('/vote'),
    expand: 'reason',
  }),
  PROPOSAL_VOTING_STARTED: def({
    label: 'VOTING',
    color: C.voting,
    filterKey: 'PROPOSAL_VOTING_STARTED',
    icon: '🗳',
    describe: d => `Voting started on ${propRef(d)}${propTitle(d)}`,
    link: propLink('/vote'),
  }),
  PROPOSAL_OBJECTION_PERIOD: def({
    label: 'OBJECTION',
    color: C.objection,
    filterKey: 'PROPOSAL_OBJECTION_PERIOD',
    icon: '⚠️',
    describe: d => `${propRef(d)} entered objection period${propTitle(d)}`,
    link: propLink('/vote'),
  }),
  PROPOSAL_ENDED: def({
    label: 'ENDED',
    color: C.pass,
    filterKey: 'PROPOSAL_ENDED',
    icon: '🏁',
    describe: d => describeEnded(d),
    variant: d =>
      endedSucceeded(d)
        ? { key: 'SUCCEEDED', label: 'SUCCEEDED', color: C.pass }
        : { key: 'DEFEATED', label: 'DEFEATED', color: C.fail },
    link: propLink('/vote'),
  }),
  PROPOSAL_QUEUED: def({
    label: 'QUEUED',
    color: C.voting,
    filterKey: 'PROPOSAL_QUEUED',
    icon: '⏳',
    describe: d => {
      const eta = relative(d.executionETA ?? d.eta);
      const etaStr = eta ? ` · executes ${eta === 'now' ? 'now' : eta}` : '';
      return `${propRef(d)} queued for execution${etaStr}${propTitle(d)}`;
    },
    link: propLink('/vote'),
  }),
  PROPOSAL_EXECUTED: def({
    label: 'EXECUTED',
    color: C.pass,
    filterKey: 'PROPOSAL_EXECUTED',
    icon: '✅',
    describe: d => `${propRef(d)} executed onchain${propTitle(d)}`,
    link: propLink('/vote'),
  }),
  PROPOSAL_CANCELLED: def({
    label: 'CANCELLED',
    color: C.fail,
    filterKey: 'PROPOSAL_CANCELLED',
    icon: '🚫',
    describe: d => `${propRef(d)} cancelled${propTitle(d)}`,
    link: propLink('/vote'),
  }),
  PROPOSAL_VETOED: def({
    label: 'VETOED',
    color: C.veto,
    filterKey: 'PROPOSAL_VETOED',
    icon: '⛔',
    describe: d => `${propRef(d)} vetoed${propTitle(d)}`,
    link: propLink('/vote'),
  }),
  VOTE: def({
    label: 'VOTE',
    color: C.vote,
    filterKey: 'VOTE',
    icon: '🗳',
    describe: (d, ctx) => describeVote(d, ctx, 'Prop'),
    variant: d => (bool(d.isRevote) ? { key: 'REVOTE', label: 'REVOTE' } : null),
    link: propLink('/vote'),
    expand: 'reason',
  }),
  PROPOSAL_FEEDBACK: def({
    label: 'FEEDBACK',
    color: C.feedback,
    filterKey: 'PROPOSAL_FEEDBACK',
    icon: '💬',
    describe: (d, ctx) =>
      `${ctx.addr(d.voter)} gave ${supportLabel(d.support)} feedback on ${propRef(d)}${quote(d.reason, 60)}`,
    link: propLink('/vote'),
    expand: 'reason',
  }),

  // ── Candidates ──────────────────────────────────────────────────────────
  CANDIDATE_CREATED: def({
    label: 'CAND',
    color: C.cand,
    filterKey: 'CANDIDATE_CREATED',
    icon: '📝',
    describe: (d, ctx) => {
      const title = str(d.title) || str(d.slug) || 'untitled';
      const who = ctx.addr(d.proposer);
      if (bool(d.isTopic)) return `${who} started topic ${title}`;
      const updates = str(d.updatesProposalId);
      if (updates && updates !== '0')
        return `${who} created update candidate for Prop ${updates} — ${title}`;
      return `New candidate by ${who}: ${title}`;
    },
    variant: d => (bool(d.isTopic) ? { key: 'TOPIC', label: 'TOPIC', color: C.topic } : null),
    link: candidateLink,
    expand: 'markdown',
  }),
  CANDIDATE_SPONSORED: def({
    label: 'SPONSOR',
    color: C.sponsor,
    filterKey: 'CANDIDATE_SPONSORED',
    icon: '✍️',
    describe: (d, ctx) => {
      const votes = num(d.votes);
      const withVotes = votes != null ? ` with ${plural(votes, 'noun')}` : '';
      const exp = relative(d.expirationTimestamp);
      const expStr = exp
        ? exp.startsWith('in')
          ? ` (expires ${exp.replace('~', '')})`
          : ' (expired)'
        : '';
      return `${ctx.addr(d.signer)} sponsored "${ctx.candTitle(d.candidateId)}"${withVotes}${expStr}${quote(d.reason, 60)}`;
    },
    link: candidateLink,
    expand: 'reason',
  }),
  CANDIDATE_UPDATED: def({
    label: 'CAND-UPD',
    color: C.candSoft,
    filterKey: 'CANDIDATE_UPDATED',
    icon: '✏️',
    describe: (d, ctx) =>
      `${ctx.addr(d.proposer)} updated candidate "${str(d.title) || ctx.candTitle(d.candidateId)}"${quote(d.reason, 60)}`,
    link: candidateLink,
    expand: 'markdown',
  }),
  CANDIDATE_CANCELED: def({
    label: 'CAND-CXL',
    color: C.fail,
    filterKey: 'CANDIDATE_CANCELED',
    icon: '🗑',
    describe: (d, ctx) =>
      `${ctx.addr(d.proposer)} canceled candidate "${str(d.title) || ctx.candTitle(d.candidateId)}"`,
    link: candidateLink,
  }),
  CANDIDATE_PROMOTED: def({
    label: 'PROMOTED',
    color: C.promoted,
    filterKey: 'CANDIDATE_PROMOTED',
    icon: '⬆️',
    describe: (d, ctx) => {
      const pid = str(d.proposalId);
      return `${ctx.addr(d.proposer)} promoted candidate "${str(d.title) || ctx.candTitle(d.candidateId)}"${pid ? ` to Prop #${pid}` : ''}`;
    },
    link: d => (str(d.proposalId) ? `/vote/${str(d.proposalId)}` : candidateLink(d)),
  }),
  CANDIDATE_FEEDBACK: def({
    label: 'FEEDBACK',
    color: C.feedback,
    filterKey: 'CANDIDATE_FEEDBACK',
    icon: '💬',
    describe: (d, ctx) =>
      `${ctx.addr(d.voter)} gave ${supportLabel(d.support)} feedback on "${ctx.candTitle(d.candidateId)}"${quote(d.reason, 60)}`,
    link: candidateLink,
    expand: 'reason',
  }),

  // ── Streams ─────────────────────────────────────────────────────────────
  STREAM_CREATED: def({
    label: 'STREAM',
    color: C.stream,
    filterKey: 'STREAM_CREATED',
    icon: '🌊',
    describe: (d, ctx) => {
      const prop = str(d.proposalId) ? ` (Prop ${str(d.proposalId)})` : '';
      return `Stream to ${ctx.addr(d.recipient)} for ${formatStreamAmount(d.tokenAmount, d.tokenAddress)}${prop}`;
    },
    link: propLink('/vote'),
  }),
  STREAM_CANCELLED: def({
    label: 'STREAM-CXL',
    color: C.fail,
    filterKey: 'STREAM_CANCELLED',
    icon: '🚫',
    describe: (d, ctx) => {
      const prop = str(d.proposalId) ? ` (Prop ${str(d.proposalId)})` : '';
      return `Stream to ${ctx.addr(d.recipient)} cancelled${prop}`;
    },
    link: propLink('/vote'),
  }),
  STREAM_WITHDRAWN: def({
    label: 'STREAM-WD',
    color: C.streamSoft,
    filterKey: 'STREAM_WITHDRAWN',
    icon: '💸',
    describe: (d, ctx) => {
      const prop = str(d.proposalId) ? ` (Prop ${str(d.proposalId)})` : '';
      return `${ctx.addr(d.recipient)} withdrew ${formatStreamAmount(d.amount ?? d.tokenAmount, d.tokenAddress)} from stream${prop}`;
    },
    link: propLink('/vote'),
  }),

  // ── Forks ───────────────────────────────────────────────────────────────
  FORK_ESCROW: def({
    label: 'FORK',
    color: C.fork,
    filterKey: 'FORK_ESCROW',
    icon: '🍴',
    describe: (d, ctx) =>
      `${ctx.addr(d.owner)} escrowed ${forkNouns(d)} to ${forkRef(d)}${quote(d.reason, 60)}`,
    link: forkLink,
    expand: 'reason',
  }),
  FORK_JOIN: def({
    label: 'FORK-JOIN',
    color: C.fork,
    filterKey: 'FORK_JOIN',
    icon: '🍴',
    describe: (d, ctx) =>
      `${ctx.addr(d.owner)} joined ${forkRef(d)} with ${forkNouns(d)}${quote(d.reason, 60)}`,
    link: forkLink,
    expand: 'reason',
  }),
  FORK_WITHDRAW: def({
    label: 'FORK-WD',
    color: C.forkSoft,
    filterKey: 'FORK_WITHDRAW',
    icon: '↩️',
    describe: (d, ctx) => `${ctx.addr(d.owner)} withdrew ${forkNouns(d)} from ${forkRef(d)} escrow`,
    link: forkLink,
  }),
  FORK_EXECUTED: def({
    label: 'FORK-EXEC',
    color: C.fork,
    filterKey: 'FORK_EXECUTED',
    icon: '💥',
    describe: (d, ctx) => {
      const count = num(d.tokensInEscrow ?? d.nounCount);
      const nouns = count != null ? plural(count, 'noun') : 'nouns';
      const treasury = isAddress(d.forkTreasury) ? ` (${ctx.addr(d.forkTreasury)})` : '';
      return `Fork #${str(d.forkId, '?')} executed — ${nouns} → new DAO${treasury}`;
    },
    link: forkLink,
  }),

  // ── DAO config ──────────────────────────────────────────────────────────
  DAO_CONFIG_CHANGED: def({
    label: 'DAO-CONFIG',
    color: C.config,
    filterKey: 'DAO_CONFIG_CHANGED',
    icon: '⚙️',
    describe: (d, ctx) => describeConfigChange('', d, ctx),
  }),

  // ── Grants ──────────────────────────────────────────────────────────────
  GRANT_CREATED: def({
    label: 'GRANT',
    color: C.grant,
    filterKey: 'GRANT_CREATED',
    icon: '🎁',
    describe: (d, ctx) => {
      const title =
        str(d.title) ||
        (str(d.description).split('\n')[0] ?? '').replace(/^#\s*/, '').slice(0, 80) ||
        'untitled';
      return `${ctx.addr(d.proposer)} created grant #${str(d.grantId, '?')}: ${title}`;
    },
    expand: 'markdown',
  }),
  GRANT_VOTE: def({
    label: 'GRANT-VOTE',
    color: C.grantSoft,
    filterKey: 'GRANT_VOTE',
    icon: '🗳',
    describe: (d, ctx) => {
      const votes = num(d.votes);
      return `${ctx.addr(d.voter)} voted ${supportLabel(d.support)}${votes != null ? ` (${n(votes)})` : ''} on grant #${str(d.grantId, '?')}${quote(d.reason, 60)}`;
    },
    expand: 'reason',
  }),
  GRANT_QUEUED: def({
    label: 'GRANT-QUEUED',
    color: C.grantSoft,
    filterKey: 'GRANT_QUEUED',
    icon: '⏳',
    describe: d => `Grant #${str(d.grantId, '?')} queued for execution`,
  }),
  GRANT_EXECUTED: def({
    label: 'GRANT-EXEC',
    color: C.grant,
    filterKey: 'GRANT_EXECUTED',
    icon: '✅',
    describe: d => `Grant #${str(d.grantId, '?')} executed`,
  }),
  GRANT_CANCELED: def({
    label: 'GRANT-CXL',
    color: C.fail,
    filterKey: 'GRANT_CANCELED',
    icon: '🚫',
    describe: d => `Grant #${str(d.grantId, '?')} canceled`,
  }),

  // ── Lil Nouns ───────────────────────────────────────────────────────────
  LIL_BID: def({
    label: 'L-BID',
    color: C.lilBid,
    filterKey: 'LIL_BID',
    icon: '💰',
    describe: (d, ctx) =>
      `${ctx.addr(d.bidder)} bid ${ethFromWei(d.value)} on Lil Noun ${str(d.nounId, '?')}${quote(d.comment ?? d.reason)}`,
    expand: 'reason',
  }),
  LIL_AUCTION_SETTLED: def({
    label: 'L-SETTLED',
    color: C.lilAuction,
    filterKey: 'LIL_AUCTION_SETTLED',
    icon: '🔥',
    describe: (d, ctx) => describeSettled(d, ctx, 'Lil '),
    variant: settledVariant,
  }),
  LIL_NOUN_CREATED: def({
    label: 'L-NOUN',
    color: C.lilAuction,
    filterKey: 'LIL_NOUN_CREATED',
    icon: '🔔',
    describe: (d, ctx) => `Lil Noun ${str(d.nounId, '?')} minted to ${ctx.addr(d.owner)}`,
  }),
  LIL_VOTE: def({
    label: 'L-VOTE',
    color: C.lilVote,
    filterKey: 'LIL_VOTE',
    icon: '🗳',
    describe: (d, ctx) => describeVote(d, ctx, 'Lil Prop'),
    expand: 'reason',
  }),
  LIL_PROPOSAL_CREATED: def({
    label: 'L-PROP',
    color: C.lilProp,
    filterKey: 'LIL_PROPOSAL_CREATED',
    icon: '📜',
    describe: (d, ctx) => describeProposalCreated(d, ctx, 'Lil '),
    expand: 'markdown',
  }),
  LIL_TRANSFER: def({
    label: 'L-XFER',
    color: C.lilXfer,
    filterKey: 'LIL_TRANSFER',
    icon: '↔️',
    describe: (d, ctx) =>
      `${nounList(d, 'Lil Noun')} transferred ${ctx.addr(d.from)} → ${ctx.addr(d.to)}`,
  }),

  // ── NounV2 ──────────────────────────────────────────────────────────────
  V2_BID: def({
    label: 'V2-BID',
    color: C.v2,
    filterKey: 'V2_BID',
    icon: '💰',
    describe: (d, ctx) =>
      `${ctx.addr(d.bidder)} bid ${ethFromWei(d.value)} on V2 Noun ${str(d.nounId, '?')}${bool(d.extended) ? ' · extended auction' : ''}`,
    link: nounLink('/v2/noun'),
  }),
  V2_SETTLED: def({
    label: 'V2-SETTLED',
    color: C.v2Dark,
    filterKey: 'V2_SETTLED',
    icon: '🔥',
    describe: (d, ctx) => describeSettled(d, ctx, 'V2 '),
    variant: settledVariant,
    link: nounLink('/v2/noun'),
  }),
  V2_AUCTION: def({
    label: 'V2-AUCTION',
    color: C.v2Soft,
    filterKey: 'V2_AUCTION',
    icon: '🔔',
    describe: (d, ctx) => {
      const curator =
        isAddress(d.curator) && !isZeroAddr(d.curator)
          ? ` · curated by ${ctx.addr(d.curator)}`
          : '';
      return `V2 Noun ${str(d.nounId, '?')} auction started${curator}`;
    },
    link: nounLink('/v2/noun'),
  }),
  V2_PROP: def({
    label: 'V2-PROP',
    color: C.v2Prop,
    filterKey: 'V2_PROP',
    icon: '📜',
    describe: (d, ctx) => describeProposalCreated(d, ctx, 'V2 '),
    link: propLink('/v2/vote'),
    expand: 'markdown',
  }),
  V2_PROP_QUEUED: def({
    label: 'V2-QUEUED',
    color: C.v2Soft,
    filterKey: 'V2_PROP_QUEUED',
    icon: '⏳',
    describe: d => {
      const eta = relative(d.executionETA ?? d.eta);
      return `${propRef(d, 'V2 ')} queued for execution${eta ? ` · executes ${eta}` : ''}${propTitle(d)}`;
    },
    link: propLink('/v2/vote'),
  }),
  V2_PROP_EXECUTED: def({
    label: 'V2-EXECUTED',
    color: C.v2,
    filterKey: 'V2_PROP_EXECUTED',
    icon: '✅',
    describe: d => `${propRef(d, 'V2 ')} executed onchain${propTitle(d)}`,
    link: propLink('/v2/vote'),
  }),
  V2_PROP_CANCELED: def({
    label: 'V2-CANCELLED',
    color: C.v2Dark,
    filterKey: 'V2_PROP_CANCELED',
    icon: '🚫',
    describe: d => `${propRef(d, 'V2 ')} cancelled${propTitle(d)}`,
    link: propLink('/v2/vote'),
  }),
  V2_VOTE: def({
    label: 'V2-VOTE',
    color: C.v2Vote,
    filterKey: 'V2_VOTE',
    icon: '🗳',
    describe: (d, ctx) => describeVote(d, ctx, 'V2 Prop'),
    link: propLink('/v2/vote'),
    expand: 'reason',
  }),
  V2_SALE: def({
    label: 'V2-SALE',
    color: C.v2Sale,
    filterKey: 'V2_SALE',
    icon: '🏷',
    describe: (d, ctx) => describeSale(d, ctx, 'V2 '),
    link: d => (arr(d.nounIds).length > 0 ? nounLink('/v2/noun')(d) : null),
  }),
};

/** Fallback for event types the registry doesn't know yet. */
const UNKNOWN_DEF = (type: string): EventDef => ({
  label: type.replace(/_/g, '-').slice(0, 14),
  color: '#666',
  filterKey: type,
  describe: d => {
    try {
      return JSON.stringify(d).slice(0, 100);
    } catch {
      return type;
    }
  },
});

export interface ResolvedEventDef extends EventDef {
  /** Raw event type from the API. */
  type: string;
  /** `data-event-type` value — the raw type, or a variant key (BURNED, TREASURY…). */
  variantKey: string;
  /** False when the type is not in the registry. */
  known: boolean;
}

/** Registry lookup with data-dependent label/colour overrides applied. */
export function getEventDef(type: string, data: EventData = {}): ResolvedEventDef {
  const base = EVENT_REGISTRY[type];
  if (base === undefined) return { ...UNKNOWN_DEF(type), type, variantKey: type, known: false };
  let override: ReturnType<NonNullable<EventDef['variant']>> = null;
  try {
    override = base.variant?.(data) ?? null;
  } catch {
    override = null;
  }
  const { key, ...rest } = override ?? {};
  return { ...base, ...rest, type, variantKey: key ?? type, known: true };
}

/** Build the describe context from the feed's lookups. */
export function makeDescribeCtx(
  ensLookup?: EnsLookup,
  candidateTitleLookup?: CandidateTitleLookup,
): DescribeCtx {
  return {
    addr: a => {
      const s = str(a);
      if (!s) return '???';
      const name = ensLookup?.(s);
      return name || shortAddr(s);
    },
    candTitle: id => {
      const s = str(id);
      if (!s) return 'candidate';
      return candidateTitleLookup?.(s) || prettifyCandidateId(s);
    },
  };
}

/** Description text for a row; never throws. */
export function describeEvent(
  type: string,
  data: EventData,
  ensLookup?: EnsLookup,
  candidateTitleLookup?: CandidateTitleLookup,
): ReactNode {
  const def = getEventDef(type, data);
  try {
    return def.describe(data ?? {}, makeDescribeCtx(ensLookup, candidateTitleLookup));
  } catch {
    return UNKNOWN_DEF(type).describe(data ?? {}, makeDescribeCtx());
  }
}

/** Internal route for the `view` link; never throws. */
export function getEventLink(type: string, data: EventData): string | null {
  try {
    return getEventDef(type, data).link?.(data ?? {}) ?? null;
  } catch {
    return null;
  }
}

/** Long-form payload for the expanded block, per the def's `expand` mode. */
export function getExpandableText(type: string, data: EventData): string | null {
  const def = getEventDef(type, data);
  if (def.expand === undefined) return null;
  if (def.expand === 'markdown') {
    const desc = data.description;
    return typeof desc === 'string' && desc.trim().length > 0 ? desc : null;
  }
  for (const c of [data.reason, data.comment, data.updateMessage]) {
    if (typeof c === 'string' && c.trim().length > 0) return c;
  }
  return null;
}

// ─── Addresses ─────────────────────────────────────────────────────────────

/** Keys whose values (string or string[]) are addresses worth ENS-resolving. */
const ADDRESS_KEYS = new Set([
  'bidder',
  'voter',
  'proposer',
  'winner',
  'owner',
  'signer',
  'recipient',
  'delegator',
  'fromDelegate',
  'toDelegate',
  'from',
  'to',
  'settler',
  'curator',
  'replyTo',
  'forkTreasury',
  'sender',
  'creator',
]);

/** Array keys that are never addresses (or not worth resolving — signers are only counted). */
const SKIP_ARRAY_KEYS = new Set(['signers', 'nounIds', 'proposalIds', 'tokenIds']);

/** Config params whose old/new values are addresses. */
const CONFIG_ADDRESS_HINT =
  /vetoer|admin|escrow|deployer|treasury|timelock|descriptor|seeder|minter|rewards/i;

/** Extract every ENS-resolvable address from an event payload. */
export function extractAddresses(data: EventData | null | undefined): string[] {
  if (!data || typeof data !== 'object') return [];
  const out = new Set<string>();
  for (const [key, val] of Object.entries(data)) {
    if (ADDRESS_KEYS.has(key)) {
      if (isAddress(val)) out.add(val);
      else if (Array.isArray(val) && !SKIP_ARRAY_KEYS.has(key)) {
        for (const v of val) if (isAddress(v)) out.add(v);
      }
      continue;
    }
    if ((key === 'oldValue' || key === 'newValue') && isAddress(val)) {
      if (CONFIG_ADDRESS_HINT.test(str(data.param))) out.add(val);
    }
  }
  return Array.from(out).filter(a => a.toLowerCase() !== ZERO_ADDR);
}

// ─── Filter tabs ───────────────────────────────────────────────────────────

/**
 * Filter tabs across the top of the terminal feed. `key` is the CSV `type=`
 * param sent to `/api/activity`. `color` anchors the disco-mode gradient ink
 * on each label (null for ALL → CSS paints a rainbow).
 */
export const FILTER_TABS: { key: string; label: string; color: string | null }[] = [
  { key: '', label: 'ALL', color: null },
  {
    key: 'AUCTION_CREATED,AUCTION_SETTLED,NOUNDER_NOUN,AUCTION_CONFIG_CHANGED',
    label: 'AUCTIONS',
    color: C.auction,
  },
  { key: 'BID', label: 'BIDS', color: C.bid },
  {
    key: 'PROPOSAL_CREATED,PROPOSAL_UPDATED,PROPOSAL_VOTING_STARTED,PROPOSAL_OBJECTION_PERIOD,PROPOSAL_ENDED,PROPOSAL_QUEUED,PROPOSAL_EXECUTED,PROPOSAL_CANCELLED,PROPOSAL_VETOED',
    label: 'PROPS',
    color: C.prop,
  },
  { key: 'VOTE,PROPOSAL_FEEDBACK', label: 'VOTES', color: C.vote },
  {
    key: 'CANDIDATE_CREATED,CANDIDATE_UPDATED,CANDIDATE_CANCELED,CANDIDATE_PROMOTED,CANDIDATE_FEEDBACK,CANDIDATE_SPONSORED',
    label: 'CAND',
    color: C.cand,
  },
  { key: 'CANDIDATE_SPONSORED', label: 'SPONSORS', color: C.sponsor },
  { key: 'DELEGATION', label: 'DELEG', color: C.deleg },
  { key: 'TRANSFER,SALE', label: 'XFERS', color: C.xfer },
  { key: 'SALE,V2_SALE', label: 'SALES', color: C.sale },
  { key: 'FORK_ESCROW,FORK_JOIN,FORK_WITHDRAW,FORK_EXECUTED', label: 'FORKS', color: C.fork },
  { key: 'STREAM_CREATED,STREAM_CANCELLED,STREAM_WITHDRAWN', label: 'STREAMS', color: C.stream },
  {
    key: 'GRANT_CREATED,GRANT_VOTE,GRANT_QUEUED,GRANT_EXECUTED,GRANT_CANCELED',
    label: 'GRANTS',
    color: C.grant,
  },
  { key: 'DAO_CONFIG_CHANGED,AUCTION_CONFIG_CHANGED', label: 'DAO', color: C.config },
  {
    key: 'LIL_BID,LIL_AUCTION_SETTLED,LIL_NOUN_CREATED,LIL_VOTE,LIL_PROPOSAL_CREATED,LIL_TRANSFER',
    label: 'LIL',
    color: C.lilBid,
  },
  { key: '_V2', label: 'V2', color: C.v2 },
  { key: '_CHAT', label: 'CHAT', color: '#a5f3fc' },
];

// ─── Time Ago ──────────────────────────────────────────────────────────────

export function timeAgo(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  if (!Number.isFinite(then)) return '?';
  const diff = Math.max(0, now - then);

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;

  const months = Math.floor(days / 30);
  return `${months}mo`;
}
