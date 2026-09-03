import { useCallback, useEffect, useRef, useState } from 'react';

import { fixturesForFilter } from './feedFixtures';
import { fetchV1ChainEvents } from './v1ChainFallback';
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

const API_BASE: string =
  (import.meta.env.VITE_MAINNET_SUBGRAPH as string | undefined) ??
  'https://spirited-flexibility-production-3c30.up.railway.app';

const POLL_INTERVAL = 12_000; // 12 seconds (1 Ethereum block)
const PAGE_SIZE = 50;

// V2 event types — when activeFilter equals one of these (or contains them as a CSV),
// only the v2 endpoint is queried. The "_V2" sentinel is the all-v2 filter pill.
const V2_EVENT_TYPES = new Set([
  'V2_BID',
  'V2_SETTLED',
  'V2_AUCTION',
  'V2_PROP',
  'V2_PROP_QUEUED',
  'V2_PROP_EXECUTED',
  'V2_PROP_CANCELED',
  'V2_VOTE',
  'V2_SALE',
]);
const V2_ALL_FILTER = '_V2';

function isV2OnlyFilter(filter: string): boolean {
  if (!filter) return false;
  if (filter === V2_ALL_FILTER) return true;
  const parts = filter.split(',').map(p => p.trim());
  return parts.length > 0 && parts.every(p => V2_EVENT_TYPES.has(p));
}

function isV2Excluded(filter: string): boolean {
  // V2 endpoint is skipped only when EVERY filter part is a non-v2 type.
  // Mixed filters (e.g. SALE,V2_SALE for the SALES tab) keep V2 included so
  // both feeds contribute their share of matching events.
  if (!filter) return false;
  if (filter === V2_ALL_FILTER) return false;
  const parts = filter.split(',').map(p => p.trim());
  return parts.length > 0 && parts.every(p => !V2_EVENT_TYPES.has(p));
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
  const fetchEvents = useCallback(
    async (
      before?: number,
    ): Promise<{
      events: ActivityEvent[];
      hasMore: boolean;
      oldestBlock: number;
    } | null> => {
      const v2Only = isV2OnlyFilter(activeFilter);
      const v2Excluded = isV2Excluded(activeFilter);

      // Prefer the API over the chain reader: the API enriches events with
      // `clientId` (used for ClientBadge emojis) which the chain fallback
      // can't provide cleanly. The chain fallback is HEAVY — it fires 7
      // parallel getContractEvents calls — so we only run it sequentially
      // after the API has failed/timed out, never in parallel. Otherwise
      // it saturates the RPC budget and starves other on-page wagmi reads
      // (most visibly: the crystal-ball orb's auction() + getBlock()
      // calls, which then hang on RPC backpressure).
      const API_PREFER_MS = 4_000;
      const API_TIMEOUT_MS = 6_000;
      const armTimeout = (ac: AbortController): void => {
        setTimeout(() => ac.abort(), API_TIMEOUT_MS);
      };

      type FetchResult = { events: ActivityEvent[]; hasMore: boolean; oldestBlock: number };

      const fetchMainnet = async (): Promise<FetchResult | null> => {
        if (v2Only) return { events: [], hasMore: false, oldestBlock: 0 };

        const apiPromise = (async (): Promise<FetchResult | null> => {
          try {
            const ac = new AbortController();
            armTimeout(ac);
            const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
            if (before != null) params.set('before', String(before));
            if (activeFilter && activeFilter !== V2_ALL_FILTER) params.set('type', activeFilter);
            const res = await fetch(`${API_BASE}/api/activity?${params}`, { signal: ac.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const apiData = await res.json();
            if (apiData?.events?.length > 0) return apiData;
            return null; // 200 but empty → let chain win
          } catch {
            return null;
          }
        })();

        // Wait up to API_PREFER_MS for the API.
        const apiWithDeadline = Promise.race([
          apiPromise,
          new Promise<null>(resolve => setTimeout(() => resolve(null), API_PREFER_MS)),
        ]);
        const apiResult = await apiWithDeadline;
        if (apiResult && apiResult.events.length > 0) return apiResult;

        // API was empty/slow/errored — only NOW kick off the chain fallback.
        try {
          const events = await fetchV1ChainEvents();
          if (events.length > 0) {
            return {
              events,
              hasMore: false,
              oldestBlock: events[events.length - 1]!.blockNumber,
            };
          }
        } catch {
          // fall through
        }

        // Chain didn't produce anything either; give the API one last chance
        // in case it's still in flight (between API_PREFER_MS and API_TIMEOUT_MS).
        return apiPromise;
      };

      const fetchV2 = async (): Promise<FetchResult | null> => {
        if (v2Excluded) return { events: [], hasMore: false, oldestBlock: 0 };

        const apiPromise = (async (): Promise<FetchResult | null> => {
          try {
            const ac = new AbortController();
            armTimeout(ac);
            const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
            if (before != null) params.set('before', String(before));
            const res = await fetch(`${API_BASE}/api/nounv2-feed?${params}`, { signal: ac.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const apiData = await res.json();
            if (apiData?.events?.length > 0) return apiData;
            return null;
          } catch {
            return null;
          }
        })();

        const apiWithDeadline = Promise.race([
          apiPromise,
          new Promise<null>(resolve => setTimeout(() => resolve(null), API_PREFER_MS)),
        ]);
        const apiResult = await apiWithDeadline;
        if (apiResult && apiResult.events.length > 0) return apiResult;

        // Only run the V2 chain fallback after the API gives up — it
        // saturates the RPC budget if fired in parallel.
        try {
          const events = await fetchV2ChainEvents();
          if (events.length > 0) {
            return {
              events,
              hasMore: false,
              oldestBlock: events[events.length - 1]!.blockNumber,
            };
          }
        } catch {
          // fall through
        }

        const apiLate = await apiPromise;
        return apiLate ?? { events: [], hasMore: false, oldestBlock: 0 };
      };

      const [mainnet, v2] = await Promise.all([fetchMainnet(), fetchV2()]);
      if (!mainnet && !v2) return null;
      const mainnetData = mainnet ?? { events: [], hasMore: false, oldestBlock: 0 };
      const v2Data = v2 ?? { events: [], hasMore: false, oldestBlock: 0 };

      // If a specific filter is active, narrow BOTH mainnet and v2 events to
      // only the wanted types. Without this, the chain fallback (which returns
      // all event types) leaks unrelated events into filtered tabs like SALES.
      // The check is by exact type name against the tab's CSV, so any new
      // type the API starts emitting passes through as long as a tab lists it.
      let mainnetFiltered = mainnetData.events;
      let v2Filtered = v2Data.events;
      if (activeFilter && activeFilter !== V2_ALL_FILTER) {
        const wanted = new Set(activeFilter.split(',').map(p => p.trim()));
        mainnetFiltered = mainnetFiltered.filter(e => wanted.has(e.type));
        v2Filtered = v2Filtered.filter(e => wanted.has(e.type));
      }

      const merged = [...mainnetFiltered, ...v2Filtered].sort(
        (a, b) => b.blockNumber - a.blockNumber,
      );

      return {
        events: merged,
        hasMore: mainnetData.hasMore || v2Data.hasMore,
        oldestBlock: merged.length > 0 ? merged[merged.length - 1]!.blockNumber : 0,
      };
    },
    [activeFilter],
  );

  // Initial load + filter change
  useEffect(() => {
    let cancelled = false;

    setState(prev => ({ ...prev, loading: true, error: null }));

    fetchEvents().then(result => {
      if (cancelled || !result) {
        if (!cancelled)
          setState(prev => ({ ...prev, loading: false, error: 'Failed to load activity' }));
        return;
      }
      // Track newest block for polling — from the REAL events, before any
      // dev fixtures are prepended (their block numbers are synthetic).
      if (result.events.length > 0) {
        newestBlockRef.current = result.events[0]!.blockNumber;
      }
      // Dev-only: localStorage['noun-wtf-feed-fixtures']==='1' prepends one
      // sample event per registry branch so new labels can be eyeballed
      // before the API emits them. See feedFixtures.ts.
      const fixtures = fixturesForFilter(activeFilter);
      setState({
        events: fixtures.length > 0 ? [...fixtures, ...result.events] : result.events,
        loading: false,
        hasMore: result.hasMore,
        oldestBlock: result.oldestBlock,
        error: null,
      });
    });

    return () => {
      cancelled = true;
    };
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
            : fetch(`${API_BASE}/api/activity?${params}`)
                .then(r => (r.ok ? r.json() : null))
                .catch(() => null),
          v2Excluded
            ? Promise.resolve(null)
            : fetch(`${API_BASE}/api/nounv2-feed?limit=20`)
                .then(r => (r.ok ? r.json() : null))
                .catch(() => null),
        ]);

        const incoming: ActivityEvent[] = [
          ...((mainnetRes?.events as ActivityEvent[] | undefined) ?? []),
          ...((v2Res?.events as ActivityEvent[] | undefined) ?? []),
        ];
        if (!incoming.length) return;

        // If a specific filter is active, narrow ALL events to listed types.
        // Both V1 and V2 events must match — the chain fallback can return
        // unrelated event types when the API is unavailable.
        let filtered = incoming;
        if (activeFilter && activeFilter !== V2_ALL_FILTER) {
          const wanted = new Set(activeFilter.split(',').map(p => p.trim()));
          filtered = filtered.filter(e => wanted.has(e.type));
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
      } catch {
        /* silent */
      }
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
