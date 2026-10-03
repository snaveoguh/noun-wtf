import type { ProposalTransaction } from '@/wrappers/nounsDao';

import { encodeAbiParameters, encodeFunctionData, erc20Abi, parseEther } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import { ProposalActionType } from '@/components/ProposalActionsModal';
import { SupportedCurrency } from '@/components/ProposalActionsModal/steps/TransferFundsDetailsStep';
import { handleActionAdd } from '@/components/ProposalActionsModal/steps/TransferFundsReviewStep';
import { nounsPayerAddress, stEthAddress, usdcAddress } from '@/contracts';
import { defaultChain } from '@/wagmi';

import {
  findShortfalls,
  LIL_NOUNS_PAYER,
  hasDuplicatedSelector,
  selectorOf,
  sumRequested,
  TREASURY_ASSETS,
} from './lilNounsTreasury';

const chainId = defaultChain.id;
const TO = '0x1111111111111111111111111111111111111111' as const;
const args = (amount: bigint) =>
  encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [TO, amount]);

const transferTx = (token: `0x${string}`, amount: bigint): ProposalTransaction => ({
  address: token,
  value: 0n,
  signature: 'transfer(address,uint256)',
  calldata: args(amount),
});

describe('sumRequested', () => {
  it('sums ETH values and known-token transfers per asset', () => {
    const txs: ProposalTransaction[] = [
      { address: TO, value: parseEther('0.5'), signature: '', calldata: '0x' },
      transferTx(usdcAddress[chainId], 3_500_000_000n),
      transferTx(usdcAddress[chainId], 500_000_000n),
      transferTx(stEthAddress[chainId], parseEther('2')),
    ];
    expect(sumRequested(txs)).toEqual({
      ETH: parseEther('0.5'),
      USDC: 4_000_000_000n,
      stETH: parseEther('2'),
    });
  });

  it('ignores transfers on unknown tokens', () => {
    expect(sumRequested([transferTx(TO, 1n)])).toEqual({});
  });
});

describe('hasDuplicatedSelector', () => {
  it('flags selector-prefixed calldata when a signature is set', () => {
    const withSelector = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [TO, 1n],
    });
    expect(withSelector.startsWith(selectorOf('transfer(address,uint256)'))).toBe(true);
    expect(
      hasDuplicatedSelector({ signature: 'transfer(address,uint256)', calldata: withSelector }),
    ).toBe(true);
  });

  it('passes args-only calldata and signature-less calls', () => {
    expect(
      hasDuplicatedSelector({ signature: 'transfer(address,uint256)', calldata: args(1n) }),
    ).toBe(false);
    expect(hasDuplicatedSelector({ signature: '', calldata: '0xa9059cbb' })).toBe(false);
  });
});

describe('findShortfalls', () => {
  it('reports only assets requested beyond the balance', () => {
    const balances = { ETH: parseEther('0.7256'), USDC: 16_050_630_000n };
    const shorts = findShortfalls({ ETH: parseEther('1'), USDC: 3_500_000_000n }, balances);
    expect(shorts.map(s => s.asset.symbol)).toEqual(['ETH']);
  });

  it('is empty while balances are loading', () => {
    expect(findShortfalls({ ETH: 1n }, undefined)).toEqual([]);
  });
});

describe('TransferFunds handleActionAdd', () => {
  const state = (currency: SupportedCurrency, amount: string) => ({
    actionType: ProposalActionType.LUMP_SUM,
    address: TO,
    amount,
    TransferFundsCurrency: currency,
  });

  it('encodes stETH transfers as args-only calldata (no duplicated selector)', () => {
    const add = vi.fn();
    handleActionAdd(state(SupportedCurrency.STETH, '1.5'), add, 'nouns');
    const tx = add.mock.calls[0][0];
    expect(tx.address).toBe(stEthAddress[chainId]);
    expect(tx.calldata).toBe(args(parseEther('1.5')));
    expect(hasDuplicatedSelector(tx)).toBe(false);
  });

  it('USDC goes via each DAO payer; only Nouns gets a TokenBuyer top-up', () => {
    const lil = vi.fn();
    handleActionAdd(state(SupportedCurrency.USDC, '3500'), lil, 'lil-nouns');
    expect(lil.mock.calls[0][0]).toMatchObject({
      address: LIL_NOUNS_PAYER,
      signature: 'sendOrRegisterDebt(address,uint256)',
      calldata: args(3_500_000_000n),
    });
    expect(lil.mock.calls[0][0].usdcValue).toBeUndefined();
    expect(sumRequested([lil.mock.calls[0][0]])).toEqual({ USDC: 3_500_000_000n });

    const nouns = vi.fn();
    handleActionAdd(state(SupportedCurrency.USDC, '3500'), nouns, 'nouns');
    expect(nouns.mock.calls[0][0]).toMatchObject({
      address: nounsPayerAddress[chainId],
      signature: 'sendOrRegisterDebt(address,uint256)',
      calldata: args(3_500_000_000n),
      usdcValue: 3_500_000_000,
    });
  });

  it('every Lil treasury asset maps to a known currency', () => {
    expect(TREASURY_ASSETS.map(a => a.symbol)).toEqual(['ETH', 'USDC', 'stETH', 'WETH']);
  });
});
