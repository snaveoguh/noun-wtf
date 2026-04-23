import type { CandidateTitleLookup, EnsLookup } from './eventFormatters';
import type { ActivityEvent as ActivityEventType } from './useActivityFeed';

import { useState } from 'react';

import { Link } from 'react-router';

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

/** Event types that have expandable description content */
const EXPANDABLE_TYPES = new Set([
  'PROPOSAL_CREATED',
  'CANDIDATE_CREATED',
  'CANDIDATE_UPDATED',
  'VOTE',
  'PROPOSAL_FEEDBACK',
  'CANDIDATE_FEEDBACK',
  'CANDIDATE_SPONSORED',
]);

function hasExpandableContent(type: string, data: Record<string, unknown>): boolean {
  if (!EXPANDABLE_TYPES.has(type)) return false;
  if (type === 'PROPOSAL_CREATED' || type === 'CANDIDATE_CREATED' || type === 'CANDIDATE_UPDATED') {
    return typeof data.description === 'string' && data.description.length > 0;
  }
  // Votes/feedback with reasons
  if (
    type === 'VOTE' ||
    type === 'PROPOSAL_FEEDBACK' ||
    type === 'CANDIDATE_FEEDBACK' ||
    type === 'CANDIDATE_SPONSORED'
  ) {
    return typeof data.reason === 'string' && data.reason.length > 80;
  }
  return false;
}

/** Simple markdown-ish rendering: strip markdown but preserve line breaks */
function renderDescription(text: string): string {
  return text
    .replace(/^#+\s*/gm, '') // strip heading markers
    .replace(/\*\*(.*?)\*\*/g, '$1') // strip bold
    .replace(/\*(.*?)\*/g, '$1') // strip italic
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1') // links → text only
    .replace(/^[*-]\s/gm, '  • ') // bullets
    .trim();
}

export default function ActivityEvent({ event, ensLookup, candidateTitleLookup }: Props) {
  const [expanded, setExpanded] = useState(false);
  const config = EVENT_TYPES[event.type];
  const color = config?.color || '#666';
  const label = config?.label || event.type;
  const description = formatEventDescription(
    event.type,
    event.data,
    ensLookup,
    candidateTitleLookup,
  );
  const age = timeAgo(event.timestamp);
  const expandable = hasExpandableContent(event.type, event.data);

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

  const expandedContent = expanded
    ? event.type === 'PROPOSAL_CREATED' ||
      event.type === 'CANDIDATE_CREATED' ||
      event.type === 'CANDIDATE_UPDATED'
      ? renderDescription(event.data.description as string)
      : (event.data.reason as string)
    : null;

  // Check if this event has an image (proposals/candidates)
  const imageUrl = expanded ? (event.data.imageUrl as string | undefined) : undefined;

  return (
    <div
      className="terminal-event"
      style={{
        padding: '6px 0',
        borderBottom: '1px solid #111111',
        lineHeight: 1.4,
      }}
    >
      {/* Main row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px',
          cursor: expandable ? 'pointer' : 'default',
        }}
        onClick={() => {
          if (expandable) setExpanded(!expanded);
        }}
      >
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
      {expanded && expandedContent && (
        <div
          style={{
            marginTop: '8px',
            marginLeft: '112px', // align with description column (36 + 12 + 64)
            marginRight: '24px',
            padding: '10px 12px',
            background: '#050505',
            borderLeft: `2px solid ${color}`,
            color: '#999',
            fontSize: '12px',
            lineHeight: 1.7,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: '600px',
            overflowY: 'auto',
          }}
          className="terminal-scrollbar"
        >
          {/* ASCII art of proposal image */}
          {imageUrl && <AsciiImage imageUrl={imageUrl} cols={70} />}

          {expandedContent}
        </div>
      )}
    </div>
  );
}
