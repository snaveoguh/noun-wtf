/**
 * Minimal ABIs. Kept deliberately small so the package has no build-time codegen.
 * Struct layouts match `src/utils/Types.sol` in delegation-framework v1.3.0.
 */

const CAVEAT_COMPONENTS = [
  { name: 'enforcer', type: 'address' },
  { name: 'terms', type: 'bytes' },
  { name: 'args', type: 'bytes' },
] as const;

export const DELEGATION_COMPONENTS = [
  { name: 'delegate', type: 'address' },
  { name: 'delegator', type: 'address' },
  { name: 'authority', type: 'bytes32' },
  { name: 'caveats', type: 'tuple[]', components: CAVEAT_COMPONENTS },
  { name: 'salt', type: 'uint256' },
  { name: 'signature', type: 'bytes' },
] as const;

/** `abi.encode(Delegation[])` — the shape of one `permissionContext`. */
export const DELEGATION_ARRAY_PARAMS = [
  { name: 'delegations', type: 'tuple[]', components: DELEGATION_COMPONENTS },
] as const;

const delegationManagerAbi = [
  {
    type: 'function',
    name: 'redeemDelegations',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_permissionContexts', type: 'bytes[]' },
      { name: '_modes', type: 'bytes32[]' },
      { name: '_executionCallDatas', type: 'bytes[]' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'disableDelegation',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_delegation', type: 'tuple', components: DELEGATION_COMPONENTS }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'enableDelegation',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_delegation', type: 'tuple', components: DELEGATION_COMPONENTS }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getDelegationHash',
    stateMutability: 'pure',
    inputs: [{ name: '_input', type: 'tuple', components: DELEGATION_COMPONENTS }],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'disabledDelegations',
    stateMutability: 'view',
    inputs: [{ name: 'delegationHash', type: 'bytes32' }],
    outputs: [{ name: 'isDisabled', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'getDomainHash',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  { type: 'error', name: 'CannotUseADisabledDelegation', inputs: [] },
  { type: 'error', name: 'InvalidAuthority', inputs: [] },
  { type: 'error', name: 'InvalidDelegate', inputs: [] },
  { type: 'error', name: 'InvalidDelegator', inputs: [] },
  { type: 'error', name: 'InvalidEOASignature', inputs: [] },
  { type: 'error', name: 'InvalidERC1271Signature', inputs: [] },
  { type: 'error', name: 'EmptySignature', inputs: [] },
  { type: 'error', name: 'AlreadyDisabled', inputs: [] },
  { type: 'error', name: 'AlreadyEnabled', inputs: [] },
  { type: 'error', name: 'BatchDataLengthMismatch', inputs: [] },
  { type: 'error', name: 'EnforcedPause', inputs: [] },
  { type: 'error', name: 'ExpectedPause', inputs: [] },
  {
    type: 'error',
    name: 'ECDSAInvalidSignature',
    inputs: [],
  },
  {
    type: 'error',
    name: 'ECDSAInvalidSignatureLength',
    inputs: [{ name: 'length', type: 'uint256' }],
  },
  {
    type: 'error',
    name: 'ECDSAInvalidSignatureS',
    inputs: [{ name: 's', type: 'bytes32' }],
  },
  {
    type: 'event',
    name: 'RedeemedDelegation',
    inputs: [
      { name: 'rootDelegator', type: 'address', indexed: true },
      { name: 'redeemer', type: 'address', indexed: true },
      { name: 'delegation', type: 'tuple', components: DELEGATION_COMPONENTS, indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'DisabledDelegation',
    inputs: [
      { name: 'delegationHash', type: 'bytes32', indexed: true },
      { name: 'delegator', type: 'address', indexed: true },
      { name: 'delegate', type: 'address', indexed: true },
      { name: 'delegation', type: 'tuple', components: DELEGATION_COMPONENTS, indexed: false },
    ],
  },
] as const;

/** Errors raised by `DeleGatorCore` / `EIP7702DeleGatorCore` (the 7702 account implementation). */
const deleGatorErrorsAbi = [
  { type: 'error', name: 'NotSelf', inputs: [] },
  { type: 'error', name: 'NotEntryPoint', inputs: [] },
  { type: 'error', name: 'NotEntryPointOrSelf', inputs: [] },
  { type: 'error', name: 'NotDelegationManager', inputs: [] },
  { type: 'error', name: 'UnauthorizedCallContext', inputs: [] },
  { type: 'error', name: 'UnsupportedCallType', inputs: [{ name: 'callType', type: 'bytes1' }] },
  { type: 'error', name: 'UnsupportedExecType', inputs: [{ name: 'execType', type: 'bytes1' }] },
  { type: 'error', name: 'FailedCall', inputs: [] },
] as const;

/** Nouns DAO governor (V3+, Bravo-style with client ids). */
const nounsGovernorVotesAbi = [
  {
    type: 'function',
    name: 'castRefundableVote',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'proposalId', type: 'uint256' },
      { name: 'support', type: 'uint8' },
      { name: 'clientId', type: 'uint32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'castRefundableVoteWithReason',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'proposalId', type: 'uint256' },
      { name: 'support', type: 'uint8' },
      { name: 'reason', type: 'string' },
      { name: 'clientId', type: 'uint32' },
    ],
    outputs: [],
  },
] as const;

/** Lil Nouns DAO governor (no client id parameter). */
const lilNounsGovernorVotesAbi = [
  {
    type: 'function',
    name: 'castRefundableVote',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'proposalId', type: 'uint256' },
      { name: 'support', type: 'uint8' },
    ],
    outputs: [{ name: '', type: 'uint96' }],
  },
  {
    type: 'function',
    name: 'castRefundableVoteWithReason',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'proposalId', type: 'uint256' },
      { name: 'support', type: 'uint8' },
      { name: 'reason', type: 'string' },
    ],
    outputs: [{ name: '', type: 'uint96' }],
  },
] as const;

/** Enforcer helpers useful for reading state / bulk-revoking. */
const limitedCallsEnforcerAbi = [
  {
    type: 'function',
    name: 'callCounts',
    stateMutability: 'view',
    inputs: [
      { name: 'delegationManager', type: 'address' },
      { name: 'delegationHash', type: 'bytes32' },
    ],
    outputs: [{ name: 'count', type: 'uint256' }],
  },
] as const;

const nonceEnforcerAbi = [
  {
    type: 'function',
    name: 'currentNonce',
    stateMutability: 'view',
    inputs: [
      { name: 'delegationManager', type: 'address' },
      { name: 'delegator', type: 'address' },
    ],
    outputs: [{ name: 'nonce', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'incrementNonce',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_delegationManager', type: 'address' }],
    outputs: [],
  },
] as const;

export const ABIS = {
  delegationManager: delegationManagerAbi,
  deleGatorErrors: deleGatorErrorsAbi,
  nounsGovernorVotes: nounsGovernorVotesAbi,
  lilNounsGovernorVotes: lilNounsGovernorVotesAbi,
  limitedCallsEnforcer: limitedCallsEnforcerAbi,
  nonceEnforcer: nonceEnforcerAbi,
} as const;
