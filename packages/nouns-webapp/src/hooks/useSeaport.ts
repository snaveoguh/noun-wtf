// ============================================================================
// SEAPORT REACT HOOKS — wagmi-integrated marketplace operations
//
// Wraps lib/seaport.ts with wallet state management, chain switching,
// approval checks, and order storage via the Ponder indexer API.
// ============================================================================

import { useState, useCallback } from 'react';

import { parseEther, type Address } from 'viem';
import { mainnet } from 'viem/chains';
import { useAccount, useWalletClient, useReadContract, useSwitchChain } from 'wagmi';

import {
  createListing,
  fulfillOrder,
  cancelOrder,
  deserializeOrder,
  serializeOrder,
  computeOrderHash,
  getCollectionFromContract,
  SEAPORT_CONDUIT,
  ERC721_APPROVAL_ABI,
  type StoredOrder,
} from '@/lib/marketplace/seaport';

// ── Types ────────────────────────────────────────────────────────────────────

export type SeaportStatus =
  | 'idle'
  | 'switching'
  | 'approving'
  | 'signing'
  | 'confirming'
  | 'submitting'
  | 'success'
  | 'error';

export interface UseCreateListingResult {
  list: (priceEth: string) => Promise<void>;
  status: SeaportStatus;
  error: string | null;
  reset: () => void;
}

export interface UseFulfillOrderResult {
  buy: () => Promise<void>;
  status: SeaportStatus;
  txHash: string | null;
  error: string | null;
  reset: () => void;
}

export interface UseCancelOrderResult {
  cancel: () => Promise<void>;
  status: SeaportStatus;
  txHash: string | null;
  error: string | null;
  reset: () => void;
}

export interface UseSeaportApprovalResult {
  isApproved: boolean;
  isLoading: boolean;
  approve: () => Promise<void>;
  status: SeaportStatus;
  error: string | null;
}

// ── Indexer helpers (client-side — no "server-only") ─────────────────────────

function getIndexerUrl(): string {
  return ((import.meta.env.VITE_INDEXER_BACKEND_URL as string | undefined) ?? '')
    .replace(/\\n/g, '')
    .replace(/\/$/, '');
}

function getMarketplaceApiUrl(path: string): string {
  const base = getIndexerUrl();
  return base ? `${base}${path}` : path;
}

async function postOrderToIndexer(order: StoredOrder): Promise<void> {
  const res = await fetch(getMarketplaceApiUrl('/api/v1/marketplace/orders'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(order),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Failed to store order: ${res.status}${body ? ` — ${body.slice(0, 120)}` : ''}`,
    );
  }
}

async function fetchOrderFromIndexer(orderHash: string): Promise<StoredOrder> {
  const res = await fetch(
    getMarketplaceApiUrl(`/api/v1/marketplace/orders/${encodeURIComponent(orderHash)}`),
  );
  if (!res.ok) {
    throw new Error(`Order not found: ${res.status}`);
  }

  return (await res.json()) as StoredOrder;
}

async function markOrderFilled(orderHash: string, txHash: string, taker: string): Promise<void> {
  await fetch(
    getMarketplaceApiUrl(`/api/v1/marketplace/orders/${encodeURIComponent(orderHash)}/fill`),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ txHash, taker }),
    },
  ).catch(() => {}); // non-blocking
}

async function markOrderCancelled(orderHash: string, txHash: string): Promise<void> {
  await fetch(
    getMarketplaceApiUrl(`/api/v1/marketplace/orders/${encodeURIComponent(orderHash)}/cancel`),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ txHash }),
    },
  ).catch(() => {});
}

// ── useSeaportApproval ───────────────────────────────────────────────────────

/**
 * Check and set ERC721 approval for the Seaport conduit.
 * Works for any ERC721 contract (Nouns, Emblem Vault, etc.)
 */
export function useSeaportApproval(tokenContract: Address): UseSeaportApprovalResult {
  const { address, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const [status, setStatus] = useState<SeaportStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const { data: isApprovedRaw, isLoading } = useReadContract({
    address: tokenContract,
    abi: ERC721_APPROVAL_ABI,
    functionName: 'isApprovedForAll',
    args: address ? [address, SEAPORT_CONDUIT] : undefined,
    chainId: mainnet.id,
    query: { enabled: !!address },
  });

  const isApproved = Boolean(isApprovedRaw);

  const approve = useCallback(async () => {
    if (!address || !walletClient) return;

    try {
      if (chainId !== mainnet.id) {
        setStatus('switching');
        await switchChainAsync({ chainId: mainnet.id });
      }

      setStatus('approving');
      setError(null);

      await walletClient.writeContract({
        address: tokenContract,
        abi: ERC721_APPROVAL_ABI,
        functionName: 'setApprovalForAll',
        args: [SEAPORT_CONDUIT, true],
        chain: mainnet,
        account: address,
      });

      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Approval failed');
    }
  }, [address, walletClient, chainId, tokenContract, switchChainAsync]);

  return { isApproved, isLoading, approve, status, error };
}

// ── useCreateListing ─────────────────────────────────────────────────────────

/**
 * Create a Seaport listing for an ERC721 NFT.
 * Handles chain switching, approval, order creation, signing, and indexer storage.
 */
export function useCreateListing(tokenContract: Address, tokenId: string): UseCreateListingResult {
  const { address, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const [status, setStatus] = useState<SeaportStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const { data: isApproved } = useReadContract({
    address: tokenContract,
    abi: ERC721_APPROVAL_ABI,
    functionName: 'isApprovedForAll',
    args: address ? [address, SEAPORT_CONDUIT] : undefined,
    chainId: mainnet.id,
    query: { enabled: !!address },
  });

  const list = useCallback(
    async (priceEth: string) => {
      if (!address || !walletClient) return;

      const priceWei = parseEther(priceEth);
      if (priceWei <= BigInt(0)) return;

      try {
        // 1. Switch to mainnet
        if (chainId !== mainnet.id) {
          setStatus('switching');
          await switchChainAsync({ chainId: mainnet.id });
        }

        // 2. Approve conduit if needed
        if (isApproved !== true) {
          setStatus('approving');
          await walletClient.writeContract({
            address: tokenContract,
            abi: ERC721_APPROVAL_ABI,
            functionName: 'setApprovalForAll',
            args: [SEAPORT_CONDUIT, true],
            chain: mainnet,
            account: address,
          });
        }

        // 3. Create + sign the Seaport order
        setStatus('signing');
        setError(null);

        const orderWithCounter = await createListing(
          {
            tokenContract,
            tokenId,
            priceWei: priceWei.toString(),
            maker: address,
          },
          walletClient,
        );

        // 4. Store order in indexer
        setStatus('submitting');

        const orderHash = computeOrderHash(orderWithCounter);
        const storedOrder: StoredOrder = {
          orderHash,
          tokenContract,
          tokenId,
          maker: address,
          priceWei: priceWei.toString(),
          expiresAt: Number(orderWithCounter.parameters.endTime),
          orderJson: serializeOrder(orderWithCounter),
          signature: orderWithCounter.signature,
          collection: getCollectionFromContract(tokenContract),
        };

        await postOrderToIndexer(storedOrder);
        setStatus('success');
      } catch (err) {
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Listing failed');
      }
    },
    [address, walletClient, chainId, tokenContract, tokenId, isApproved, switchChainAsync],
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);

  return { list, status, error, reset };
}

// ── useFulfillOrder ──────────────────────────────────────────────────────────

/**
 * Buy an NFT by fulfilling a Seaport order.
 * Fetches the order from the indexer, then executes the Seaport fulfillment.
 */
export function useFulfillOrder(orderHash: string): UseFulfillOrderResult {
  const { address, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const [status, setStatus] = useState<SeaportStatus>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const buy = useCallback(async () => {
    if (!address || !walletClient || !orderHash) return;

    try {
      // 1. Switch to mainnet
      if (chainId !== mainnet.id) {
        setStatus('switching');
        await switchChainAsync({ chainId: mainnet.id });
      }

      // 2. Fetch order from indexer
      setStatus('confirming');
      setError(null);

      const storedOrder = await fetchOrderFromIndexer(orderHash);
      const order = deserializeOrder(storedOrder.orderJson);

      // 3. Fulfill via Seaport
      setStatus('signing');

      const hash = await fulfillOrder({ order, fulfiller: address }, walletClient);
      setTxHash(hash);

      // 4. Mark order as filled in indexer (best-effort)
      await markOrderFilled(orderHash, hash, address);

      setStatus('success');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Purchase failed');
    }
  }, [address, walletClient, chainId, orderHash, switchChainAsync]);

  const reset = useCallback(() => {
    setStatus('idle');
    setTxHash(null);
    setError(null);
  }, []);

  return { buy, status, txHash, error, reset };
}

// ── useCancelOrder ───────────────────────────────────────────────────────────

/**
 * Cancel a Seaport listing on-chain.
 * Only the order's offerer (seller) can cancel.
 */
export function useCancelOrder(orderHash: string): UseCancelOrderResult {
  const { address, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const [status, setStatus] = useState<SeaportStatus>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cancel = useCallback(async () => {
    if (!address || !walletClient || !orderHash) return;

    try {
      // 1. Switch to mainnet
      if (chainId !== mainnet.id) {
        setStatus('switching');
        await switchChainAsync({ chainId: mainnet.id });
      }

      // 2. Fetch order from indexer
      setStatus('confirming');
      setError(null);

      const storedOrder = await fetchOrderFromIndexer(orderHash);
      const order = deserializeOrder(storedOrder.orderJson);

      // 3. Cancel on-chain via Seaport
      setStatus('signing');

      const hash = await cancelOrder(order, walletClient);
      setTxHash(hash);

      // 4. Mark cancelled in indexer (best-effort)
      await markOrderCancelled(orderHash, hash);

      setStatus('success');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Cancellation failed');
    }
  }, [address, walletClient, chainId, orderHash, switchChainAsync]);

  const reset = useCallback(() => {
    setStatus('idle');
    setTxHash(null);
    setError(null);
  }, []);

  return { cancel, status, txHash, error, reset };
}
