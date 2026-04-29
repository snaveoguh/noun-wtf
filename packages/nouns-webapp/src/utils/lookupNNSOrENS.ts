import { parseAbiItem, PublicClient } from 'viem';

import { stripNoggles } from '@/utils/addressAndENSDisplayUtils';
import { Address } from '@/utils/types';

/**
 * Look up ENS name for an address.
 * Uses the ENS reverse resolver contract directly.
 *
 * Strips the `.noggles` suffix before returning so the UI never surfaces the
 * namespace (see `stripNoggles`).
 */
export async function lookupNNSOrENS(
  client: PublicClient,
  target: Address,
): Promise<string | null> {
  try {
    const name = await client.readContract({
      address: '0x849f92178950f6254db5d16d1ba265e70521ac1b',
      abi: [parseAbiItem('function resolve(address) view returns (string)')],
      functionName: 'resolve',
      args: [target],
    });
    if (!name) return null;
    const stripped = stripNoggles(name);
    return stripped || null;
  } catch {
    return null;
  }
}
