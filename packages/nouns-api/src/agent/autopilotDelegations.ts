// ─── Autopilot — delegation submission validation ───────────────────────────
//
// A voter hands us a signed ERC-7710 delegation (built with
// `@nouns/vote-permit`'s `buildVoteDelegation`, signed with EIP-712 by the
// voter's EOA — plain or EIP-7702-upgraded). Before we store it we prove:
//
//   1. it parses and is EXACTLY the SVP profile (`decodeVoteDelegation` throws
//      on any unknown caveat / broader scope)
//   2. delegator == the wallet the route is for
//   3. governor == the governor the `dao` maps to
//   4. redeemer == our relayer
//   5. expiry is in the future and ≤ 365 days out
//   6. the delegation's own EIP-712 signature recovers to the delegator
//      (ECDSA); for an address that carries code (7702 / smart account) we
//      also accept ERC-1271 via `eth_call`
//
// This module has no route / store / Ponder dependencies so the self-test can
// call `validateDelegationSubmission` directly — the route calls the same fn.

import type { AutopilotDao } from './autopilotPrefs.js';
import type { NewDelegation } from './autopilotStore.js';
import type { PublicClient } from 'viem';

import {
  decodeVoteDelegation,
  deserializeDelegation,
  getDelegationHash,
  GOVERNORS,
  InvalidVoteDelegationError,
  serializeDelegation,
  toDelegationTypedData,
  type Delegation,
  type GovernorConfig,
  type ScopeSummary,
} from '@nouns/vote-permit';
import { getAddress, recoverTypedDataAddress } from 'viem';

type Hex = `0x${string}`;

export const MAX_DELEGATION_TTL_S = 365 * 24 * 3600;

export function governorFor(dao: AutopilotDao): GovernorConfig {
  return dao === 'nouns' ? GOVERNORS.nouns : GOVERNORS.lilNouns;
}

export type DelegationValidation =
  | {
      ok: true;
      delegation: Delegation;
      summary: ScopeSummary;
      hash: Hex;
      row: NewDelegation;
      signatureMethod: 'ecdsa' | 'erc1271';
    }
  | { ok: false; status: 400 | 401; error: string };

/**
 * Verify the delegation's EIP-712 signature. ECDSA first (covers plain EOAs
 * AND MetaMask's 7702 delegator, whose `isValidSignature` is the same ECDSA
 * check against `address(this)`); then ERC-1271 through the node when the
 * address has code.
 */
export async function verifyDelegationSignature(
  delegation: Delegation,
  client: PublicClient,
  chainId = 1,
): Promise<'ecdsa' | 'erc1271' | null> {
  if (!delegation.signature || delegation.signature === '0x') return null;
  const typedData = toDelegationTypedData(delegation, chainId);
  const expected = delegation.delegator.toLowerCase();
  try {
    const recovered = await recoverTypedDataAddress({
      ...typedData,
      signature: delegation.signature,
    });
    if (recovered.toLowerCase() === expected) return 'ecdsa';
  } catch {
    /* not a plain ECDSA signature — try 1271 */
  }
  try {
    const code = await client.getCode({ address: getAddress(delegation.delegator) });
    if (!code || code === '0x') return null;
    const ok = await client.verifyTypedData({
      address: getAddress(delegation.delegator),
      ...typedData,
      signature: delegation.signature,
    });
    return ok ? 'erc1271' : null;
  } catch {
    return null;
  }
}

export async function validateDelegationSubmission(args: {
  address: string;
  dao: AutopilotDao;
  delegation: unknown; // serializeDelegation output (string) or its parsed object
  relayer: string;
  client: PublicClient;
  now?: number; // ms
}): Promise<DelegationValidation> {
  const bad = (error: string, status: 400 | 401 = 400): DelegationValidation => ({
    ok: false,
    status,
    error,
  });
  const address = args.address.toLowerCase();
  const now = args.now ?? Date.now();

  let delegation: Delegation;
  try {
    delegation = deserializeDelegation(args.delegation);
  } catch (err) {
    return bad(`delegation does not parse: ${err instanceof Error ? err.message : String(err)}`);
  }

  let summary: ScopeSummary;
  try {
    summary = decodeVoteDelegation(delegation);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return bad(
      err instanceof InvalidVoteDelegationError
        ? `delegation is not a scoped vote permission: ${msg}`
        : `delegation could not be decoded: ${msg}`,
    );
  }

  if (delegation.delegator.toLowerCase() !== address) {
    return bad(`delegator ${delegation.delegator} is not ${address}`, 401);
  }
  const gov = governorFor(args.dao);
  if (summary.governor.toLowerCase() !== gov.address.toLowerCase()) {
    return bad(
      `delegation targets governor ${summary.governor}, expected ${gov.address} for ${args.dao}`,
    );
  }
  if (summary.redeemer.toLowerCase() !== args.relayer.toLowerCase()) {
    return bad(`redeemer ${summary.redeemer} is not the noun.wtf relayer ${args.relayer}`);
  }
  const nowS = Math.floor(now / 1000);
  if (summary.expiresAt <= nowS) return bad('delegation has already expired');
  if (summary.expiresAt > nowS + MAX_DELEGATION_TTL_S) {
    return bad('expiresAt must be within 365 days');
  }
  if (summary.notBefore != null && summary.notBefore > nowS + MAX_DELEGATION_TTL_S) {
    return bad('notBefore must be within 365 days');
  }

  const method = await verifyDelegationSignature(delegation, args.client, gov.chainId);
  if (!method) return bad('delegation signature does not verify for the delegator', 401);

  const hash = getDelegationHash(delegation).toLowerCase() as Hex;
  return {
    ok: true,
    delegation,
    summary,
    hash,
    signatureMethod: method,
    row: {
      address,
      dao: args.dao,
      delegationJson: serializeDelegation(delegation),
      delegationHash: hash,
      redeemer: summary.redeemer.toLowerCase(),
      expiresAt: summary.expiresAt * 1000,
      maxVotes: summary.maxVotes ?? null,
    },
  };
}
