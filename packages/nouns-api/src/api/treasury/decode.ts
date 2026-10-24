// ─── Proposal transaction decoder ────────────────────────────────────────────
//
// Turns one executed proposal action (target, value, signature, calldata) into
// what it did with the treasury's money. Pure: no RPC, no DB.
//
// Nouns proposals carry the function as a `signature` string and the ABI-encoded
// args WITHOUT the selector in `calldata` (the timelock prepends the selector).
// When `signature` is empty, `calldata` is either '0x' (plain ETH send) or a
// full call with its selector — both are handled.

import { decodeAbiParameters, parseAbiItem, toFunctionSelector, type AbiFunction } from 'viem';

import {
  CONVERSION_TARGETS,
  NOUNS_TOKEN,
  PAYER,
  STREAM_FACTORY,
  TOKENS,
  USDC,
} from './knownAddresses.js';

export interface RawProposalTx {
  target: string;
  value: bigint;
  signature: string;
  calldata: string;
}

export type Action =
  /** Plain ETH send (no function call). */
  | { type: 'eth'; to: string; wei: bigint }
  /** ERC-20 `transfer` (from the treasury) or `transferFrom(from, …)`. */
  | { type: 'token'; token: string; to: string; raw: bigint; from?: string }
  /** USDC via the Payer: `sendOrRegisterDebt(account, amount)`. */
  | { type: 'payer'; to: string; raw: bigint }
  /** Stream Factory `createStream(…)`. */
  | {
      type: 'stream';
      recipient: string;
      raw: bigint;
      token: string;
      start: number;
      stop: number;
      predicted?: string;
      payer?: string;
    }
  /** A Noun leaving via `transferFrom` / `safeTransferFrom` on the Nouns token. */
  | { type: 'noun'; from: string; to: string; nounId: number }
  /** ETH turned into another treasury asset (wrap, stake, Token Buyer). */
  | { type: 'conversion'; target: string; wei: bigint; label: string }
  /** Any other call; `wei` is the ETH sent with it (often 0). */
  | { type: 'call'; target: string; wei: bigint; fn: string };

const lc = (s: string) => s.toLowerCase();

// Signatures we know how to read when a proposal passes raw calldata with a
// selector and an empty `signature` field.
const KNOWN_SIGNATURES = [
  'transfer(address,uint256)',
  'transferFrom(address,address,uint256)',
  'safeTransferFrom(address,address,uint256)',
  'sendOrRegisterDebt(address,uint256)',
  'createStream(address,uint256,address,uint256,uint256,uint8,address)',
  'createStream(address,address,uint256,address,uint256,uint256,uint8)',
  'createStream(address,uint256,address,uint256,uint256)',
  'createStream(address,address,uint256,address,uint256,uint256)',
  'deposit()',
  'submit(address)',
] as const;

const BY_SELECTOR = new Map<string, string>(
  KNOWN_SIGNATURES.map(sig => [toFunctionSelector(`function ${sig}`), sig]),
);

/** Strip spaces and argument names: "transfer(address to, uint256 amt)" → "transfer(address,uint256)". */
export function normalizeSignature(sig: string): string {
  const s = sig.trim();
  const open = s.indexOf('(');
  if (open < 0) return s;
  const name = s.slice(0, open).trim();
  const inner = s.slice(open + 1, s.lastIndexOf(')'));
  if (inner.trim() === '') return `${name}()`;
  // Only top-level splitting is needed for the signatures we interpret; a
  // tuple arg just won't match any known signature.
  const parts = inner.split(',').map(p => p.trim().split(/\s+/)[0]);
  return `${name}(${parts.join(',')})`;
}

interface Call {
  sig: string; // normalized
  fn: string; // name only
  args: readonly unknown[] | null; // null when undecodable
}

function readCall(tx: RawProposalTx): Call | null {
  let sig = tx.signature ? normalizeSignature(tx.signature) : '';
  let data = (tx.calldata || '0x').toLowerCase();
  if (!sig) {
    if (data === '0x' || data.length < 10) return null;
    const selector = data.slice(0, 10);
    const known = BY_SELECTOR.get(selector);
    if (!known) return { sig: selector, fn: selector, args: null };
    sig = known;
    data = `0x${data.slice(10)}`;
  }
  const fn = sig.slice(0, sig.indexOf('(')) || sig;
  try {
    const item = parseAbiItem(`function ${sig}`) as AbiFunction;
    if (item.inputs.length === 0) return { sig, fn, args: [] };
    const args = decodeAbiParameters(item.inputs, data as `0x${string}`);
    return { sig, fn, args };
  } catch {
    return { sig, fn, args: null };
  }
}

const asAddr = (v: unknown) => lc(String(v));
const asBig = (v: unknown) => (typeof v === 'bigint' ? v : BigInt(String(v)));
const asNum = (v: unknown) => Number(asBig(v));

export function decodeProposalTx(tx: RawProposalTx): Action {
  const target = lc(tx.target);
  const wei = tx.value ?? 0n;
  const call = readCall(tx);

  // Plain ETH send
  if (!call) {
    const conv = CONVERSION_TARGETS[target];
    if (conv && wei > 0n) return { type: 'conversion', target, wei, label: conv };
    return { type: 'eth', to: target, wei };
  }

  const a = call.args;
  if (a) {
    // ── USDC Payer ──
    if (target === PAYER && call.sig === 'sendOrRegisterDebt(address,uint256)') {
      return { type: 'payer', to: asAddr(a[0]), raw: asBig(a[1]) };
    }

    // ── Stream Factory ──
    if (target === STREAM_FACTORY && call.fn === 'createStream') {
      switch (call.sig) {
        case 'createStream(address,uint256,address,uint256,uint256,uint8,address)':
          return {
            type: 'stream',
            recipient: asAddr(a[0]),
            raw: asBig(a[1]),
            token: asAddr(a[2]),
            start: asNum(a[3]),
            stop: asNum(a[4]),
            predicted: asAddr(a[6]),
          };
        case 'createStream(address,uint256,address,uint256,uint256)':
          return {
            type: 'stream',
            recipient: asAddr(a[0]),
            raw: asBig(a[1]),
            token: asAddr(a[2]),
            start: asNum(a[3]),
            stop: asNum(a[4]),
          };
        case 'createStream(address,address,uint256,address,uint256,uint256,uint8)':
        case 'createStream(address,address,uint256,address,uint256,uint256)':
          return {
            type: 'stream',
            payer: asAddr(a[0]),
            recipient: asAddr(a[1]),
            raw: asBig(a[2]),
            token: asAddr(a[3]),
            start: asNum(a[4]),
            stop: asNum(a[5]),
          };
      }
    }

    // ── Nouns NFT leaving the treasury ──
    if (
      target === NOUNS_TOKEN &&
      (call.sig === 'transferFrom(address,address,uint256)' ||
        call.sig === 'safeTransferFrom(address,address,uint256)')
    ) {
      return { type: 'noun', from: asAddr(a[0]), to: asAddr(a[1]), nounId: asNum(a[2]) };
    }

    // ── ERC-20 transfers (known tokens, or any `transfer` — priced later) ──
    if (call.sig === 'transfer(address,uint256)' && target !== NOUNS_TOKEN) {
      return { type: 'token', token: target, to: asAddr(a[0]), raw: asBig(a[1]) };
    }
    if (call.sig === 'transferFrom(address,address,uint256)' && TOKENS[target]) {
      return {
        type: 'token',
        token: target,
        from: asAddr(a[0]),
        to: asAddr(a[1]),
        raw: asBig(a[2]),
      };
    }
  }

  // ── ETH conversions that are calls (WETH.deposit(), stETH.submit(ref)) ──
  const conv = CONVERSION_TARGETS[target];
  if (conv && wei > 0n) return { type: 'conversion', target, wei, label: conv };

  return { type: 'call', target, wei, fn: call.fn };
}

/** USDC amounts are 6-decimal; ETH-likes 18. Unknown tokens → null. */
export function tokenUnits(token: string, raw: bigint): number | null {
  const info = TOKENS[lc(token)];
  if (!info) return null;
  return Number(raw) / 10 ** info.decimals;
}

export const isUsdc = (token: string) => lc(token) === USDC;
