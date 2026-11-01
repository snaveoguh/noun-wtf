// NounWorldLedger on Base: kinds, ABI and where it's deployed.
// Source of truth: packages/noun-world-chain (Foundry). Keep this ABI in step.

import type { Address } from 'viem';

export const KIND = { graffiti: 1, records: 2 } as const;
export type SnapshotKind = keyof typeof KIND;
export const KIND_NAME: Record<number, SnapshotKind> = { 1: 'graffiti', 2: 'records' };

export const BASE_CHAIN_ID = 8453;
export const BASE_SEPOLIA_CHAIN_ID = 84532;

/**
 * Deployed ledgers by chain. Empty until the owner deploys (see the
 * noun-world-chain README); `VITE_LEDGER_ADDRESS` / `VITE_LEDGER_CHAIN_ID`
 * override it for the page, `LEDGER_ADDRESS` / `LEDGER_CHAIN_ID` for the job.
 */
export const LEDGER_DEPLOYMENTS: Partial<Record<number, Address>> = {};

export const PUBLIC_RPC: Record<number, string> = {
  [BASE_CHAIN_ID]: 'https://mainnet.base.org',
  [BASE_SEPOLIA_CHAIN_ID]: 'https://sepolia.base.org',
};

export const EXPLORER: Record<number, string> = {
  [BASE_CHAIN_ID]: 'https://basescan.org',
  [BASE_SEPOLIA_CHAIN_ID]: 'https://sepolia.basescan.org',
};

const VERSION_TUPLE = {
  type: 'tuple',
  components: [
    { name: 'root', type: 'bytes32' },
    { name: 'timestamp', type: 'uint64' },
    { name: 'kind', type: 'uint8' },
    { name: 'kindIndex', type: 'uint32' },
    { name: 'uri', type: 'string' },
  ],
} as const;

export const LEDGER_ABI = [
  {
    type: 'function',
    name: 'commit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'root', type: 'bytes32' },
      { name: 'manifestURI', type: 'string' },
      { name: 'kind', type: 'uint8' },
    ],
    outputs: [{ name: 'index', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'committer',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'versionCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'versionCountOf',
    stateMutability: 'view',
    inputs: [{ name: 'kind', type: 'uint8' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'version',
    stateMutability: 'view',
    inputs: [{ name: 'index', type: 'uint256' }],
    outputs: [{ name: '', ...VERSION_TUPLE }],
  },
  {
    type: 'function',
    name: 'latestOf',
    stateMutability: 'view',
    inputs: [{ name: 'kind', type: 'uint8' }],
    outputs: [
      { name: 'index', type: 'uint256' },
      { name: 'v', ...VERSION_TUPLE },
    ],
  },
  {
    type: 'function',
    name: 'versions',
    stateMutability: 'view',
    inputs: [
      { name: 'start', type: 'uint256' },
      { name: 'count', type: 'uint256' },
    ],
    outputs: [{ name: 'out', type: 'tuple[]', components: VERSION_TUPLE.components }],
  },
  {
    type: 'function',
    name: 'verify',
    stateMutability: 'view',
    inputs: [
      { name: 'index', type: 'uint256' },
      { name: 'leaf', type: 'bytes32' },
      { name: 'proof', type: 'bytes32[]' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'event',
    name: 'Committed',
    inputs: [
      { name: 'index', type: 'uint256', indexed: true },
      { name: 'kind', type: 'uint8', indexed: true },
      { name: 'root', type: 'bytes32', indexed: true },
      { name: 'kindIndex', type: 'uint32', indexed: false },
      { name: 'timestamp', type: 'uint64', indexed: false },
      { name: 'uri', type: 'string', indexed: false },
      { name: 'committer', type: 'address', indexed: false },
    ],
  },
] as const;

export interface LedgerVersion {
  index: number;
  root: `0x${string}`;
  timestamp: number;
  kind: number;
  kindIndex: number;
  uri: string;
}
