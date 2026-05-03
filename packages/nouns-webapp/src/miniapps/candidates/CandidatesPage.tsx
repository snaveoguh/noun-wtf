/**
 * CandidatesPage — standalone miniapp page listing all proposal candidates.
 * Uses useCandidateProposals() (Ponder GraphQL first, eth_getLogs fallback).
 * Paginated: 50 per page with infinite scroll.
 */
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';

import { useQuery } from '@apollo/client';
import { Link } from 'react-router';
import { useBlockNumber } from 'wagmi';

import ShortAddress from '@/components/ShortAddress';
import { relativeTimestamp } from '@/utils/timeUtils';
import { useProposalThreshold } from '@/wrappers/nounsDao';
import { useCandidateProposals } from '@/wrappers/nounsData';
import type { ProposalCandidate } from '@/wrappers/nounsData';
import { delegateNounsAtBlockQuery } from '@/wrappers/subgraph';

type SortMode = 'recent' | 'sponsors' | 'oldest';

const PAGE_SIZE = 50;

const CandidatesPage: React.FC = () => {
  // Block-watch so the candidates list re-fetches as new blocks arrive —
  // newly-created candidates appear without a manual reload. The wrapper's
  // Apollo query isn't keyed on blockNumber, so we explicitly call refetch
  // when the block advances.
  const { data: blockNumber } = useBlockNumber({ watch: true });
  const { loading: isLoading, data: candidates, error, refetch } = useCandidateProposals(blockNumber);

  useEffect(() => {
    if (blockNumber == null) return;
    refetch?.();
    // Only the block-number tick should retrigger; refetch identity is
    // stable enough that depending on it would just cause double-fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockNumber]);
  const threshold = (useProposalThreshold() ?? 0) + 1;
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const filteredCandidates = useMemo(() => {
    return (candidates ?? [])
      .filter(c => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
          c.version.content.title.toLowerCase().includes(q) ||
          c.proposer.toLowerCase().includes(q) ||
          c.slug.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (sortMode === 'recent') {
          return Number(b.lastUpdatedTimestamp) - Number(a.lastUpdatedTimestamp);
        }
        if (sortMode === 'sponsors') {
          return b.voteCount - a.voteCount;
        }
        // oldest
        return Number(a.lastUpdatedTimestamp) - Number(b.lastUpdatedTimestamp);
      });
  }, [candidates, searchQuery, sortMode]);

  // Reset visible count when search/sort changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchQuery, sortMode]);

  const visibleCandidates = useMemo(
    () => filteredCandidates.slice(0, visibleCount),
    [filteredCandidates, visibleCount],
  );

  const hasMore = visibleCount < filteredCandidates.length;

  // Infinite scroll via IntersectionObserver
  const loadMore = useCallback(() => {
    setVisibleCount(prev => Math.min(prev + PAGE_SIZE, filteredCandidates.length));
  }, [filteredCandidates.length]);

  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>🎴 Candidates</h1>
          <p style={styles.subtitle}>
            Proposal candidates from the community. Sponsor candidates to help them become proposals.
          </p>
        </div>
        <Link to="/create-candidate" style={styles.createBtn}>
          + New Candidate
        </Link>
      </div>

      {/* Controls */}
      <div style={styles.controls}>
        <input
          type="text"
          placeholder="Search candidates..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={styles.searchInput}
        />
        <div style={styles.sortButtons}>
          {(['recent', 'sponsors', 'oldest'] as SortMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setSortMode(mode)}
              style={{
                ...styles.sortBtn,
                ...(sortMode === mode ? styles.sortBtnActive : {}),
              }}
            >
              {mode === 'recent' ? '🕐 Recent' : mode === 'sponsors' ? '✍️ Most Sponsors' : '📅 Oldest'}
            </button>
          ))}
        </div>
      </div>

      {/* Loading / Error */}
      {isLoading && !candidates?.length && (
        <div style={styles.statusMessage}>
          <div style={styles.spinner} />
          <p>Loading candidates...</p>
        </div>
      )}

      {error && (
        <div style={{ ...styles.statusMessage, color: '#e74c3c' }}>
          <p>Error loading candidates: {(error as Error).message}</p>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && filteredCandidates.length === 0 && (
        <div style={styles.emptyState}>
          <p style={styles.emptyTitle}>No candidates found</p>
          <p style={styles.emptySubtitle}>
            {searchQuery
              ? 'Try a different search query.'
              : 'Be the first to create a proposal candidate!'}
          </p>
          {!searchQuery && (
            <Link to="/create-candidate" style={styles.createBtnSmall}>
              Create Candidate
            </Link>
          )}
        </div>
      )}

      {/* Candidates grid */}
      {visibleCandidates.length > 0 && (
        <div style={styles.grid}>
          {visibleCandidates.map(candidate => (
            <CandidateCardMini
              key={candidate.id}
              candidate={candidate}
              threshold={threshold}
              currentBlock={blockNumber}
            />
          ))}
        </div>
      )}

      {/* Infinite scroll sentinel */}
      {hasMore && <div ref={sentinelRef} style={{ height: 1 }} />}

      {/* Stats */}
      {candidates && candidates.length > 0 && (
        <div style={styles.stats}>
          <span>
            {visibleCandidates.length} of {filteredCandidates.length} candidates
            {filteredCandidates.length < candidates.length && ` (${candidates.length} total)`}
          </span>
          {hasMore && (
            <button onClick={loadMore} style={styles.loadMoreBtn}>
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// ---- Inline candidate card for the miniapp ----

const CandidateCardMini: React.FC<{
  candidate: ProposalCandidate;
  threshold: number;
  currentBlock?: bigint;
}> = ({ candidate, threshold, currentBlock }) => {
  const signers = candidate.version.content.contentSignatures ?? [];
  const requiredVotes = candidate.requiredVotes || threshold;

  // Sum the delegated noun voting weight of (proposer + valid signers) — this is the real
  // metric vs. the proposal threshold, not the count of distinct signer addresses.
  const nowSec = Math.floor(Date.now() / 1000);
  const activeSignerIds = signers
    .filter(
      s =>
        s.signer?.id &&
        s.canceled !== true &&
        Number(s.expirationTimestamp ?? 0) > nowSec,
    )
    .map(s => s.signer.id.toLowerCase());
  const proposerLower = candidate.proposer?.toLowerCase() ?? '';
  const queryAddresses = Array.from(
    new Set([proposerLower, ...activeSignerIds].filter(Boolean)),
  );
  const { query, variables } = delegateNounsAtBlockQuery(
    queryAddresses,
    currentBlock ? currentBlock - 1n : 0n,
  );
  const { data: delegateData } = useQuery<{
    delegates: { items: Array<{ id: string; delegatedVotes: number }> };
  }>(query, { variables, skip: queryAddresses.length === 0 });

  const totalSupport =
    delegateData?.delegates?.items?.reduce(
      (sum, d) => sum + Number(d.delegatedVotes ?? 0),
      0,
    ) ?? 0;
  const progress = Math.min(totalSupport / Math.max(requiredVotes, 1), 1);
  const isOver = totalSupport >= requiredVotes;

  return (
    <Link to={`/candidates/${candidate.id}`} style={styles.card}>
      {/* Title */}
      <h3 style={styles.cardTitle}>{candidate.version.content.title || 'Untitled'}</h3>

      {/* Proposer */}
      <p style={styles.cardProposer}>
        by{' '}
        <span style={{ fontWeight: 600 }}>
          <ShortAddress address={candidate.proposer} avatar={false} />
        </span>
      </p>

      {/* Progress bar */}
      <div style={styles.progressContainer}>
        <div style={{ ...styles.progressBar, width: `${progress * 100}%` }} />
      </div>

      {/* Sponsor count + timestamp */}
      <div style={styles.cardFooter}>
        <span
          style={{
            ...styles.sponsorCount,
            ...(isOver ? { color: '#43b369', fontWeight: 700 } : {}),
          }}
        >
          {totalSupport} / {requiredVotes} noun votes
        </span>
        <span style={styles.timestamp}>
          {relativeTimestamp(Number(candidate.lastUpdatedTimestamp))}
        </span>
      </div>
    </Link>
  );
};

// ---- Styles ----

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 960,
    margin: '0 auto',
    padding: '2rem 1.5rem',
    fontFamily: "'PT Root UI', sans-serif",
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '2rem',
    flexWrap: 'wrap',
    gap: '1rem',
  },
  title: {
    fontFamily: "'Londrina Solid', cursive",
    fontSize: '2.5rem',
    margin: 0,
    lineHeight: 1.1,
  },
  subtitle: {
    color: '#8c8d92',
    marginTop: '0.5rem',
    fontSize: '0.95rem',
  },
  createBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    background: '#000',
    color: '#fff',
    padding: '0.75rem 1.5rem',
    borderRadius: 12,
    fontWeight: 700,
    fontSize: '0.95rem',
    textDecoration: 'none',
    transition: 'transform 100ms',
  },
  controls: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '1.5rem',
    flexWrap: 'wrap' as const,
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    minWidth: 200,
    padding: '0.6rem 1rem',
    borderRadius: 10,
    border: '1px solid #e0e0e0',
    fontSize: '0.9rem',
    fontFamily: "'PT Root UI', sans-serif",
    outline: 'none',
  },
  sortButtons: {
    display: 'flex',
    gap: '0.5rem',
  },
  sortBtn: {
    padding: '0.5rem 0.8rem',
    borderRadius: 8,
    border: '1px solid #e0e0e0',
    background: '#fff',
    cursor: 'pointer',
    fontSize: '0.8rem',
    fontFamily: "'PT Root UI', sans-serif",
    fontWeight: 600,
    transition: 'all 100ms',
  },
  sortBtnActive: {
    background: '#000',
    color: '#fff',
    borderColor: '#000',
  },
  statusMessage: {
    textAlign: 'center' as const,
    padding: '3rem 1rem',
    color: '#8c8d92',
  },
  spinner: {
    width: 32,
    height: 32,
    border: '3px solid #e0e0e0',
    borderTopColor: '#000',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    margin: '0 auto 1rem',
  },
  emptyState: {
    textAlign: 'center' as const,
    padding: '4rem 2rem',
    background: '#f8f8fa',
    borderRadius: 16,
  },
  emptyTitle: {
    fontFamily: "'Londrina Solid', cursive",
    fontSize: '1.5rem',
    margin: 0,
  },
  emptySubtitle: {
    color: '#8c8d92',
    marginTop: '0.5rem',
  },
  createBtnSmall: {
    display: 'inline-block',
    marginTop: '1rem',
    background: '#000',
    color: '#fff',
    padding: '0.6rem 1.2rem',
    borderRadius: 10,
    fontWeight: 700,
    fontSize: '0.85rem',
    textDecoration: 'none',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '1rem',
  },
  card: {
    display: 'block',
    background: '#fff',
    borderRadius: 16,
    padding: '1.25rem',
    border: '1px solid #eee',
    textDecoration: 'none',
    color: 'inherit',
    transition: 'box-shadow 100ms, transform 100ms',
    cursor: 'pointer',
  },
  cardTitle: {
    fontFamily: "'Londrina Solid', cursive",
    fontSize: '1.15rem',
    margin: '0 0 0.5rem',
    lineHeight: 1.2,
    color: '#14141f',
  },
  cardProposer: {
    fontSize: '0.8rem',
    color: '#8c8d92',
    margin: '0 0 0.75rem',
  },
  progressContainer: {
    height: 6,
    background: '#e8e8ec',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: '0.75rem',
  },
  progressBar: {
    height: '100%',
    background: 'linear-gradient(90deg, #2ecc71, #27ae60)',
    borderRadius: 3,
    transition: 'width 300ms ease',
  },
  cardFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '0.8rem',
    color: '#8c8d92',
  },
  sponsorCount: {
    fontWeight: 600,
  },
  timestamp: {
    opacity: 0.7,
  },
  stats: {
    textAlign: 'center' as const,
    marginTop: '2rem',
    fontSize: '0.85rem',
    color: '#8c8d92',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '1rem',
  },
  loadMoreBtn: {
    padding: '0.4rem 1rem',
    borderRadius: 8,
    border: '1px solid #e0e0e0',
    background: '#fff',
    cursor: 'pointer',
    fontSize: '0.8rem',
    fontFamily: "'PT Root UI', sans-serif",
    fontWeight: 600,
  },
};

export default CandidatesPage;
