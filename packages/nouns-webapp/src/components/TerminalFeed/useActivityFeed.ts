import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchV2ChainEvents } from './v2ChainFallback';

export interface ActivityEvent {
  type: string;
  blockNumber: number;
  timestamp: string;
  txHash: string;
  data: Record<string, unknown>;
}

interface FeedState {
  events: ActivityEvent[];
  loading: boolean;
  hasMore: boolean;
  oldestBlock: number;
  error: string | null;
}

const API_BASE = import.meta.env.VITE_MAINNET_SUBGRAPH
  || 'https://spirited-flexibility-production-3c30.up.railway.app';

const POLL_INTERVAL = 12_000; // 12 seconds (1 Ethereum block)
const PAGE_SIZE = 50;

// V2 event types — when activeFilter equals one of these (or contains them as a CSV),
// only the v2 endpoint is queried. The "_V2" sentinel is the all-v2 filter pill.
const V2_EVENT_TYPES = new Set(['V2_BID', 'V2_SETTLED', 'V2_AUCTION', 'V2_PROP', 'V2_VOTE']);
const V2_ALL_FILTER = '_V2';

function isV2OnlyFilter(filter: string): boolean {
  if (!filter) return false;
  if (filter === V2_ALL_FILTER) return true;
  const parts = filter.split(',').map(p => p.trim());
  return parts.length > 0 && parts.every(p => V2_EVENT_TYPES.has(p));
}

function isV2Excluded(filter: string): boolean {
  // If a non-v2 filter is active (e.g. BID, VOTE), skip v2 entirely.
  if (!filter) return false;
  if (filter === V2_ALL_FILTER) return false;
  const parts = filter.split(',').map(p => p.trim());
  return parts.some(p => !V2_EVENT_TYPES.has(p));
}

export function useActivityFeed(activeFilter: string) {
  const [state, setState] = useState<FeedState>({
    events: [],
    loading: true,
    hasMore: true,
    oldestBlock: 0,
    error: null,
  });

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const newestBlockRef = useRef<number>(0);

  // Fetch events from both mainnet and v2 endpoints, merging into one stream.
  const fetchEvents = useCallback(async (before?: number): Promise<{
    events: ActivityEvent[];
    hasMore: boolean;
    oldestBlock: number;
  } | null> => {
    const v2Only = isV2OnlyFilter(activeFilter);
    const v2Excluded = isV2Excluded(activeFilter);

    const fetchMainnet = async (): Promise<{
      events: ActivityEvent[]; hasMore: boolean; oldestBlock: number;
    } | null> => {
      if (v2Only) return { events: [], hasMore: false, oldestBlock: 0 };
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
        if (before) params.set('before', String(before));
        if (activeFilter && activeFilter !== V2_ALL_FILTER) params.set('type', activeFilter);
        const res = await fetch(`${API_BASE}/api/activity?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        console.error('[ActivityFeed] Mainnet fetch error:', err);
        return null;
      }
    };

    const fetchV2 = async (): Promise<{
      events: ActivityEvent[]; hasMore: boolean; oldestBlock: number;
    } | null> => {
      if (v2Excluded) return { events: [], hasMore: false, oldestBlock: 0 };
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
        if (before) params.set('before', String(before));
        const res = await fetch(`${API_BASE}/api/nounv2-feed?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const apiData = await res.json();
        if (apiData?.events?.length > 0) return apiData;
        // API returned 0 events — fall back to direct chain reads. The
        // /api/nounv2-feed endpoint isn't always live (Railway redeploy
        // issues post-NounV2 launch).
        const chainEvents = await fetchV2ChainEvents();
        return {
          events: chainEvents,
          hasMore: false,
          oldestBlock: chainEvents.length > 0 ? chainEvents[chainEvents.length - 1]!.blockNumber : 0,
        };
      } catch (err) {
        console.warn('[ActivityFeed] V2 endpoint unavailable, trying chain fallback:', err);
        try {
          const chainEvents = await fetchV2ChainEvents();
          return {
            events: chainEvents,
            hasMore: false,
            oldestBlock: chainEvents.length > 0 ? chainEvents[chainEvents.length - 1]!.blockNumber : 0,
          };
        } catch (chainErr) {
          console.warn('[ActivityFeed] V2 chain fallback also failed:', chainErr);
          return { events: [], hasMore: false, oldestBlock: 0 };
        }
      }
    };

    const [mainnet, v2] = await Promise.all([fetchMainnet(), fetchV2()]);
    if (!mainnet && !v2) return null;
    const mainnetData = mainnet ?? { events: [], hasMore: false, oldestBlock: 0 };
    const v2Data = v2 ?? { events: [], hasMore: false, oldestBlock: 0 };

    // If a specific v2 type filter is active, narrow v2 events to those types.
    let v2Filtered = v2Data.events;
    if (activeFilter && activeFilter !== V2_ALL_FILTER && v2Only) {
      const wanted = new Set(activeFilter.split(',').map(p => p.trim()));
      v2Filtered = v2Filtered.filter(e => wanted.has(e.type));
    }

    const merged = [...mainnetData.events, ...v2Filtered].sort(
      (a, b) => b.blockNumber - a.blockNumber,
    );

    return {
      events: merged,
      hasMore: mainnetData.hasMore || v2Data.hasMore,
      oldestBlock:
        merged.length > 0 ? merged[merged.length - 1]!.blockNumber : 0,
    };
  }, [activeFilter]);

  // Initial load + filter change
  useEffect(() => {
    let cancelled = false;

    setState(prev => ({ ...prev, loading: true, error: null }));

    fetchEvents().then(result => {
      if (cancelled || !result) {
        if (!cancelled) setState(prev => ({ ...prev, loading: false, error: 'Failed to load activity' }));
        return;
      }
      // Track newest block for polling
      if (result.events.length > 0) {
        newestBlockRef.current = result.events[0]!.blockNumber;
      }
      setState({
        events: result.events,
        loading: false,
        hasMore: result.hasMore,
        oldestBlock: result.oldestBlock,
        error: null,
      });
    });

    return () => { cancelled = true; };
  }, [activeFilter, fetchEvents]);

  // Polling for new events
  useEffect(() => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);

    pollTimerRef.current = setInterval(async () => {
      const v2Only = isV2OnlyFilter(activeFilter);
      const v2Excluded = isV2Excluded(activeFilter);
      const params = new URLSearchParams({ limit: '20' });
      if (activeFilter && activeFilter !== V2_ALL_FILTER) params.set('type', activeFilter);

      try {
        const [mainnetRes, v2Res] = await Promise.all([
          v2Only
            ? Promise.resolve(null)
            : fetch(`${API_BASE}/api/activity?${params}`).then(r => (r.ok ? r.json() : null)).catch(() => null),
          v2Excluded
            ? Promise.resolve(null)
            : fetch(`${API_BASE}/api/nounv2-feed?limit=20`).then(r => (r.ok ? r.json() : null)).catch(() => null),
        ]);

        const incoming: ActivityEvent[] = [
          ...((mainnetRes?.events as ActivityEvent[] | undefined) ?? []),
          ...((v2Res?.events as ActivityEvent[] | undefined) ?? []),
        ];
        if (!incoming.length) return;

        // If a specific v2 type filter is active, narrow v2 events.
        let filtered = incoming;
        if (v2Only && activeFilter !== V2_ALL_FILTER) {
          const wanted = new Set(activeFilter.split(',').map(p => p.trim()));
          filtered = filtered.filter(e =>
            V2_EVENT_TYPES.has(e.type) ? wanted.has(e.type) : true,
          );
        }

        const newEvents = filtered
          .filter(e => e.blockNumber > newestBlockRef.current)
          .sort((a, b) => b.blockNumber - a.blockNumber);

        if (newEvents.length > 0) {
          newestBlockRef.current = newEvents[0]!.blockNumber;
          setState(prev => ({
            ...prev,
            events: [...newEvents, ...prev.events],
          }));
        }
      } catch { /* silent */ }
    }, POLL_INTERVAL);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [activeFilter]);

  // Load more (infinite scroll)
  const loadMore = useCallback(async () => {
    if (state.loading || !state.hasMore || !state.oldestBlock) return;

    setState(prev => ({ ...prev, loading: true }));

    const result = await fetchEvents(state.oldestBlock);
    if (!result) {
      setState(prev => ({ ...prev, loading: false }));
      return;
    }

    setState(prev => ({
      events: [...prev.events, ...result.events],
      loading: false,
      hasMore: result.hasMore,
      oldestBlock: result.oldestBlock,
      error: null,
    }));
  }, [state.loading, state.hasMore, state.oldestBlock, fetchEvents]);

  return {
    events: state.events,
    loading: state.loading,
    hasMore: state.hasMore,
    error: state.error,
    loadMore,
  };
}
