import type { CandidateTitleLookup, EnsLookup } from './eventFormatters';
import type { ActivityEvent as ActivityEventType } from './useActivityFeed';

import { useState } from 'react';

import ReactMarkdown from 'react-markdown';
import { Link } from 'react-router';
import remarkBreaks from 'remark-breaks';

import ClientBadge from '@/components/ClientBadge';

import AsciiImage from './AsciiImage';
import { EVENT_TYPES, formatEventDescription, timeAgo } from './eventFormatters';

interface Props {
  event: ActivityEventType;
  ensLookup?: EnsLookup;
  candidateTitleLookup?: CandidateTitleLookup;
}

const ETHERSCAN_BASE = 'https://etherscan.io/tx/';

const CANDIDATE_EVENT_TYPES = new Set([
  'CANDIDATE_CREATED',
  'CANDIDATE_SPONSORED',
  'CANDIDATE_FEEDBACK',
  'CANDIDATE_UPDATED',
  'CANDIDATE_CANCELED',
  'CANDIDATE_PROMOTED',
]);

/** Event types whose payload may contain a long-form description field. */
const DESCRIPTION_TYPES = new Set([
  'PROPOSAL_CREATED',
  'CANDIDATE_CREATED',
  'CANDIDATE_UPDATED',
  'LIL_PROPOSAL_CREATED',
  'V2_PROP',
  'GRANT_CREATED',
]);

/** Event types whose payload may contain a long-form `reason` (or comment) field. */
const REASON_TYPES = new Set([
  'VOTE',
  'PROPOSAL_FEEDBACK',
  'CANDIDATE_FEEDBACK',
  'CANDIDATE_SPONSORED',
  'LIL_VOTE',
  'LIL_BID',
  'V2_VOTE',
  'GRANT_VOTE',
]);

/** Pull whichever long-form text a given event carries, if any. */
function getExpandableText(type: string, data: Record<string, unknown>): string | null {
  if (DESCRIPTION_TYPES.has(type)) {
    const desc = data.description;
    if (typeof desc === 'string' && desc.trim().length > 0) return desc;
  }
  if (REASON_TYPES.has(type)) {
    // LIL_BID stores the bidder's note under `comment` (or sometimes `reason`).
    const candidates = [data.reason, data.comment];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim().length > 0) return c;
    }
  }
  return null;
}

/** Treat `https:` URLs as the only safe transport for embedded media. */
function isSafeHttpsUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url, 'https://noun.wtf');
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function ActivityEvent({ event, ensLookup, candidateTitleLookup }: Props) {
  const [expanded, setExpanded] = useState(false);
  const config = EVENT_TYPES[event.type];
  // Override badge for burned auctions (winner = 0x0, amount = 0)
  const isBurnedAuction =
    (event.type === 'AUCTION_SETTLED' ||
      event.type === 'V2_SETTLED' ||
      event.type === 'LIL_AUCTION_SETTLED') &&
    ((event.data.winner as string) || '').toLowerCase() ===
      '0x0000000000000000000000000000000000000000' &&
    ((event.data.amount as string) || '0') === '0';
  const color = isBurnedAuction ? '#f97316' : config?.color || '#666';
  const label = isBurnedAuction ? 'BURNED' : config?.label || event.type;
  const description = formatEventDescription(
    event.type,
    event.data,
    ensLookup,
    candidateTitleLookup,
  );
  const age = timeAgo(event.timestamp);
  const expandableText = getExpandableText(event.type, event.data);
  const expandable = expandableText !== null;
  const isMarkdown = DESCRIPTION_TYPES.has(event.type);
  const rawClientId = event.data.clientId as number | string | null | undefined;
  const clientId =
    rawClientId == null || rawClientId === ''
      ? null
      : typeof rawClientId === 'number'
        ? rawClientId
        : Number(rawClientId);
  const showClientBadge = clientId != null && Number.isFinite(clientId);

  // Internal link target (react-router) shown as `view` alongside the `tx` link.
  let viewHref: string | null = null;
  if (event.type === 'CANDIDATE_PROMOTED') {
    const proposalId = event.data.proposalId;
    if (proposalId != null) {
      viewHref = `/vote/${proposalId}`;
    } else {
      const candidateId = event.data.candidateId as string | undefined;
      if (candidateId) viewHref = `/candidates/${candidateId}`;
    }
  } else if (CANDIDATE_EVENT_TYPES.has(event.type)) {
    const candidateId = event.data.candidateId as string | undefined;
    if (candidateId) viewHref = `/candidates/${candidateId}`;
  } else if (event.type === 'PROPOSAL_CREATED') {
    const proposalId = event.data.proposalId;
    if (proposalId != null) viewHref = `/vote/${proposalId}`;
  }

  // Check if this event has an image (proposals/candidates)
  const imageUrl = expanded ? (event.data.imageUrl as string | undefined) : undefined;

  return (
    <div
      className="terminal-event"
      style={{
        padding: '3px 0',
        borderBottom: '1px solid #111111',
        lineHeight: 1.35,
      }}
    >
      {/* Main row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '6px',
          cursor: expandable ? 'pointer' : 'default',
        }}
        onClick={() => {
          if (expandable) setExpanded(!expanded);
        }}
      >
        {/* Client emoji — fixed slot at the far left of the row so the
            following columns stay vertically aligned across rows even when
            an event has no clientId. */}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '16px',
            flexShrink: 0,
            paddingTop: '1px',
          }}
          onClick={e => e.stopPropagation()}
        >
          {showClientBadge && <ClientBadge clientId={clientId} size={13} />}
        </span>

        {/* Timestamp */}
        <span
          style={{
            color: '#444',
            fontSize: '12px',
            minWidth: '36px',
            textAlign: 'right',
            flexShrink: 0,
            paddingTop: '1px',
          }}
        >
          {age}
        </span>

        {/* Type badge */}
        <span
          style={{
            color,
            fontSize: '11px',
            minWidth: '64px',
            flexShrink: 0,
            paddingTop: '2px',
            letterSpacing: '0.5px',
          }}
        >
          {label}
        </span>

        {/* Description */}
        <span
          style={{
            color: '#ccc',
            fontSize: '13px',
            flex: 1,
            wordBreak: 'break-word',
          }}
        >
          {description}
          {expandable && (
            <span style={{ color: '#444', fontSize: '11px', marginLeft: '6px' }}>
              {expanded ? '▾' : '▸'}
            </span>
          )}
        </span>

        {/* View link (internal, e.g. candidate / proposal page) */}
        {viewHref && (
          <Link
            to={viewHref}
            style={{
              color: '#333',
              fontSize: '11px',
              flexShrink: 0,
              textDecoration: 'none',
              paddingTop: '2px',
            }}
            onMouseEnter={e => {
              (e.target as HTMLElement).style.color = '#666';
            }}
            onMouseLeave={e => {
              (e.target as HTMLElement).style.color = '#333';
            }}
            onClick={e => e.stopPropagation()}
          >
            view
          </Link>
        )}

        {/* TX link */}
        {event.txHash && (
          <a
            href={`${ETHERSCAN_BASE}${event.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: '#333',
              fontSize: '11px',
              flexShrink: 0,
              textDecoration: 'none',
              paddingTop: '2px',
            }}
            onMouseEnter={e => {
              (e.target as HTMLElement).style.color = '#666';
            }}
            onMouseLeave={e => {
              (e.target as HTMLElement).style.color = '#333';
            }}
            onClick={e => e.stopPropagation()}
            title={event.txHash}
          >
            tx
          </a>
        )}
      </div>

      {/* Expanded content */}
      {expanded && expandableText && (
        <div
          style={{
            marginTop: '8px',
            marginLeft: '112px', // align with description column (36 + 12 + 64)
            marginRight: '24px',
            padding: '10px 12px',
            background: '#050505',
            borderLeft: `2px solid ${color}`,
            color: '#bbb',
            fontSize: '12px',
            lineHeight: 1.7,
            wordBreak: 'break-word',
            overflowWrap: 'anywhere',
            maxHeight: '600px',
            overflowY: 'auto',
            overflowX: 'hidden',
            animation: 'terminalRowExpand 140ms ease-out',
          }}
          className="terminal-scrollbar terminal-row-expanded"
        >
          {/* ASCII art of proposal image */}
          {imageUrl && <AsciiImage imageUrl={imageUrl} cols={70} />}

          {isMarkdown ? (
            <ReactMarkdown
              // No rehype-raw → raw HTML in the markdown is rendered as text,
              // not parsed. This is the safe-by-default react-markdown config.
              remarkPlugins={[remarkBreaks]}
              components={{
                p: ({ ...props }) => <p {...props} style={{ margin: '0 0 8px' }} />,
                h1: ({ ...props }) => (
                  <h1
                    {...props}
                    style={{ fontSize: '14px', margin: '8px 0 6px', color: '#ddd' }}
                  />
                ),
                h2: ({ ...props }) => (
                  <h2
                    {...props}
                    style={{ fontSize: '13px', margin: '8px 0 6px', color: '#ddd' }}
                  />
                ),
                h3: ({ ...props }) => (
                  <h3
                    {...props}
                    style={{ fontSize: '12px', margin: '6px 0 4px', color: '#ddd' }}
                  />
                ),
                strong: ({ ...props }) => <strong {...props} style={{ color: '#eee' }} />,
                em: ({ ...props }) => <em {...props} style={{ color: '#ddd' }} />,
                code: ({ ...props }) => (
                  <code
                    {...props}
                    style={{
                      background: '#0e0e0e',
                      padding: '1px 4px',
                      borderRadius: 3,
                      fontSize: '11px',
                    }}
                  />
                ),
                pre: ({ ...props }) => (
                  <pre
                    {...props}
                    style={{
                      background: '#0e0e0e',
                      padding: '8px 10px',
                      borderRadius: 4,
                      overflowX: 'auto',
                      fontSize: '11px',
                      margin: '6px 0',
                    }}
                  />
                ),
                ul: ({ ...props }) => (
                  <ul {...props} style={{ paddingLeft: 18, margin: '4px 0' }} />
                ),
                ol: ({ ...props }) => (
                  <ol {...props} style={{ paddingLeft: 18, margin: '4px 0' }} />
                ),
                blockquote: ({ ...props }) => (
                  <blockquote
                    {...props}
                    style={{
                      borderLeft: '2px solid #222',
                      paddingLeft: 8,
                      margin: '6px 0',
                      color: '#888',
                    }}
                  />
                ),
                a: ({ href, ...props }) => {
                  if (!isSafeHttpsUrl(href)) {
                    return <span {...props} style={{ color: '#888' }} />;
                  }
                  return (
                    <a
                      {...props}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      style={{ color: '#7dd3fc', textDecoration: 'underline' }}
                    />
                  );
                },
                img: ({ src, alt }) => {
                  if (!isSafeHttpsUrl(src)) return null;
                  return (
                    <img
                      src={src}
                      alt={alt || ''}
                      loading="lazy"
                      style={{
                        maxWidth: '100%',
                        height: 'auto',
                        borderRadius: 6,
                        margin: '6px 0',
                        display: 'block',
                      }}
                      onError={e => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  );
                },
              }}
            >
              {expandableText}
            </ReactMarkdown>
          ) : (
            <div style={{ whiteSpace: 'pre-wrap' }}>{expandableText}</div>
          )}
        </div>
      )}
    </div>
  );
}
