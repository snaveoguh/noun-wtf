import { useMemo } from 'react';

import {
  NOUNV2_AUCTION_HOUSE_ADDRESS,
  nounV2AuctionHouseAbi,
} from '@/contracts/nounv2-auction-house';
import { NOUNV2_TOKEN_ADDRESS, nounV2TokenAbi } from '@/contracts/nounv2-token';
import { NOUNV2_TREASURY_ADDRESS } from '@/contracts/nounv2-treasury';
import {
  nounsAuctionHouseAbi,
  nounsAuctionHouseAddress,
  nounsTokenAbi,
  nounsTokenAddress,
} from '@/contracts';
import { nounsTreasuryAddress } from '@/contracts/nouns-treasury.gen';
import { defaultChain } from '@/wagmi';

import useActiveDao, { ActiveDao } from './useActiveDao';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export type DaoContext = {
  /** Which DAO is currently active. */
  dao: ActiveDao;
  /** True when `dao === 'nounv2'`. Shortcut for branching. */
  isV2: boolean;
  /**
   * Whether the required addresses for the active DAO are configured. When
   * `false` the on-chain hooks should short-circuit — contracts aren't
   * deployed yet so reads/writes would target the zero address.
   */
  isConfigured: boolean;
  /** Auction house contract for the active DAO. */
  auctionHouseAddress: `0x${string}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  auctionHouseAbi: any;
  /** Noun token contract for the active DAO. */
  tokenAddress: `0x${string}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tokenAbi: any;
  /** Treasury contract for the active DAO. */
  treasuryAddress: `0x${string}`;
};

/**
 * Returns contract addresses/abis for the active DAO (`?dao=` toggle).
 *
 * Decouples every Auction-related component from hardcoded mainnet Nouns
 * contracts — pass the result through the bid form, settle button, and
 * seed loader so they target the correct chain/contract pair.
 *
 * NOTE: This is a plain React hook — NO wagmi hooks are called here, so
 * the hook is safe to import from any component regardless of whether
 * WagmiProvider has mounted yet.
 */
export default function useDaoContext(): DaoContext {
  const { activeDao } = useActiveDao();

  return useMemo(() => {
    if (activeDao === 'nounv2') {
      const isConfigured =
        NOUNV2_AUCTION_HOUSE_ADDRESS !== ZERO_ADDRESS &&
        NOUNV2_TOKEN_ADDRESS !== ZERO_ADDRESS;
      return {
        dao: 'nounv2' as const,
        isV2: true,
        isConfigured,
        auctionHouseAddress: NOUNV2_AUCTION_HOUSE_ADDRESS,
        auctionHouseAbi: nounV2AuctionHouseAbi,
        tokenAddress: NOUNV2_TOKEN_ADDRESS,
        tokenAbi: nounV2TokenAbi,
        treasuryAddress: NOUNV2_TREASURY_ADDRESS,
      };
    }

    const chainId = defaultChain.id as keyof typeof nounsAuctionHouseAddress;
    return {
      dao: 'nouns' as const,
      isV2: false,
      isConfigured: true,
      auctionHouseAddress: nounsAuctionHouseAddress[chainId] as `0x${string}`,
      auctionHouseAbi: nounsAuctionHouseAbi,
      tokenAddress: nounsTokenAddress[chainId] as `0x${string}`,
      tokenAbi: nounsTokenAbi,
      treasuryAddress: nounsTreasuryAddress[chainId] as `0x${string}`,
    };
  }, [activeDao]);
}
