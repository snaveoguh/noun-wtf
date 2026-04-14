/**
 * Read-only viem client for Base chain.
 * Used for Yellow Collective token/proposal reads — NOT added to wagmi config.
 */
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

export const baseClient = createPublicClient({
  chain: base,
  transport: http(
    (import.meta.env.VITE_BASE_JSONRPC as string | undefined) ?? 'https://base.llamarpc.com',
  ),
});
