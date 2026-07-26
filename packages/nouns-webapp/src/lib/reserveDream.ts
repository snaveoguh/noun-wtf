// ─── Reserve a Dream Noun via the NounIRL agent ─────────────────────────────
//
// Flow: the dreamer tips ~$5 of ETH to nounirl.eth on any supported chain, then
// we POST the tip tx hash + the traits they want here. The agent's blockWatcher
// then auto-settles the next Noun whose traits match (AND logic over the listed
// categories — partial reservations are fine).
//
// Mirrors the API side:
//   packages/nouns-api/src/agent/reservations.ts   (store + /api/agent/reserve)
//   packages/nouns-api/src/agent/tipVerifier.ts     (verifies a MINED tip tx)
//   packages/nouns-api/src/agent/traitPredictor.ts  (matchesTraits — substring/AND)

import { traitName } from '@/lib/traitName';
import { INounSeed } from '@/wrappers/nounToken';

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  'https://spirited-flexibility-production-3c30.up.railway.app';

// nounirl.eth — the agent wallet that receives reservation tips and settles
// matching Nouns. Same address on every EVM chain. Mirrors NOUNIRL_ADDRESS on
// the API. (resolved from nounirl.eth on 2026-06-07)
export const NOUNIRL_ADDRESS = '0xACc74B39976D50522621F54c18dC85E2822Ec22c' as const;

// Minimum tip the agent accepts (~$5 at ~$2500/ETH). Mirrors MIN_TIP_ETH in
// packages/nouns-api/src/agent/constants.ts — keep in sync. We deposit exactly
// this floor so verification always passes regardless of the live ETH price.
export const RESERVE_TIP_ETH = 0.002;

// Chains the agent verifies tips on. Mirrors SUPPORTED_CHAINS in the API.
export const RESERVE_SUPPORTED_CHAINS: Record<number, string> = {
  1: 'Ethereum',
  8453: 'Base',
  10: 'Optimism',
  42161: 'Arbitrum',
  7777777: 'Zora',
};

export function isReserveChainSupported(chainId: number | undefined): boolean {
  return chainId != null && chainId in RESERVE_SUPPORTED_CHAINS;
}

export type ReservableLayer = 'head' | 'glasses' | 'body' | 'accessory';

export const RESERVABLE_LAYERS: { key: ReservableLayer; label: string }[] = [
  { key: 'head', label: 'Head' },
  { key: 'glasses', label: 'Noggles' },
  { key: 'body', label: 'Body' },
  { key: 'accessory', label: 'Accessory' },
];

/**
 * Build the agent's "category:value" trait strings from a seed and the set of
 * layers the dreamer wants to require. Matching is substring + AND, so the exact
 * trait name (e.g. "head:Shark") is the tightest possible reservation. The names
 * come from the same V1 trait set the agent resolves settled Nouns against.
 */
export function buildReserveTraits(seed: INounSeed, layers: ReservableLayer[]): string[] {
  return layers.map(layer => `${layer}:${traitName(layer, seed[layer])}`);
}

export interface ReserveResult {
  id: string;
  status: string;
  traits: string[];
  message?: string;
}

/**
 * Create the reservation. Call this ONLY after the tip tx is mined — the API
 * verifies a confirmed receipt and will cancel reservations whose tx is still
 * pending.
 */
export async function reserveDream(params: {
  wallet: string;
  txHash: string;
  chainId: number;
  traits: string[];
  settleFor?: string;
}): Promise<ReserveResult> {
  const res = await fetch(`${API_BASE}/api/agent/reserve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });

  let data: { reservation?: ReserveResult; error?: string } = {};
  try {
    data = await res.json();
  } catch {
    // fall through to status-based error below
  }

  if (!res.ok || !data.reservation) {
    throw new Error(data.error ?? `Reserve failed (${res.status})`);
  }
  return data.reservation;
}
