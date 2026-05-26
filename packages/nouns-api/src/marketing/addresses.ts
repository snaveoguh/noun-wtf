// ─── Well-known Nouns governance addresses ──────────────────────────────────
//
// Used by the proposal decoder to label transaction targets with human names
// instead of bare hex. Lower-cased for case-insensitive matching.

import type { Hex } from 'viem';

type AddressLabel = {
  name: string;
  // A short note shown in the decoded action when the LLM drafts copy.
  note?: string;
};

const ADDRESS_LABELS: Record<string, AddressLabel> = {
  // ── DAO core ──
  '0xb1a32fc9f9d8b2cf86c068cae13108809547ef71': {
    name: 'DAO Treasury',
    note: 'Nouns Timelock V2 — current treasury',
  },
  '0x0bc3807ec262cb779b38d65b38158acc3bfede10': {
    name: 'Legacy Treasury',
    note: 'Nouns Timelock V1 — older proposals execute here',
  },
  '0x6f3e6272a167e8accb32072d08e0957f9c79223d': {
    name: 'Nouns Governor',
    note: 'NounsDAOLogicV4 proxy',
  },
  '0x9c8ff314c9bc7f6e59a9d9225fb22946427edc03': {
    name: 'NounsToken',
  },
  '0x830bd73e4184cef73443c15111a1df14e495c706': {
    name: 'Auction House',
    note: 'NounsAuctionHouseV2',
  },
  '0xf790a5f59678dd733fb3de93493a91f472ca1365': {
    name: 'NounsDAOData',
    note: 'Candidate / feedback contract',
  },

  // ── Payments + streams ──
  '0xd97bcd9f47cee35c0a9ec1dc40c1269afc9e8e1d': {
    name: 'USDC Payer',
    note: 'NounsPayer — sends USDC, falls back to debt',
  },
  '0x0fd206fc7a7dbcd5661157edcb1ffdd0d02a61ff': {
    name: 'Stream Factory',
    note: 'Creates Sablier-style payment streams',
  },
  '0x4f2acdc74f6941390d9b1804fabc3e780388cfe5': {
    name: 'Token Buyer',
    note: 'Swaps ETH → USDC for the Payer',
  },

  // ── Standard tokens ──
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': {
    name: 'USDC',
  },
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': {
    name: 'WETH',
  },

  // ── Small Grants (noun.wtf) ──
  '0xbac9233725440c595b19d975309cc98cb259253a': {
    name: 'Small Grants Treasury',
    note: 'noun.wtf-exclusive grants pool',
  },
};

export function labelForAddress(address: Hex | string): AddressLabel | null {
  return ADDRESS_LABELS[address.toLowerCase()] ?? null;
}

export function shortAddr(address: Hex | string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
