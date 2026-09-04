import type { Caveat } from './types.js';

import {
  concatHex,
  getAddress,
  isAddress,
  isHex,
  pad,
  size,
  slice,
  toHex,
  type Address,
  type Hex,
} from 'viem';

import { FRAMEWORK } from './constants.js';

/*
 * Terms encodings — verified against delegation-framework v1.3.0 `src/enforcers/*.sol`:
 *
 *  AllowedTargetsEnforcer  terms = abi.encodePacked(address[])   (n * 20 bytes, n >= 1)
 *  AllowedMethodsEnforcer  terms = abi.encodePacked(bytes4[])    (n * 4 bytes, n >= 1)
 *  ValueLteEnforcer        terms = bytes32(uint256 maxValue)
 *  RedeemerEnforcer        terms = abi.encodePacked(address[])   (n * 20 bytes, n >= 1)
 *  TimestampEnforcer       terms = uint128 after || uint128 before   (32 bytes; both exclusive; 0 = unset)
 *  LimitedCallsEnforcer    terms = bytes32(uint256 limit)
 *  NonceEnforcer           terms = bytes32(uint256 nonce)
 */

const UINT128_MAX = (1n << 128n) - 1n;

function assertHexBytes(value: Hex, label: string): void {
  if (!isHex(value, { strict: true })) throw new TypeError(`${label}: expected 0x-prefixed hex`);
  if (size(value) === 0) throw new TypeError(`${label}: empty terms`);
}

function assertNonNegativeInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0)
    throw new RangeError(`${label}: expected a non-negative integer`);
}

/** Terms are raw bytes; normalise to lowercase hex so JSON round-trips compare equal. */
function caveat(enforcer: Address, terms: Hex): Caveat {
  return { enforcer, terms: terms.toLowerCase() as Hex, args: '0x' };
}

// ---------------------------------------------------------------- targets

export function encodeAllowedTargetsTerms(targets: Address[]): Hex {
  if (targets.length === 0) throw new RangeError('AllowedTargets: at least one target required');
  return concatHex(targets.map(t => getAddress(t)));
}

export function decodeAllowedTargetsTerms(terms: Hex): Address[] {
  assertHexBytes(terms, 'AllowedTargets');
  const len = size(terms);
  if (len % 20 !== 0) throw new RangeError('AllowedTargets: invalid terms length');
  const out: Address[] = [];
  for (let i = 0; i < len; i += 20) out.push(getAddress(slice(terms, i, i + 20)));
  return out;
}

export function allowedTargetsCaveat(targets: Address[]): Caveat {
  return caveat(FRAMEWORK.enforcers.allowedTargets, encodeAllowedTargetsTerms(targets));
}

// ---------------------------------------------------------------- methods

export function encodeAllowedMethodsTerms(selectors: Hex[]): Hex {
  if (selectors.length === 0)
    throw new RangeError('AllowedMethods: at least one selector required');
  for (const s of selectors) {
    if (!isHex(s, { strict: true }) || size(s) !== 4) {
      throw new TypeError(`AllowedMethods: ${s} is not a 4-byte selector`);
    }
  }
  return concatHex(selectors.map(s => s.toLowerCase() as Hex));
}

export function decodeAllowedMethodsTerms(terms: Hex): Hex[] {
  assertHexBytes(terms, 'AllowedMethods');
  const len = size(terms);
  if (len % 4 !== 0) throw new RangeError('AllowedMethods: invalid terms length');
  const out: Hex[] = [];
  for (let i = 0; i < len; i += 4) out.push(slice(terms, i, i + 4));
  return out;
}

export function allowedMethodsCaveat(selectors: Hex[]): Caveat {
  return caveat(FRAMEWORK.enforcers.allowedMethods, encodeAllowedMethodsTerms(selectors));
}

// ---------------------------------------------------------------- value

export function encodeValueLteTerms(maxValue: bigint): Hex {
  if (maxValue < 0n) throw new RangeError('ValueLte: negative value');
  return pad(toHex(maxValue), { size: 32 });
}

export function decodeValueLteTerms(terms: Hex): bigint {
  assertHexBytes(terms, 'ValueLte');
  if (size(terms) !== 32) throw new RangeError('ValueLte: invalid terms length');
  return BigInt(terms);
}

export function valueLteCaveat(maxValue: bigint): Caveat {
  return caveat(FRAMEWORK.enforcers.valueLte, encodeValueLteTerms(maxValue));
}

// ---------------------------------------------------------------- redeemer

export function encodeRedeemerTerms(redeemers: Address[]): Hex {
  if (redeemers.length === 0) throw new RangeError('Redeemer: at least one redeemer required');
  return concatHex(redeemers.map(r => getAddress(r)));
}

export function decodeRedeemerTerms(terms: Hex): Address[] {
  assertHexBytes(terms, 'Redeemer');
  const len = size(terms);
  if (len % 20 !== 0) throw new RangeError('Redeemer: invalid terms length');
  const out: Address[] = [];
  for (let i = 0; i < len; i += 20) out.push(getAddress(slice(terms, i, i + 20)));
  return out;
}

export function redeemerCaveat(redeemers: Address[]): Caveat {
  return caveat(FRAMEWORK.enforcers.redeemer, encodeRedeemerTerms(redeemers));
}

// ---------------------------------------------------------------- timestamp

/**
 * @param after  delegation usable only when `block.timestamp > after` (0 = unset)
 * @param before delegation usable only when `block.timestamp < before` (0 = unset)
 */
export function encodeTimestampTerms(after: number, before: number): Hex {
  assertNonNegativeInt(after, 'Timestamp.after');
  assertNonNegativeInt(before, 'Timestamp.before');
  if (BigInt(after) > UINT128_MAX || BigInt(before) > UINT128_MAX) {
    throw new RangeError('Timestamp: threshold exceeds uint128');
  }
  return concatHex([pad(toHex(after), { size: 16 }), pad(toHex(before), { size: 16 })]);
}

export function decodeTimestampTerms(terms: Hex): { after: number; before: number } {
  assertHexBytes(terms, 'Timestamp');
  if (size(terms) !== 32) throw new RangeError('Timestamp: invalid terms length');
  const after = BigInt(slice(terms, 0, 16));
  const before = BigInt(slice(terms, 16, 32));
  if (after > BigInt(Number.MAX_SAFE_INTEGER) || before > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Timestamp: threshold does not fit in a JS number');
  }
  return { after: Number(after), before: Number(before) };
}

export function timestampCaveat(after: number, before: number): Caveat {
  return caveat(FRAMEWORK.enforcers.timestamp, encodeTimestampTerms(after, before));
}

// ---------------------------------------------------------------- limited calls

export function encodeLimitedCallsTerms(limit: number | bigint): Hex {
  const v = BigInt(limit);
  if (v <= 0n) throw new RangeError('LimitedCalls: limit must be >= 1');
  return pad(toHex(v), { size: 32 });
}

export function decodeLimitedCallsTerms(terms: Hex): bigint {
  assertHexBytes(terms, 'LimitedCalls');
  if (size(terms) !== 32) throw new RangeError('LimitedCalls: invalid terms length');
  return BigInt(terms);
}

export function limitedCallsCaveat(limit: number | bigint): Caveat {
  return caveat(FRAMEWORK.enforcers.limitedCalls, encodeLimitedCallsTerms(limit));
}

// ---------------------------------------------------------------- nonce

export function encodeNonceTerms(nonce: bigint): Hex {
  if (nonce < 0n) throw new RangeError('Nonce: negative nonce');
  return pad(toHex(nonce), { size: 32 });
}

export function decodeNonceTerms(terms: Hex): bigint {
  assertHexBytes(terms, 'Nonce');
  if (size(terms) !== 32) throw new RangeError('Nonce: invalid terms length');
  return BigInt(terms);
}

export function nonceCaveat(nonce: bigint): Caveat {
  return caveat(FRAMEWORK.enforcers.nonce, encodeNonceTerms(nonce));
}

// ---------------------------------------------------------------- helpers

export type KnownEnforcer = keyof typeof FRAMEWORK.enforcers;

const ENFORCER_BY_ADDRESS: Record<string, KnownEnforcer> = Object.fromEntries(
  (Object.entries(FRAMEWORK.enforcers) as [KnownEnforcer, Address][]).map(([k, a]) => [
    a.toLowerCase(),
    k,
  ]),
);

/** Identify which framework enforcer a caveat points at, or `null` for anything unknown. */
export function identifyEnforcer(enforcer: Address): KnownEnforcer | null {
  if (!isAddress(enforcer)) return null;
  return ENFORCER_BY_ADDRESS[enforcer.toLowerCase()] ?? null;
}
