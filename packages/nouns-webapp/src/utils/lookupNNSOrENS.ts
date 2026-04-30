import { PublicClient } from 'viem';

import { isNogglesName } from '@/utils/addressAndENSDisplayUtils';
import { Address } from '@/utils/types';

/**
 * Reverse-resolve an address to its primary ENS name. NNS (the noggles
 * naming service at `0x849f9217…`) was previously queried first; it is now
 * skipped entirely since the project was rugged. Names already published in
 * the noggles namespace are filtered out as a safety net.
 *
 * Function name kept for backwards compat with existing call sites.
 */
export async function lookupNNSOrENS(
  client: PublicClient,
  target: Address,
): Promise<string | null> {
  try {
    const name = await client.getEnsName({ address: target });
    if (!name || isNogglesName(name)) return null;
    return name;
  } catch {
    return null;
  }
}
