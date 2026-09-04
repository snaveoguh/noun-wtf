import type { GovernorKind } from './types.js';
import type { Address, Hex } from 'viem';

/**
 * MetaMask Delegation Framework v1.3.0. Deployed via CREATE2 — identical addresses on
 * Ethereum mainnet and Sepolia (and the other supported chains).
 * Source: https://github.com/MetaMask/delegation-framework/tree/v1.3.0
 */
export const FRAMEWORK = {
  version: '1.3.0',
  delegationManager: '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3',
  enforcers: {
    allowedTargets: '0x7F20f61b1f09b08D970938F6fa563634d65c4EeB',
    allowedMethods: '0x2c21fD0Cb9DC8445CB3fb0DC5E7Bb0Aca01842B5',
    timestamp: '0x1046bb45C8d673d4ea75321280DB34899413c069',
    redeemer: '0xE144b0b2618071B4E56f746313528a669c7E65c5',
    limitedCalls: '0x04658B29F6b82ed55274221a06Fc97D318E25416',
    nonce: '0xDE4f2FAC4B3D87A1d9953Ca5FC09FCa7F366254f',
    valueLte: '0x92Bf12322527cAA612fd31a0e810472BBB106A8F',
  },
  /** `EIP7702StatelessDeleGator` — the implementation MetaMask designates for upgraded EOAs. */
  metamask7702Delegator: '0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B',
  /** `DelegationManager.ROOT_AUTHORITY` — bytes32(max). */
  rootAuthority: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
} as const satisfies {
  version: '1.3.0';
  delegationManager: Address;
  enforcers: Record<
    | 'allowedTargets'
    | 'allowedMethods'
    | 'timestamp'
    | 'redeemer'
    | 'limitedCalls'
    | 'nonce'
    | 'valueLte',
    Address
  >;
  metamask7702Delegator: Address;
  rootAuthority: Hex;
};

/** `DelegationManager.ANY_DELEGATE` — allows any caller to redeem. Never used by SVP. */
export const ANY_DELEGATE: Address = '0x0000000000000000000000000000000000000a11';

/** EIP-712 domain constants baked into DelegationManager v1.3.0 (`NAME`, `DOMAIN_VERSION`). */
export const DELEGATION_MANAGER_DOMAIN = { name: 'DelegationManager', version: '1' } as const;

/**
 * ERC-7579 `ModeCode` for a single call, default (revert-on-failure) execution type.
 * Layout: callType(1) | execType(1) | unused(4) | modeSelector(4) | modePayload(22) — all zero.
 */
export const MODE_SINGLE_DEFAULT: Hex =
  '0x0000000000000000000000000000000000000000000000000000000000000000';

export interface GovernorConfig {
  chainId: 1;
  address: Address;
  kind: GovernorKind;
  /** Whether the vote functions take a trailing `uint32 clientId`. */
  clientIdParam: boolean;
}

export const GOVERNORS = {
  nouns: {
    chainId: 1,
    address: '0x6f3E6272A167e8AcCb32072d08E0957F9c79223d',
    kind: 'nouns',
    clientIdParam: true,
  },
  lilNouns: {
    chainId: 1,
    address: '0x5d2C31ce16924C2a71D317e5BbFd5ce387854039',
    kind: 'lil',
    clientIdParam: false,
  },
} as const satisfies Record<string, GovernorConfig>;

/** noun.wtf's registered Nouns client id (used for `castRefundableVote*` on kind `nouns`). */
export const NOUN_WTF_CLIENT_ID = 37;
