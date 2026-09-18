import { createConfig, fallback, http } from '@wagmi/core';
import { mainnet } from '@wagmi/core/chains';

export default {
  baseUri: process.env.NEXT_PUBLIC_BASE_URI,
  mainnetBlockDurationSeconds: 12,
} as const;

// content/governance/proposals.mdx reads a dozen governance parameters over JSON-RPC while the page is
// statically generated. A single transport with viem's defaults means one slow public endpoint can hang the
// export past Next's per-page timeout (seen in CI against the chain default, eth.merkle.io). Mirror the
// webapp's setup instead: a fallback chain, a short per-request timeout so a dead endpoint fails over
// quickly, and JSON_RPC as an optional override at the front.
const HTTP_TIMEOUT = 10_000;
const rpcUrls = [
  ...(process.env.JSON_RPC ? [process.env.JSON_RPC] : []),
  'https://ethereum-rpc.publicnode.com',
  'https://1rpc.io/eth',
  'https://eth.merkle.io',
];

export const wagmiConfig = createConfig({
  chains: [mainnet],
  transports: {
    [mainnet.id]: fallback(rpcUrls.map(url => http(url, { timeout: HTTP_TIMEOUT }))),
  },
});
