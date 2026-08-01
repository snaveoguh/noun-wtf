import { QueryClient } from '@tanstack/react-query';

// Defaults tuned for an RPC-constrained app on free public endpoints:
//   - staleTime 30s — components can mount/unmount during navigation
//     (tab switches, DAO toggle, route changes) without each remount firing
//     a fresh chain read. TanStack's default of 0 made every transition a
//     storm of `useReadContract` refetches.
//   - retry 1 — wagmi reads that fail once usually fail again on the same
//     transport. Three default retries × every read × every refocus was the
//     amplifier turning a single 429 into a 30-call cascade.
//   - refetchOnWindowFocus off — Cmd-Tab-ing to inspect a tx on Etherscan
//     and back used to refire every active query. Block-level freshness is
//     handled by the explicit watcher in `ChainSubscriber`, not by polling.
//   - refetchOnReconnect off — same reasoning. Reconnect happens on every
//     wifi blip and shouldn't trigger a thundering herd.
// Per-hook overrides (e.g. `useDaoNounSeed`'s 5min staleTime for immutable
// seed data) still take precedence; this just stops the default from being
// "as fresh as possible at all costs".
//
// Lives in its own module (rather than inline in index.tsx) so non-hook code
// can imperatively invalidate queries — e.g. `invalidateProbeDreamsCache()`
// after publishing a dream.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      retryDelay: attempt => Math.min(1000 * 2 ** attempt, 8000),
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});
