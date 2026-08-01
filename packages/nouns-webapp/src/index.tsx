import type { Address } from './utils/types';

import React, { useEffect } from 'react';

import { ApolloProvider } from '@apollo/client';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { createRoot } from 'react-dom/client';
import { Provider as ReduxProvider } from 'react-redux';
import { parseAbiItem } from 'viem';
import { hardhat } from 'viem/chains';
import { usePublicClient, useWatchContractEvent, WagmiProvider } from 'wagmi';

import { CustomConnectkitProvider } from '@/components/CustomConnectkitProvider';
import { ThemeProvider } from '@/components/ThemeProvider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SiteThemeProvider } from '@/contexts/SiteThemeContext';
import { queryClient } from '@/lib/queryClient';
import { store } from '@/store';
import { execute } from '@/subgraphs/execute';

import App from './App';
import config, { CHAIN_ID } from './config';
import {
  nounsAuctionHouseAbi,
  nounsAuctionHouseAddress,
  useReadNounsAuctionHouseAuction,
} from './contracts';
import { useAppDispatch, useAppSelector } from './hooks';
import { LanguageProvider } from './i18n/LanguageProvider';
import reportWebVitals from './reportWebVitals';
import {
  appendBid,
  reduxSafeAuction,
  reduxSafeBid,
  reduxSafeNewAuction,
  setActiveAuction,
  setAuctionExtended,
  setAuctionSettled,
  setBidClientId,
  setFullAuction,
} from './state/slices/auction';
import { setLastAuctionNounId, setOnDisplayAuctionNounId } from './state/slices/onDisplayAuction';
import { addPastAuctions, upsertPastAuction } from './state/slices/pastAuctions';
import { nounPath } from './utils/history';
import { defaultChain, config as wagmiConfig } from './wagmi';
import { clientFactory, latestAuctionsQuery, singleAuctionQuery } from './wrappers/subgraph';

/**
 * Catch React render errors so the whole page doesn't go white.
 *
 * Transient RPC failures (free public endpoints rate-limiting under a
 * traffic spike) used to escape as `Cannot read properties of undefined
 * (reading 'data')` and trip the boundary, tombstoning the whole app
 * until the user manually reloaded. We now identify that family of
 * errors and ignore them — the underlying TanStack queries will retry
 * on their own cadence and the page reconciles itself once data lands.
 * A logic error (anything not RPC-shape) still trips the boundary.
 */
function isLikelyRpcDataError(error: Error): boolean {
  const m = (error?.message || '').toLowerCase();
  return (
    // Chrome format: "Cannot read properties of undefined (reading 'data')"
    m.includes("reading 'data'") ||
    m.includes("reading 'result'") ||
    // Safari format: "undefined is not an object (evaluating 'R[1].data')"
    // Match the generic shape — any "evaluating '...data'" or "...result'"
    // pattern, plus the bare "undefined is not an object" guard for when the
    // expression part doesn't include those keywords.
    (m.includes('evaluating') && (m.includes(".data'") || m.includes(".result'"))) ||
    (m.includes('undefined is not an object') && (m.includes('.data') || m.includes('.result'))) ||
    // Network / rate-limit shapes
    m.includes('429') ||
    m.includes('rate limit') ||
    m.includes('payment required') ||
    m.includes('http request failed')
  );
}

// Circuit breaker: swallowing an RPC-shape error re-renders the children.
// That recovers a *transient* failure, but a *deterministic* one (a real
// logic bug whose message happens to match the RPC shape — e.g. a render
// that always reads `.data` of undefined) throws again on every retry.
// React then exhausts its re-render budget and unmounts the whole tree →
// blank white page. We count consecutive swallows in a tight time window;
// once they pile up the error is clearly not transient, so we stop
// swallowing and show the error UI instead of white-screening the app.
let swallowCount = 0;
let lastSwallowAt = 0;
const SWALLOW_WINDOW_MS = 1000;
const SWALLOW_LIMIT = 5;

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    if (isLikelyRpcDataError(error)) {
      const now = Date.now();
      swallowCount = now - lastSwallowAt < SWALLOW_WINDOW_MS ? swallowCount + 1 : 1;
      lastSwallowAt = now;
      if (swallowCount > SWALLOW_LIMIT) {
        console.error(
          '[ErrorBoundary] RPC-shape error repeated — treating as deterministic, not swallowing:',
          error.message,
        );
        return { error };
      }
      console.warn('[ErrorBoundary] swallowing transient RPC error:', error.message);
      return { error: null };
    }
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (isLikelyRpcDataError(error) && swallowCount <= SWALLOW_LIMIT) return;
    console.error('[ErrorBoundary]', error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, fontFamily: 'monospace' }}>
          <h2>Something went wrong</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#c00' }}>{this.state.error.message}</pre>
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const client = clientFactory(config.app.subgraphApiUri);

const ChainSubscriber: React.FC = () => {
  const dispatch = useAppDispatch();
  const publicClient = usePublicClient();
  const chainId = defaultChain.id;

  // Fetch the current auction
  const { data: currentAuction } = useReadNounsAuctionHouseAuction();
  useEffect(() => {
    if (currentAuction) {
      dispatch(setFullAuction(reduxSafeAuction(currentAuction)));
      dispatch(setLastAuctionNounId(Number(currentAuction.nounId)));
    }
  }, [currentAuction, dispatch]);

  // Fetch the previous 24 hours of bids
  useEffect(() => {
    if (CHAIN_ID === hardhat.id) {
      return;
    }
    (async () => {
      try {
        const latestBlock = await publicClient.getBlock();
        const fromBlock = latestBlock.number > 7200n ? latestBlock.number - 7200n : 0n;

        const logs = await publicClient.getLogs({
          address: nounsAuctionHouseAddress[chainId],
          event: parseAbiItem(
            'event AuctionBid(uint256 indexed nounId, address sender, uint256 value, bool extended)',
          ),
          fromBlock,
          toBlock: latestBlock.number,
        });

        // Dedupe block lookups — bids commonly share a block, and one getBlock
        // per bid turned a quiet auction into a burst of RPC calls on load.
        const blockTimestamps = new Map<bigint, bigint>();
        for (const bn of new Set(
          logs.map(l => l.blockNumber).filter((b): b is bigint => b != null),
        )) {
          const block = await publicClient.getBlock({ blockNumber: bn });
          blockTimestamps.set(bn, block.timestamp);
        }

        for (const {
          args: { extended, nounId, sender, value },
          blockNumber,
          transactionHash,
          transactionIndex,
        } of logs) {
          dispatch(
            appendBid(
              reduxSafeBid({
                nounId: Number(nounId),
                sender: sender as Address,
                value: Number(value),
                extended: extended !== undefined,
                transactionHash: transactionHash ?? '',
                transactionIndex: transactionIndex ?? 0,
                timestamp: blockNumber != null ? (blockTimestamps.get(blockNumber) ?? 0n) : 0n,
              }),
            ),
          );
        }
      } catch (err) {
        console.error('[ChainSubscriber] Failed to fetch recent bids:', err);
      }
    })();
  }, [chainId, dispatch, publicClient]);

  // One watcher for the whole auction house instead of five. Five separate
  // useWatch*Event hooks meant five filtered getLogs polls every cycle; this
  // is a single unfiltered poll, routed by event name. Combined with the 12s
  // pollingInterval that turns 5 polls / 4s into 1 poll / 12s.
  useWatchContractEvent({
    address: nounsAuctionHouseAddress[chainId],
    abi: nounsAuctionHouseAbi,
    onLogs: async logs => {
      for (const log of logs) {
        switch (log.eventName) {
          case 'AuctionBid': {
            const { extended, nounId, sender, value } = log.args;
            const block = await publicClient.getBlock({
              blockNumber: log.blockNumber ?? undefined,
            });
            dispatch(
              appendBid(
                reduxSafeBid({
                  nounId: Number(nounId),
                  sender: sender as Address,
                  value: Number(value),
                  extended: extended !== undefined,
                  transactionHash: log.transactionHash ?? '',
                  transactionIndex: log.transactionIndex ?? 0,
                  timestamp: block.timestamp,
                }),
              ),
            );
            break;
          }
          case 'AuctionBidWithClientId': {
            // Emitted alongside AuctionBid — attach the clientId to the bid
            // already appended above, matched by nounId + value.
            const { nounId, value, clientId } = log.args;
            if (nounId == null || value == null || clientId == null) break;
            dispatch(
              setBidClientId({
                nounId: Number(nounId),
                value: value.toString(),
                clientId: Number(clientId),
              }),
            );
            break;
          }
          case 'AuctionCreated': {
            const { startTime, endTime, nounId } = log.args;
            dispatch(
              setActiveAuction(
                reduxSafeNewAuction({
                  nounId: Number(nounId),
                  startTime: Number(startTime),
                  endTime: Number(endTime),
                  settled: false,
                }),
              ),
            );
            const nounIdNumber = Number(nounId);
            window.location.href = nounPath(nounIdNumber);
            dispatch(setOnDisplayAuctionNounId(nounIdNumber));
            dispatch(setLastAuctionNounId(nounIdNumber));
            break;
          }
          case 'AuctionExtended': {
            const { endTime, nounId } = log.args;
            dispatch(
              setAuctionExtended({
                nounId: Number(nounId),
                endTime: Number(endTime),
              }),
            );
            break;
          }
          case 'AuctionSettled': {
            // Reserve-not-met settlements emit winner=0x0000...0000 &
            // amount=0. The slice reducer normalizes the zero-address winner
            // to undefined so renderers can branch on `!bidder`.
            const { amount, winner, nounId } = log.args;
            dispatch(
              setAuctionSettled({
                nounId: Number(nounId),
                amount: Number(amount),
                winner: winner as Address,
              }),
            );
            break;
          }
        }
      }
    },
  });

  return <></>;
};

const PastAuctions: React.FC = () => {
  const latestAuctionId = useAppSelector(state => state.onDisplayAuction.lastAuctionNounId);

  const { data: auctions } = useQuery({
    queryKey: ['latestAuctions'],
    queryFn: async () => {
      const { query, variables } = latestAuctionsQuery(1000);
      const result = await execute<{
        auctions: {
          items: Array<{
            nounId: string;
            amount: string;
            settled: boolean;
            winner: string | null;
            startTime: string;
            endTime: string;
            clientId: number | null;
            noun: { id: string; owner: string } | null;
            bids: {
              items: Array<{
                value: string;
                bidder: string;
                clientId: number | null;
                createdAtBlock: string;
                createdAt: string;
                createdAtTransaction: string;
              }>;
            };
          }>;
        };
      }>(query, variables);
      return result?.auctions?.items ?? [];
    },
  });

  const dispatch = useAppDispatch();

  useEffect(() => {
    if (auctions) {
      dispatch(addPastAuctions(auctions));
    }
  }, [auctions, latestAuctionId, dispatch]);

  return <></>;
};

/**
 * Fills in auction data for a single noun on-demand when it's outside the
 * latestAuctionsQuery(1000) window — e.g. Noun #1 once we're past Noun ~1870.
 * Watches the currently-displayed nounId and fetches only if not already in
 * the past-auctions cache (and not the live auction).
 */
const MissingAuctionFetcher: React.FC = () => {
  const dispatch = useAppDispatch();
  const onDisplayAuctionNounId = useAppSelector(
    state => state.onDisplayAuction.onDisplayAuctionNounId,
  );
  const lastAuctionNounId = useAppSelector(state => state.onDisplayAuction.lastAuctionNounId);
  const pastAuctions = useAppSelector(state => state.pastAuctions.pastAuctions);

  const needsFetch =
    onDisplayAuctionNounId != null &&
    lastAuctionNounId != null &&
    onDisplayAuctionNounId !== Number(lastAuctionNounId) &&
    !pastAuctions.some(
      a => a.activeAuction != null && Number(a.activeAuction.nounId) === onDisplayAuctionNounId,
    );

  const { data: fetchedAuction } = useQuery({
    queryKey: ['singleAuction', onDisplayAuctionNounId],
    enabled: needsFetch,
    staleTime: Infinity, // settled auctions are immutable
    queryFn: async () => {
      if (onDisplayAuctionNounId == null) return null;
      const { query, variables } = singleAuctionQuery(String(onDisplayAuctionNounId));
      const result = await execute<{
        auctions: {
          items: Array<{
            nounId: string;
            amount: string;
            settled: boolean;
            winner: string | null;
            startTime: string;
            endTime: string;
            clientId: number | null;
            noun: { id: string; owner: string } | null;
            bids: {
              items: Array<{
                value: string;
                bidder: string;
                clientId: number | null;
                createdAtBlock: string;
                createdAt: string;
                createdAtTransaction: string;
              }>;
            };
          }>;
        };
      }>(query, variables);
      return result?.auctions?.items?.[0] ?? null;
    },
  });

  useEffect(() => {
    if (fetchedAuction) {
      dispatch(upsertPastAuction(fetchedAuction));
    }
  }, [fetchedAuction, dispatch]);

  return <></>;
};

createRoot(document.getElementById('root')!).render(
  <ThemeProvider attribute="class" defaultTheme="light" forcedTheme="light">
    <TooltipProvider delayDuration={0}>
      <ReduxProvider store={store}>
        <React.StrictMode>
          <WagmiProvider config={wagmiConfig}>
            <QueryClientProvider client={queryClient}>
              {import.meta.env.VITE_ENABLE_TANSTACK_QUERY_DEVTOOLS === 'true' && (
                <ReactQueryDevtools initialIsOpen={false} />
              )}
              <ChainSubscriber />
              <ApolloProvider client={client}>
                <PastAuctions />
                <MissingAuctionFetcher />
                <LanguageProvider>
                  <CustomConnectkitProvider>
                    <SiteThemeProvider>
                      <ErrorBoundary>
                        <App />
                      </ErrorBoundary>
                    </SiteThemeProvider>
                  </CustomConnectkitProvider>
                </LanguageProvider>
              </ApolloProvider>
            </QueryClientProvider>
          </WagmiProvider>
        </React.StrictMode>
      </ReduxProvider>
    </TooltipProvider>
  </ThemeProvider>,
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example, reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
