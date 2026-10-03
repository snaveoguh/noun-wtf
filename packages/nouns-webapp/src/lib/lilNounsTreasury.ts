import type { ProposalTransaction } from '@/wrappers/nounsDao';
import type { Address } from 'viem';

import { decodeAbiParameters, erc20Abi, keccak256, stringToBytes } from 'viem';
import { useBalance, useReadContract, useReadContracts } from 'wagmi';

import { stEthAddress, usdcAddress, wethAddress } from '@/contracts';
import { LIL_NOUNS_GOVERNOR, LIL_NOUNS_GOVERNOR_ABI } from '@/lib/marketplace/governance';
import { defaultChain } from '@/wagmi';

/**
 * Assets the Lil Nouns treasury can pay out from a draft. ETH is the native
 * balance; the rest are plain ERC20 `transfer`s executed by the treasury
 * (Lil Nouns has no payer / token buyer like Nouns DAO does).
 */
export type TreasuryAssetSymbol = 'ETH' | 'USDC' | 'stETH' | 'WETH';

export interface TreasuryAsset {
  symbol: TreasuryAssetSymbol;
  decimals: number;
  /** Token contract; null for native ETH. */
  address: Address | null;
}

const chainId = defaultChain.id;

export const TREASURY_ASSETS: readonly TreasuryAsset[] = [
  { symbol: 'ETH', decimals: 18, address: null },
  { symbol: 'USDC', decimals: 6, address: usdcAddress[chainId] },
  { symbol: 'stETH', decimals: 18, address: stEthAddress[chainId] },
  { symbol: 'WETH', decimals: 18, address: wethAddress[chainId] },
];

const ERC20_TOKENS = TREASURY_ASSETS.filter(
  (a): a is TreasuryAsset & { address: Address } => a.address !== null,
);

export type AssetAmounts = Partial<Record<TreasuryAssetSymbol, bigint>>;

/**
 * Live Lil Nouns treasury balances. The treasury (timelock) address is read
 * from the governor rather than hardcoded. Everything is gated on `enabled`
 * so Nouns drafts never hit these contracts.
 */
export function useLilNounsTreasury(enabled: boolean): {
  treasury: Address | undefined;
  balances: AssetAmounts | undefined;
} {
  const { data: treasury } = useReadContract({
    address: LIL_NOUNS_GOVERNOR,
    abi: LIL_NOUNS_GOVERNOR_ABI,
    functionName: 'timelock',
    query: { enabled },
  });
  const ready = enabled && treasury !== undefined;

  const { data: eth } = useBalance({ address: treasury, query: { enabled: ready } });
  const { data: tokens } = useReadContracts({
    contracts: ERC20_TOKENS.map(t => ({
      address: t.address,
      abi: erc20Abi,
      functionName: 'balanceOf' as const,
      args: [treasury ?? '0x0000000000000000000000000000000000000000'] as const,
    })),
    query: { enabled: ready },
  });

  if (!ready || eth === undefined || tokens === undefined) return { treasury, balances: undefined };
  const balances: AssetAmounts = { ETH: eth.value };
  ERC20_TOKENS.forEach((t, i) => {
    const r = tokens[i];
    if (r?.status === 'success') balances[t.symbol] = r.result;
  });
  return { treasury, balances };
}

const TRANSFER_SIG = 'transfer(address,uint256)';

/** First 4 bytes of keccak(signature), as `0x`-prefixed lowercase hex. */
export function selectorOf(signature: string): string {
  return keccak256(stringToBytes(signature)).slice(0, 10).toLowerCase();
}

/**
 * True when `calldata` already starts with the selector for `signature`. The
 * timelock prepends that selector itself whenever `signature` is set, so the
 * call would carry it twice and revert at execution.
 */
export function hasDuplicatedSelector(tx: Pick<ProposalTransaction, 'signature' | 'calldata'>) {
  if (!tx.signature) return false;
  const data = tx.calldata.toLowerCase();
  // Args-only calldata is a multiple of 32 bytes; selector-prefixed is 4 more.
  return (data.length - 2) % 64 === 8 && data.startsWith(selectorOf(tx.signature));
}

/**
 * Sum what a set of proposal transactions asks the treasury to pay out, per
 * asset: ETH attached as `value` on any action, plus ERC20 `transfer`s on the
 * known token contracts. Anything else (function calls, streams) isn't
 * counted, so this is a lower bound.
 */
export function sumRequested(txs: readonly ProposalTransaction[]): AssetAmounts {
  const out: AssetAmounts = {};
  const add = (sym: TreasuryAssetSymbol, amt: bigint) => {
    out[sym] = (out[sym] ?? 0n) + amt;
  };
  for (const tx of txs) {
    if (tx.value !== undefined && tx.value > 0n) add('ETH', tx.value);
    if (tx.signature !== TRANSFER_SIG) continue;
    const token = ERC20_TOKENS.find(t => t.address.toLowerCase() === tx.address.toLowerCase());
    if (token === undefined) continue;
    const args = hasDuplicatedSelector(tx) ? `0x${tx.calldata.slice(10)}` : tx.calldata;
    try {
      const [, amount] = decodeAbiParameters(
        [{ type: 'address' }, { type: 'uint256' }],
        args as `0x${string}`,
      );
      add(token.symbol, amount);
    } catch {
      // Malformed calldata: leave it to the duplicated-selector / review checks.
    }
  }
  return out;
}

/** Assets where the request exceeds a known balance. */
export function findShortfalls(requested: AssetAmounts, balances: AssetAmounts | undefined) {
  if (balances === undefined) return [];
  return TREASURY_ASSETS.flatMap(a => {
    const want = requested[a.symbol] ?? 0n;
    const have = balances[a.symbol];
    return want > 0n && have !== undefined && want > have ? [{ asset: a, want, have }] : [];
  });
}

export function formatAssetAmount(amount: bigint, asset: TreasuryAsset): string {
  const n = Number(amount) / 10 ** asset.decimals;
  return n.toLocaleString(undefined, {
    maximumFractionDigits: asset.decimals === 6 ? 2 : 4,
    minimumFractionDigits: asset.decimals === 6 ? 2 : 0,
  });
}
