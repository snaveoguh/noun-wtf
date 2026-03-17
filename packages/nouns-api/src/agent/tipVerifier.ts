// ─── Agent NounIRL — Omnichain Tip Verification ─────────────────────────────
//
// Verifies ETH transfers to nounirl.eth on any supported chain.
// Uses free public RPCs for tx receipt lookups.

import { createPublicClient, http, formatEther, type Hex, type Chain } from 'viem';
import { mainnet, base, optimism, arbitrum, zora } from 'viem/chains';
import { SUPPORTED_CHAINS, MIN_TIP_ETH, getNounIrlAddress } from './constants.js';

// ─── Chain Configs ─────────────────────────────────────────────────────────

const CHAIN_CONFIGS: Record<number, Chain> = {
  1: mainnet,
  8453: base,
  10: optimism,
  42161: arbitrum,
  7777777: zora,
};

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TipVerification {
  valid: boolean;
  error?: string;
  amountEth?: number;
  from?: string;
  to?: string;
  chainId?: number;
  chainName?: string;
}

// ─── Verify Tip ────────────────────────────────────────────────────────────

/**
 * Verify an ETH transfer to nounirl.eth on any supported chain.
 *
 * @param txHash - Transaction hash to verify
 * @param chainId - Chain ID where the transaction was sent
 */
export async function verifyTip(txHash: string, chainId: number): Promise<TipVerification> {
  const chainInfo = SUPPORTED_CHAINS[chainId];
  if (!chainInfo) {
    return {
      valid: false,
      error: `Unsupported chain ID: ${chainId}. Supported: ${Object.entries(SUPPORTED_CHAINS).map(([id, c]) => `${c.name} (${id})`).join(', ')}`,
    };
  }

  const chainConfig = CHAIN_CONFIGS[chainId];
  if (!chainConfig) {
    return { valid: false, error: `Chain config not found for ${chainId}` };
  }

  let nounIrlAddress: string;
  try {
    nounIrlAddress = getNounIrlAddress().toLowerCase();
  } catch {
    return { valid: false, error: 'Agent wallet not configured' };
  }

  try {
    const client = createPublicClient({
      chain: chainConfig,
      transport: http(chainInfo.rpc),
    });

    // Fetch transaction
    const tx = await client.getTransaction({ hash: txHash as Hex });
    if (!tx) {
      return { valid: false, error: 'Transaction not found' };
    }

    // Verify recipient is nounirl.eth
    if (!tx.to || tx.to.toLowerCase() !== nounIrlAddress) {
      return {
        valid: false,
        error: `Transaction not sent to nounirl.eth. Sent to: ${tx.to}`,
      };
    }

    // Verify amount
    const amountEth = Number(formatEther(tx.value));
    if (amountEth < MIN_TIP_ETH) {
      return {
        valid: false,
        error: `Tip too small: ${amountEth.toFixed(6)} ETH (minimum: ${MIN_TIP_ETH} ETH ≈ $5)`,
        amountEth,
      };
    }

    // Verify transaction was mined (confirmed)
    const receipt = await client.getTransactionReceipt({ hash: txHash as Hex });
    if (!receipt || receipt.status !== 'success') {
      return {
        valid: false,
        error: 'Transaction not confirmed or failed',
        amountEth,
      };
    }

    return {
      valid: true,
      amountEth,
      from: tx.from,
      to: tx.to,
      chainId,
      chainName: chainInfo.name,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[NounIRL] Tip verification failed on ${chainInfo.name}:`, msg);
    return {
      valid: false,
      error: `Verification failed on ${chainInfo.name}: ${msg}`,
    };
  }
}

/**
 * Get the ETH balance of nounirl.eth on Ethereum mainnet.
 */
export async function getAgentBalance(): Promise<number> {
  try {
    const client = createPublicClient({
      chain: mainnet,
      transport: http(SUPPORTED_CHAINS[1]?.rpc ?? 'https://ethereum-rpc.publicnode.com'),
    });

    const nounIrlAddress = getNounIrlAddress();
    const balance = await client.getBalance({ address: nounIrlAddress as `0x${string}` });
    return Number(formatEther(balance));
  } catch (err) {
    console.error('[NounIRL] Failed to get agent balance:', err);
    return 0;
  }
}
