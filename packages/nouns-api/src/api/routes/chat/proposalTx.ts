/* eslint-disable unicorn/no-nested-ternary */
import {
  decodeAbiParameters,
  encodeFunctionData,
  getAddress,
  type Hex,
  parseEther,
  parseUnits,
} from 'viem';

import { nounCheckClient } from '../../lib/chain.js';

// ─── Proposal Transaction Primitives ───────────────────────────────────────
// The LLM never hand-encodes hex calldata for token transfers anymore.
// It picks a `kind` and gives human-readable amounts; the API does the math.
// Falling back to raw {target,value,signature,calldata} is allowed but
// guarded by a tight, address-aware sanity check.
const TOKEN_ADDRESSES = {
  USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  STETH: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
  PAYER: '0xd97Bcd9f47cEe35c0a9ec1dc40C1269afc9E8E1D',
} as const;

const TOKEN_DECIMALS: Record<string, number> = {
  [TOKEN_ADDRESSES.USDC.toLowerCase()]: 6,
  [TOKEN_ADDRESSES.WETH.toLowerCase()]: 18,
  [TOKEN_ADDRESSES.STETH.toLowerCase()]: 18,
};

const ERC20_TRANSFER_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

const PAYER_DEBT_ABI = [
  {
    type: 'function',
    name: 'sendOrRegisterDebt',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

export type RawProposalTx = {
  target: string;
  value?: string;
  signature?: string;
  calldata?: string;
};

export type ProposalTxPrimitive =
  | { kind: 'usdc_transfer'; recipient: string; amount: string }
  | { kind: 'usdc_payer_debt'; recipient: string; amount: string }
  | { kind: 'eth_transfer'; recipient: string; amountEth: string }
  | { kind: 'weth_transfer'; recipient: string; amountEth: string }
  | { kind: 'steth_transfer'; recipient: string; amountEth: string };

export type ProposalTxInput = ProposalTxPrimitive | RawProposalTx;

type CanonicalTx = {
  target: string;
  value: string;
  signature: string;
  calldata: string;
};

function isPrimitive(t: ProposalTxInput): t is ProposalTxPrimitive {
  return typeof (t as { kind?: unknown }).kind === 'string';
}

function checkedAddress(
  label: string,
  raw: string,
): { ok: true; value: string } | { ok: false; error: string } {
  try {
    return { ok: true, value: getAddress(raw) };
  } catch {
    return { ok: false, error: `${label} is not a valid 0x-address: ${raw}` };
  }
}

function expandPrimitive(
  p: ProposalTxPrimitive,
  idx: number,
): { ok: true; tx: CanonicalTx } | { ok: false; error: string } {
  switch (p.kind) {
    case 'usdc_transfer': {
      const addr = checkedAddress(`tx[${idx}].recipient`, p.recipient);
      if (!addr.ok) return { ok: false, error: addr.error };
      let amount: bigint;
      try {
        amount = parseUnits(p.amount, 6);
      } catch {
        return {
          ok: false,
          error: `tx[${idx}] usdc_transfer: amount "${p.amount}" is not a valid USDC amount.`,
        };
      }
      return {
        ok: true,
        tx: {
          target: TOKEN_ADDRESSES.USDC,
          value: '0',
          signature: 'transfer(address,uint256)',
          calldata: encodeFunctionData({
            abi: ERC20_TRANSFER_ABI,
            functionName: 'transfer',
            args: [addr.value as `0x${string}`, amount],
          }),
        },
      };
    }
    case 'usdc_payer_debt': {
      const addr = checkedAddress(`tx[${idx}].recipient`, p.recipient);
      if (!addr.ok) return { ok: false, error: addr.error };
      let amount: bigint;
      try {
        amount = parseUnits(p.amount, 6);
      } catch {
        return {
          ok: false,
          error: `tx[${idx}] usdc_payer_debt: amount "${p.amount}" is not a valid USDC amount.`,
        };
      }
      return {
        ok: true,
        tx: {
          target: TOKEN_ADDRESSES.PAYER,
          value: '0',
          signature: 'sendOrRegisterDebt(address,uint256)',
          calldata: encodeFunctionData({
            abi: PAYER_DEBT_ABI,
            functionName: 'sendOrRegisterDebt',
            args: [addr.value as `0x${string}`, amount],
          }),
        },
      };
    }
    case 'eth_transfer': {
      const addr = checkedAddress(`tx[${idx}].recipient`, p.recipient);
      if (!addr.ok) return { ok: false, error: addr.error };
      let wei: bigint;
      try {
        wei = parseEther(p.amountEth);
      } catch {
        return {
          ok: false,
          error: `tx[${idx}] eth_transfer: amountEth "${p.amountEth}" is not a valid ETH amount.`,
        };
      }
      return {
        ok: true,
        tx: {
          target: addr.value,
          value: wei.toString(),
          signature: '',
          calldata: '0x',
        },
      };
    }
    case 'weth_transfer':
    case 'steth_transfer': {
      const addr = checkedAddress(`tx[${idx}].recipient`, p.recipient);
      if (!addr.ok) return { ok: false, error: addr.error };
      let wei: bigint;
      try {
        wei = parseEther(p.amountEth);
      } catch {
        return {
          ok: false,
          error: `tx[${idx}] ${p.kind}: amountEth "${p.amountEth}" is not a valid amount.`,
        };
      }
      const target = p.kind === 'weth_transfer' ? TOKEN_ADDRESSES.WETH : TOKEN_ADDRESSES.STETH;
      return {
        ok: true,
        tx: {
          target,
          value: '0',
          signature: 'transfer(address,uint256)',
          calldata: encodeFunctionData({
            abi: ERC20_TRANSFER_ABI,
            functionName: 'transfer',
            args: [addr.value as `0x${string}`, wei],
          }),
        },
      };
    }
    default: {
      const exhaustive: never = p;
      return { ok: false, error: `Unknown primitive kind: ${JSON.stringify(exhaustive)}` };
    }
  }
}

// Sanity-check raw transactions. Address-aware: if the target is a known
// token contract, we know its decimals and apply a tight bound. Otherwise
// fall back to a generic 10^30 ceiling (catches the worst LLM blow-ups).
function checkRawTx(raw: RawProposalTx, idx: number): string | null {
  const sig = (raw.signature || '').trim();
  if (sig !== 'transfer(address,uint256)' && sig !== 'sendOrRegisterDebt(address,uint256)') {
    return null;
  }
  const cd = raw.calldata || '0x';
  if (!cd.startsWith('0x') || cd.length < 10) return null;
  // Strip selector if present (transfer/sendOrRegisterDebt both have 4-byte selectors)
  const body = cd.replace(/^0x/, '');
  const argHex = body.length >= 136 ? body.slice(8) : body;
  if (argHex.length < 128) return null;
  let amount: bigint;
  try {
    const decoded = decodeAbiParameters(
      [{ type: 'address' }, { type: 'uint256' }],
      ('0x' + argHex.padStart(128, '0')) as Hex,
    );
    amount = decoded[1] as bigint;
  } catch {
    return null;
  }

  const targetLower = (raw.target || '').toLowerCase();
  const knownDecimals = TOKEN_DECIMALS[targetLower];
  // sendOrRegisterDebt is USDC-only by contract design.
  const effectiveDecimals = sig === 'sendOrRegisterDebt(address,uint256)' ? 6 : knownDecimals;

  if (effectiveDecimals !== undefined) {
    // Whole-token cap: 10 billion of any single token. Anything above is
    // essentially guaranteed to be a decimal-scaling mistake. (10B USDC at
    // 6 decimals = 10^16; 10B ETH at 18 decimals = 10^28.)
    const maxRaw = 10n ** BigInt(10 + effectiveDecimals);
    if (amount > maxRaw) {
      let tokenName: string;
      if (targetLower === TOKEN_ADDRESSES.USDC.toLowerCase()) tokenName = 'USDC';
      else if (targetLower === TOKEN_ADDRESSES.WETH.toLowerCase()) tokenName = 'WETH';
      else if (targetLower === TOKEN_ADDRESSES.STETH.toLowerCase()) tokenName = 'stETH';
      else if (sig === 'sendOrRegisterDebt(address,uint256)') tokenName = 'USDC (Payer)';
      else tokenName = `token@${raw.target}`;
      return `tx[${idx}] (${sig} → ${tokenName}) decoded amount ${amount.toString()} exceeds 10B at ${effectiveDecimals} decimals. Almost certainly a scaling mistake — use the typed primitive (e.g. {kind:"usdc_transfer", amount:"20000"}) instead of raw calldata.`;
    }
  } else {
    // Unknown token. Apply generic 10^30 ceiling.
    const ABSURD = 10n ** 30n;
    if (amount > ABSURD) {
      return `tx[${idx}] (${sig}) decoded amount ${amount.toString()} is impossibly large — likely an encoding error.`;
    }
  }
  return null;
}

export function expandProposalTransactions(
  inputs: ProposalTxInput[] | undefined,
): { ok: true; txs: CanonicalTx[] } | { ok: false; error: string } {
  if (!inputs || inputs.length === 0) return { ok: true, txs: [] };
  const out: CanonicalTx[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const t = inputs[i];
    if (!t) return { ok: false, error: `tx[${i}] is missing.` };
    if (isPrimitive(t)) {
      const exp = expandPrimitive(t, i);
      if (!exp.ok) return { ok: false, error: exp.error };
      out.push(exp.tx);
    } else {
      const targetCheck = checkedAddress(`tx[${i}].target`, t.target);
      if (!targetCheck.ok) return { ok: false, error: targetCheck.error };
      const raw: RawProposalTx = {
        target: targetCheck.value,
        value: t.value || '0',
        signature: t.signature || '',
        calldata: t.calldata || '0x',
      };
      const failure = checkRawTx(raw, i);
      if (failure) return { ok: false, error: failure };
      out.push({
        target: raw.target,
        value: raw.value!,
        signature: raw.signature!,
        calldata: raw.calldata!,
      });
    }
  }
  return { ok: true, txs: out };
}

// Parse a single "send X <token> to <recipient>" transfer out of free text
// (candidate title+description). Nouns rejects empty candidates
// (MustProvideActions), so the deterministic `create candidate:` command needs
// to encode at least one action. Returns:
//   - a ProposalTxPrimitive when a transfer is found and the recipient resolves
//   - 'unresolved' when a transfer is described but the recipient is unusable
//   - null when no transfer intent is present at all
export async function parseCandidateTransfer(
  text: string,
): Promise<ProposalTxPrimitive | 'unresolved' | null> {
  const amtTok = text.match(/([\d,]+(?:\.\d+)?)\s*(eth|weth|steth|usdc)\b/i);
  if (!amtTok?.[1] || !amtTok[2]) return null; // no transfer intent → caller refuses empty candidate
  const amount = amtTok[1].replace(/,/g, '');
  const token = amtTok[2].toLowerCase();

  const recipMatch = text.match(/\bto\s+(0x[\da-f]{40}|[\da-z-]+\.eth)\b/i);
  if (!recipMatch?.[1]) return 'unresolved';
  let recipient = recipMatch[1];

  if (recipient.toLowerCase().endsWith('.eth')) {
    try {
      const resolved = await nounCheckClient.getEnsAddress({ name: recipient.toLowerCase() });
      if (!resolved) return 'unresolved';
      recipient = resolved;
    } catch {
      return 'unresolved';
    }
  }

  if (token === 'usdc') return { kind: 'usdc_transfer', recipient, amount };
  return {
    kind: token === 'eth' ? 'eth_transfer' : token === 'weth' ? 'weth_transfer' : 'steth_transfer',
    recipient,
    amountEth: amount,
  };
}
