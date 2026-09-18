import { useMemo } from 'react';

import { useReadContracts } from 'wagmi';

/**
 * Reads the Nouns treasury's liquid staking positions and, crucially, the exchange rate for each one.
 *
 * The SDK's `readNounsTreasuryBalancesInEth` returns balances but values wstETH 1:1 against ETH, which
 * understates it by roughly 20%. This hook reads `stEthPerToken()` and the equivalent for each other
 * token so the ETH figures here are correct.
 *
 * The rates are the same ones the `StakingRevenueOracle` in `nouns-contracts` reads, so this doubles as
 * the monitoring surface for Client Incentives V2: what the page shows accruing is what the oracle would
 * report as revenue.
 */

const TREASURY = '0xb1a32FC9F9D8b2cf86C068Cae13108809547ef71' as const;

const WSTETH = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0' as const;
const STETH = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84' as const;
const RETH = '0xae78736Cd615f374D3085123A210448E74Fc6393' as const;
const METH = '0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa' as const;
const METH_STAKING = '0xe3cBd06D7dadB3F4e6557bAb7EdD924CD1489E8f' as const;
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const;

const ONE = 10n ** 18n;

const balanceOfAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

const wstEthAbi = [
  {
    type: 'function',
    name: 'stEthPerToken',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const;

const rEthAbi = [
  {
    type: 'function',
    name: 'getExchangeRate',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const;

const mEthStakingAbi = [
  {
    type: 'function',
    name: 'mETHToETH',
    stateMutability: 'view',
    inputs: [{ name: 'mETHAmount', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

/** A liquid staking position, valued in ETH. */
export interface StakedPosition {
  /** Token symbol, e.g. "wstETH" */
  symbol: string;
  /** Raw token balance held by the treasury */
  balance: bigint;
  /** Wei of ETH one whole token is worth */
  rate: bigint;
  /** `balance` converted to ETH */
  valueInEth: bigint;
  /** Published APR for this token, as a fraction (0.03 = 3%) */
  apr: number;
}

export interface TreasuryStakingData {
  positions: StakedPosition[];
  /** Liquid, non-yield-bearing holdings, valued in ETH */
  liquid: { symbol: string; valueInEth: bigint }[];
  totalStakedEth: bigint;
  totalLiquidEth: bigint;
  /** Blended annual yield across all staked positions, in wei of ETH per year */
  annualYieldWei: bigint;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Published APRs, as fractions. These are not readable onchain in any cheap way — each protocol derives
 * them from historical rate movement — so they are constants that need periodic review. The staked
 * *balances* and *rates* below are live; only the APR is an assumption.
 */
export const PUBLISHED_APR: Record<string, number> = {
  stETH: 0.029,
  wstETH: 0.029,
  rETH: 0.027,
  mETH: 0.031,
};

export function useTreasuryStaking(): TreasuryStakingData {
  const { data, isLoading, isError } = useReadContracts({
    contracts: [
      { address: WSTETH, abi: balanceOfAbi, functionName: 'balanceOf', args: [TREASURY] },
      { address: STETH, abi: balanceOfAbi, functionName: 'balanceOf', args: [TREASURY] },
      { address: RETH, abi: balanceOfAbi, functionName: 'balanceOf', args: [TREASURY] },
      { address: METH, abi: balanceOfAbi, functionName: 'balanceOf', args: [TREASURY] },
      { address: WETH, abi: balanceOfAbi, functionName: 'balanceOf', args: [TREASURY] },
      { address: WSTETH, abi: wstEthAbi, functionName: 'stEthPerToken' },
      { address: RETH, abi: rEthAbi, functionName: 'getExchangeRate' },
      { address: METH_STAKING, abi: mEthStakingAbi, functionName: 'mETHToETH', args: [ONE] },
    ],
    query: {
      // Exchange rates move on the order of hours, so there is nothing to gain from refetching hard
      staleTime: 60_000,
      refetchInterval: 60_000,
    },
  });

  return useMemo(() => {
    const value = (i: number): bigint => {
      const r = data?.[i];
      return r && r.status === 'success' ? (r.result as bigint) : 0n;
    };

    const positions: StakedPosition[] = [
      { symbol: 'wstETH', balance: value(0), rate: value(5) },
      // stETH rebases, so one stETH is one ETH by construction and the yield shows up in the balance
      { symbol: 'stETH', balance: value(1), rate: ONE },
      { symbol: 'rETH', balance: value(2), rate: value(6) },
      { symbol: 'mETH', balance: value(3), rate: value(7) },
    ].map(p => ({
      ...p,
      valueInEth: (p.balance * p.rate) / ONE,
      apr: PUBLISHED_APR[p.symbol] ?? 0,
    }));

    const liquid = [{ symbol: 'wETH', valueInEth: value(4) }];

    const totalStakedEth = positions.reduce((sum, p) => sum + p.valueInEth, 0n);
    const totalLiquidEth = liquid.reduce((sum, l) => sum + l.valueInEth, 0n);

    // Weight each position's APR by its size. Done in basis points to stay in integer maths.
    const annualYieldWei = positions.reduce(
      (sum, p) => sum + (p.valueInEth * BigInt(Math.round(p.apr * 10_000))) / 10_000n,
      0n,
    );

    return {
      positions,
      liquid,
      totalStakedEth,
      totalLiquidEth,
      annualYieldWei,
      isLoading,
      isError,
    };
  }, [data, isLoading, isError]);
}
