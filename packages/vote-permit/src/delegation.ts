import type {
  Caveat,
  Delegation,
  DelegationTypedData,
  GovernorKind,
  ScopeSummary,
  UnsignedDelegation,
  VoteScope,
} from './types.js';

import {
  concatHex,
  encodeAbiParameters,
  getAddress,
  hashTypedData,
  isAddress,
  isHex,
  keccak256,
  stringToHex,
  toHex,
  type Address,
  type Hex,
} from 'viem';

import {
  allowedMethodsCaveat,
  allowedTargetsCaveat,
  decodeAllowedMethodsTerms,
  decodeAllowedTargetsTerms,
  decodeLimitedCallsTerms,
  decodeNonceTerms,
  decodeRedeemerTerms,
  decodeTimestampTerms,
  decodeValueLteTerms,
  identifyEnforcer,
  limitedCallsCaveat,
  nonceCaveat,
  redeemerCaveat,
  timestampCaveat,
  valueLteCaveat,
  type KnownEnforcer,
} from './caveats.js';
import {
  DELEGATION_MANAGER_DOMAIN,
  FRAMEWORK,
  GOVERNORS,
  type GovernorConfig,
} from './constants.js';
import { isVoteSelector, SELECTOR_TO_SIGNATURE, voteSelectorsFor } from './selectors.js';

// ---------------------------------------------------------------- EIP-712

/** Exact type strings from `src/utils/Constants.sol`. `signature` and `args` are deliberately absent. */
export const DELEGATION_TYPES = {
  Delegation: [
    { name: 'delegate', type: 'address' },
    { name: 'delegator', type: 'address' },
    { name: 'authority', type: 'bytes32' },
    { name: 'caveats', type: 'Caveat[]' },
    { name: 'salt', type: 'uint256' },
  ],
  Caveat: [
    { name: 'enforcer', type: 'address' },
    { name: 'terms', type: 'bytes' },
  ],
} as const;

export const DELEGATION_TYPEHASH: Hex = keccak256(
  stringToHex(
    'Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)Caveat(address enforcer,bytes terms)',
  ),
);

export const CAVEAT_TYPEHASH: Hex = keccak256(stringToHex('Caveat(address enforcer,bytes terms)'));

/** EIP-712 domain of the DelegationManager on `chainId`. */
export function delegationDomain(chainId: number): DelegationTypedData['domain'] {
  return {
    name: DELEGATION_MANAGER_DOMAIN.name,
    version: DELEGATION_MANAGER_DOMAIN.version,
    chainId,
    verifyingContract: FRAMEWORK.delegationManager,
  };
}

/** Typed data for any (unsigned) delegation, ready for `signTypedData` / `eth_signTypedData_v4`. */
export function toDelegationTypedData(
  d: UnsignedDelegation | Delegation,
  chainId: number,
): DelegationTypedData {
  return {
    domain: delegationDomain(chainId),
    types: DELEGATION_TYPES,
    primaryType: 'Delegation',
    message: {
      delegate: d.delegate,
      delegator: d.delegator,
      authority: d.authority,
      caveats: d.caveats.map(c => ({ enforcer: c.enforcer, terms: c.terms })),
      salt: d.salt,
    },
  };
}

/**
 * The digest the delegator actually signs: `toTypedDataHash(domainSeparator, getDelegationHash(d))`.
 * Equivalent to viem `hashTypedData(toDelegationTypedData(d, chainId))`.
 */
export function getDelegationSigningHash(d: UnsignedDelegation | Delegation, chainId: number): Hex {
  return hashTypedData(toDelegationTypedData(d, chainId));
}

// ---------------------------------------------------------------- hashing (EncoderLib)

function getCaveatPacketHash(c: Pick<Caveat, 'enforcer' | 'terms'>): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'address' }, { type: 'bytes32' }],
      [CAVEAT_TYPEHASH, c.enforcer, keccak256(c.terms)],
    ),
  );
}

function getCaveatArrayPacketHash(caveats: Pick<Caveat, 'enforcer' | 'terms'>[]): Hex {
  return keccak256(concatHex(caveats.map(getCaveatPacketHash)));
}

/**
 * `EncoderLib._getDelegationHash` — the EIP-712 struct hash of a Delegation, which the
 * DelegationManager also uses as the key for `disabledDelegations`.
 * Must equal `DelegationManager.getDelegationHash(d)` on-chain.
 */
export function getDelegationHash(d: UnsignedDelegation | Delegation): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'address' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'uint256' },
      ],
      [
        DELEGATION_TYPEHASH,
        d.delegate,
        d.delegator,
        d.authority,
        getCaveatArrayPacketHash(d.caveats),
        d.salt,
      ],
    ),
  );
}

// ---------------------------------------------------------------- build

function randomSalt(): bigint {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return BigInt(toHex(bytes));
}

function assertAddress(value: string, label: string): asserts value is Address {
  if (!isAddress(value)) throw new TypeError(`${label}: ${value} is not an address`);
}

/**
 * Build the caveat set for a vote scope and the EIP-712 payload the voter must sign.
 * Caveat order is fixed (see SPEC.md §3) so the resulting hash is deterministic for a given scope+salt.
 */
export function buildVoteDelegation(scope: VoteScope): {
  delegation: UnsignedDelegation;
  typedData: DelegationTypedData;
  summary: ScopeSummary;
} {
  assertAddress(scope.governor, 'governor');
  assertAddress(scope.delegator, 'delegator');
  assertAddress(scope.redeemer, 'redeemer');
  if (!Number.isInteger(scope.chainId) || scope.chainId <= 0) {
    throw new RangeError('chainId must be a positive integer');
  }
  if (!Number.isInteger(scope.expiresAt) || scope.expiresAt <= 0) {
    throw new RangeError('expiresAt must be a positive unix timestamp (seconds)');
  }
  if (scope.notBefore !== undefined) {
    if (!Number.isInteger(scope.notBefore) || scope.notBefore < 0) {
      throw new RangeError('notBefore must be a non-negative unix timestamp (seconds)');
    }
    if (scope.notBefore >= scope.expiresAt) throw new RangeError('notBefore must be < expiresAt');
  }
  if (scope.maxVotes !== undefined && (!Number.isInteger(scope.maxVotes) || scope.maxVotes <= 0)) {
    throw new RangeError('maxVotes must be a positive integer');
  }
  if (scope.nonce !== undefined && scope.nonce < 0n) throw new RangeError('nonce must be >= 0');
  if (scope.salt !== undefined && scope.salt < 0n) throw new RangeError('salt must be >= 0');

  const selectors = scope.selectors ?? voteSelectorsFor(scope.governorKind);
  if (selectors.length === 0) throw new RangeError('selectors must be non-empty');
  for (const s of selectors) {
    if (!isVoteSelector(scope.governorKind, s)) {
      throw new RangeError(
        `selector ${s} is not a vote selector for governor kind '${scope.governorKind}'`,
      );
    }
  }

  const governor = getAddress(scope.governor);
  const redeemer = getAddress(scope.redeemer);
  const delegator = getAddress(scope.delegator);

  const caveats: Caveat[] = [
    allowedTargetsCaveat([governor]),
    allowedMethodsCaveat(selectors),
    valueLteCaveat(0n),
    redeemerCaveat([redeemer]),
    timestampCaveat(scope.notBefore ?? 0, scope.expiresAt),
  ];
  if (scope.maxVotes !== undefined) caveats.push(limitedCallsCaveat(scope.maxVotes));
  if (scope.nonce !== undefined) caveats.push(nonceCaveat(scope.nonce));

  const delegation: UnsignedDelegation = {
    delegate: redeemer,
    delegator,
    authority: FRAMEWORK.rootAuthority,
    caveats,
    salt: scope.salt ?? randomSalt(),
  };

  const summary: ScopeSummary = {
    governor,
    governorKind: scope.governorKind,
    allowedFunctions: selectors.map(s => SELECTOR_TO_SIGNATURE[s.toLowerCase()] ?? s),
    redeemer,
    expiresAt: scope.expiresAt,
    valueLimit: 0n,
  };
  if (scope.notBefore !== undefined && scope.notBefore > 0) summary.notBefore = scope.notBefore;
  if (scope.maxVotes !== undefined) summary.maxVotes = scope.maxVotes;
  if (scope.nonce !== undefined) summary.nonce = scope.nonce;

  return { delegation, typedData: toDelegationTypedData(delegation, scope.chainId), summary };
}

// ---------------------------------------------------------------- decode / validate

export class InvalidVoteDelegationError extends Error {
  override name = 'InvalidVoteDelegationError';
}

function fail(msg: string): never {
  throw new InvalidVoteDelegationError(msg);
}

export interface DecodeOptions {
  /**
   * Governors to accept. Defaults to {@link GOVERNORS}. Supply your own registry to
   * validate delegations for other Governor deployments (see SPEC.md §8).
   */
  governors?: readonly GovernorConfig[];
}

const REQUIRED: readonly KnownEnforcer[] = [
  'allowedTargets',
  'allowedMethods',
  'valueLte',
  'redeemer',
  'timestamp',
];
const OPTIONAL: readonly KnownEnforcer[] = ['limitedCalls', 'nonce'];

/**
 * Parse a delegation's caveats back into a {@link ScopeSummary}, enforcing the SVP profile.
 *
 * Throws {@link InvalidVoteDelegationError} if:
 *  - `authority` is not ROOT_AUTHORITY (SVP is single-hop only)
 *  - any caveat points at an enforcer outside the v1.3.0 set above
 *  - any required caveat is missing or duplicated
 *  - AllowedTargets is not exactly one known governor
 *  - AllowedMethods contains anything that is not a vote selector for that governor kind
 *  - ValueLte is not 0
 *  - Redeemer is not exactly one address, or differs from `delegate`
 *  - Timestamp has no expiry
 *
 * Servers/relayers MUST call this before storing or redeeming a delegation.
 */
export function decodeVoteDelegation(
  d: Delegation | UnsignedDelegation,
  options: DecodeOptions = {},
): ScopeSummary {
  const governors = options.governors ?? (Object.values(GOVERNORS) as readonly GovernorConfig[]);

  if (!isAddress(d.delegate)) fail('delegate is not an address');
  if (!isAddress(d.delegator)) fail('delegator is not an address');
  if (
    !isHex(d.authority, { strict: true }) ||
    d.authority.toLowerCase() !== FRAMEWORK.rootAuthority
  ) {
    fail('authority must be ROOT_AUTHORITY (single-hop delegation only)');
  }
  if (typeof d.salt !== 'bigint' || d.salt < 0n) fail('salt must be a non-negative bigint');
  if (!Array.isArray(d.caveats) || d.caveats.length === 0)
    fail('caveats must be a non-empty array');

  const seen = new Map<KnownEnforcer, Caveat>();
  for (const c of d.caveats) {
    const kind = identifyEnforcer(c.enforcer);
    if (kind === null) fail(`unknown enforcer ${c.enforcer}`);
    if (seen.has(kind)) fail(`duplicate ${kind} caveat`);
    if (!isHex(c.terms, { strict: true })) fail(`${kind}: terms is not hex`);
    seen.set(kind, c);
  }
  for (const r of REQUIRED) if (!seen.has(r)) fail(`missing required ${r} caveat`);
  for (const k of seen.keys()) {
    if (!REQUIRED.includes(k) && !OPTIONAL.includes(k))
      fail(`caveat ${k} is not part of the SVP profile`);
  }

  const get = (k: KnownEnforcer): Caveat => seen.get(k) as Caveat;

  // Targets → exactly one, and it must be a known governor.
  const targets = decodeAllowedTargetsTerms(get('allowedTargets').terms);
  if (targets.length !== 1) fail('AllowedTargets must contain exactly one address');
  const governor = targets[0] as Address;
  const gov = governors.find(g => g.address.toLowerCase() === governor.toLowerCase());
  if (!gov) fail(`AllowedTargets ${governor} is not a known governor`);
  const governorKind: GovernorKind = gov.kind;

  // Methods → non-empty subset of that kind's vote selectors.
  const selectors = decodeAllowedMethodsTerms(get('allowedMethods').terms);
  if (selectors.length === 0) fail('AllowedMethods must contain at least one selector');
  for (const s of selectors) {
    if (!isVoteSelector(governorKind, s))
      fail(`AllowedMethods selector ${s} is not a vote function of '${governorKind}'`);
  }

  // Value → must be zero.
  if (decodeValueLteTerms(get('valueLte').terms) !== 0n) fail('ValueLte must be 0');

  // Redeemer → exactly one, and it must equal the delegate.
  const redeemers = decodeRedeemerTerms(get('redeemer').terms);
  if (redeemers.length !== 1) fail('Redeemer must contain exactly one address');
  const redeemer = redeemers[0] as Address;
  if (redeemer.toLowerCase() !== d.delegate.toLowerCase()) fail('Redeemer must equal delegate');

  // Timestamp → expiry required.
  const { after, before } = decodeTimestampTerms(get('timestamp').terms);
  if (before === 0) fail('Timestamp must set an expiry');
  if (after !== 0 && after >= before) fail('Timestamp notBefore must be < expiresAt');

  const summary: ScopeSummary = {
    governor: getAddress(gov.address),
    governorKind,
    allowedFunctions: selectors.map(s => SELECTOR_TO_SIGNATURE[s.toLowerCase()] ?? s),
    redeemer,
    expiresAt: before,
    valueLimit: 0n,
  };
  if (after !== 0) summary.notBefore = after;

  const lc = seen.get('limitedCalls');
  if (lc) {
    const limit = decodeLimitedCallsTerms(lc.terms);
    if (limit <= 0n) fail('LimitedCalls limit must be >= 1');
    if (limit > BigInt(Number.MAX_SAFE_INTEGER)) fail('LimitedCalls limit is unreasonably large');
    summary.maxVotes = Number(limit);
  }
  const nc = seen.get('nonce');
  if (nc) summary.nonce = decodeNonceTerms(nc.terms);

  return summary;
}
