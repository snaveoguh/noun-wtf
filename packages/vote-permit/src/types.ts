import type { Address, Hex } from 'viem';

/** Which Governor flavour a scope targets. */
export type GovernorKind = 'nouns' | 'lil';

/**
 * ERC-7710 caveat as consumed by the MetaMask DelegationManager.
 * `args` is NOT part of the EIP-712 hash and may be supplied at redeem time.
 */
export type Caveat = {
  enforcer: Address;
  terms: Hex;
  args: Hex;
};

/** ERC-7710 delegation as consumed by `DelegationManager.redeemDelegations`. */
export type Delegation = {
  delegate: Address;
  delegator: Address;
  authority: Hex;
  caveats: Caveat[];
  salt: bigint;
  signature: Hex;
};

export type UnsignedDelegation = Omit<Delegation, 'signature'>;

/** Vote support values shared by Nouns / Lil Nouns / Bravo-style governors. */
export type VoteSupport = 0 | 1 | 2;

/**
 * Everything a voter grants. Encoded into caveats by {@link buildVoteDelegation}.
 * All timestamps are unix seconds.
 */
export interface VoteScope {
  chainId: number;
  governor: Address;
  governorKind: GovernorKind;
  /** The voter's EOA (must sign the typed data). */
  delegator: Address;
  /** The relayer address that will call `redeemDelegations`. */
  redeemer: Address;
  /** Delegation is unusable at/after this timestamp (TimestampEnforcer upper bound, exclusive). */
  expiresAt: number;
  /** Delegation is unusable at/before this timestamp (TimestampEnforcer lower bound, exclusive). */
  notBefore?: number;
  /** Total number of redemptions allowed (LimitedCallsEnforcer). Omit for unlimited until expiry. */
  maxVotes?: number;
  /** NonceEnforcer nonce. Omit to skip nonce-based bulk revocation. */
  nonce?: bigint;
  /** Delegation salt. Random when omitted. */
  salt?: bigint;
  /** Allowed function selectors. Defaults to the governor kind's two `castRefundable*` selectors. */
  selectors?: Hex[];
}

/** Human/machine readable summary parsed back out of a delegation's caveats. */
export interface ScopeSummary {
  governor: Address;
  governorKind: GovernorKind;
  /** Human-readable signatures of the allowed functions, e.g. `castRefundableVote(uint256,uint8,uint32)`. */
  allowedFunctions: string[];
  redeemer: Address;
  expiresAt: number;
  notBefore?: number;
  maxVotes?: number;
  valueLimit: 0n;
  nonce?: bigint;
}

export interface EIP712TypedDataField {
  name: string;
  type: string;
}

/** EIP-712 payload for a Delegation, shaped for viem `signTypedData` / `eth_signTypedData_v4`. */
export interface DelegationTypedData {
  domain: {
    name: 'DelegationManager';
    version: '1';
    chainId: number;
    verifyingContract: Address;
  };
  types: {
    Delegation: readonly EIP712TypedDataField[];
    Caveat: readonly EIP712TypedDataField[];
  };
  primaryType: 'Delegation';
  message: {
    delegate: Address;
    delegator: Address;
    authority: Hex;
    caveats: { enforcer: Address; terms: Hex }[];
    salt: bigint;
  };
}
