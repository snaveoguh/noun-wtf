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

// Transport order matters for cold-start latency. wagmi's `fallback` waits
// for each transport to fail (or hang past its timeout) before trying the
// next, so the first entry needs to resolve fast. WebSocket setup to
// publicnode regularly takes 5–15s on first connect, which would block every
// `useReadContract` / `useBlock` call on the page until the WS handshake
// completes — manifesting as the crystal-ball orb stuck on "SCRYING…".
//
// HTTP transports respond on the first request, so we put them first and
// keep WebSocket as a secondary option (still useful for `watch: true`
// subscriptions once the page has settled).
// Multiple HTTP fallbacks with explicit per-transport timeouts.
//
// wagmi's `fallback` waits for each transport to fail before rotating to
// the next. The default per-transport timeout is 60s (!), so a single
// stalled publicnode call would lock the crystal-ball orb for a full
// minute before falling through to llamarpc. 5s is plenty for an
// `eth_call` / `eth_getBlockByNumber` on a healthy RPC; if it doesn't
// respond in 5s, treat it as failed and try the next transport.
//
// `rank: true` lets wagmi periodically reorder transports by latency so
// the fastest one floats to the top automatically.
const HTTP_TIMEOUT = 5_000;
const transports = {
  [mainnet.id]: fallback(
    [
      ...(import.meta.env.VITE_MAINNET_JSONRPC !== undefined
        ? [http(import.meta.env.VITE_MAINNET_JSONRPC, { timeout: HTTP_TIMEOUT })]
        : []),
      http('https://eth.llamarpc.com', { timeout: HTTP_TIMEOUT }),
      http('https://cloudflare-eth.com', { timeout: HTTP_TIMEOUT }),
      http('https://ethereum-rpc.publicnode.com', { timeout: HTTP_TIMEOUT }),
      ...(import.meta.env.VITE_MAINNET_WSRPC !== undefined
        ? [webSocket(import.meta.env.VITE_MAINNET_WSRPC)]
        : []),
    ],
    { rank: true },
  ),
  [sepolia.id]: fallback(
    [
      ...(import.meta.env.VITE_SEPOLIA_JSONRPC !== undefined
        ? [http(import.meta.env.VITE_SEPOLIA_JSONRPC, { timeout: HTTP_TIMEOUT })]
        : []),
      http('https://ethereum-sepolia-rpc.publicnode.com', { timeout: HTTP_TIMEOUT }),
      ...(import.meta.env.VITE_SEPOLIA_WSRPC !== undefined
        ? [webSocket(import.meta.env.VITE_SEPOLIA_WSRPC)]
        : []),
    ],
    { rank: true },
  ),
};

export const config = createConfig({
  chains: [activeChain],
  transports,
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
