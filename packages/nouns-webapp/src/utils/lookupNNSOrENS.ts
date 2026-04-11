import { parseAbiItem, PublicClient } from 'viem';

import { Address } from '@/utils/types';

/**
 * Look up ENS name for an address.
 * Uses the ENS reverse resolver contract directly.
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
    return name || null;
  } catch {
    return null;
  }
}
