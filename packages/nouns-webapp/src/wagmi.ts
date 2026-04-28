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
// Multiple HTTP fallbacks — wagmi rotates to the next one on
// timeout/rate-limit (429). Single-endpoint fallbacks (the previous setup)
// meant a slow publicnode = stuck crystal-ball orb. llamarpc + cloudflare
// are both unauthenticated, generally faster + more permissive than
// publicnode; we keep publicnode as the third option to preserve any
// existing rate-limit budget instead of hammering one host.
const transports = {
  [mainnet.id]: fallback([
    ...(import.meta.env.VITE_MAINNET_JSONRPC !== undefined
      ? [http(import.meta.env.VITE_MAINNET_JSONRPC)]
      : []),
    http('https://eth.llamarpc.com'),
    http('https://cloudflare-eth.com'),
    http('https://ethereum-rpc.publicnode.com'),
    ...(import.meta.env.VITE_MAINNET_WSRPC !== undefined
      ? [webSocket(import.meta.env.VITE_MAINNET_WSRPC)]
      : []),
  ]),
  [sepolia.id]: fallback([
    ...(import.meta.env.VITE_SEPOLIA_JSONRPC !== undefined
      ? [http(import.meta.env.VITE_SEPOLIA_JSONRPC)]
      : []),
    http('https://ethereum-sepolia-rpc.publicnode.com'),
    ...(import.meta.env.VITE_SEPOLIA_WSRPC !== undefined
      ? [webSocket(import.meta.env.VITE_SEPOLIA_WSRPC)]
      : []),
  ]),
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
