import { useCallback, useEffect, useRef, useState } from 'react';

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

  // Fetch events from API
  const fetchEvents = useCallback(async (before?: number): Promise<{
    events: ActivityEvent[];
    hasMore: boolean;
    oldestBlock: number;
  } | null> => {
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (before) params.set('before', String(before));
      if (activeFilter) params.set('type', activeFilter);

      const res = await fetch(`${API_BASE}/api/activity?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error('[ActivityFeed] Fetch error:', err);
      return null;
    }
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
      // Fetch latest events (no "before" = most recent)
      const params = new URLSearchParams({ limit: '20' });
      if (activeFilter) params.set('type', activeFilter);

      try {
        const res = await fetch(`${API_BASE}/api/activity?${params}`);
        if (!res.ok) return;
        const result = await res.json();
        if (!result.events?.length) return;

        const newEvents = (result.events as ActivityEvent[]).filter(
          e => e.blockNumber > newestBlockRef.current,
        );

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
