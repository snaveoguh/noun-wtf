// ============================================================================
// SEAPORT 1.6 UTILITIES — Direct NFT marketplace operations
//
// Replaces all dead Reservoir Protocol API calls. Creates, fulfills, and
// cancels Seaport orders directly on Ethereum mainnet. Used by both the PEPE
// and Nouns marketplaces.
//
// 0% marketplace fees: consideration only includes the seller as recipient.
// ============================================================================

import type { OrderWithCounter, CreateOrderInput, Order } from '@opensea/seaport-js/lib/types';
import type { WalletClient } from 'viem';

import { Seaport } from '@opensea/seaport-js';
import {
  ItemType,
  CROSS_CHAIN_SEAPORT_V1_6_ADDRESS,
  OPENSEA_CONDUIT_KEY,
  OPENSEA_CONDUIT_ADDRESS,
} from '@opensea/seaport-js/lib/constants';
import { BrowserProvider, JsonRpcSigner } from 'ethers';

// ── Constants ────────────────────────────────────────────────────────────────

/** Canonical Seaport 1.6 deployment on Ethereum mainnet */
export const SEAPORT_ADDRESS = CROSS_CHAIN_SEAPORT_V1_6_ADDRESS;

/** OpenSea conduit — handles token approvals for Seaport */
export const SEAPORT_CONDUIT = OPENSEA_CONDUIT_ADDRESS;

/** Default listing duration: 30 days */
export const DEFAULT_LISTING_DURATION_SECONDS = 30 * 24 * 60 * 60;

/** ERC721 standard ABI for approval checks (shared by Nouns + Emblem Vault) */
export const ERC721_APPROVAL_ABI = [
  {
    type: 'function',
    name: 'isApprovedForAll',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'operator', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'setApprovalForAll',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'approved', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'ownerOf',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const;

// ── Types ────────────────────────────────────────────────────────────────────

export interface CreateListingParams {
  /** NFT contract address */
  tokenContract: string;
  /** Token ID (as string for BigInt safety) */
  tokenId: string;
  /** Price in wei */
  priceWei: string;
  /** Seller address */
  maker: string;
  /** Listing duration in seconds (default: 30 days) */
  durationSeconds?: number;
}

export interface FulfillOrderParams {
  /** Full Seaport order (parameters + signature + counter) */
  order: OrderWithCounter;
  /** Buyer address */
  fulfiller: string;
}

export interface StoredOrder {
  orderHash: string;
  tokenContract: string;
  tokenId: string;
  maker: string;
  priceWei: string;
  expiresAt: number;
  orderJson: string;
  signature: string;
  collection: string;
}

// Re-export types
export type { OrderWithCounter, Order, ItemType };

// ── Ethers v6 adapter ────────────────────────────────────────────────────────

/**
 * Convert a viem WalletClient to an ethers v6 Signer.
 * Required because seaport-js expects an ethers Signer.
 */
export function walletClientToSigner(walletClient: WalletClient): JsonRpcSigner {
  const { account, chain, transport } = walletClient;
  if (!account) throw new Error('WalletClient has no account');
  if (!chain) throw new Error('WalletClient has no chain');

  const provider = new BrowserProvider(transport, {
    chainId: chain.id,
    name: chain.name,
  });

  return new JsonRpcSigner(provider, account.address);
}

/**
 * Create a Seaport instance from a viem WalletClient.
 */
export function createSeaportInstance(walletClient: WalletClient): Seaport {
  const signer = walletClientToSigner(walletClient);
  return new Seaport(signer, {
    overrides: {
      contractAddress: SEAPORT_ADDRESS,
    },
  });
}

// ── Order creation ───────────────────────────────────────────────────────────

/**
 * Create a listing (sell order) for an ERC721 NFT.
 *
 * The seller offers their NFT in exchange for ETH. No marketplace fees —
 * the only consideration item is the seller receiving the full payment.
 *
 * Returns the signed order ready to be stored in the indexer.
 */
export async function createListing(
  params: CreateListingParams,
  walletClient: WalletClient,
): Promise<OrderWithCounter> {
  const seaport = createSeaportInstance(walletClient);
  const duration = params.durationSeconds ?? DEFAULT_LISTING_DURATION_SECONDS;
  const now = Math.floor(Date.now() / 1000);

  const orderInput: CreateOrderInput = {
    offer: [
      {
        itemType: ItemType.ERC721,
        token: params.tokenContract,
        identifier: params.tokenId,
      },
    ],
    consideration: [
      {
        amount: params.priceWei,
        recipient: params.maker,
      },
    ],
    startTime: now.toString(),
    endTime: (now + duration).toString(),
    conduitKey: OPENSEA_CONDUIT_KEY,
    // No fees array = 0% marketplace fees
  };

  const { executeAllActions } = await seaport.createOrder(orderInput, params.maker);

  return await executeAllActions();
}

/**
 * Compute a deterministic hash for a Seaport order.
 * Uses the order's salt + offerer as a unique key.
 */
export function computeOrderHash(order: OrderWithCounter): string {
  const p = order.parameters;
  // Simple deterministic hash: salt is already random per order
  return `${p.offerer.toLowerCase()}-${p.salt}-${p.offer[0]?.token ?? '0x'}-${p.offer[0]?.identifierOrCriteria ?? '0'}`;
}

// ── Order fulfillment ────────────────────────────────────────────────────────

/**
 * Fulfill (buy) a Seaport order.
 *
 * The buyer sends ETH and receives the NFT. Returns the transaction hash.
 */
export async function fulfillOrder(
  params: FulfillOrderParams,
  walletClient: WalletClient,
): Promise<string> {
  const seaport = createSeaportInstance(walletClient);

  const { executeAllActions } = await seaport.fulfillOrder({
    order: params.order,
    accountAddress: params.fulfiller,
  });

  const tx = await executeAllActions();
  // ethers v6 ContractTransactionResponse has hash; seaport-js types
  // reference the v5 ContractTransaction — cast through unknown.
  return (tx as unknown as { hash: string }).hash;
}

// ── Order cancellation ───────────────────────────────────────────────────────

/**
 * Cancel a Seaport order on-chain.
 * Only the order's offerer can cancel.
 */
export async function cancelOrder(
  order: OrderWithCounter,
  walletClient: WalletClient,
): Promise<string> {
  const seaport = createSeaportInstance(walletClient);

  const tx = await seaport.cancelOrders([order.parameters], walletClient.account!.address);

  const receipt = await tx.transact();
  return (receipt as unknown as { hash: string }).hash;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Serialize an OrderWithCounter for storage in the indexer.
 */
export function serializeOrder(order: OrderWithCounter): string {
  return JSON.stringify(order);
}

/**
 * Deserialize a stored order JSON back to an OrderWithCounter.
 * The stored JSON contains the full order including counter.
 */
export function deserializeOrder(json: string): OrderWithCounter {
  return JSON.parse(json) as OrderWithCounter;
}

/**
 * Extract the price in wei from a Seaport order's consideration items.
 * Sums all NATIVE (ETH) consideration items going to the offerer.
 */
export function getOrderPriceWei(order: Order | OrderWithCounter): bigint {
  let total = BigInt(0);
  for (const item of order.parameters.consideration) {
    // ItemType.NATIVE = 0 (ETH payments)
    if (Number(item.itemType) === 0) {
      total += BigInt(item.startAmount);
    }
  }
  return total;
}

/**
 * Check if an order has expired.
 */
export function isOrderExpired(order: Order | OrderWithCounter): boolean {
  const endTime = Number(order.parameters.endTime);
  return endTime > 0 && endTime < Math.floor(Date.now() / 1000);
}

/**
 * Determine the collection name from a token contract address.
 */
export function getCollectionFromContract(tokenContract: string): string {
  const lower = tokenContract.toLowerCase();
  if (lower === '0x9c8ff314c9bc7f6e59a9d9225fb22946427edc03') return 'nouns';
  if (lower === '0x82c7a8f707110f5fbb16184a5933e9f78a34c6ab') return 'emblem-vault-legacy';
  if (lower === '0x7e6027a6a84fc1f6db6782c523efe62c923e46ff') return 'emblem-vault-curated';
  return 'unknown';
}
