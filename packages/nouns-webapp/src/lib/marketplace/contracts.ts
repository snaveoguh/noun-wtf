/**
 * Prediction market + marketplace contract ABIs, addresses, and chain config.
 * Consolidated from pooter.world's contracts.ts for the noun.wtf migration.
 */

import type { Address } from 'viem';

// ── Chain config ───────────────────────────────────────────────────────────

export const CONTRACTS_CHAIN_ID = Number(
  (import.meta.env.VITE_CONTRACTS_CHAIN_ID as string | undefined) ?? '1',
) as 1 | 11155111;

export const PREDICTION_MARKET_CHAIN_ID = Number(
  (import.meta.env.VITE_PREDICTION_MARKET_CHAIN_ID as string | undefined) ??
    (import.meta.env.VITE_CONTRACTS_CHAIN_ID as string | undefined) ??
    '1',
) as 1 | 11155111;

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

// ── Addresses ──────────────────────────────────────────────────────────────

export const NOUNS_TOKEN_ADDRESS = ((import.meta.env.VITE_NOUNS_TOKEN_ADDRESS as
  | string
  | undefined) ?? '0x9C8fF314C9Bc7F6e59A9d9225Fb22946427eDC03') as Address;

export const PREDICTION_MARKET_ADDRESS = ((import.meta.env.VITE_PREDICTION_MARKET_ADDRESS as
  | string
  | undefined) ?? '0x2ea7502C4db5B8cfB329d8a9866EB6705b036608') as Address;

// ── Prediction Market ABI ──────────────────────────────────────────────────

export const PREDICTION_MARKET_ABI = [
  {
    type: 'function',
    name: 'isDaoResolvable',
    inputs: [{ name: 'dao', type: 'string' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'createMarket',
    inputs: [
      { name: 'dao', type: 'string' },
      { name: 'proposalId', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'resolve',
    inputs: [
      { name: 'dao', type: 'string' },
      { name: 'proposalId', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'ownerResolve',
    inputs: [
      { name: 'dao', type: 'string' },
      { name: 'proposalId', type: 'string' },
      { name: 'outcome', type: 'uint8' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'stake',
    inputs: [
      { name: 'dao', type: 'string' },
      { name: 'proposalId', type: 'string' },
      { name: 'isFor', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'claim',
    inputs: [
      { name: 'dao', type: 'string' },
      { name: 'proposalId', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getMarket',
    inputs: [
      { name: 'dao', type: 'string' },
      { name: 'proposalId', type: 'string' },
    ],
    outputs: [
      { name: 'forPool', type: 'uint256' },
      { name: 'againstPool', type: 'uint256' },
      { name: 'forStakers', type: 'uint256' },
      { name: 'againstStakers', type: 'uint256' },
      { name: 'forOddsBps', type: 'uint256' },
      { name: 'againstOddsBps', type: 'uint256' },
      { name: 'outcome', type: 'uint8' },
      { name: 'exists', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getPosition',
    inputs: [
      { name: 'dao', type: 'string' },
      { name: 'proposalId', type: 'string' },
      { name: 'user', type: 'address' },
    ],
    outputs: [
      { name: 'forStake', type: 'uint256' },
      { name: 'againstStake', type: 'uint256' },
      { name: 'claimed', type: 'bool' },
    ],
    stateMutability: 'view',
  },
] as const;

// ── Auction Price Prediction Market ────────────────────────────────────────

export const AUCTION_PRICE_MARKET_ADDRESS = ((import.meta.env.VITE_AUCTION_PRICE_MARKET_ADDRESS as
  | string
  | undefined) ?? '0x0000000000000000000000000000000000000000') as Address;

export const AUCTION_PRICE_MARKET_ABI = [
  {
    type: 'function',
    name: 'createMarket',
    inputs: [{ name: 'nounId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'stake',
    inputs: [
      { name: 'nounId', type: 'uint256' },
      { name: 'isHigher', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'resolve',
    inputs: [{ name: 'nounId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'claim',
    inputs: [{ name: 'nounId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getMarket',
    inputs: [{ name: 'nounId', type: 'uint256' }],
    outputs: [
      { name: 'higherPool', type: 'uint256' },
      { name: 'lowerPool', type: 'uint256' },
      { name: 'higherStakers', type: 'uint256' },
      { name: 'lowerStakers', type: 'uint256' },
      { name: 'higherOddsBps', type: 'uint256' },
      { name: 'lowerOddsBps', type: 'uint256' },
      { name: 'outcome', type: 'uint8' },
      { name: 'priceWei', type: 'uint256' },
      { name: 'avgWei', type: 'uint256' },
      { name: 'feeBps', type: 'uint16' },
      { name: 'exists', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getPosition',
    inputs: [
      { name: 'nounId', type: 'uint256' },
      { name: 'user', type: 'address' },
    ],
    outputs: [
      { name: 'higherStake', type: 'uint256' },
      { name: 'lowerStake', type: 'uint256' },
      { name: 'claimed', type: 'bool' },
    ],
    stateMutability: 'view',
  },
] as const;
