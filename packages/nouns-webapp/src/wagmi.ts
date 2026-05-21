import { find, pipe } from 'remeda';
import { createConfig, http, fallback, webSocket } from 'wagmi';
import { mainnet, sepolia } from 'wagmi/chains';
import { coinbaseWallet, injected, safe, walletConnect } from 'wagmi/connectors';

import { CHAIN_ID, WALLET_CONNECT_V2_PROJECT_ID } from './config';

const activeChainId = Number(CHAIN_ID);

const activeChain =
  pipe(
    [mainnet, sepolia],
    find(chain => chain.id === activeChainId),
  ) ?? sepolia;

// Per-transport timeout. wagmi's `fallback` waits for each transport to fail
// before rotating to the next; the default 60s would freeze the UI on a
// single stalled call. 5s is ample for an `eth_call` on a healthy RPC.
// HTTP stays ahead of WebSocket since the WS handshake can take 5–15s on a
// cold connect, which would block every read until it settles.
const HTTP_TIMEOUT = 5_000;

// Primary RPC: a keyed Infura endpoint when VITE_INFURA_KEY is set. Free
// public endpoints do not survive this app's load — eth.llamarpc.com and
// cloudflare-eth.com send no CORS headers (every browser request failed
// preflight), and drpc.org's free tier rejects eth_getLogs ("method is not
// available on freetier"). Infura serves the full method set over CORS.
// publicnode is the no-key fallback: it works and passes CORS, but 429s
// under sustained load, so it must never be the primary.
//
// `rank` is deliberately off. `rank: true` fires continuous background
// sample requests at every transport to reorder them — that was itself a
// heavy source of 429s. Plain ordered fallback only touches a transport
// when a real request needs one.
const infuraKey = import.meta.env.VITE_INFURA_KEY as string;
const mainnetPrimary =
  (import.meta.env.VITE_MAINNET_JSONRPC as string) ||
  (infuraKey ? `https://mainnet.infura.io/v3/${infuraKey}` : 'https://ethereum-rpc.publicnode.com');
const sepoliaPrimary =
  (import.meta.env.VITE_SEPOLIA_JSONRPC as string) ||
  (infuraKey
    ? `https://sepolia.infura.io/v3/${infuraKey}`
    : 'https://ethereum-sepolia-rpc.publicnode.com');

const transports = {
  [mainnet.id]: fallback([
    http(mainnetPrimary, { timeout: HTTP_TIMEOUT }),
    http('https://ethereum-rpc.publicnode.com', { timeout: HTTP_TIMEOUT }),
    ...(import.meta.env.VITE_MAINNET_WSRPC !== undefined
      ? [webSocket(import.meta.env.VITE_MAINNET_WSRPC)]
      : []),
  ]),
  [sepolia.id]: fallback([
    http(sepoliaPrimary, { timeout: HTTP_TIMEOUT }),
    ...(import.meta.env.VITE_SEPOLIA_WSRPC !== undefined
      ? [webSocket(import.meta.env.VITE_SEPOLIA_WSRPC)]
      : []),
  ]),
};

export const config = createConfig({
  chains: [activeChain],
  transports,
  // Poll cadence for every wagmi watcher. Default 4s; with five auction
  // event watchers that was a continuous getLogs drain. 12s matches the
  // app's other intervals and is fine for a daily auction.
  pollingInterval: 12_000,
  connectors: [
    injected(),
    walletConnect({
      projectId: WALLET_CONNECT_V2_PROJECT_ID,
      showQrModal: false,
    }),
    coinbaseWallet({
      appName: 'Nouns.WTF',
      appLogoUrl: 'https://nouns.wtf/static/media/logo.cdea1650.svg',
    }),
    safe(),
  ],
});

export const defaultChain = activeChain;

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
