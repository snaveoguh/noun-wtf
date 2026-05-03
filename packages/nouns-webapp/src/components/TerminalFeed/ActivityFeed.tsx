import type { ActivityEvent as ActivityEventType } from './useActivityFeed';

import { useCallback, useEffect, useMemo, useRef } from 'react';

import ActivityEvent from './ActivityEvent';
import { extractAddresses } from './eventFormatters';
import { useEnsNames } from './useEnsNames';

interface Props {
  events: ActivityEventType[];
  loading: boolean;
  hasMore: boolean;
  error: string | null;
  onLoadMore: () => void;
}

export default function ActivityFeed({ events, loading, hasMore, error, onLoadMore }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Collect unique addresses from all visible events for ENS resolution
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

  // Build a candidateId → title map from CANDIDATE_CREATED events already in the
  // feed, so SPONSORED/FEEDBACK rows can show which candidate they reference.
  const candidateTitleLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const event of events) {
      if (event.type !== 'CANDIDATE_CREATED') continue;
      const id = event.data.candidateId as string | undefined;
      const title = event.data.title as string | undefined;
      if (id && title && !map.has(id)) map.set(id, title);
    }
    return (candidateId: string): string | null => map.get(candidateId) ?? null;
  }, [events]);

  // Infinite scroll via IntersectionObserver
  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0]?.isIntersecting && hasMore && !loading) {
        onLoadMore();
      }
    },
    [hasMore, loading, onLoadMore],
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(handleIntersect, {
      root: scrollRef.current,
      rootMargin: '200px',
      threshold: 0,
    });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [handleIntersect]);

  return (
    <div
      ref={scrollRef}
      style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '0 16px',
      }}
      className="terminal-scrollbar"
    >
      {error && (
        <div style={{ color: 'var(--theme-negative)', padding: '16px 0', fontSize: '13px' }}>{error}</div>
      )}

      {events.length === 0 && !loading && !error && (
        <div style={{ color: 'var(--theme-text-muted)', padding: '40px 0', textAlign: 'center', fontSize: '13px' }}>
          no events found. the void stares back.
        </div>
      )}

      {events.map((event, i) => (
        <ActivityEvent
          key={`${event.type}-${event.blockNumber}-${i}`}
          event={event}
          ensLookup={ensLookup}
          candidateTitleLookup={candidateTitleLookup}
        />
      ))}

      {/* Sentinel for infinite scroll */}
      <div ref={sentinelRef} style={{ height: 1 }} />

      {loading && (
        <div style={{ color: 'var(--theme-accent)', padding: '12px 0', fontSize: '12px', opacity: 0.6 }}>
          loading...
        </div>
      )}

      {!hasMore && events.length > 0 && (
        <div style={{ color: 'var(--theme-text-muted)', padding: '16px 0', fontSize: '11px', textAlign: 'center' }}>
          end of indexed history
        </div>
      )}
    </div>
  );
}
