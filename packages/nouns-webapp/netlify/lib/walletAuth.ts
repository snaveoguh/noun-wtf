// ── Noun World wallet links: check a rider's signed "link" message ──
//
// A rider proves an address by signing (no gas) the human-readable message
// built by linkMessage() in the game's net/Stats.ts. Here we rebuild the same
// text from the posted fields and recover the signer. Plain EOAs verify
// offline; smart-contract wallets (ERC-1271 / ERC-6492) fall back to an RPC
// call, unless WORLD_STATS_RPC=off.

import { createPublicClient, getAddress, http, isAddress, verifyMessage } from 'viem';
import { mainnet } from 'viem/chains';

import { linkMessage } from '../../src/miniapps/world2/net/Stats';

/** A signature older than this is refused (and one this far in the future). */
export const LINK_MAX_AGE_MS = 10 * 60_000;
const LINK_MAX_SKEW_MS = 2 * 60_000;
const MAX_SIG_CHARS = 4000;

export type LinkCheck =
  | { ok: true; address: `0x${string}`; ts: number }
  | { ok: false; status: number; error: string };

async function contractWalletSigned(
  address: `0x${string}`,
  message: string,
  signature: `0x${string}`,
): Promise<boolean> {
  const rpc = process.env.WORLD_STATS_RPC ?? 'https://ethereum-rpc.publicnode.com';
  if (rpc === 'off' || rpc === '') return false;
  try {
    const client = createPublicClient({ chain: mainnet, transport: http(rpc, { timeout: 6000 }) });
    return await client.verifyMessage({ address, message, signature });
  } catch {
    return false;
  }
}

/** Was `name` linked to `address` for `rider` by that address, recently? */
export async function checkLink(
  rider: string,
  name: string,
  rawAddress: unknown,
  rawTs: unknown,
  rawSig: unknown,
  now = Date.now(),
): Promise<LinkCheck> {
  if (typeof rawAddress !== 'string' || !isAddress(rawAddress, { strict: false })) {
    return { ok: false, status: 400, error: 'Bad address' };
  }
  const ts = Number(rawTs);
  if (!Number.isInteger(ts) || ts <= 0) return { ok: false, status: 400, error: 'Bad timestamp' };
  if (now - ts > LINK_MAX_AGE_MS || ts - now > LINK_MAX_SKEW_MS) {
    return { ok: false, status: 401, error: 'Signature expired, sign again' };
  }
  if (
    typeof rawSig !== 'string' ||
    rawSig.length > MAX_SIG_CHARS ||
    !/^0x[\dA-Fa-f]+$/.test(rawSig)
  ) {
    return { ok: false, status: 400, error: 'Bad signature' };
  }
  const signature = rawSig as `0x${string}`;
  const address = getAddress(rawAddress);
  const message = linkMessage(rider, rawAddress, name, ts);
  let good = false;
  try {
    good = await verifyMessage({ address, message, signature });
  } catch {
    good = false;
  }
  if (!good) good = await contractWalletSigned(address, message, signature);
  if (!good) return { ok: false, status: 401, error: 'Signature does not match address' };
  return { ok: true, address, ts };
}
