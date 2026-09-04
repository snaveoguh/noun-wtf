import type { Caveat, Delegation, DelegationTypedData } from './types.js';

import { getAddress, isAddress, isHex, type Address, type Hex } from 'viem';

/** JSON wire form. `salt` is a 0x-hex string (decimal strings are accepted on input). */
export interface SerializedDelegation {
  delegate: Address;
  delegator: Address;
  authority: Hex;
  caveats: Caveat[];
  salt: Hex;
  signature: Hex;
}

function bigintToHex(v: bigint): Hex {
  return `0x${v.toString(16)}`;
}

function parseBigint(v: unknown, label: string): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === 'string' && /^(0x[\da-f]+|\d+)$/i.test(v)) return BigInt(v);
  throw new TypeError(`${label}: expected a bigint, hex string or decimal string`);
}

function parseAddress(v: unknown, label: string): Address {
  if (typeof v !== 'string' || !isAddress(v)) throw new TypeError(`${label}: not an address`);
  return getAddress(v);
}

function parseHex(v: unknown, label: string, { allowEmpty = true } = {}): Hex {
  if (typeof v !== 'string' || !isHex(v, { strict: true }))
    throw new TypeError(`${label}: not hex`);
  if (!allowEmpty && v === '0x') throw new TypeError(`${label}: must not be empty`);
  return v.toLowerCase() as Hex;
}

export function toSerializedDelegation(d: Delegation): SerializedDelegation {
  return {
    delegate: d.delegate,
    delegator: d.delegator,
    authority: d.authority,
    caveats: d.caveats.map(c => ({ enforcer: c.enforcer, terms: c.terms, args: c.args ?? '0x' })),
    salt: bigintToHex(d.salt),
    signature: d.signature,
  };
}

export function fromSerializedDelegation(input: unknown): Delegation {
  if (typeof input !== 'object' || input === null)
    throw new TypeError('delegation: expected an object');
  const o = input as Record<string, unknown>;
  if (!Array.isArray(o.caveats)) throw new TypeError('delegation.caveats: expected an array');
  const caveats: Caveat[] = o.caveats.map((c, i) => {
    if (typeof c !== 'object' || c === null)
      throw new TypeError(`caveats[${i}]: expected an object`);
    const cc = c as Record<string, unknown>;
    return {
      enforcer: parseAddress(cc.enforcer, `caveats[${i}].enforcer`),
      terms: parseHex(cc.terms, `caveats[${i}].terms`),
      args: cc.args === undefined ? '0x' : parseHex(cc.args, `caveats[${i}].args`),
    };
  });
  return {
    delegate: parseAddress(o.delegate, 'delegate'),
    delegator: parseAddress(o.delegator, 'delegator'),
    authority: parseHex(o.authority, 'authority', { allowEmpty: false }),
    caveats,
    salt: parseBigint(o.salt, 'salt'),
    signature: o.signature === undefined ? '0x' : parseHex(o.signature, 'signature'),
  };
}

/** bigint-safe JSON string of a delegation. */
export function serializeDelegation(d: Delegation): string {
  return JSON.stringify(toSerializedDelegation(d));
}

/** Inverse of {@link serializeDelegation}. Accepts a JSON string or an already-parsed object. */
export function deserializeDelegation(json: string | unknown): Delegation {
  const parsed: unknown = typeof json === 'string' ? JSON.parse(json) : json;
  return fromSerializedDelegation(parsed);
}

/**
 * JSON string of the typed data with `salt` as a decimal string — the form `eth_signTypedData_v4`
 * expects over raw JSON-RPC. viem's `signTypedData` accepts the bigint form directly.
 */
export function serializeTypedData(typedData: DelegationTypedData): string {
  return JSON.stringify(typedData, (_key, value: unknown) =>
    typeof value === 'bigint' ? value.toString(10) : value,
  );
}
