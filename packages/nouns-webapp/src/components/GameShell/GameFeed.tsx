import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ChevronDown, ChevronRight, Filter } from 'lucide-react';

import {
  EVENT_TYPES,
  extractAddresses,
  timeAgo,
  type CandidateTitleLookup,
  type EnsLookup,
  type ProposalTitleLookup,
} from '@/components/TerminalFeed/eventFormatters';
import { useActivityFeed, type ActivityEvent } from '@/components/TerminalFeed/useActivityFeed';
import { useEnsNames } from '@/components/TerminalFeed/useEnsNames';
import { useAllProposals } from '@/wrappers/nounsDao';

import { formatEventNodes } from './feedNodes';

import classes from './GameShell.module.css';

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

const DESCRIPTION_TYPES = new Set([
  'PROPOSAL_CREATED',
  'CANDIDATE_CREATED',
  'CANDIDATE_UPDATED',
  'LIL_PROPOSAL_CREATED',
  'V2_PROP',
  'GRANT_CREATED',
]);

function getExpandableText(type: string, data: Record<string, unknown>): string | null {
  if (DESCRIPTION_TYPES.has(type)) {
    const desc = data.description;
    if (typeof desc === 'string' && desc.trim().length > 0) return desc;
  }
  if (REASON_TYPES.has(type)) {
    const candidates = [data.reason, data.comment];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim().length > 0) return c;
    }
  }
  return null;
}

interface FeedRowProps {
  event: ActivityEvent;
  ensLookup?: EnsLookup;
  candidateTitleLookup?: CandidateTitleLookup;
  proposalTitleLookup?: ProposalTitleLookup;
}

function FeedRow({ event, ensLookup, candidateTitleLookup, proposalTitleLookup }: FeedRowProps) {
  const [expanded, setExpanded] = useState(false);
  const expandableText = getExpandableText(event.type, event.data);
  const expandable = expandableText !== null;
  const age = timeAgo(event.timestamp);
  const config = EVENT_TYPES[event.type];

  // Burned auctions show the fire emoji instead of the configured icon for
  // additional clarity. (Burned == winner=0x0 + amount=0.)
  const isBurnedAuction =
    (event.type === 'AUCTION_SETTLED' ||
      event.type === 'V2_SETTLED' ||
      event.type === 'LIL_AUCTION_SETTLED') &&
    ((event.data.winner as string) || '').toLowerCase() ===
      '0x0000000000000000000000000000000000000000' &&
    ((event.data.amount as string) || '0') === '0';
  const icon = isBurnedAuction ? '🔥' : (config?.icon ?? '·');

  const onToggle = () => {
    if (expandable) setExpanded(e => !e);
  };

  return (
    <div className={classes.feedRow}>
      <div
        className={classes.feedRowMain}
        onClick={onToggle}
        style={{ cursor: expandable ? 'pointer' : 'default' }}
      >
        <span className={classes.feedIcon} aria-hidden title={config?.label}>
          {icon}
        </span>
        <span className={classes.feedDescription}>
          {formatEventNodes(event.type, event.data, {
            ensLookup,
            candidateTitleLookup,
            proposalTitleLookup,
          })}
          {expandable && (
            <button
              type="button"
              className={classes.feedChevron}
              onClick={e => {
                e.stopPropagation();
                onToggle();
              }}
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? (
                <ChevronDown size={11} aria-hidden />
              ) : (
                <ChevronRight size={11} aria-hidden />
              )}
            </button>
          )}
        </span>
        <span className={classes.feedTime}>{age}</span>
      </div>

      {expandable && expanded && expandableText && (
        <div className={classes.feedExpand}>{expandableText}</div>
      )}
    </div>
  );
}

/**
 * Activity feed pane for the Game theme.
 *
 * Reuses the Terminal feed's data layer (`useActivityFeed` + `useEnsNames`)
 * and re-renders rows in nouns.game's dense format: one-line description with
 * a small leading event icon, inline noun thumbnails before each "Noun N"
 * mention, vote tokens with vote counts, full proposal titles via lookup,
 * and a threaded chevron-collapsed reasoning quote below for votes/feedback.
 */
export default function GameFeed() {
  // No filter UI yet — show the full ALL stream like nouns.game's home feed.
  const { events, loading, hasMore, error, loadMore } = useActivityFeed('');

  const addresses = useMemo(() => {
    const set = new Set<string>();
    for (const event of events) {
      for (const addr of extractAddresses(event.data)) {
        set.add(addr);
      }
    }
    return Array.from(set);
  }, [events]);
  const ensLookup = useEnsNames(addresses);

  const candidateTitleLookup = useMemo<CandidateTitleLookup>(() => {
    const map = new Map<string, string>();
    for (const event of events) {
      if (event.type !== 'CANDIDATE_CREATED') continue;
      const id = event.data.candidateId as string | undefined;
      const title = event.data.title as string | undefined;
      if (id && title && !map.has(id)) map.set(id, title);
    }
    return (candidateId: string) => map.get(candidateId) ?? null;
  }, [events]);

  // Pull every Nouns DAO proposal title once (cached at the wrapper level)
  // so VOTE / QUEUED / EXECUTED rows can render full titles even when the
  // matching PROPOSAL_CREATED event is older than the current feed window.
  const allProposals = useAllProposals();

  // Proposal title lookup — first checks the recently-loaded PROPOSAL_CREATED
  // events (so V2/Lil titles are resolved), then falls back to the global
  // useAllProposals snapshot for older mainnet proposals not in the feed.
  const proposalTitleLookup = useMemo<ProposalTitleLookup>(() => {
    const map = new Map<string, string>();
    for (const p of allProposals.data ?? []) {
      if (p.id && p.title) map.set(String(p.id), p.title);
    }
    for (const event of events) {
      if (
        event.type !== 'PROPOSAL_CREATED' &&
        event.type !== 'V2_PROP' &&
        event.type !== 'LIL_PROPOSAL_CREATED'
      )
        continue;
      const id = event.data.proposalId;
      const title = event.data.title as string | undefined;
      if (id != null && title) {
        const key = String(id);
        if (!map.has(key)) map.set(key, title);
      }
    }
    return (proposalId: number | string) => map.get(String(proposalId)) ?? null;
  }, [events, allProposals.data]);

  // IntersectionObserver for infinite scroll.
  const sentinelRef = useRef<HTMLDivElement>(null);
  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0]?.isIntersecting && hasMore && !loading) {
        loadMore();
      }
    },
    [hasMore, loading, loadMore],
  );
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(handleIntersect, { rootMargin: '300px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [handleIntersect]);

  return (
    <section className={`${classes.pane} ${classes.paneLeft}`}>
      <header className={classes.paneHeader}>
        <h1 className={classes.paneTitle}>Feed</h1>
        <button type="button" className={classes.iconBtn} aria-label="Filter">
          <Filter size={15} aria-hidden />
        </button>
      </header>

      {error && <div className={classes.feedEmpty}>Failed to load activity.</div>}

      <div className={classes.feedList}>
        {events.map((event, i) => (
          <FeedRow
            key={`${event.type}-${event.blockNumber}-${i}`}
            event={event}
            ensLookup={ensLookup}
            candidateTitleLookup={candidateTitleLookup}
            proposalTitleLookup={proposalTitleLookup}
          />
        ))}

        {events.length === 0 && !loading && !error && (
          <div className={classes.feedEmpty}>No events yet.</div>
        )}

        <div ref={sentinelRef} style={{ height: 1 }} />

        {loading && <div className={classes.feedEmpty}>loading…</div>}

        {!hasMore && events.length > 0 && (
          <div className={classes.feedEmpty}>end of indexed history</div>
        )}
      </div>
    </section>
  );
}
