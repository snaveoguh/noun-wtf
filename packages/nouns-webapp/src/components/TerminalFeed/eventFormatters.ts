// ─── Event Type Configuration ──────────────────────────────────────────────

export interface EventTypeConfig {
  label: string;
  color: string;
  filterKey: string;
}

export const EVENT_TYPES: Record<string, EventTypeConfig> = {
  BID:                  { label: 'BID',      color: '#60a5fa', filterKey: 'BID' },
  VOTE:                 { label: 'VOTE',     color: '#c084fc', filterKey: 'VOTE' },
  PROPOSAL_CREATED:     { label: 'PROP',     color: '#facc15', filterKey: 'PROPOSAL_CREATED' },
  AUCTION_SETTLED:      { label: 'SETTLED',  color: '#4ade80', filterKey: 'AUCTION_SETTLED' },
  NOUN_CREATED:         { label: 'NOUN',     color: '#4ade80', filterKey: 'NOUN_CREATED' },
  CANDIDATE_CREATED:    { label: 'CAND',     color: '#fb923c', filterKey: 'CANDIDATE_CREATED' },
  CANDIDATE_SPONSORED:  { label: 'SPONSOR',  color: '#f472b6', filterKey: 'CANDIDATE_SPONSORED' },
  PROPOSAL_FEEDBACK:    { label: 'FEEDBACK', color: '#94a3b8', filterKey: 'PROPOSAL_FEEDBACK' },
  CANDIDATE_FEEDBACK:   { label: 'FEEDBACK', color: '#94a3b8', filterKey: 'CANDIDATE_FEEDBACK' },
  STREAM_CREATED:       { label: 'STREAM',   color: '#2dd4bf', filterKey: 'STREAM_CREATED' },
  DELEGATION:           { label: 'DELEG',    color: '#e879f9', filterKey: 'DELEGATION' },
  TRANSFER:             { label: 'XFER',     color: '#f9a8d4', filterKey: 'TRANSFER' },
  PROPOSAL_QUEUED:      { label: 'QUEUED',   color: '#fbbf24', filterKey: 'PROPOSAL_QUEUED' },
  PROPOSAL_EXECUTED:    { label: 'EXEC',     color: '#34d399', filterKey: 'PROPOSAL_EXECUTED' },
  PROPOSAL_CANCELLED:   { label: 'CANCEL',   color: '#f87171', filterKey: 'PROPOSAL_CANCELLED' },
  PROPOSAL_VETOED:      { label: 'VETOED',   color: '#fb923c', filterKey: 'PROPOSAL_VETOED' },
  GRANT_CREATED:        { label: 'GRANT',    color: '#22d3ee', filterKey: 'GRANT_CREATED' },
  GRANT_VOTE:           { label: 'GVOTE',    color: '#67e8f9', filterKey: 'GRANT_VOTE' },
  GRANT_QUEUED:         { label: 'GQUEUE',   color: '#a5f3fc', filterKey: 'GRANT_QUEUED' },
  GRANT_EXECUTED:       { label: 'GEXEC',    color: '#06b6d4', filterKey: 'GRANT_EXECUTED' },
  GRANT_CANCELED:       { label: 'GCANCEL',  color: '#f87171', filterKey: 'GRANT_CANCELED' },
};

// Filter tabs shown in the UI
export const FILTER_TABS = [
  { key: '',                     label: 'ALL' },
  { key: 'BID',                  label: 'BIDS' },
  { key: 'VOTE',                 label: 'VOTES' },
  { key: 'PROPOSAL_CREATED',     label: 'PROPS' },
  { key: 'AUCTION_SETTLED',      label: 'AUCTIONS' },
  { key: 'DELEGATION',           label: 'DELEGATIONS' },
  { key: 'TRANSFER',             label: 'TRANSFERS' },
  { key: 'CANDIDATE_SPONSORED',  label: 'SPONSORS' },
  { key: 'STREAM_CREATED',       label: 'STREAMS' },
  { key: 'GRANT_CREATED',        label: 'GRANTS' },
  { key: '_CHAT',                label: 'CHAT' },
];

// ─── Address Formatting ────────────────────────────────────────────────────

export type EnsLookup = (addr: string) => string | null;

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

function supportLabel(support: number): string {
  if (support === 0) return 'AGAINST';
  if (support === 1) return 'FOR';
  if (support === 2) return 'ABSTAIN';
  return '?';
}

// ─── Event Description Formatter ───────────────────────────────────────────

export function formatEventDescription(type: string, data: Record<string, unknown>, ensLookup?: EnsLookup): string {
  const addr = (a: string) => resolveAddr(a, ensLookup);

  switch (type) {
    case 'BID':
      return `${addr(data.bidder as string)} bid ${ethFromWei(data.value as string)} ETH on Noun ${data.nounId}`;

    case 'VOTE': {
      const reason = data.reason as string;
      const base = `${addr(data.voter as string)} voted ${supportLabel(data.support as number)} on Prop ${data.proposalId}`;
      return reason ? `${base} — "${reason.slice(0, 80)}${reason.length > 80 ? '...' : ''}"` : base;
    }

    case 'PROPOSAL_CREATED':
      return `New proposal #${data.proposalId} by ${addr(data.proposer as string)}: ${data.title || 'untitled'}`;

    case 'AUCTION_SETTLED':
      return `Noun ${data.nounId} won by ${addr(data.winner as string)} for ${ethFromWei(data.amount as string)} ETH`;

    case 'NOUN_CREATED':
      return `Noun ${data.nounId} minted to ${addr(data.owner as string)}`;

    case 'CANDIDATE_CREATED':
      return `New candidate by ${addr(data.proposer as string)}: ${data.title || data.slug || 'untitled'}`;

    case 'CANDIDATE_SPONSORED': {
      const reason = data.reason as string;
      const base = `${addr(data.signer as string)} sponsored candidate`;
      return reason ? `${base} — "${reason.slice(0, 60)}${reason.length > 60 ? '...' : ''}"` : base;
    }

    case 'PROPOSAL_FEEDBACK': {
      const reason = data.reason as string;
      const base = `${addr(data.voter as string)} gave ${supportLabel(data.support as number)} feedback on Prop ${data.proposalId}`;
      return reason ? `${base} — "${reason.slice(0, 60)}${reason.length > 60 ? '...' : ''}"` : base;
    }

    case 'CANDIDATE_FEEDBACK': {
      const reason = data.reason as string;
      const base = `${addr(data.voter as string)} gave ${supportLabel(data.support as number)} feedback on candidate`;
      return reason ? `${base} — "${reason.slice(0, 60)}${reason.length > 60 ? '...' : ''}"` : base;
    }

    case 'STREAM_CREATED':
      return `Stream to ${addr(data.recipient as string)} for ${ethFromWei(data.tokenAmount as string)} ETH${data.proposalId ? ` (Prop ${data.proposalId})` : ''}`;

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
      const title = ((data.description as string) || '').split('\n')[0]?.replace(/^#\s*/, '').slice(0, 80) || 'untitled';
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

    default:
      return JSON.stringify(data).slice(0, 100);
  }
}

/** Extract all address fields from event data */
export function extractAddresses(data: Record<string, unknown>): string[] {
  const addrs: string[] = [];
  for (const key of ['bidder', 'voter', 'proposer', 'winner', 'owner', 'signer', 'recipient', 'delegator', 'fromDelegate', 'toDelegate', 'from', 'to']) {
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
