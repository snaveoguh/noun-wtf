// ─── Proposal calldata decoder ───────────────────────────────────────────────
//
// Turns the raw on-chain (target, value, signature, calldata) tuples that come
// out of a `ProposalCreated` event into structured, human-readable actions.
//
// Deterministic. No LLM. The LLM later writes voice copy *on top of* this
// output — never letting it guess what a proposal does, which is how you avoid
// the bot saying "sends 100 ETH" when it actually sends 1000.
//
// Each transaction in a Nouns proposal is shaped as:
//   - target:   contract being called (or recipient for raw ETH sends)
//   - value:    ETH (wei) attached
//   - signature: human-readable function sig, e.g. "transfer(address,uint256)"
//               When non-empty, the calldata holds ONLY the encoded args.
//               When empty, the calldata is the full ABI-encoded call.
//   - calldata: the arg bytes (or full call if signature is empty)

import {
  type Hex,
  decodeAbiParameters,
  parseAbiItem,
  parseAbiParameters,
  toFunctionSignature,
} from 'viem';

import { labelForAddress, shortAddr } from './addresses.js';

// ─── Decoded action shapes ──────────────────────────────────────────────────

export type DecodedAction =
  | EthTransferAction
  | UsdcPaymentAction
  | StreamCreationAction
  | KnownContractCallAction
  | RawCallAction;

interface BaseAction {
  index: number;
  target: Hex;
  targetLabel: string | null;
  ethValue: bigint;
}

export interface EthTransferAction extends BaseAction {
  kind: 'eth_transfer';
  recipient: Hex;
  amount: bigint;
}

export interface UsdcPaymentAction extends BaseAction {
  kind: 'usdc_payment';
  recipient: Hex;
  amountMicro: bigint;
  amountUsd: number;
}

export interface StreamCreationAction extends BaseAction {
  kind: 'stream';
  payer: Hex | null;
  recipient: Hex;
  tokenAmount: bigint;
  tokenAddress: Hex;
  tokenSymbol: string | null;
  startTime: bigint;
  stopTime: bigint;
  durationDays: number;
}

export interface KnownContractCallAction extends BaseAction {
  kind: 'contract_call';
  functionName: string;
  signature: string;
  args: ReadonlyArray<unknown> | null;
  argsRendered: string | null;
}

export interface RawCallAction extends BaseAction {
  kind: 'raw';
  signature: string;
  calldata: Hex;
}

// ─── Input shape ────────────────────────────────────────────────────────────

export interface RawTransaction {
  index: number;
  target: Hex;
  value: bigint;
  signature: string;
  calldata: Hex;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const USDC_PAYER = '0xd97bcd9f47cee35c0a9ec1dc40c1269afc9e8e1d';
const STREAM_FACTORY = '0x0fd206fc7a7dbcd5661157edcb1ffdd0d02a61ff';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

const TOKEN_SYMBOLS: Record<string, string> = {
  [USDC]: 'USDC',
  [WETH]: 'WETH',
};

// ─── Decoders for specific signatures ───────────────────────────────────────

function tryDecodeUsdcPayment(tx: RawTransaction): UsdcPaymentAction | null {
  if (tx.target.toLowerCase() !== USDC_PAYER) return null;
  if (!/^sendOrRegisterDebt\(/.test(tx.signature)) return null;

  try {
    const [recipient, amountMicro] = decodeAbiParameters(
      parseAbiParameters('address, uint256'),
      tx.calldata,
    ) as [Hex, bigint];
    return {
      kind: 'usdc_payment',
      index: tx.index,
      target: tx.target,
      targetLabel: 'USDC Payer',
      ethValue: tx.value,
      recipient,
      amountMicro,
      amountUsd: Number(amountMicro) / 1_000_000,
    };
  } catch {
    return null;
  }
}

function tryDecodeStreamCreation(tx: RawTransaction): StreamCreationAction | null {
  if (tx.target.toLowerCase() !== STREAM_FACTORY) return null;
  if (!/^createStream\(/.test(tx.signature) && !/^createAndFundStream\(/.test(tx.signature)) {
    return null;
  }

  // Both `createStream` overloads and `createAndFundStream` share the same
  // arg layout for the variant the DAO actually uses on-chain.
  //   createStream(address payer, address recipient, uint256 tokenAmount,
  //                address tokenAddress, uint256 startTime, uint256 stopTime,
  //                uint8 nonce)
  // Older variants drop `payer` and `nonce`. Try the long form first, fall
  // back to the short one.
  const longParams = parseAbiParameters(
    'address payer, address recipient, uint256 tokenAmount, address tokenAddress, uint256 startTime, uint256 stopTime, uint8 nonce',
  );
  const shortParams = parseAbiParameters(
    'address recipient, uint256 tokenAmount, address tokenAddress, uint256 startTime, uint256 stopTime, uint8 nonce',
  );

  let payer: Hex | null = null;
  let recipient: Hex;
  let tokenAmount: bigint;
  let tokenAddress: Hex;
  let startTime: bigint;
  let stopTime: bigint;

  try {
    const decoded = decodeAbiParameters(longParams, tx.calldata) as [
      Hex,
      Hex,
      bigint,
      Hex,
      bigint,
      bigint,
      number,
    ];
    [payer, recipient, tokenAmount, tokenAddress, startTime, stopTime] = decoded;
  } catch {
    try {
      const decoded = decodeAbiParameters(shortParams, tx.calldata) as [
        Hex,
        bigint,
        Hex,
        bigint,
        bigint,
        number,
      ];
      [recipient, tokenAmount, tokenAddress, startTime, stopTime] = decoded;
    } catch {
      return null;
    }
  }

  const durationSec = Number(stopTime - startTime);
  const durationDays = Math.max(0, Math.round(durationSec / 86_400));
  const tokenSymbol = TOKEN_SYMBOLS[tokenAddress.toLowerCase()] ?? null;

  return {
    kind: 'stream',
    index: tx.index,
    target: tx.target,
    targetLabel: 'Stream Factory',
    ethValue: tx.value,
    payer,
    recipient,
    tokenAmount,
    tokenAddress,
    tokenSymbol,
    startTime,
    stopTime,
    durationDays,
  };
}

// Best-effort: pull args out of any signature we can parse with viem.
function tryDecodeKnownCall(tx: RawTransaction): KnownContractCallAction | null {
  if (!tx.signature) return null;
  let functionName: string;
  let argsRendered: string | null = null;
  let args: ReadonlyArray<unknown> | null = null;
  try {
    // viem can parse a sig like `transfer(address,uint256)` into an ABI item.
    const abiItem = parseAbiItem(`function ${tx.signature}`) as {
      name: string;
      inputs: ReadonlyArray<{ name?: string; type: string }>;
    };
    functionName = abiItem.name;
    const decoded = decodeAbiParameters(
      abiItem.inputs.map(i => ({ name: i.name ?? '', type: i.type })),
      tx.calldata,
    );
    args = decoded;
    argsRendered = abiItem.inputs
      .map((input, i) => {
        const v = decoded[i];
        const label = input.name || input.type;
        return `${label}=${renderArg(v, input.type)}`;
      })
      .join(', ');
  } catch {
    return null;
  }

  return {
    kind: 'contract_call',
    index: tx.index,
    target: tx.target,
    targetLabel: labelForAddress(tx.target)?.name ?? null,
    ethValue: tx.value,
    functionName,
    signature: tx.signature,
    args,
    argsRendered,
  };
}

function renderArg(value: unknown, type: string): string {
  if (value == null) return 'null';
  if (type === 'address') {
    const addr = value as Hex;
    const label = labelForAddress(addr)?.name;
    return label ? `${label} (${shortAddr(addr)})` : shortAddr(addr);
  }
  if (type.startsWith('uint') || type.startsWith('int')) {
    return (value as bigint).toString();
  }
  if (type === 'bool') return String(value);
  if (type === 'string') return JSON.stringify(value);
  if (type === 'bytes' || type.startsWith('bytes')) {
    const s = value as string;
    return s.length > 20 ? `${s.slice(0, 12)}…(${s.length / 2 - 1} bytes)` : s;
  }
  if (Array.isArray(value)) return `[${value.length}]`;
  return String(value);
}

// ─── Public entry point ─────────────────────────────────────────────────────

export function decodeProposalTransactions(txs: RawTransaction[]): DecodedAction[] {
  return txs.sort((a, b) => a.index - b.index).map(tx => decodeOne(tx));
}

function decodeOne(tx: RawTransaction): DecodedAction {
  // 1. Plain ETH send (no signature, no calldata, value > 0)
  if (!tx.signature && (!tx.calldata || tx.calldata === '0x') && tx.value > 0n) {
    return {
      kind: 'eth_transfer',
      index: tx.index,
      target: tx.target,
      targetLabel: labelForAddress(tx.target)?.name ?? null,
      ethValue: tx.value,
      recipient: tx.target,
      amount: tx.value,
    };
  }

  // 2. USDC payment via NounsPayer
  const usdc = tryDecodeUsdcPayment(tx);
  if (usdc) return usdc;

  // 3. Stream creation via StreamFactory
  const stream = tryDecodeStreamCreation(tx);
  if (stream) return stream;

  // 4. Any other call we can decode against its signature
  const known = tryDecodeKnownCall(tx);
  if (known) return known;

  // 5. Last resort — surface as raw so the drafter can flag "this is opaque"
  return {
    kind: 'raw',
    index: tx.index,
    target: tx.target,
    targetLabel: labelForAddress(tx.target)?.name ?? null,
    ethValue: tx.value,
    signature: tx.signature || '<no-signature>',
    calldata: tx.calldata,
  };
}

// ─── Human-readable rendering ───────────────────────────────────────────────
//
// What the drafter sees when it's writing copy. Compact, factually exact, no
// fluff. Each line is one decoded action.

export function renderActionLine(action: DecodedAction): string {
  switch (action.kind) {
    case 'eth_transfer': {
      const eth = formatEth(action.amount);
      const to = labelForAddress(action.recipient)?.name ?? shortAddr(action.recipient);
      return `[${action.index}] send ${eth} ETH → ${to}`;
    }
    case 'usdc_payment': {
      const to = labelForAddress(action.recipient)?.name ?? shortAddr(action.recipient);
      return `[${action.index}] pay $${action.amountUsd.toLocaleString()} USDC → ${to}`;
    }
    case 'stream': {
      const to = shortAddr(action.recipient);
      const sym = action.tokenSymbol ?? shortAddr(action.tokenAddress);
      const amt =
        action.tokenSymbol === 'USDC'
          ? `$${(Number(action.tokenAmount) / 1_000_000).toLocaleString()}`
          : (action.tokenSymbol === 'WETH'
            ? `${formatEth(action.tokenAmount)} WETH`
            : action.tokenAmount.toString());
      return `[${action.index}] stream ${amt} ${sym === 'USDC' || sym === 'WETH' ? '' : sym + ' '}→ ${to} over ${action.durationDays}d`;
    }
    case 'contract_call': {
      const to = action.targetLabel ?? shortAddr(action.target);
      const argSummary = action.argsRendered ? ` (${action.argsRendered})` : '';
      const ethSuffix = action.ethValue > 0n ? ` + ${formatEth(action.ethValue)} ETH` : '';
      return `[${action.index}] ${to}.${action.functionName}${argSummary}${ethSuffix}`;
    }
    case 'raw': {
      const to = action.targetLabel ?? shortAddr(action.target);
      const ethSuffix = action.ethValue > 0n ? ` + ${formatEth(action.ethValue)} ETH` : '';
      return `[${action.index}] ${to} CALL ${action.signature}${ethSuffix} (raw calldata, undecoded)`;
    }
  }
}

export function renderActionsBlock(actions: DecodedAction[]): string {
  return actions.map(renderActionLine).join('\n');
}

function formatEth(wei: bigint): string {
  const eth = Number(wei) / 1e18;
  if (eth >= 1) return eth.toFixed(2);
  if (eth >= 0.001) return eth.toFixed(4);
  return eth.toExponential(2);
}

// Just for completeness — gives back the function selector if needed.
export function selectorOf(signature: string): Hex | null {
  if (!signature) return null;
  try {
    const sig = toFunctionSignature(`function ${signature}`);
    return sig as Hex;
  } catch {
    return null;
  }
}
