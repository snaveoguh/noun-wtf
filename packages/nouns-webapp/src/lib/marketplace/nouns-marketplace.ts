// ============================================================================
// NOUNS MARKETPLACE DATA LAYER — 0% fee Noun NFT marketplace
//
// Data sources:
// 1. Ponder indexer (morality.network) — marketplace orders
// 2. NounsToken contract — ownership, seeds
// 3. nouns-svg.ts — SVG rendering from seeds
// ============================================================================

import type { NounSeed } from './nouns-svg';

import { type Address, formatEther } from 'viem';

import { NOUNS_TOKEN_ADDRESS } from './contracts';

// ============================================================================
// TYPES
// ============================================================================

export interface NounMarketItem {
  nounId: number;
  owner: Address | null;
  seed: NounSeed | null;
  traits: NounTraits | null;
  listedPriceEth: string | null;
  orderHash: string | null;
}

export interface NounTraits {
  head: string;
  body: string;
  accessory: string;
  glasses: string;
  background: string;
}

export interface NounDetailItem extends NounMarketItem {
  /** Last auction winning bid in ETH (from subgraph, null if not available) */
  lastAuctionEth: string | null;
}

// ============================================================================
// CONSTANTS
// ============================================================================

export const NOUNS_CONTRACT = NOUNS_TOKEN_ADDRESS;

// ============================================================================
// INDEXER URL — server-side config
// ============================================================================

function getIndexerUrl(): string {
  return ((import.meta.env.VITE_INDEXER_BACKEND_URL as string | undefined) ?? '')
    .replace(/\\n/g, '')
    .replace(/\/$/, '');
}

// ============================================================================
// MARKETPLACE ORDERS — from Ponder indexer
// ============================================================================

interface IndexerOrderResponse {
  orderHash: string;
  tokenContract: string;
  tokenId: string;
  maker: string;
  priceWei: string;
  expiresAt: number;
  status: string;
  orderJson: string;
  signature: string;
  collection: string;
  taker: string | null;
  txHash: string | null;
  createdAt: number;
}

/**
 * Fetch active Nouns marketplace orders from the Ponder indexer.
 */
export async function fetchNounsOrders(limit: number = 100): Promise<IndexerOrderResponse[]> {
  const base = getIndexerUrl();
  if (!base) return [];

  try {
    const params = new URLSearchParams({
      collection: 'nouns',
      status: 'ACTIVE',
      limit: String(limit),
    });

    const res = await fetch(`${base}/api/v1/marketplace/orders?${params}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.orders ?? []) as IndexerOrderResponse[];
  } catch {
    return [];
  }
}

/**
 * Fetch a single Nouns order by tokenId.
 */
export async function fetchNounOrderByTokenId(
  tokenId: string,
): Promise<IndexerOrderResponse | null> {
  const base = getIndexerUrl();
  if (!base) return null;

  try {
    const params = new URLSearchParams({
      collection: 'nouns',
      tokenContract: NOUNS_CONTRACT.toLowerCase(),
      tokenId,
      status: 'ACTIVE',
      limit: '1',
    });

    const res = await fetch(`${base}/api/v1/marketplace/orders?${params}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const orders = (data.orders ?? []) as IndexerOrderResponse[];
    return orders[0] ?? null;
  } catch {
    return null;
  }
}

// ============================================================================
// ONCHAIN DATA — NounsToken contract reads
// ============================================================================

/** NounsToken minimal ABI for marketplace reads (ERC721Enumerable) */
export const NOUNS_TOKEN_ABI = [
  {
    type: 'function',
    name: 'ownerOf',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'seeds',
    inputs: [{ name: 'nounId', type: 'uint256' }],
    outputs: [
      { name: 'background', type: 'uint48' },
      { name: 'body', type: 'uint48' },
      { name: 'accessory', type: 'uint48' },
      { name: 'head', type: 'uint48' },
      { name: 'glasses', type: 'uint48' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalSupply',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'tokenOfOwnerByIndex',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'index', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

// ============================================================================
// TRAIT NAMES — human-readable labels for Noun traits
// ============================================================================

const BACKGROUND_NAMES = ['cool', 'warm'];

export function getTraitNames(seed: NounSeed): NounTraits {
  // We import lazily to avoid pulling in the full asset data on every import
  // For now, use index-based names; the UI will use nouns-svg.ts for proper filenames
  return {
    background: BACKGROUND_NAMES[seed.background] || `bg-${seed.background}`,
    body: `body-${seed.body}`,
    accessory: `accessory-${seed.accessory}`,
    head: `head-${seed.head}`,
    glasses: `glasses-${seed.glasses}`,
  };
}

// ============================================================================
// MARKETPLACE DATA — combine onchain + marketplace orders
// ============================================================================

/**
 * Fetch all Nouns with active marketplace listings.
 * Only returns listed Nouns — no filler.
 */
export async function fetchListedNouns(): Promise<NounMarketItem[]> {
  const orders = await fetchNounsOrders(500);

  return orders.map(order => {
    const priceEth = formatEther(BigInt(order.priceWei));
    return {
      nounId: Number(order.tokenId),
      owner: order.maker as Address,
      seed: null,
      traits: null,
      listedPriceEth: priceEth,
      orderHash: order.orderHash,
    };
  });
}

/**
 * Build detail data for a single Noun.
 */
export async function fetchNounDetail(nounId: number): Promise<NounDetailItem> {
  const order = await fetchNounOrderByTokenId(String(nounId));

  return {
    nounId,
    owner: order ? (order.maker as Address) : null,
    seed: null, // Enriched on the client
    traits: null,
    listedPriceEth: order ? formatEther(BigInt(order.priceWei)) : null,
    orderHash: order?.orderHash || null,
    lastAuctionEth: null, // TODO: fetch from Nouns subgraph
  };
}
