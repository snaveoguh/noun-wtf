import type { Address } from './utils/types';

import React, { useEffect } from 'react';

import { ApolloProvider } from '@apollo/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { createRoot } from 'react-dom/client';
import { Provider as ReduxProvider } from 'react-redux';
import { parseAbiItem } from 'viem';
import { hardhat } from 'viem/chains';
import { usePublicClient, WagmiProvider } from 'wagmi';

import { CustomConnectkitProvider } from '@/components/CustomConnectkitProvider';
import { ThemeProvider } from '@/components/ThemeProvider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { store } from '@/store';
import { execute } from '@/subgraphs/execute';

import { SiteThemeProvider } from '@/contexts/SiteThemeContext';

import App from './App';
import config, { CHAIN_ID } from './config';
import {
  nounsAuctionHouseAddress,
  useReadNounsAuctionHouseAuction,
  useWatchNounsAuctionHouseAuctionBidEvent,
  useWatchNounsAuctionHouseAuctionBidWithClientIdEvent,
  useWatchNounsAuctionHouseAuctionCreatedEvent,
  useWatchNounsAuctionHouseAuctionExtendedEvent,
  useWatchNounsAuctionHouseAuctionSettledEvent,
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

const queryClient = new QueryClient();

/** Catch React render errors so the whole page doesn't go white */
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, fontFamily: 'monospace' }}>
          <h2>Something went wrong</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#c00' }}>
            {this.state.error.message}
          </pre>
          <button onClick={() => window.location.reload()}>Reload</button>
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

      for (const {
        args: { extended, nounId, sender, value },
        blockNumber,
        transactionHash,
        transactionIndex,
      } of logs) {
        const block = await publicClient.getBlock({
          blockNumber: blockNumber ?? undefined,
        });
        const timestamp = block.timestamp;

        dispatch(
          appendBid(
            reduxSafeBid({
              nounId: Number(nounId),
              sender: sender as Address,
              value: Number(value),
              extended: extended !== undefined,
              transactionHash: transactionHash ?? '',
              transactionIndex: transactionIndex ?? 0,
              timestamp,
            }),
          ),
        );
      }
      } catch (err) {
        console.error('[ChainSubscriber] Failed to fetch recent bids:', err);
      }
    })();
  }, [chainId, dispatch, publicClient]);

  // Watch for new bids
  useWatchNounsAuctionHouseAuctionBidEvent({
    onLogs: async logs => {
      for (const {
        args: { extended, nounId, sender, value },
        blockNumber,
        transactionHash,
        transactionIndex,
      } of logs) {
        const block = await publicClient.getBlock({
          blockNumber: blockNumber ?? undefined,
        });
        const timestamp = block.timestamp;

        dispatch(
          appendBid(
            reduxSafeBid({
              nounId: Number(nounId),
              sender: sender as Address,
              value: Number(value),
              extended: extended !== undefined,
              transactionHash: transactionHash ?? '',
              transactionIndex: transactionIndex ?? 0,
              timestamp,
            }),
          ),
        );
      }
    },
  });

  // Watch for new auction creation events
  useWatchNounsAuctionHouseAuctionCreatedEvent({
    onLogs: logs => {
      for (const log of logs) {
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
      }
    },
  });

  // Watch for AuctionBidWithClientId (emitted alongside AuctionBid). Attach
  // the clientId to the bid already appended above, matched by nounId + value.
  useWatchNounsAuctionHouseAuctionBidWithClientIdEvent({
    onLogs: logs => {
      for (const {
        args: { nounId, value, clientId },
      } of logs) {
        if (nounId == null || value == null || clientId == null) continue;
        dispatch(
          setBidClientId({
            nounId: Number(nounId),
            value: value.toString(),
            clientId: Number(clientId),
          }),
        );
      }
    },
  });

  // Watch for new auction extended events
  useWatchNounsAuctionHouseAuctionExtendedEvent({
    onLogs: logs => {
      for (const log of logs) {
        const { endTime, nounId } = log.args;
        dispatch(
          setAuctionExtended({
            nounId: Number(nounId),
            endTime: Number(endTime),
          }),
        );
      }
    },
  });

  // Watch for auction settlement events
  useWatchNounsAuctionHouseAuctionSettledEvent({
    onLogs: logs => {
      for (const log of logs) {
        const { amount, winner, nounId } = log.args;
        // Reserve-not-met settlements emit winner=0x0000...0000 & amount=0.
        // The slice reducer will normalize the zero-address winner to
        // undefined so downstream renderers can branch on `!bidder`.
        dispatch(
          setAuctionSettled({
            nounId: Number(nounId),
            amount: Number(amount),
            winner: winner as Address,
          }),
        );
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
