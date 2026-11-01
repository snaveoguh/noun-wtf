// Reads NounWorldLedger straight from Base's public RPC (the site's wagmi
// config is mainnet-first; this page needs no wallet) and fetches snapshot
// files through a public gateway.

import { createPublicClient, http, isAddress, type Address, type Hex } from 'viem';

import {
  BASE_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  LEDGER_ABI,
  LEDGER_DEPLOYMENTS,
  PUBLIC_RPC,
  type LedgerVersion,
} from '@/miniapps/world2/onchain/contract';
import { gatewayUrl } from '@/miniapps/world2/onchain/storage';

export interface LedgerTarget {
  chainId: number;
  address: Address | null;
  rpc: string;
}

export function ledgerTarget(
  env: Record<string, string | undefined> = import.meta.env,
): LedgerTarget {
  const id = Number(env.VITE_LEDGER_CHAIN_ID || BASE_CHAIN_ID);
  const chainId = id === BASE_SEPOLIA_CHAIN_ID ? BASE_SEPOLIA_CHAIN_ID : BASE_CHAIN_ID;
  const raw = env.VITE_LEDGER_ADDRESS || LEDGER_DEPLOYMENTS[chainId] || '';
  return {
    chainId,
    address: isAddress(raw) ? raw : null,
    rpc: env.VITE_LEDGER_RPC || PUBLIC_RPC[chainId],
  };
}

type Client = ReturnType<typeof makeClient>;
const makeClient = (rpc: string) => createPublicClient({ transport: http(rpc) });
const clients: Record<string, Client> = {};
const client = (t: LedgerTarget): Client => (clients[t.rpc] ??= makeClient(t.rpc));

/** Newest first, at most `limit`. */
export async function readVersions(t: LedgerTarget, limit = 90): Promise<LedgerVersion[]> {
  if (!t.address) return [];
  const c = client(t);
  const n = Number(
    await c.readContract({ address: t.address, abi: LEDGER_ABI, functionName: 'versionCount' }),
  );
  if (n === 0) return [];
  const start = Math.max(0, n - limit);
  const rows = await c.readContract({
    address: t.address,
    abi: LEDGER_ABI,
    functionName: 'versions',
    args: [BigInt(start), BigInt(n - start)],
  });
  return rows
    .map((v, i) => ({
      index: start + i,
      root: v.root,
      timestamp: Number(v.timestamp),
      kind: v.kind,
      kindIndex: v.kindIndex,
      uri: v.uri,
    }))
    .reverse();
}

/** The contract's own verify(), so the answer doesn't rest on this page's code. */
export async function chainVerify(
  t: LedgerTarget,
  index: number,
  leaf: Hex,
  proof: Hex[],
): Promise<boolean> {
  if (!t.address) return false;
  return client(t).readContract({
    address: t.address,
    abi: LEDGER_ABI,
    functionName: 'verify',
    args: [BigInt(index), leaf, proof],
  });
}

const IPFS_GATEWAY =
  (import.meta.env.VITE_IPFS_GATEWAY as string | undefined) || 'https://ipfs.io/ipfs/';

export const httpUrl = (uri: string) => gatewayUrl(uri, IPFS_GATEWAY);

export async function fetchJson(uri: string): Promise<unknown> {
  const res = await fetch(httpUrl(uri));
  if (!res.ok) throw new Error(`${res.status} from the gateway`);
  return res.json();
}

/** The snapshot directory a manifest URI sits in. */
export const dirOf = (manifestUri: string) => manifestUri.replace(/\/manifest\.json$/, '');
