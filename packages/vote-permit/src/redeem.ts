import type { Delegation, GovernorKind, UnsignedDelegation, VoteSupport } from './types.js';

import {
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getAddress,
  isAddress,
  type Address,
  type Hex,
} from 'viem';

import { ABIS, DELEGATION_ARRAY_PARAMS } from './abis.js';
import { FRAMEWORK, MODE_SINGLE_DEFAULT, NOUN_WTF_CLIENT_ID } from './constants.js';
import { getDelegationHash } from './delegation.js';

export interface VoteCallArgs {
  governorKind: GovernorKind;
  proposalId: bigint;
  support: VoteSupport;
  reason?: string;
  /** Only used for kind `nouns`. Defaults to noun.wtf's client id (37). */
  clientId?: number;
}

function assertSupport(support: number): asserts support is VoteSupport {
  if (support !== 0 && support !== 1 && support !== 2) {
    throw new RangeError(`support must be 0 (against), 1 (for) or 2 (abstain); got ${support}`);
  }
}

/** The inner `castRefundableVote*` calldata the governor will receive (msg.sender = the voter's EOA). */
export function encodeVoteCalldata(args: VoteCallArgs): Hex {
  assertSupport(args.support);
  if (args.proposalId < 0n) throw new RangeError('proposalId must be >= 0');
  const hasReason = typeof args.reason === 'string' && args.reason.length > 0;

  if (args.governorKind === 'nouns') {
    const clientId = args.clientId ?? NOUN_WTF_CLIENT_ID;
    if (!Number.isInteger(clientId) || clientId < 0 || clientId > 0xffffffff) {
      throw new RangeError('clientId must be a uint32');
    }
    return hasReason
      ? encodeFunctionData({
          abi: ABIS.nounsGovernorVotes,
          functionName: 'castRefundableVoteWithReason',
          args: [args.proposalId, args.support, args.reason as string, clientId],
        })
      : encodeFunctionData({
          abi: ABIS.nounsGovernorVotes,
          functionName: 'castRefundableVote',
          args: [args.proposalId, args.support, clientId],
        });
  }

  return hasReason
    ? encodeFunctionData({
        abi: ABIS.lilNounsGovernorVotes,
        functionName: 'castRefundableVoteWithReason',
        args: [args.proposalId, args.support, args.reason as string],
      })
    : encodeFunctionData({
        abi: ABIS.lilNounsGovernorVotes,
        functionName: 'castRefundableVote',
        args: [args.proposalId, args.support],
      });
}

/** ERC-7579 single-call execution calldata: `abi.encodePacked(target, value, callData)`. */
export function encodeSingleExecution(target: Address, value: bigint, callData: Hex): Hex {
  return encodePacked(['address', 'uint256', 'bytes'], [getAddress(target), value, callData]);
}

/** `abi.encode(Delegation[])` for a single-delegation chain (leaf == root). */
export function encodePermissionContext(delegations: Delegation[]): Hex {
  return encodeAbiParameters(DELEGATION_ARRAY_PARAMS, [delegations]);
}

/**
 * Encode `DelegationManager.redeemDelegations` for one signed vote delegation.
 * The relayer (the delegation's `delegate` / Redeemer) sends this to the DelegationManager.
 * The DelegationManager then calls `executeFromExecutor` on the voter's 7702 account, which
 * calls the governor — so the governor sees `msg.sender == voter`.
 */
export function buildRedeemVoteCall(args: {
  delegation: Delegation;
  governorKind: GovernorKind;
  governor: Address;
  proposalId: bigint;
  support: VoteSupport;
  reason?: string;
  clientId?: number;
}): { to: Address; data: Hex; value: 0n } {
  if (!isAddress(args.governor)) throw new TypeError(`governor ${args.governor} is not an address`);
  const voteCalldata = encodeVoteCalldata(args);
  const execution = encodeSingleExecution(args.governor, 0n, voteCalldata);
  const data = encodeFunctionData({
    abi: ABIS.delegationManager,
    functionName: 'redeemDelegations',
    args: [[encodePermissionContext([args.delegation])], [MODE_SINGLE_DEFAULT], [execution]],
  });
  return { to: FRAMEWORK.delegationManager, data, value: 0n };
}

/**
 * Encode `DelegationManager.disableDelegation`. MUST be sent from the delegator's own address
 * (works with or without 7702 code — `msg.sender` is the EOA either way).
 */
export function buildRevokeCall(d: Delegation | UnsignedDelegation): { to: Address; data: Hex } {
  const delegation: Delegation = { ...d, signature: 'signature' in d ? d.signature : '0x' };
  return {
    to: FRAMEWORK.delegationManager,
    data: encodeFunctionData({
      abi: ABIS.delegationManager,
      functionName: 'disableDelegation',
      args: [delegation],
    }),
  };
}

/** Read call: `DelegationManager.disabledDelegations(getDelegationHash(d))`. */
export function buildIsRevokedCall(d: Delegation | UnsignedDelegation): { to: Address; data: Hex } {
  return {
    to: FRAMEWORK.delegationManager,
    data: encodeFunctionData({
      abi: ABIS.delegationManager,
      functionName: 'disabledDelegations',
      args: [getDelegationHash(d)],
    }),
  };
}

/**
 * Bulk revocation: `NonceEnforcer.incrementNonce(delegationManager)` sent from the delegator
 * invalidates every delegation that carries a Nonce caveat with the old nonce.
 */
export function buildIncrementNonceCall(): { to: Address; data: Hex } {
  return {
    to: FRAMEWORK.enforcers.nonce,
    data: encodeFunctionData({
      abi: ABIS.nonceEnforcer,
      functionName: 'incrementNonce',
      args: [FRAMEWORK.delegationManager],
    }),
  };
}
