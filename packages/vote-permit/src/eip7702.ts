import { getAddress, isHex, type Address, type Hex } from 'viem';

import { FRAMEWORK } from './constants.js';

/** EIP-7702 delegation designation prefix: `0xef0100 || address`. */
export const EIP7702_PREFIX = '0xef0100';

export interface Parsed7702Code {
  isDelegated: boolean;
  implementation: Address | null;
  /** True when the designated implementation is MetaMask's `EIP7702StatelessDeleGator` v1.3.0. */
  isMetaMaskDelegator: boolean;
}

/**
 * Interpret the result of `eth_getCode(eoa)`.
 * - `undefined` / `0x` → plain EOA (not delegated)
 * - `0xef0100 || 20 bytes` → EIP-7702 delegated EOA
 * - anything else → a real contract, or malformed; reported as not delegated
 */
export function parse7702Code(code: Hex | undefined): Parsed7702Code {
  const none: Parsed7702Code = {
    isDelegated: false,
    implementation: null,
    isMetaMaskDelegator: false,
  };
  if (!code || !isHex(code, { strict: true })) return none;
  const lower = code.toLowerCase();
  if (lower.length !== EIP7702_PREFIX.length + 40 || !lower.startsWith(EIP7702_PREFIX)) return none;
  const implementation = getAddress(`0x${lower.slice(EIP7702_PREFIX.length)}`);
  return {
    isDelegated: true,
    implementation,
    isMetaMaskDelegator:
      implementation.toLowerCase() === FRAMEWORK.metamask7702Delegator.toLowerCase(),
  };
}

/** Build the code an EOA carries once it has designated `implementation` (useful for `stateOverride` simulations). */
export function make7702Code(implementation: Address = FRAMEWORK.metamask7702Delegator): Hex {
  return `${EIP7702_PREFIX}${getAddress(implementation).slice(2).toLowerCase()}` as Hex;
}
