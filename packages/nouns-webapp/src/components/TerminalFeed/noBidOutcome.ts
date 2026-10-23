import type { getPublicClient } from '@wagmi/core';

import { BaseError, ContractFunctionRevertedError } from 'viem';

import { nounsTokenAbi } from '@/contracts';

type Client = NonNullable<ReturnType<typeof getPublicClient>>;

const ZERO = '0x0000000000000000000000000000000000000000';

/**
 * A V1 no-bid settle emits `winner = 0x000…0` on chain for both outcomes:
 * the V4 AuctionHouse sends the noun to the nouns.eth treasury, pre-V4 burned
 * it. The feed's settle describer reads a raw zero winner as a burn, so the
 * V1 chain fallback must say which one happened. Mirrors the indexer
 * (nouns-api/src/NounsAuctionHouseV2.ts): burned only if `ownerOf` reverts.
 * (NounV2 always burns a no-bid noun, so v2ChainFallback doesn't need this.)
 *
 * Any other failure (RPC flake) counts as treasury — V4 never burns.
 *
 * Returns the flags to merge into the event's data, or {} for a normal win.
 */
export async function noBidFlags(
  client: Client,
  token: `0x${string}`,
  nounId: bigint,
  winner: string | undefined,
  amount: bigint | undefined,
): Promise<{ treasury: true } | { burned: true } | Record<string, never>> {
  if ((amount ?? 0n) !== 0n || (winner ?? ZERO).toLowerCase() !== ZERO) return {};
  try {
    await client.readContract({
      address: token,
      abi: nounsTokenAbi,
      functionName: 'ownerOf',
      args: [nounId],
    });
    return { treasury: true };
  } catch (err) {
    const reverted =
      err instanceof BaseError && err.walk(e => e instanceof ContractFunctionRevertedError) != null;
    return reverted ? { burned: true } : { treasury: true };
  }
}
