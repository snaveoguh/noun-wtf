import type { getPublicClient } from '@wagmi/core';

import { BaseError, ContractFunctionRevertedError, parseAbi } from 'viem';

type Client = NonNullable<ReturnType<typeof getPublicClient>>;

const ownerOfAbi = parseAbi(['function ownerOf(uint256) view returns (address)']);
const ZERO = '0x0000000000000000000000000000000000000000';

/**
 * A no-bid settle emits `winner = 0x000…0` on chain for both outcomes: V4
 * (and the NounV2 AuctionHouse) send the noun to the treasury, pre-V4 burned
 * it. The feed's settle describer reads a raw zero winner as a burn, so the
 * chain fallbacks must say which one happened. Mirrors the indexer
 * (nouns-api/src/NounsAuctionHouseV2.ts): burned only if `ownerOf` reverts.
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
      abi: ownerOfAbi,
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
