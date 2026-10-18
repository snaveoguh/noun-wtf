// ── Noun Trade on-chain: build-time switches (all off / testnet by default) ──
//
// VITE_TRADE_ONCHAIN=true          show the CASH OUT / DEPOSIT panel (default off)
// VITE_TRADE_CHAIN_ID=84532        Base Sepolia (default) | 8453 Base
// VITE_TRADE_GOODS_ADDRESS=0x…     NounTradeGoods (from packages/noun-trade-contracts/deployments)
// VITE_TRADE_RPC=https://…         optional read RPC override
//
// VITE_* values are baked at build time from .github/workflows/netlify-deploy.yml.

import { getAddress, isAddress, type Address } from 'viem';

import { BASE_SEPOLIA_CHAIN_ID, DEFAULT_TRADE_RPC } from './tokens';

const env = import.meta.env as Record<string, string | undefined>;

export const TRADE_ONCHAIN_ENABLED = env.VITE_TRADE_ONCHAIN === 'true';
export const TRADE_CHAIN_ID = Number(env.VITE_TRADE_CHAIN_ID || BASE_SEPOLIA_CHAIN_ID);
export const TRADE_GOODS_ADDRESS: Address | null =
  env.VITE_TRADE_GOODS_ADDRESS && isAddress(env.VITE_TRADE_GOODS_ADDRESS)
    ? getAddress(env.VITE_TRADE_GOODS_ADDRESS)
    : null;
export const TRADE_RPC = env.VITE_TRADE_RPC || DEFAULT_TRADE_RPC[TRADE_CHAIN_ID] || '';
