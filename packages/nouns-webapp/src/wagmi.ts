import { find, pipe } from 'remeda';
import { createConfig, http, fallback, webSocket } from 'wagmi';
import { mainnet, polygon, sepolia } from 'wagmi/chains';
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

// Free, no-key, CORS-enabled public RPCs. Ordered by observed reliability:
// fallback() tries the first; on failure (timeout / 429 / 5xx / CORS) it
// moves to the next. A real failure of all three means the chain is down.
//
// Endpoints we deliberately exclude:
//   - mainnet.infura.io  — keyed, free tier is too small and 402s once cap hits
//   - rpc.ankr.com/eth   — now requires a key for public access
//   - eth.llamarpc.com   — no CORS headers, every browser preflight fails
//   - cloudflare-eth.com — same CORS issue
//   - eth.drpc.org       — free tier rejects eth_getLogs (we need it for events)
//
// `rank` is deliberately off. `rank: true` fires continuous background
// sample requests at every transport to reorder them — that was itself a
// heavy source of 429s. Plain ordered fallback only touches a transport
// when a real request needs one.
//
// VITE_MAINNET_JSONRPC / VITE_SEPOLIA_JSONRPC override the primary if set
// (e.g. local dev hitting hardhat, or pasting in a key'd Alchemy URL).
const mainnetPrimary =
  (import.meta.env.VITE_MAINNET_JSONRPC as string) || 'https://ethereum-rpc.publicnode.com';
const sepoliaPrimary =
  (import.meta.env.VITE_SEPOLIA_JSONRPC as string) || 'https://ethereum-sepolia-rpc.publicnode.com';

const transports = {
  [mainnet.id]: fallback([
    http(mainnetPrimary, { timeout: HTTP_TIMEOUT }),
    // publicnode: first fallback — healthy + CORS-enabled again (verified
    // 2026-08-18; the July anon-403 episode has cleared). Critical because the
    // dRPC free plan 400s heavy calls (getLogs >10k blocks, batches >3), and
    // the two below are effectively dead: 1rpc.io is over its free-plan quota
    // and eth.merkle.io 429s browser CORS preflights. Kept at the tail anyway
    // in case they recover.
    http('https://ethereum-rpc.publicnode.com', { timeout: HTTP_TIMEOUT }),
    http('https://1rpc.io/eth', { timeout: HTTP_TIMEOUT }),
    http('https://eth.merkle.io', { timeout: HTTP_TIMEOUT }),
    ...(import.meta.env.VITE_MAINNET_WSRPC !== undefined
      ? [webSocket(import.meta.env.VITE_MAINNET_WSRPC)]
      : []),
  ]),
  [sepolia.id]: fallback([
    http(sepoliaPrimary, { timeout: HTTP_TIMEOUT }),
    http('https://1rpc.io/sepolia', { timeout: HTTP_TIMEOUT }),
    ...(import.meta.env.VITE_SEPOLIA_WSRPC !== undefined
      ? [webSocket(import.meta.env.VITE_SEPOLIA_WSRPC)]
      : []),
  ]),
  // Polygon is a secondary chain used only by the Borgs collection on /probe
  // (mint + breed txs). Reads go through the dedicated client in lib/borgs.ts.
  [polygon.id]: fallback([
    http('https://polygon-bor-rpc.publicnode.com', { timeout: HTTP_TIMEOUT }),
    http('https://polygon-rpc.com', { timeout: HTTP_TIMEOUT }),
    http('https://1rpc.io/matic', { timeout: HTTP_TIMEOUT }),
  ]),
};

export const config = createConfig({
  chains: [activeChain, polygon],
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
