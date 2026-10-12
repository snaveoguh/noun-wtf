// ── NounWorldDrops: address, ABI + the drops endpoint's shapes ──────────
//
// The contract (packages/nouns-contracts/contracts/world/NounWorldDrops.sol)
// pays a drop to whoever brings a voucher the world-drops function signed
// for them. No address configured → the whole feature stays hidden.

import { isAddress, type Address } from 'viem';

const RAW = (import.meta.env.VITE_WORLD_DROPS_ADDRESS ?? '') as string;

export const DROPS_ADDRESS: Address | null = isAddress(RAW) ? (RAW as Address) : null;

export const DROPS_URL = '/.netlify/functions/world-drops';

/** ipfs:// → a public gateway (for <img> and texture loads). */
export const gatewayUrl = (u: string) =>
  u.startsWith('ipfs://') ? `https://ipfs.io/ipfs/${u.slice(7)}` : u;

export const DROPS_ABI = [
  {
    type: 'function',
    name: 'claim',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'dropId', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  { type: 'error', name: 'NotOpen', inputs: [] },
  { type: 'error', name: 'DropExpired', inputs: [] },
  { type: 'error', name: 'VoucherExpired', inputs: [] },
  { type: 'error', name: 'BadSignature', inputs: [] },
  { type: 'error', name: 'EthTransferFailed', inputs: [] },
] as const;

export type AssetKind = 'eth' | 'erc20' | 'erc721' | 'erc1155';

export interface DropAsset {
  kind: AssetKind;
  label: string;
  token?: string;
  tokenId?: string;
  amount?: string;
  image?: string;
}

/** One drop as GET world-drops returns it. */
export interface WorldDrop {
  dropId: string;
  x: number;
  y: number;
  z: number;
  asset: DropAsset;
  /** On-chain expiry (ms). */
  expiresAt: number;
  /** Someone holds a live voucher for it. */
  taken: boolean;
}

export interface Voucher {
  dropId: string;
  claimer: Address;
  deadline: number;
  signature: `0x${string}`;
}

export type VoucherResult =
  | { ok: true; voucher: Voucher; contract: Address; chainId: number }
  | { ok: false; error: 'taken' | 'expired' | 'proof' | 'busy' | 'other'; reason?: string };

/** Ask the server for a voucher, showing it the ride that reached the drop. */
export async function requestVoucher(
  dropId: string,
  address: Address,
  proof: string,
): Promise<VoucherResult> {
  try {
    const res = await fetch(DROPS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'claim', dropId, address, proof }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok && body.voucher !== undefined)
      return {
        ok: true,
        voucher: body.voucher as Voucher,
        contract: body.contract as Address,
        chainId: Number(body.chainId),
      };
    if (res.status === 409 && body.error === 'taken') return { ok: false, error: 'taken' };
    if (res.status === 410) return { ok: false, error: 'expired' };
    if (res.status === 422) return { ok: false, error: 'proof', reason: String(body.reason ?? '') };
    if (res.status === 429 || res.status === 409)
      return { ok: false, error: 'busy', reason: String(body.error ?? '') };
    return { ok: false, error: 'other', reason: String(body.error ?? res.status) };
  } catch (e) {
    return { ok: false, error: 'other', reason: (e as Error).message };
  }
}

/** Tell the server the drop was claimed on-chain (it checks the contract). */
export function reportClaimed(dropId: string) {
  void fetch(DROPS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'claimed', dropId }),
  }).catch(() => undefined);
}
