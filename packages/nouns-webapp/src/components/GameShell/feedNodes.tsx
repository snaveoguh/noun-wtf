import type { ReactNode } from 'react';

import type {
  CandidateTitleLookup,
  EnsLookup,
  ProposalTitleLookup,
} from '@/components/TerminalFeed/eventFormatters';
import { prettifyCandidateId } from '@/components/TerminalFeed/eventFormatters';
import { PropHoverCard } from '@/components/PropHoverCard';
import { VoterHoverCard } from '@/components/VoterHoverCard';
import type { Address } from '@/utils/types';

import InlineNoun from './InlineNoun';
import classes from './GameShell.module.css';

// ─── Helpers ──────────────────────────────────────────────────────────────

function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr || '???';
  return `${addr.slice(0, 6)}..${addr.slice(-4)}`;
}

function resolveAddr(addr: string, ensLookup?: EnsLookup): string {
  if (!addr) return '???';
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
  return { amount: ethFromWei(tokenAmount), symbol: 'ETH' };
}

function supportLabel(support: number): 'FOR' | 'AGAINST' | 'ABSTAIN' | '?' {
  if (support === 0) return 'AGAINST';
  if (support === 1) return 'FOR';
  if (support === 2) return 'ABSTAIN';
  return '?';
}

function VoteToken({ support }: { support: number }) {
  const label = supportLabel(support);
  if (label === '?') return <span>?</span>;
  const cls =
    label === 'FOR'
      ? `${classes.voteTag} ${classes.voteFor}`
      : label === 'AGAINST'
        ? `${classes.voteTag} ${classes.voteAgainst}`
        : `${classes.voteTag} ${classes.voteAbstain}`;
  return <span className={cls}>{label}</span>;
}

function Name({ addr, ensLookup }: { addr: string; ensLookup?: EnsLookup }) {
  // Skip wrapping when there's no usable address (zero-address burns, missing
  // data) — the hover card has nothing to look up. Otherwise reuse the
  // rendered span as the trigger via `asChild` so we don't add extra DOM.
  if (!addr || addr === '0x0000000000000000000000000000000000000000') {
    return <span className={classes.feedName}>{resolveAddr(addr, ensLookup)}</span>;
  }
  return (
    <VoterHoverCard address={addr as Address} asChild>
      <span className={classes.feedName} style={{ cursor: 'default' }}>
        {resolveAddr(addr, ensLookup)}
      </span>
    </VoterHoverCard>
  );
}

function NounRef({
  nounId,
  prefix = 'Noun',
}: {
  nounId: number | string | bigint;
  prefix?: 'Noun' | 'Lil Noun' | 'V2 Noun';
}) {
  return (
    <span className={classes.nounRef}>
      <InlineNoun nounId={nounId} size={14} title={`${prefix} ${nounId}`} />
      <span>
        {prefix} {String(nounId)}
      </span>
    </span>
  );
}

function PropRef({
  id,
  title,
  prefix = '',
}: {
  id: number | string;
  title?: string | null;
  prefix?: '' | 'Lil ' | 'V2 ';
}) {
  // Wrap the "#963" token in mono so feed rows present the proposal numbers
  // as a tabular column. The trailing title runs in body sans for legibility.
  // Lil / V2 props live on different chains/contracts than the main DAO; the
  // hover card only resolves vanilla mainnet proposals, so we skip the wrap
  // for prefixed refs and emit a plain span.
  const inner = (
    <span className={classes.propRef} style={prefix === '' ? { cursor: 'default' } : undefined}>
      <span className={classes.propIdToken}>
        #{prefix}
        {String(id)}
      </span>
      {title ? <span className={classes.propTitle}>{title}</span> : null}
    </span>
  );
  if (prefix !== '' || id === '' || id == null) return inner;
  return (
    <PropHoverCard type="proposal" proposalId={String(id)} asChild>
      {inner}
    </PropHoverCard>
  );
}

// Color-coded amount+symbol pill. `data-token` drives the color via the
// `.tokenChip[data-token=…]` rules in GameShell.module.css. Falls back to a
// muted neutral for any symbol the palette doesn't recognise. Replaces the
// older monochrome `MarkRef` wrapper for amount+token pairs in feed rows.
const KNOWN_TOKENS = new Set(['ETH', 'WETH', 'stETH', 'wstETH', 'rETH', 'USDC']);
function TokenAmount({ amount, symbol }: { amount: string; symbol: string }) {
  const token = KNOWN_TOKENS.has(symbol) ? symbol : 'OTHER';
  return (
    <span className={classes.tokenChip} data-token={token}>
      {amount} {symbol}
    </span>
  );
}

function CandidateRef({ slug, title }: { slug?: string; title: string }) {
  // Candidate ids in the feed are slugs (e.g. "0xabc-some-slug-2026"). When
  // we have one, wrap the title in a PropHoverCard so the tooltip renders;
  // otherwise emit the bare title span (e.g. proposed-from-text fallbacks).
  const inner = (
    <span className={classes.propTitle} style={slug ? { cursor: 'default' } : undefined}>
      {title}
    </span>
  );
  if (!slug) return inner;
  return (
    <PropHoverCard type="candidate" candidateSlug={slug} asChild>
      {inner}
    </PropHoverCard>
  );
}

const MARKETPLACE_DISPLAY: Record<string, string> = {
  'opensea.io': 'OpenSea',
  'blur.io': 'Blur',
  'looksrare.org': 'LooksRare',
  'x2y2.io': 'X2Y2',
  'sudoswap.xyz': 'Sudoswap',
  'reservoir.tools': 'Reservoir',
  'rarible.com': 'Rarible',
  'magiceden.io': 'Magic Eden',
};

function formatMarketplace(raw: string): string {
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (MARKETPLACE_DISPLAY[lower]) return MARKETPLACE_DISPLAY[lower];
  const stripped = lower.replace(/\.(io|xyz|org|com|tools|app|wtf|dev)$/i, '');
  if (!stripped) return raw;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

// ─── Public formatter ──────────────────────────────────────────────────────

interface NodeContext {
  ensLookup?: EnsLookup;
  candidateTitleLookup?: CandidateTitleLookup;
  proposalTitleLookup?: ProposalTitleLookup;
}

/**
 * Render a single feed event as a row of inline JSX nodes — names, vote
 * tokens, inline noun thumbnails, proposal titles, etc. Mirrors the
 * `formatEventDescription` plain-text formatter in shape and field access,
 * but emits JSX so we can interleave images and styled tokens without HTML
 * stringification.
 */
export function formatEventNodes(
  type: string,
  data: Record<string, unknown>,
  ctx: NodeContext = {},
): ReactNode {
  const { ensLookup, candidateTitleLookup, proposalTitleLookup } = ctx;
  const candTitle = (id?: string): string =>
    (id && candidateTitleLookup?.(id)) || (id ? prettifyCandidateId(id) : 'candidate');
  const propTitle = (id?: number | string): string | null =>
    id != null ? (proposalTitleLookup?.(id) ?? null) : null;

  switch (type) {
    case 'BID':
      return (
        <>
          <Name addr={data.bidder as string} ensLookup={ensLookup} /> bid{' '}
          <TokenAmount amount={ethFromWei(data.value as string)} symbol="ETH" /> on{' '}
          <NounRef nounId={data.nounId as number} />
        </>
      );

    case 'VOTE': {
      const votes = (data.votes as number | string | undefined) ?? null;
      const propId = data.proposalId as number;
      const title = propTitle(propId);
      return (
        <>
          <Name addr={data.voter as string} ensLookup={ensLookup} /> voted{' '}
          <VoteToken support={data.support as number} />
          {votes != null && <span className={classes.voteCount}> ({votes})</span>} on{' '}
          <PropRef id={propId} title={title} />
        </>
      );
    }

    case 'PROPOSAL_FEEDBACK': {
      const propId = data.proposalId as number;
      const title = propTitle(propId);
      return (
        <>
          <Name addr={data.voter as string} ensLookup={ensLookup} /> gave feedback{' '}
          <VoteToken support={data.support as number} /> on <PropRef id={propId} title={title} />
        </>
      );
    }

    case 'CANDIDATE_FEEDBACK': {
      const slug = data.candidateId as string | undefined;
      const title = candTitle(slug);
      return (
        <>
          <Name addr={data.voter as string} ensLookup={ensLookup} /> gave feedback{' '}
          <VoteToken support={data.support as number} /> on{' '}
          <CandidateRef slug={slug} title={title} />
        </>
      );
    }

    case 'PROPOSAL_CREATED': {
      const id = data.proposalId as number;
      const title = (data.title as string) || 'untitled';
      return (
        <>
          <Name addr={data.proposer as string} ensLookup={ensLookup} /> proposed{' '}
          <PropRef id={id} title={title} />
        </>
      );
    }

    case 'PROPOSAL_QUEUED': {
      const id = data.proposalId as number;
      const title = propTitle(id);
      return (
        <>
          Queued: <PropRef id={id} title={title} />
        </>
      );
    }

    case 'PROPOSAL_EXECUTED': {
      const id = data.proposalId as number;
      const title = propTitle(id);
      return (
        <>
          Executed: <PropRef id={id} title={title} />
        </>
      );
    }

    case 'PROPOSAL_CANCELLED': {
      const id = data.proposalId as number;
      const title = propTitle(id);
      return (
        <>
          Cancelled: <PropRef id={id} title={title} />
        </>
      );
    }

    case 'PROPOSAL_VETOED': {
      const id = data.proposalId as number;
      const title = propTitle(id);
      return (
        <>
          Vetoed: <PropRef id={id} title={title} />
        </>
      );
    }

    case 'AUCTION_SETTLED': {
      const winner = ((data.winner as string | undefined) || '').toLowerCase();
      const amountStr = (data.amount as string | undefined) || '0';
      const isBurned =
        winner === '0x0000000000000000000000000000000000000000' &&
        (amountStr === '0' || amountStr === '');
      const id = data.nounId as number;
      if (isBurned) {
        return (
          <>
            Auction for <NounRef nounId={id} /> ended without a winner
          </>
        );
      }
      return (
        <>
          <NounRef nounId={id} /> won by <Name addr={winner} ensLookup={ensLookup} /> for{' '}
          <TokenAmount amount={ethFromWei(amountStr)} symbol="ETH" />
        </>
      );
    }

    case 'NOUN_CREATED': {
      const id = data.nounId as number;
      return (
        <>
          Auction for <NounRef nounId={id} /> started by{' '}
          <Name addr={data.owner as string} ensLookup={ensLookup} />
        </>
      );
    }

    case 'CANDIDATE_CREATED': {
      const slug = (data.slug as string | undefined) ?? (data.candidateId as string | undefined);
      const title = (data.title as string) || (data.slug as string) || 'untitled';
      return (
        <>
          <Name addr={data.proposer as string} ensLookup={ensLookup} /> created candidate{' '}
          <CandidateRef slug={slug} title={title} />
        </>
      );
    }

    case 'CANDIDATE_SPONSORED': {
      const slug = data.candidateId as string | undefined;
      const title = candTitle(slug);
      return (
        <>
          <Name addr={data.signer as string} ensLookup={ensLookup} /> sponsored{' '}
          <CandidateRef slug={slug} title={title} />
        </>
      );
    }

    case 'CANDIDATE_UPDATED': {
      const slug = data.candidateId as string | undefined;
      const title = (data.title as string) || candTitle(slug);
      return (
        <>
          <Name addr={data.proposer as string} ensLookup={ensLookup} /> updated{' '}
          <CandidateRef slug={slug} title={title} />
        </>
      );
    }

    case 'CANDIDATE_CANCELED': {
      const slug = data.candidateId as string | undefined;
      const title = (data.title as string) || candTitle(slug);
      return (
        <>
          <Name addr={data.proposer as string} ensLookup={ensLookup} /> canceled{' '}
          <CandidateRef slug={slug} title={title} />
        </>
      );
    }

    case 'CANDIDATE_PROMOTED': {
      const slug = data.candidateId as string | undefined;
      const title = (data.title as string) || candTitle(slug);
      const proposalId = data.proposalId;
      return (
        <>
          <Name addr={data.proposer as string} ensLookup={ensLookup} /> promoted{' '}
          <CandidateRef slug={slug} title={title} />
          {proposalId != null && (
            <>
              {' '}
              → <PropRef id={proposalId as number} title={null} />
            </>
          )}
        </>
      );
    }

    case 'STREAM_CREATED': {
      const stream = formatStreamAmount(
        data.tokenAmount as string,
        data.tokenAddress as string | undefined,
      );
      return (
        <>
          Stream to <Name addr={data.recipient as string} ensLookup={ensLookup} /> for{' '}
          <TokenAmount amount={stream.amount} symbol={stream.symbol} />
          {data.proposalId != null && (
            <>
              {' '}
              (<PropRef id={data.proposalId as number} />)
            </>
          )}
        </>
      );
    }

    case 'DELEGATION':
      return (
        <>
          <Name addr={data.delegator as string} ensLookup={ensLookup} /> delegated{' '}
          <Name addr={data.fromDelegate as string} ensLookup={ensLookup} /> →{' '}
          <Name addr={data.toDelegate as string} ensLookup={ensLookup} />
        </>
      );

    case 'TRANSFER':
      return (
        <>
          <Name addr={data.from as string} ensLookup={ensLookup} /> transferred{' '}
          <NounRef nounId={data.nounId as number} /> to{' '}
          <Name addr={data.to as string} ensLookup={ensLookup} />
        </>
      );

    case 'GRANT_CREATED': {
      const title =
        ((data.description as string) || '').split('\n')[0]?.replace(/^#\s*/, '').slice(0, 80) ||
        'untitled';
      return (
        <>
          <Name addr={data.proposer as string} ensLookup={ensLookup} /> created grant{' '}
          <PropRef id={data.grantId as number} title={title} />
        </>
      );
    }

    case 'GRANT_VOTE': {
      const votes = data.votes as number | undefined;
      return (
        <>
          <Name addr={data.voter as string} ensLookup={ensLookup} /> voted{' '}
          <VoteToken support={data.support as number} />
          {votes != null && <span className={classes.voteCount}> ({votes})</span>} on grant{' '}
          <PropRef id={data.grantId as number} />
        </>
      );
    }

    case 'GRANT_QUEUED':
      return (
        <>
          Queued grant <PropRef id={data.grantId as number} />
        </>
      );

    case 'GRANT_EXECUTED':
      return (
        <>
          Executed grant <PropRef id={data.grantId as number} />
        </>
      );

    case 'GRANT_CANCELED':
      return (
        <>
          Cancelled grant <PropRef id={data.grantId as number} />
        </>
      );

    case 'LIL_BID':
      return (
        <>
          <Name addr={data.bidder as string} ensLookup={ensLookup} /> bid{' '}
          <TokenAmount amount={ethFromWei(data.value as string)} symbol="ETH" /> on{' '}
          <NounRef nounId={data.nounId as number} prefix="Lil Noun" />
        </>
      );

    case 'LIL_AUCTION_SETTLED':
      return (
        <>
          <NounRef nounId={data.nounId as number} prefix="Lil Noun" /> won by{' '}
          <Name addr={data.winner as string} ensLookup={ensLookup} /> for{' '}
          <TokenAmount amount={ethFromWei(data.amount as string)} symbol="ETH" />
        </>
      );

    case 'LIL_NOUN_CREATED':
      return (
        <>
          <NounRef nounId={data.nounId as number} prefix="Lil Noun" /> minted to{' '}
          <Name addr={data.owner as string} ensLookup={ensLookup} />
        </>
      );

    case 'LIL_VOTE': {
      const votes = data.votes as number | undefined;
      return (
        <>
          <Name addr={data.voter as string} ensLookup={ensLookup} /> voted{' '}
          <VoteToken support={data.support as number} />
          {votes != null && <span className={classes.voteCount}> ({votes})</span>} on{' '}
          <PropRef id={data.proposalId as number} prefix="Lil " />
        </>
      );
    }

    case 'LIL_PROPOSAL_CREATED': {
      const title = (data.title as string) || 'untitled';
      return (
        <>
          <Name addr={data.proposer as string} ensLookup={ensLookup} /> proposed{' '}
          <PropRef id={data.proposalId as number} title={title} prefix="Lil " />
        </>
      );
    }

    case 'LIL_TRANSFER':
      return (
        <>
          <Name addr={data.from as string} ensLookup={ensLookup} /> transferred{' '}
          <NounRef nounId={data.nounId as number} prefix="Lil Noun" /> to{' '}
          <Name addr={data.to as string} ensLookup={ensLookup} />
        </>
      );

    case 'V2_BID':
      return (
        <>
          <Name addr={data.bidder as string} ensLookup={ensLookup} /> bid{' '}
          <TokenAmount amount={ethFromWei(data.value as string)} symbol="ETH" /> on{' '}
          <NounRef nounId={data.nounId as number} prefix="V2 Noun" />
        </>
      );

    case 'V2_SETTLED': {
      const winner = ((data.winner as string | undefined) || '').toLowerCase();
      const amountStr = (data.amount as string | undefined) || '0';
      const isBurned =
        winner === '0x0000000000000000000000000000000000000000' &&
        (amountStr === '0' || amountStr === '');
      const id = data.nounId as number;
      if (isBurned) {
        return (
          <>
            Auction for <NounRef nounId={id} prefix="V2 Noun" /> ended without a winner
          </>
        );
      }
      return (
        <>
          <NounRef nounId={id} prefix="V2 Noun" /> won by{' '}
          <Name addr={winner} ensLookup={ensLookup} /> for{' '}
          <TokenAmount amount={ethFromWei(amountStr)} symbol="ETH" />
        </>
      );
    }

    case 'V2_AUCTION':
      return (
        <>
          Auction for <NounRef nounId={data.nounId as number} prefix="V2 Noun" /> started
        </>
      );

    case 'V2_PROP': {
      const title = (data.title as string) || 'untitled';
      return (
        <>
          <Name addr={data.proposer as string} ensLookup={ensLookup} /> proposed{' '}
          <PropRef id={data.proposalId as number} title={title} prefix="V2 " />
        </>
      );
    }

    case 'V2_VOTE': {
      const votes = data.votes as number | undefined;
      return (
        <>
          <Name addr={data.voter as string} ensLookup={ensLookup} /> voted{' '}
          <VoteToken support={data.support as number} />
          {votes != null && <span className={classes.voteCount}> ({votes})</span>} on{' '}
          <PropRef id={data.proposalId as number} prefix="V2 " />
        </>
      );
    }

    case 'SALE':
    case 'V2_SALE': {
      const name = (data.collectionName as string) || (data.collection as string) || 'Item';
      const tokenId = data.tokenId != null && data.tokenId !== '' ? String(data.tokenId) : '';
      const priceEth =
        typeof data.priceEth === 'number' ? data.priceEth : Number(data.priceEth ?? 0);
      const priceStr =
        priceEth === 0 ? '0' : priceEth < 0.001 ? '<0.001' : priceEth.toFixed(priceEth < 1 ? 4 : 2);
      const currency = (data.currency as string) || 'ETH';
      const market = formatMarketplace((data.marketplace as string) || '');
      const fromAddr = (data.from as string) || '';
      const toAddr = (data.to as string) || '';
      const isNounCollection = /noun/i.test(name) && tokenId.length > 0;
      const tokenIdNum = Number(tokenId);
      return (
        <>
          {isNounCollection && Number.isFinite(tokenIdNum) ? (
            <NounRef nounId={tokenIdNum} prefix={type === 'V2_SALE' ? 'V2 Noun' : 'Noun'} />
          ) : (
            <span className={classes.propTitle}>
              {name}
              {tokenId ? ` ${tokenId}` : ''}
            </span>
          )}{' '}
          sold for <TokenAmount amount={priceStr} symbol={currency} />
          {market && <> on {market}</>}
          {fromAddr && (
            <>
              {' '}
              from <Name addr={fromAddr} ensLookup={ensLookup} />
            </>
          )}
          {toAddr && (
            <>
              {' '}
              to <Name addr={toAddr} ensLookup={ensLookup} />
            </>
          )}
        </>
      );
    }

    default:
      return <span className={classes.feedDim}>{type}</span>;
  }
}
