// ─── Event Type Configuration ──────────────────────────────────────────────

export interface EventTypeConfig {
  label: string;
  color: string;
  filterKey: string;
}

export const EVENT_TYPES: Record<string, EventTypeConfig> = {
  BID: { label: 'BID', color: '#60a5fa', filterKey: 'BID' },
  VOTE: { label: 'VOTE', color: '#c084fc', filterKey: 'VOTE' },
  PROPOSAL_CREATED: { label: 'PROP', color: '#facc15', filterKey: 'PROPOSAL_CREATED' },
  AUCTION_SETTLED: { label: 'SETTLED', color: '#4ade80', filterKey: 'AUCTION_SETTLED' },
  NOUN_CREATED: { label: 'NOUN', color: '#4ade80', filterKey: 'NOUN_CREATED' },
  CANDIDATE_CREATED: { label: 'CAND', color: '#fb923c', filterKey: 'CANDIDATE_CREATED' },
  CANDIDATE_SPONSORED: { label: 'SPONSOR', color: '#f472b6', filterKey: 'CANDIDATE_SPONSORED' },
  CANDIDATE_UPDATED: { label: 'CAND-UPD', color: '#fdba74', filterKey: 'CANDIDATE_UPDATED' },
  CANDIDATE_CANCELED: { label: 'CAND-CXL', color: '#f87171', filterKey: 'CANDIDATE_CANCELED' },
  CANDIDATE_PROMOTED: { label: 'PROMOTED', color: '#fde047', filterKey: 'CANDIDATE_PROMOTED' },
  PROPOSAL_FEEDBACK: { label: 'FEEDBACK', color: '#94a3b8', filterKey: 'PROPOSAL_FEEDBACK' },
  CANDIDATE_FEEDBACK: { label: 'FEEDBACK', color: '#94a3b8', filterKey: 'CANDIDATE_FEEDBACK' },
  STREAM_CREATED: { label: 'STREAM', color: '#2dd4bf', filterKey: 'STREAM_CREATED' },
  DELEGATION: { label: 'DELEG', color: '#e879f9', filterKey: 'DELEGATION' },
  TRANSFER: { label: 'XFER', color: '#f9a8d4', filterKey: 'TRANSFER' },
  PROPOSAL_QUEUED: { label: 'QUEUED', color: '#fbbf24', filterKey: 'PROPOSAL_QUEUED' },
  PROPOSAL_EXECUTED: { label: 'EXEC', color: '#34d399', filterKey: 'PROPOSAL_EXECUTED' },
  PROPOSAL_CANCELLED: { label: 'CANCEL', color: '#f87171', filterKey: 'PROPOSAL_CANCELLED' },
  PROPOSAL_VETOED: { label: 'VETOED', color: '#fb923c', filterKey: 'PROPOSAL_VETOED' },
  GRANT_CREATED: { label: 'GRANT', color: '#22d3ee', filterKey: 'GRANT_CREATED' },
  GRANT_VOTE: { label: 'GVOTE', color: '#67e8f9', filterKey: 'GRANT_VOTE' },
  GRANT_QUEUED: { label: 'GQUEUE', color: '#a5f3fc', filterKey: 'GRANT_QUEUED' },
  GRANT_EXECUTED: { label: 'GEXEC', color: '#06b6d4', filterKey: 'GRANT_EXECUTED' },
  GRANT_CANCELED: { label: 'GCANCEL', color: '#f87171', filterKey: 'GRANT_CANCELED' },
  LIL_BID: { label: 'L-BID', color: '#93c5fd', filterKey: 'LIL_BID' },
  LIL_AUCTION_SETTLED: { label: 'L-SETTLED', color: '#86efac', filterKey: 'LIL_AUCTION_SETTLED' },
  LIL_NOUN_CREATED: { label: 'L-NOUN', color: '#86efac', filterKey: 'LIL_NOUN_CREATED' },
  LIL_VOTE: { label: 'L-VOTE', color: '#d8b4fe', filterKey: 'LIL_VOTE' },
  LIL_PROPOSAL_CREATED: { label: 'L-PROP', color: '#fde047', filterKey: 'LIL_PROPOSAL_CREATED' },
  LIL_TRANSFER: { label: 'L-XFER', color: '#fbcfe8', filterKey: 'LIL_TRANSFER' },
  SALE: { label: 'SALE', color: '#f97316', filterKey: 'SALE' },
};

// Filter tabs shown in the UI
export const FILTER_TABS = [
  { key: '', label: 'ALL' },
  { key: 'BID', label: 'BIDS' },
  { key: 'VOTE', label: 'VOTES' },
  { key: 'PROPOSAL_CREATED', label: 'PROPS' },
  { key: 'AUCTION_SETTLED', label: 'AUCTIONS' },
  { key: 'DELEGATION', label: 'DELEGATIONS' },
  { key: 'TRANSFER', label: 'TRANSFERS' },
  { key: 'CANDIDATE_SPONSORED', label: 'SPONSORS' },
  { key: 'STREAM_CREATED', label: 'STREAMS' },
  { key: 'GRANT_CREATED', label: 'GRANTS' },
  {
    key: 'LIL_BID,LIL_AUCTION_SETTLED,LIL_NOUN_CREATED,LIL_VOTE,LIL_PROPOSAL_CREATED,LIL_TRANSFER',
    label: 'LIL',
  },
  { key: 'SALE', label: 'SALES' },
  { key: '_CHAT', label: 'CHAT' },
];

// ─── Address Formatting ────────────────────────────────────────────────────

export type EnsLookup = (addr: string) => string | null;

/** Look up a candidate's title by its candidateId (`${proposer}-${slug}`). */
export type CandidateTitleLookup = (candidateId: string) => string | null;

/** Pretty-print a candidate id / slug when no title is known. */
export function prettifyCandidateId(candidateId: string): string {
  // candidateId = `${proposer}-${slug}` where proposer is a 42-char 0x address.
  const slug =
    candidateId.startsWith('0x') && candidateId.length > 43 ? candidateId.slice(43) : candidateId;
  // Slug is kebab-case, sometimes truncated. Humanize it.
  return slug.replace(/-/g, ' ').slice(0, 60);
}

function resolveCandidateTitle(
  candidateId: string | undefined,
  lookup?: CandidateTitleLookup,
): string {
  if (!candidateId) return 'candidate';
  const title = lookup?.(candidateId);
  if (title) return title;
  return prettifyCandidateId(candidateId);
}

function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr || '???';
  return `${addr.slice(0, 6)}..${addr.slice(-4)}`;
}

function resolveAddr(addr: string, ensLookup?: EnsLookup): string {
  if (ensLookup) {
    const name = ensLookup(addr);
    if (name) return name;
  }
  return shortAddr(addr);
}

function ethFromWei(wei: string): string {
  try {
    const eth = Number(wei) / 1e18;
    if (eth === 0) return '0';
    if (eth < 0.001) return '<0.001';
    return eth.toFixed(eth < 1 ? 4 : 2);
  } catch {
    return '?';
  }
}

// USDC/stablecoins use 6 decimals, not 18
function usdcFromWei(wei: string): string {
  try {
    const amount = Number(wei) / 1e6;
    if (amount === 0) return '0';
    if (amount < 0.01) return '<0.01';
    return amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  } catch {
    return '?';
  }
}

// Known token addresses (lowercase)
const USDC_ADDRESS = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const STETH_ADDRESS = '0xae7ab96520de3a18e5e111b5eaab095312d7fe84';

function formatStreamAmount(
  tokenAmount: string,
  tokenAddress?: string,
): { amount: string; symbol: string } {
  const addr = (tokenAddress || '').toLowerCase();
  if (addr === USDC_ADDRESS) {
    return { amount: usdcFromWei(tokenAmount), symbol: 'USDC' };
  }
  if (addr === STETH_ADDRESS) {
    return { amount: ethFromWei(tokenAmount), symbol: 'stETH' };
  }
  // Default: WETH or unknown → show as ETH
  return { amount: ethFromWei(tokenAmount), symbol: 'ETH' };
}

function supportLabel(support: number): string {
  if (support === 0) return 'AGAINST';
  if (support === 1) return 'FOR';
  if (support === 2) return 'ABSTAIN';
  return '?';
}

// ─── Event Description Formatter ───────────────────────────────────────────

export function formatEventDescription(
  type: string,
  data: Record<string, unknown>,
  ensLookup?: EnsLookup,
  candidateTitleLookup?: CandidateTitleLookup,
): string {
  const addr = (a: string) => resolveAddr(a, ensLookup);
  const candTitle = (id?: string) => resolveCandidateTitle(id, candidateTitleLookup);

  switch (type) {
    case 'BID':
      return `${addr(data.bidder as string)} bid ${ethFromWei(data.value as string)} ETH on Noun ${data.nounId}`;

    case 'VOTE': {
      const reason = data.reason as string;
      const base = `${addr(data.voter as string)} voted ${supportLabel(data.support as number)} on Prop ${data.proposalId}`;
      return reason ? `${base} — "${reason.slice(0, 80)}${reason.length > 80 ? '...' : ''}"` : base;
    }

    case 'PROPOSAL_CREATED': {
      const propTitle = (data.title as string) || 'untitled';
      return `New proposal #${data.proposalId} by ${addr(data.proposer as string)}: ${propTitle}`;
    }

    case 'AUCTION_SETTLED':
      return `Noun ${data.nounId} won by ${addr(data.winner as string)} for ${ethFromWei(data.amount as string)} ETH`;

    case 'NOUN_CREATED':
      return `Noun ${data.nounId} minted to ${addr(data.owner as string)}`;

    case 'CANDIDATE_CREATED': {
      const title = (data.title as string) || (data.slug as string) || 'untitled';
      return `New candidate by ${addr(data.proposer as string)}: ${title}`;
    }

    case 'CANDIDATE_SPONSORED': {
      const reason = (data.reason as string) || '';
      const title = candTitle(data.candidateId as string | undefined);
      const base = `${addr(data.signer as string)} sponsored "${title}"`;
      return reason.length > 0
        ? `${base} — "${reason.slice(0, 60)}${reason.length > 60 ? '...' : ''}"`
        : base;
    }

    case 'CANDIDATE_UPDATED': {
      const reason = (data.reason as string) || '';
      const title = (data.title as string) || candTitle(data.candidateId as string | undefined);
      const base = `${addr(data.proposer as string)} updated candidate "${title}"`;
      return reason.length > 0
        ? `${base} — "${reason.slice(0, 60)}${reason.length > 60 ? '...' : ''}"`
        : base;
    }

    case 'CANDIDATE_CANCELED': {
      const title = (data.title as string) || candTitle(data.candidateId as string | undefined);
      return `${addr(data.proposer as string)} canceled candidate "${title}"`;
    }

    case 'CANDIDATE_PROMOTED': {
      const title = (data.title as string) || candTitle(data.candidateId as string | undefined);
      const proposalId = data.proposalId;
      const suffix = proposalId != null ? ` to Prop #${proposalId}` : '';
      return `${addr(data.proposer as string)} promoted candidate "${title}"${suffix}`;
    }

    case 'PROPOSAL_FEEDBACK': {
      const reason = (data.reason as string) || '';
      const base = `${addr(data.voter as string)} gave ${supportLabel(data.support as number)} feedback on Prop ${data.proposalId}`;
      return reason.length > 0
        ? `${base} — "${reason.slice(0, 60)}${reason.length > 60 ? '...' : ''}"`
        : base;
    }

    case 'CANDIDATE_FEEDBACK': {
      const reason = (data.reason as string) || '';
      const title = candTitle(data.candidateId as string | undefined);
      const base = `${addr(data.voter as string)} gave ${supportLabel(data.support as number)} feedback on "${title}"`;
      return reason.length > 0
        ? `${base} — "${reason.slice(0, 60)}${reason.length > 60 ? '...' : ''}"`
        : base;
    }

    case 'STREAM_CREATED': {
      const stream = formatStreamAmount(
        data.tokenAmount as string,
        data.tokenAddress as string | undefined,
      );
      const propSuffix = data.proposalId != null ? ` (Prop ${data.proposalId})` : '';
      return `Stream to ${addr(data.recipient as string)} for ${stream.amount} ${stream.symbol}${propSuffix}`;
    }

    case 'DELEGATION':
      return `${addr(data.delegator as string)} delegated votes from ${addr(data.fromDelegate as string)} → ${addr(data.toDelegate as string)}`;

    case 'TRANSFER':
      return `Noun ${data.nounId} transferred ${addr(data.from as string)} → ${addr(data.to as string)}`;

    case 'PROPOSAL_QUEUED':
      return `Prop ${data.proposalId} queued for execution`;

    case 'PROPOSAL_EXECUTED':
      return `Prop ${data.proposalId} executed onchain`;

    case 'PROPOSAL_CANCELLED':
      return `Prop ${data.proposalId} cancelled`;

    case 'PROPOSAL_VETOED':
      return `Prop ${data.proposalId} vetoed`;

    case 'GRANT_CREATED': {
      const title =
        ((data.description as string) || '').split('\n')[0]?.replace(/^#\s*/, '').slice(0, 80) ||
        'untitled';
      return `${addr(data.proposer as string)} created grant #${data.grantId}: ${title}`;
    }

    case 'GRANT_VOTE': {
      const reason = data.reason as string;
      const base = `${addr(data.voter as string)} voted ${supportLabel(data.support as number)} on grant #${data.grantId} (${data.votes} votes)`;
      return reason ? `${base} — "${reason.slice(0, 60)}${reason.length > 60 ? '...' : ''}"` : base;
    }

    case 'GRANT_QUEUED':
      return `Grant #${data.grantId} queued for execution`;

    case 'GRANT_EXECUTED':
      return `Grant #${data.grantId} executed`;

    case 'GRANT_CANCELED':
      return `Grant #${data.grantId} canceled`;

    case 'LIL_BID': {
      const comment = ((data.comment as string) || (data.reason as string) || '').trim();
      const base = `${addr(data.bidder as string)} bid ${ethFromWei(data.value as string)} ETH on Lil Noun ${data.nounId}`;
      return comment.length > 0
        ? `${base} — "${comment.slice(0, 80)}${comment.length > 80 ? '...' : ''}"`
        : base;
    }

    case 'LIL_AUCTION_SETTLED':
      return `Lil Noun ${data.nounId} won by ${addr(data.winner as string)} for ${ethFromWei(data.amount as string)} ETH`;

    case 'LIL_NOUN_CREATED':
      return `Lil Noun ${data.nounId} minted to ${addr(data.owner as string)}`;

    case 'LIL_VOTE': {
      const reason = (data.reason as string) || '';
      const base = `${addr(data.voter as string)} voted ${supportLabel(data.support as number)} on Lil Prop ${data.proposalId}`;
      return reason.length > 0
        ? `${base} — "${reason.slice(0, 80)}${reason.length > 80 ? '...' : ''}"`
        : base;
    }

    case 'LIL_PROPOSAL_CREATED': {
      const propTitle = (data.title as string) || 'untitled';
      return `New Lil proposal #${data.proposalId} by ${addr(data.proposer as string)}: ${propTitle}`;
    }

    case 'LIL_TRANSFER':
      return `Lil Noun ${data.nounId} transferred ${addr(data.from as string)} → ${addr(data.to as string)}`;

    case 'SALE': {
      const name = (data.collectionName as string) || (data.collection as string) || 'Item';
      const tokenId = data.tokenId != null && data.tokenId !== '' ? ` ${data.tokenId}` : '';
      const priceEth =
        typeof data.priceEth === 'number' ? data.priceEth : Number(data.priceEth ?? 0);
      const priceStr =
        priceEth === 0 ? '0' : priceEth < 0.001 ? '<0.001' : priceEth.toFixed(priceEth < 1 ? 4 : 2);
      const currency = (data.currency as string) || 'ETH';
      const market = (data.marketplace as string) || '';
      const marketSuffix = market ? ` on ${market}` : '';
      return `${name}${tokenId} sold for ${priceStr} ${currency} — ${addr(data.from as string)} → ${addr(data.to as string)}${marketSuffix}`;
    }

    default:
      return JSON.stringify(data).slice(0, 100);
  }
}

/** Extract all address fields from event data */
export function extractAddresses(data: Record<string, unknown>): string[] {
  const addrs: string[] = [];
  for (const key of [
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
  ]) {
    const val = data[key] as string | undefined;
    if (val && val.startsWith('0x') && val.length === 42) {
      addrs.push(val);
    }
  }
  return addrs;
}

// ─── Time Ago ──────────────────────────────────────────────────────────────

export function timeAgo(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
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
