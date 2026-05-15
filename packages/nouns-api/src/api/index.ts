/* eslint-disable unicorn/no-nested-ternary */
import { metricsMiddleware, getMetrics, getRecentErrors, getBufferSize } from './metrics.js';

// Agent Hub client — replaces direct Anthropic SDK calls
const AGENT_HUB_URL = process.env.AGENT_HUB_URL || 'http://localhost:3100';
const AGENT_HUB_SECRET = process.env.AGENT_HUB_SECRET || '';

interface HubChatRequest {
  messages: Array<{
    role: string;
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>;
    tool_call_id?: string;
  }>;
  system?: string;
  task?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: Array<{
    type: 'function';
    function: { name: string; description?: string; parameters?: Record<string, unknown> };
  }>;
  stream?: boolean;
  timeoutMs?: number;
}

interface HubChatResponse {
  text: string | null;
  model: string;
  provider: string;
  usage: { input: number; output: number };
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  finishReason?: string;
  error?: string;
}

async function hubChat(request: HubChatRequest): Promise<HubChatResponse> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (AGENT_HUB_SECRET) headers.authorization = `Bearer ${AGENT_HUB_SECRET}`;

  const res = await fetch(`${AGENT_HUB_URL}/v1/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(request.timeoutMs ?? 60_000),
  });

  const payload = (await res.json()) as HubChatResponse;
  if (!res.ok || payload.error) {
    throw new Error(payload.error || `Hub returned ${res.status}`);
  }
  return payload;
}

const NOUNIRL_PIPE_UNLOCK_MESSAGE =
  'if you are here it is likely you know where to find my pipe, talk to him to get this unlocked';

function isUpstreamAiFailure(errMsg: string) {
  return /all providers failed|rate limit reached|credit limit exceeded|credit limit|429\b|402\b/i.test(
    errMsg,
  );
}

/**
 * Fallback parser for when the LLM generates XML tool calls in its text response
 * instead of returning structured tool_calls (common with Groq/Llama models).
 * Mutates the response in-place: extracts tool calls, sets finishReason, strips XML from text.
 */
function patchXmlToolCalls(response: HubChatResponse): void {
  // Normalize Anthropic's 'tool_use' → 'tool_calls' so the main loop condition works
  if (response.finishReason === 'tool_use') {
    response.finishReason = 'tool_calls';
  }
  if (response.finishReason === 'tool_calls' && response.toolCalls?.length) return; // already structured

  const text = response.text ?? '';
  const toolCalls: NonNullable<HubChatResponse['toolCalls']> = [];
  let idx = 0;

  // ── Format 1: <tool_call>{"name":"...", "arguments":{...}}</tool_call> ──
  for (const m of text.matchAll(/<tool_call>\s*([\S\s]*?)\s*<\/tool_call>/g)) {
    try {
      const parsed = JSON.parse(m[1]);
      const name = parsed.name ?? parsed.function?.name;
      const args = parsed.arguments ?? parsed.function?.arguments ?? {};
      if (name) {
        toolCalls.push({
          id: `text-fallback-${idx++}`,
          type: 'function',
          function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
        });
      }
    } catch {
      /* malformed JSON — skip */
    }
  }

  // ── Format 2: <invoke name="..."><parameter name="...">value</parameter></invoke> ──
  if (!toolCalls.length) {
    const paramPattern = /<parameter\s+name="([^"]+)">([\S\s]*?)<\/parameter>/g;
    for (const m of text.matchAll(/<invoke\s+name="([^"]+)">([\S\s]*?)<\/invoke>/g)) {
      const params: Record<string, unknown> = {};
      for (const pm of m[2].matchAll(paramPattern)) {
        const raw = pm[2].trim();
        try {
          params[pm[1]] = JSON.parse(raw);
        } catch {
          params[pm[1]] = raw;
        }
      }
      toolCalls.push({
        id: `text-fallback-${idx++}`,
        type: 'function',
        function: { name: m[1], arguments: JSON.stringify(params) },
      });
    }
  }

  if (toolCalls.length) {
    console.log(
      `[NounIRL] Recovered ${toolCalls.length} tool call(s) from text: ${toolCalls.map(t => t.function.name).join(', ')}`,
    );
    response.toolCalls = toolCalls;
    response.finishReason = 'tool_calls';
    // Strip all tool-call markup from text so the user sees clean output
    response.text =
      text
        .replace(/<tool_call>[\S\s]*?<\/tool_call>/g, '')
        .replace(/<function_calls>[\S\s]*?<\/function_calls>/g, '')
        .replace(/<invoke\s+name="[^"]*">[\S\s]*?<\/invoke>/g, '')
        .trim() || null;
  }
}
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Agent NounIRL

import { and, desc, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { graphql } from 'ponder';
import { db } from 'ponder:api';
import schema from 'ponder:schema';
import sharp from 'sharp';
import {
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  type Hex,
  parseEther,
  parseUnits,
  verifyTypedData,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';

import { smallGrantsTreasuryAbi } from '../abi/SmallGrantsTreasury.js';
import { NOUNS_TOKEN_ADDRESS, NOUNS_TOKEN_ABI, MIN_NOUNS_FOR_DEPLOY } from '../agent/constants.js';
import {
  initAgent,
  reservationStore,
  verifyTip,
  getAgentBalance,
  getWatcherState,
  checkNow,
  settleAuction,
  parseTraitDescription,
  getAllTraitNames,
  getDeployHistory,
  canDeploy,
  generatePatch,
  applyAndDeploy,
  isBridgeConfigured,
  remember,
  recall,
  buildMemoryContext,
  buildGovernanceContext,
  buildLiveAuctionContext,
  buildProposalsAndGrantsContext,
  learnFromUrl,
  batchLearn,
  getKnowledgeStats,
  runSelfLearn,
  buildPeopleDb,
  getBuildStatus,
  listPeople,
  getPerson,
  searchPeople,
  getPeopleCount,
  buildPeopleContext,
  detectFunction,
  buildFunctionSkillPromptSnippet,
  predictSeed,
  seedToTraitNames,
} from '../agent/index.js';
import { NOUN_V2_KNOWLEDGE } from '../agent/nounV2Knowledge.js';
import {
  getPositions as getTradingPositions,
  getPerformance as getTradingPerformance,
  getSignals as getTradingSignals,
} from '../agent/tradingClient.js';

// ─── Noun Balance Check (for deploy gating) ────────────────────────────────
const nounCheckClient = createPublicClient({
  chain: mainnet,
  transport: http(process.env.PONDER_RPC_URL_1 || 'https://ethereum-rpc.publicnode.com'),
});

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

// ─── Block Timing Helpers ──────────────────────────────────────────────────
const BLOCK_TIME_SECONDS = 12;

async function getCurrentBlock(): Promise<bigint> {
  return nounCheckClient.getBlockNumber();
}

function formatBlocksRemaining(
  currentBlock: bigint,
  endBlock: string | bigint | null | undefined,
): { blocksLeft: number; timeLeftHours: number; timeLeftFormatted: string; hasEnded: boolean } {
  if (!endBlock)
    return { blocksLeft: 0, timeLeftHours: 0, timeLeftFormatted: 'unknown', hasEnded: true };
  const end = BigInt(endBlock);
  if (currentBlock >= end) {
    return { blocksLeft: 0, timeLeftHours: 0, timeLeftFormatted: 'ended', hasEnded: true };
  }
  const blocksLeft = Number(end - currentBlock);
  const secondsLeft = blocksLeft * BLOCK_TIME_SECONDS;
  const hoursLeft = secondsLeft / 3600;
  let formatted: string;
  if (hoursLeft < 1) {
    const mins = Math.round(secondsLeft / 60);
    formatted = `~${mins} minutes`;
  } else if (hoursLeft < 24) {
    formatted = `~${hoursLeft.toFixed(1)} hours`;
  } else {
    const days = hoursLeft / 24;
    formatted = `~${days.toFixed(1)} days`;
  }
  return { blocksLeft, timeLeftHours: hoursLeft, timeLeftFormatted: formatted, hasEnded: false };
}

async function getNounBalance(address: string): Promise<number> {
  try {
    const balance = await nounCheckClient.readContract({
      address: NOUNS_TOKEN_ADDRESS,
      abi: NOUNS_TOKEN_ABI,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    });
    return Number(balance);
  } catch (err) {
    console.error('[NounIRL] Failed to check Noun balance:', err);
    return 0;
  }
}

const app = new Hono();

// Initialize Agent NounIRL (non-blocking — starts block watcher in background)
try {
  initAgent();
} catch (err) {
  console.error('[NounIRL] Agent init failed (non-fatal):', err);
}

// CORS — allow noun.wtf and localhost
app.use(
  '*',
  cors({
    origin: [
      'https://noun.wtf',
      'https://dev-noun-wtf.netlify.app',
      'http://localhost:5173',
      'http://localhost:3000',
    ],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Accept'],
  }),
);

// Request metrics
app.use('*', metricsMiddleware);

// ============================================================
// GraphQL (Ponder) — with derived proposal status
// ============================================================

// Cache latest block for status computation (refreshed every 30s)
let cachedLatestBlock: bigint = 0n;
let cachedBlockAt = 0;

async function getLatestBlockCached(): Promise<bigint> {
  if (Date.now() - cachedBlockAt < 30_000 && cachedLatestBlock > 0n) return cachedLatestBlock;
  try {
    cachedLatestBlock = await getCurrentBlock();
    cachedBlockAt = Date.now();
  } catch {
    /* keep stale value */
  }
  return cachedLatestBlock;
}

/** Recursively walk a JSON value and patch any proposal-like objects with computed status */
function patchProposalStatuses(data: unknown, latestBlock: bigint): void {
  if (!data || typeof data !== 'object') return;
  if (Array.isArray(data)) {
    for (const item of data) patchProposalStatuses(item, latestBlock);
    return;
  }
  const obj = data as Record<string, unknown>;
  // A proposal-like object has status + endBlock + forVotes
  if (typeof obj.status === 'string' && obj.endBlock !== undefined && obj.forVotes !== undefined) {
    obj.status = computeDerivedStatus(
      {
        status: obj.status as string,
        forVotes: Number(obj.forVotes),
        againstVotes: Number(obj.againstVotes ?? 0),
        quorumVotes: BigInt(obj.quorumVotes ?? 0),
        endBlock: BigInt(obj.endBlock ?? 0),
        objectionPeriodEndBlock: obj.objectionPeriodEndBlock
          ? BigInt(obj.objectionPeriodEndBlock as string)
          : null,
        executionETA: obj.executionETA ? BigInt(obj.executionETA as string) : null,
        onTimelockV1: obj.onTimelockV1 === true,
        startBlock: BigInt(obj.startBlock ?? 0),
      },
      latestBlock,
    );
  }
  // A grant-like object has status + endBlock + forVotes but NO quorumVotes
  if (
    typeof obj.status === 'string' &&
    obj.endBlock !== undefined &&
    obj.forVotes !== undefined &&
    obj.quorumVotes === undefined &&
    obj.snapshotBlock !== undefined
  ) {
    obj.status = computeDerivedGrantStatus(obj, latestBlock);
  }

  // Recurse into nested objects (items, proposals, node, edges, etc.)
  for (const val of Object.values(obj)) {
    if (val && typeof val === 'object') patchProposalStatuses(val, latestBlock);
  }
}

/** Compute derived grant status — grants have no quorum, simple majority wins */
function computeDerivedGrantStatus(g: Record<string, unknown>, latestBlock: bigint): string {
  const status = g.status as string;
  if (['CANCELED', 'EXECUTED'].includes(status)) return status;

  if (status === 'QUEUED') {
    if (g.executionETA) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const gracePeriod = 14 * 86400;
      if (nowSeconds >= Number(g.executionETA) + gracePeriod) return 'EXPIRED';
    }
    return 'QUEUED';
  }

  // ACTIVE grants past endBlock: check votes
  if (status === 'ACTIVE') {
    const endBlock = BigInt(g.endBlock as string | number);
    if (latestBlock > endBlock) {
      const forVotes = Number(g.forVotes);
      const againstVotes = Number(g.againstVotes ?? 0);
      if (forVotes === 0 || forVotes <= againstVotes) return 'DEFEATED';
      return 'SUCCEEDED';
    }
  }

  return status;
}

/**
 * Middleware that:
 * 1. Buffers Yoga's response fully to avoid Railway/Fastly chunked-transfer truncation
 * 2. Computes derived proposal statuses
 * 3. Re-emits with explicit Content-Length (no chunked encoding)
 */
async function graphqlWithDerivedStatus(
  c: { res: Response; [key: string]: unknown },
  next: () => Promise<void>,
) {
  await next();
  const ct = c.res.headers.get('content-type') || '';
  if (!ct.includes('json')) return;

  // Read full body as text first — works even if JSON is malformed
  let text: string;
  try {
    text = await c.res.text();
  } catch {
    return; // stream error — pass through
  }

  // Try to parse, patch statuses, re-stringify
  try {
    const body = JSON.parse(text);
    if (body?.data) {
      const latestBlock = await getLatestBlockCached();
      if (latestBlock > 0n) patchProposalStatuses(body.data, latestBlock);
    }
    text = JSON.stringify(body);
  } catch {
    // Malformed JSON — still re-emit the raw text with proper headers
  }

  // Re-emit with explicit Content-Length and no chunked transfer-encoding
  const headers = new Headers(c.res.headers);
  headers.delete('transfer-encoding');
  headers.set('content-length', String(new TextEncoder().encode(text).byteLength));
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8');
  }
  c.res = new Response(text, { status: 200, headers });
}

app.use('/', graphqlWithDerivedStatus, graphql({ db, schema }));
app.use('/graphql', graphqlWithDerivedStatus, graphql({ db, schema }));

// ============================================================
// REST endpoints — bypass GraphQL/Yoga chunked encoding (Fastly truncates it)
// ============================================================

/** All proposals with signers — single JSON response, no chunked encoding */
app.get('/api/proposals', async c => {
  const proposals = await db
    .select()
    .from(schema.proposal)
    .orderBy(desc(schema.proposal.createdAtBlock));
  const signers = await db.select().from(schema.proposalSigner);
  const signerMap = new Map<string, string[]>();
  for (const s of signers) {
    const key = String(s.proposalId);
    if (!signerMap.has(key)) signerMap.set(key, []);
    signerMap.get(key)!.push(s.signer);
  }
  const latestBlock = await getLatestBlockCached();
  const items = proposals.map(p => {
    const item: Record<string, unknown> = {
      ...p,
      id: String(p.id),
      startBlock: String(p.startBlock),
      endBlock: String(p.endBlock),
      proposalThreshold: String(p.proposalThreshold),
      quorumVotes: String(p.quorumVotes),
      executionETA: p.executionETA != null ? String(p.executionETA) : null,
      objectionPeriodEndBlock:
        p.objectionPeriodEndBlock != null ? String(p.objectionPeriodEndBlock) : null,
      updatePeriodEndBlock: p.updatePeriodEndBlock != null ? String(p.updatePeriodEndBlock) : null,
      voteSnapshotBlock: p.voteSnapshotBlock != null ? String(p.voteSnapshotBlock) : null,
      createdAtBlock: String(p.createdAtBlock),
      createdAt: String(new Date(p.createdAt).getTime()),
      signers: signerMap.get(String(p.id)) ?? [],
    };
    if (latestBlock > 0n) {
      item.status = computeDerivedStatus(
        {
          status: p.status,
          forVotes: p.forVotes,
          againstVotes: p.againstVotes,
          quorumVotes: BigInt(p.quorumVotes),
          endBlock: BigInt(p.endBlock),
          objectionPeriodEndBlock:
            p.objectionPeriodEndBlock != null ? BigInt(p.objectionPeriodEndBlock) : null,
          executionETA: p.executionETA != null ? BigInt(p.executionETA) : null,
          onTimelockV1: p.onTimelockV1,
          startBlock: BigInt(p.startBlock),
        },
        latestBlock,
      );
    }
    return item;
  });
  return c.json(items);
});

/** Single proposal with votes, signers, transactions — bypasses GraphQL/Fastly truncation */
app.get('/api/proposals/:id', async c => {
  const idParam = c.req.param('id');
  const allProposals = await db.select().from(schema.proposal);
  const p = allProposals.find(pr => String(pr.id) === idParam);
  if (!p) return c.json({ error: 'not found' }, 404);

  const signers = await db.select().from(schema.proposalSigner);
  const proposalSigners = signers.filter(s => String(s.proposalId) === idParam);

  const allVotes = await db.select().from(schema.vote).orderBy(desc(schema.vote.createdAtBlock));
  const votes = allVotes.filter(v => String(v.proposalId) === idParam);

  const allTxs = await db.select().from(schema.transaction);
  const proposalTxs = allTxs.filter(t => String(t.proposalId) === idParam);

  const latestBlock = await getLatestBlockCached();

  const item: Record<string, unknown> = {
    ...p,
    id: String(p.id),
    startBlock: String(p.startBlock),
    endBlock: String(p.endBlock),
    proposalThreshold: String(p.proposalThreshold),
    quorumVotes: String(p.quorumVotes),
    executionETA: p.executionETA != null ? String(p.executionETA) : null,
    objectionPeriodEndBlock:
      p.objectionPeriodEndBlock != null ? String(p.objectionPeriodEndBlock) : null,
    updatePeriodEndBlock: p.updatePeriodEndBlock != null ? String(p.updatePeriodEndBlock) : null,
    voteSnapshotBlock: p.voteSnapshotBlock != null ? String(p.voteSnapshotBlock) : null,
    createdAtBlock: String(p.createdAtBlock),
    createdAt: String(new Date(p.createdAt).getTime()),
    signers: proposalSigners.map(s => s.signer),
    // Ponder returns BigInts for proposalId / value — stringify so Hono can JSON-serialize.
    transactions: proposalTxs.map(t => ({
      index: t.index,
      proposalId: String(t.proposalId),
      target: t.target,
      value: String(t.value),
      signature: t.signature,
      calldata: t.calldata,
    })),
  };
  if (latestBlock > 0n) {
    item.status = computeDerivedStatus(
      {
        status: p.status,
        forVotes: p.forVotes,
        againstVotes: p.againstVotes,
        quorumVotes: BigInt(p.quorumVotes),
        endBlock: BigInt(p.endBlock),
        objectionPeriodEndBlock:
          p.objectionPeriodEndBlock != null ? BigInt(p.objectionPeriodEndBlock) : null,
        executionETA: p.executionETA != null ? BigInt(p.executionETA) : null,
        onTimelockV1: p.onTimelockV1,
        startBlock: BigInt(p.startBlock),
      },
      latestBlock,
    );
  }

  return c.json({
    proposal: item,
    votes: votes.map(v => ({
      voter: v.voter,
      support: v.support,
      votes: v.votes,
      reason: v.reason,
      createdAtBlock: String(v.createdAtBlock),
      createdAtTransaction: v.createdAtTransaction,
    })),
  });
});

/** Extract original signer from description tag, strip the tag */
function extractSigner(desc: string): { signer: string | null; description: string } {
  const match = desc.match(/^<!--\s*signer:(0x[\dA-Fa-f]{40})\s*-->\n?/);
  if (match) {
    return { signer: match[1], description: desc.slice(match[0].length) };
  }
  return { signer: null, description: desc };
}

/**
 * Single candidate by id — used by the OG-image edge function so /candidates/:id
 * unfurls can pull the first image from the body without hitting the subgraph.
 * Candidate `id` is `${proposer}-${slug}` (matches the schema primary key).
 * Slug-only fallback supports legacy share URLs that drop the proposer prefix.
 */
app.get('/api/candidates/:id', async c => {
  const idParam = c.req.param('id');
  if (!idParam) return c.json({ error: 'id required' }, 400);

  // Try exact id match first.
  const byId = await db
    .select()
    .from(schema.candidate)
    .where(eq(schema.candidate.id, idParam))
    .limit(1);

  let candidate = byId[0];

  // Fallback: lookup by slug if the id-prefixed form didn't hit. Picks the
  // most recently created match — slug collisions across proposers are rare
  // but possible.
  if (!candidate) {
    const bySlug = await db
      .select()
      .from(schema.candidate)
      .where(eq(schema.candidate.slug, idParam))
      .orderBy(desc(schema.candidate.createdAtBlock))
      .limit(1);
    candidate = bySlug[0];
  }

  if (!candidate) return c.json({ error: 'not found' }, 404);

  return c.json({
    id: candidate.id,
    slug: candidate.slug,
    proposer: candidate.proposer,
    description: candidate.description,
    canceled: candidate.canceled,
    versionsCount: candidate.versionsCount,
    promotedToProposalId:
      candidate.promotedToProposalId != null ? String(candidate.promotedToProposalId) : null,
    createdAt: String(new Date(candidate.createdAt).getTime()),
  });
});

/** All grants — single JSON response, with derived status (DEFEATED/SUCCEEDED) */
app.get('/api/grants', async c => {
  const grants = await db.select().from(schema.grant).orderBy(desc(schema.grant.id));
  const latestBlock = await getLatestBlockCached();
  const items = grants.map(g => {
    const { signer, description } = extractSigner(g.description);
    const item: Record<string, unknown> = {
      ...g,
      id: String(g.id),
      description,
      signer,
      snapshotBlock: String(g.snapshotBlock),
      startBlock: String(g.startBlock),
      endBlock: String(g.endBlock),
      createdAtBlock: String(g.createdAtBlock),
      executionETA: g.executionETA != null ? String(g.executionETA) : null,
      createdAt: String(new Date(g.createdAt).getTime()),
    };
    if (latestBlock > 0n) {
      item.status = computeDerivedGrantStatus(item, latestBlock);
    }
    return item;
  });
  return c.json(items);
});

/** Single grant with votes and status changes — bypasses GraphQL truncation */
app.get('/api/grants/:id', async c => {
  const idParam = c.req.param('id');
  const allGrants = await db.select().from(schema.grant);
  const g = allGrants.find(gr => String(gr.id) === idParam);
  if (!g) return c.json({ error: 'not found' }, 404);

  const allVotes = await db
    .select()
    .from(schema.grantVote)
    .orderBy(desc(schema.grantVote.createdAtBlock));
  const votes = allVotes.filter(v => String(v.grantId) === idParam);

  const allChanges = await db
    .select()
    .from(schema.grantStatusChange)
    .orderBy(schema.grantStatusChange.createdAtBlock);
  const changes = allChanges.filter(sc => String(sc.grantId) === idParam);

  const latestBlock = await getLatestBlockCached();

  const { signer, description } = extractSigner(g.description);
  const item: Record<string, unknown> = {
    ...g,
    id: String(g.id),
    description,
    signer,
    snapshotBlock: String(g.snapshotBlock),
    startBlock: String(g.startBlock),
    endBlock: String(g.endBlock),
    createdAtBlock: String(g.createdAtBlock),
    executionETA: g.executionETA != null ? String(g.executionETA) : null,
    createdAt: String(new Date(g.createdAt).getTime()),
  };
  if (latestBlock > 0n) {
    item.status = computeDerivedGrantStatus(item, latestBlock);
  }

  return c.json({
    grant: item,
    votes: votes.map(v => ({
      voter: v.voter,
      support: v.support,
      votes: v.votes,
      reason: v.reason,
      createdAtTransaction: v.createdAtTransaction,
    })),
    statusChanges: changes.map(sc => ({
      status: sc.status,
      createdAtBlock: String(sc.createdAtBlock),
      createdAtTransaction: sc.createdAtTransaction,
    })),
  });
});

// ============================================================
// NounV2 — fork endpoints. Same shape as /api/grants and /api/auction-stats
// so the webapp can consume them without branching. Addresses come from env
// vars and may be zero until the mainnet deploy lands.
// ============================================================

const NOUNV2_AUCTION_HOUSE_ADDRESS = (process.env.NOUNV2_AUCTION_HOUSE_ADDRESS ??
  '0x0000000000000000000000000000000000000000') as `0x${string}`;

const NOUNV2_AUCTION_ABI = [
  {
    type: 'function',
    name: 'auction',
    inputs: [],
    outputs: [
      { name: 'nounId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'startTime', type: 'uint256' },
      { name: 'endTime', type: 'uint256' },
      { name: 'bidder', type: 'address' },
      { name: 'settled', type: 'bool' },
    ],
    stateMutability: 'view',
  },
] as const;

const NOUNV2_CURRENT_AUCTION_CACHE_TTL_MS = 15_000;
let nounV2CurrentAuctionCache: { at: number; payload: unknown } | null = null;

/** Derived status for a NounV2 proposal (mirrors computeDerivedGrantStatus). */
function computeDerivedNounV2ProposalStatus(
  p: Record<string, unknown>,
  latestBlock: bigint,
): string {
  const status = p.status as string;
  if (['CANCELED', 'EXECUTED'].includes(status)) return status;

  // Queued proposals expire after the grace period (7d on NounV2Treasury).
  if (status === 'QUEUED') {
    if (p.executionETA) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const GRACE_PERIOD = 7 * 86400;
      if (nowSeconds >= Number(p.executionETA) + GRACE_PERIOD) return 'EXPIRED';
    }
    return 'QUEUED';
  }

  if (status === 'ACTIVE') {
    const endBlock = BigInt(p.endBlock as string | number);
    if (latestBlock > endBlock) {
      const forVotes = Number(p.forVotes);
      const againstVotes = Number(p.againstVotes ?? 0);
      if (forVotes === 0 || forVotes <= againstVotes) return 'DEFEATED';
      return 'SUCCEEDED';
    }
  }

  return status;
}

/** All NounV2 proposals — single JSON response with derived status. */
app.get('/api/nounv2-proposals', async c => {
  const proposals = await db
    .select()
    .from(schema.nounV2Proposal)
    .orderBy(desc(schema.nounV2Proposal.id));
  const latestBlock = await getLatestBlockCached();
  const items = proposals.map(p => {
    const item: Record<string, unknown> = {
      ...p,
      id: String(p.id),
      startBlock: String(p.startBlock),
      endBlock: String(p.endBlock),
      createdAtBlock: String(p.createdAtBlock),
      executionETA: p.executionETA != null ? String(p.executionETA) : null,
      createdAt: String(new Date(p.createdAt).getTime()),
    };
    if (latestBlock > 0n) {
      item.status = computeDerivedNounV2ProposalStatus(item, latestBlock);
    }
    return item;
  });
  return c.json(items);
});

/** Single NounV2 proposal with votes, actions, status changes. */
app.get('/api/nounv2-proposals/:id', async c => {
  const idParam = c.req.param('id');
  const allProposals = await db.select().from(schema.nounV2Proposal);
  const p = allProposals.find(pr => String(pr.id) === idParam);
  if (!p) return c.json({ error: 'not found' }, 404);

  const allVotes = await db
    .select()
    .from(schema.nounV2Vote)
    .orderBy(desc(schema.nounV2Vote.createdAtBlock));
  const votes = allVotes.filter(v => String(v.proposalId) === idParam);

  const allTxs = await db.select().from(schema.nounV2ProposalTransaction);
  const txs = allTxs.filter(t => String(t.proposalId) === idParam);

  const allChanges = await db
    .select()
    .from(schema.nounV2ProposalStatusChange)
    .orderBy(schema.nounV2ProposalStatusChange.createdAtBlock);
  const changes = allChanges.filter(sc => String(sc.proposalId) === idParam);

  const latestBlock = await getLatestBlockCached();

  const item: Record<string, unknown> = {
    ...p,
    id: String(p.id),
    startBlock: String(p.startBlock),
    endBlock: String(p.endBlock),
    createdAtBlock: String(p.createdAtBlock),
    executionETA: p.executionETA != null ? String(p.executionETA) : null,
    createdAt: String(new Date(p.createdAt).getTime()),
  };
  if (latestBlock > 0n) {
    item.status = computeDerivedNounV2ProposalStatus(item, latestBlock);
  }

  return c.json({
    proposal: item,
    votes: votes.map(v => ({
      voter: v.voter,
      support: v.support,
      votes: v.votes,
      reason: v.reason,
      createdAtBlock: String(v.createdAtBlock),
      createdAtTransaction: v.createdAtTransaction,
    })),
    actions: txs.map(t => ({
      index: t.index,
      proposalId: String(t.proposalId),
      target: t.target,
      value: String(t.value),
      signature: t.signature,
      calldata: t.calldata,
    })),
    statusChanges: changes.map(sc => ({
      status: sc.status,
      createdAtBlock: String(sc.createdAtBlock),
      createdAtTransaction: sc.createdAtTransaction,
    })),
  });
});

/** All NounV2 auctions from the indexer, newest first. */
app.get('/api/nounv2-auctions', async c => {
  const auctions = await db
    .select()
    .from(schema.nounV2Auction)
    .orderBy(desc(schema.nounV2Auction.nounId));
  const allBids = await db
    .select()
    .from(schema.nounV2Bid)
    .orderBy(desc(schema.nounV2Bid.createdAtBlock));

  const bidsByNoun = new Map<string, typeof allBids>();
  for (const b of allBids) {
    const key = String(b.nounId);
    if (!bidsByNoun.has(key)) bidsByNoun.set(key, []);
    bidsByNoun.get(key)!.push(b);
  }

  const items = auctions.map(a => ({
    nounId: String(a.nounId),
    // Date.getTime() on the indexer's "seconds-as-ms" stored Date numerically equals
    // the original Unix-seconds chain timestamp — output it directly. Do NOT divide
    // by 1000; the consumer (e.g. webapp's BidHistoryModalRow) does `new Date(value * 1000)`.
    startTime: String(new Date(a.startTime).getTime()),
    endTime: String(new Date(a.endTime).getTime()),
    settled: a.settled,
    winner: a.winner,
    amount: a.amount != null ? String(a.amount) : null,
    createdAtBlock: String(a.createdAtBlock),
    createdAtTransaction: a.createdAtTransaction,
    bids: (bidsByNoun.get(String(a.nounId)) ?? []).map(b => ({
      bidder: b.bidder,
      value: String(b.value),
      extended: b.extended,
      createdAtBlock: String(b.createdAtBlock),
      createdAtTransaction: b.createdAtTransaction,
    })),
  }));
  return c.json(items);
});

/**
 * Single NounV2 auction with its full bid history. Powers the webapp's
 * `useV2AuctionBids` hook so the bid history modal works for any past
 * auction (not just the last ~8k blocks an eth_getLogs scan can cover).
 *
 * Bid rows include `timestamp` (chain seconds) so the row formatter can
 * show "X minutes ago" without an extra block lookup.
 */
app.get('/api/nounv2-auctions/:nounId', async c => {
  const idParam = c.req.param('nounId');
  let nounIdBig: bigint;
  try {
    nounIdBig = BigInt(idParam);
  } catch {
    return c.json({ error: 'invalid nounId' }, 400);
  }

  const auctionRows = await db
    .select()
    .from(schema.nounV2Auction)
    .where(eq(schema.nounV2Auction.nounId, nounIdBig));
  if (auctionRows.length === 0) return c.json({ error: 'not found' }, 404);
  const a = auctionRows[0]!;

  const bidRows = await db
    .select()
    .from(schema.nounV2Bid)
    .where(eq(schema.nounV2Bid.nounId, nounIdBig))
    .orderBy(desc(schema.nounV2Bid.value));

  return c.json({
    nounId: String(a.nounId),
    // See note above: stored Date.getTime() == original Unix seconds value.
    startTime: String(new Date(a.startTime).getTime()),
    endTime: String(new Date(a.endTime).getTime()),
    settled: a.settled,
    winner: a.winner,
    amount: a.amount != null ? String(a.amount) : null,
    createdAtBlock: String(a.createdAtBlock),
    createdAtTransaction: a.createdAtTransaction,
    bids: bidRows.map(b => ({
      bidder: b.bidder,
      value: String(b.value),
      extended: b.extended,
      timestamp: String(new Date(b.createdAt).getTime()),
      transactionHash: b.createdAtTransaction,
      createdAtBlock: String(b.createdAtBlock),
    })),
  });
});

// ─── NounV2 Activity Feed ─────────────────────────────────────────────────
// Unions recent rows from nounv2_bid, nounv2_auction (settled), nounv2_proposal,
// and nounv2_vote. Sorted DESC by block, paginated via ?before=<block>.
let nounV2FeedCache: {
  data: { events: ActivityEvent[]; hasMore: boolean; oldestBlock: number };
  fetchedAt: number;
  key: string;
} | null = null;
const NOUNV2_FEED_TTL = 30_000;

app.get('/api/nounv2-feed', async c => {
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
  const beforeParam = c.req.query('before');
  const before = beforeParam ? BigInt(beforeParam) : undefined;
  const cacheKey = `${limit}:${before ?? 'latest'}`;

  if (
    nounV2FeedCache?.key === cacheKey &&
    Date.now() - nounV2FeedCache.fetchedAt < NOUNV2_FEED_TTL
  ) {
    return c.json(nounV2FeedCache.data);
  }

  try {
    const perTable = limit + 10;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function fetchRows(tbl: any, blockCol: any): Promise<any[]> {
      try {
        if (before) {
          return await db
            .select()
            .from(tbl)
            .where(lt(blockCol, before))
            .orderBy(desc(blockCol))
            .limit(perTable);
        }
        return await db.select().from(tbl).orderBy(desc(blockCol)).limit(perTable);
      } catch {
        return [];
      }
    }

    const [bids, auctions, proposals, votes] = await Promise.all([
      fetchRows(schema.nounV2Bid, schema.nounV2Bid.createdAtBlock),
      fetchRows(schema.nounV2Auction, schema.nounV2Auction.createdAtBlock),
      fetchRows(schema.nounV2Proposal, schema.nounV2Proposal.createdAtBlock),
      fetchRows(schema.nounV2Vote, schema.nounV2Vote.createdAtBlock),
      // V2 sales: Reservoir API is dead (Oct 2025). V2 sales will be detected
      // via on-chain enrichment once V2 transfer indexing ships.
    ]);

    const events: ActivityEvent[] = [];

    for (const b of bids) {
      events.push({
        type: 'V2_BID',
        blockNumber: Number(b.createdAtBlock),
        timestamp: tsToISO(b.createdAt),
        txHash: b.createdAtTransaction || '',
        data: {
          nounId: Number(b.nounId),
          value: String(b.value),
          bidder: b.bidder,
          extended: b.extended,
        },
      });
    }

    for (const a of auctions) {
      // Use SETTLED only for finalized auctions; show CREATED for fresh auctions.
      if (a.settled) {
        events.push({
          type: 'V2_SETTLED',
          blockNumber: Number(a.createdAtBlock),
          timestamp: tsToISO(a.createdAt),
          txHash: a.createdAtTransaction || '',
          data: {
            nounId: Number(a.nounId),
            winner: a.winner || '',
            amount: String(a.amount || '0'),
          },
        });
      } else {
        events.push({
          type: 'V2_AUCTION',
          blockNumber: Number(a.createdAtBlock),
          timestamp: tsToISO(a.createdAt),
          txHash: a.createdAtTransaction || '',
          data: {
            nounId: Number(a.nounId),
            startTime: new Date(a.startTime).getTime(),
            endTime: new Date(a.endTime).getTime(),
          },
        });
      }
    }

    for (const p of proposals) {
      const descText = (p.description || '') as string;
      const title = (descText.split('\n')[0] || '').replace(/^#\s*/, '').slice(0, 120);
      events.push({
        type: 'V2_PROP',
        blockNumber: Number(p.createdAtBlock),
        timestamp: tsToISO(p.createdAt),
        txHash: p.createdAtTransaction || '',
        data: {
          proposalId: Number(p.id),
          proposer: p.proposer,
          title,
          status: p.status,
          description: descText.slice(0, 4000),
        },
      });
    }

    for (const v of votes) {
      events.push({
        type: 'V2_VOTE',
        blockNumber: Number(v.createdAtBlock),
        timestamp: tsToISO(v.createdAt),
        txHash: v.createdAtTransaction || '',
        data: {
          voter: v.voter,
          proposalId: Number(v.proposalId),
          support: v.support,
          votes: v.votes,
          reason: v.reason || '',
        },
      });
    }

    // V2 sales: disabled — Reservoir API shut down Oct 2025. V2 sale detection
    // will land once V2 transfer indexing ships (same on-chain approach as V1).
    if (false) {
    }

    events.sort((a, b) => b.blockNumber - a.blockNumber);
    const sliced = events.slice(0, limit);
    const hasMore = events.length > limit;
    const oldestBlock = sliced.length > 0 ? sliced[sliced.length - 1]!.blockNumber : 0;

    const result = { events: sliced, hasMore, oldestBlock };
    nounV2FeedCache = { data: result, fetchedAt: Date.now(), key: cacheKey };
    return c.json(result);
  } catch (err) {
    console.error('[NounV2Feed] Error:', err);
    return c.json({ events: [], hasMore: false, oldestBlock: 0 }, 500);
  }
});

/** Live NounV2 auction state — direct contract read, like /api/auction-stats. */
app.get('/api/nounv2-auction/current', async c => {
  const now = Date.now();
  if (
    nounV2CurrentAuctionCache !== null &&
    now - nounV2CurrentAuctionCache.at < NOUNV2_CURRENT_AUCTION_CACHE_TTL_MS
  ) {
    return c.json(nounV2CurrentAuctionCache.payload);
  }

  // If the address hasn't been set yet, return a structured "not deployed" response
  // instead of 500'ing on a zero-address call.
  if (NOUNV2_AUCTION_HOUSE_ADDRESS === '0x0000000000000000000000000000000000000000') {
    const payload = { deployed: false, current: null };
    nounV2CurrentAuctionCache = { at: now, payload };
    return c.json(payload);
  }

  try {
    // viem returns a tuple for multiple named outputs; index access is stable.
    const current = (await nounCheckClient.readContract({
      address: NOUNV2_AUCTION_HOUSE_ADDRESS,
      abi: NOUNV2_AUCTION_ABI,
      functionName: 'auction',
    })) as readonly [bigint, bigint, bigint, bigint, `0x${string}`, boolean];

    const payload = {
      deployed: true,
      current: {
        nounId: String(current[0]),
        amount: String(current[1]),
        startTime: Number(current[2]),
        endTime: Number(current[3]),
        bidder: current[4],
        settled: current[5],
      },
    };
    nounV2CurrentAuctionCache = { at: now, payload };
    return c.json(payload);
  } catch (err) {
    if (nounV2CurrentAuctionCache !== null) {
      return c.json(nounV2CurrentAuctionCache.payload, 200, { 'x-cache': 'stale' });
    }
    return c.json({ error: err instanceof Error ? err.message : 'fetch failed' }, 502);
  }
});

// ============================================================
// Lil Nouns proposals proxy — fetches from Goldsky subgraph on the server,
// caches briefly, serves in the same shape as /api/proposals so the
// prediction-market UI can drop it in without branching.
// ============================================================

const LIL_NOUNS_SUBGRAPH =
  'https://api.goldsky.com/api/public/project_cldjvjgtylso13swq3dre13sf/subgraphs/lil-nouns-subgraph/1.0.10/gn';

// Keep the cache tight — proposals change rarely but we want new votes to land quickly.
const LIL_NOUNS_CACHE_TTL_MS = 60_000;
let lilNounsCache: { at: number; items: unknown[] } | null = null;

const LIL_NOUNS_GOVERNOR = '0x5d2C31ce16924C2a71D317e5BbFd5ce387854039' as const;
const LIL_NOUNS_GOVERNOR_STATE_ABI = [
  {
    type: 'function',
    name: 'state',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [{ type: 'uint8' }],
    stateMutability: 'view',
  },
] as const;

// Governor state enum → uppercase status matching the subgraph's values.
// Bravo-style states; Nouns / Lil Nouns extend with OBJECTION_PERIOD + UPDATABLE.
const GOVERNOR_STATE_CODES = [
  'PENDING',
  'ACTIVE',
  'CANCELLED',
  'DEFEATED',
  'SUCCEEDED',
  'QUEUED',
  'EXPIRED',
  'EXECUTED',
  'VETOED',
  'OBJECTION_PERIOD',
  'UPDATABLE',
] as const;

/**
 * Overwrite stale ACTIVE statuses from the subgraph with on-chain governor state.
 * The Goldsky subgraph only updates status on explicit events (Queued/Executed/
 * Cancelled/Vetoed); proposals that timed out without resolution stay stuck at
 * ACTIVE, which misrepresents DEFEATED + EXPIRED in the UI.
 */
async function overlayOnchainStatus(
  items: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const staleIds = items
    .filter(p => typeof p.status === 'string' && p.status.toUpperCase() === 'ACTIVE')
    .map(p => p.id as string);
  if (staleIds.length === 0) return items;

  try {
    const results = await nounCheckClient.multicall({
      contracts: staleIds.map(id => ({
        address: LIL_NOUNS_GOVERNOR,
        abi: LIL_NOUNS_GOVERNOR_STATE_ABI,
        functionName: 'state' as const,
        args: [BigInt(id)],
      })),
      allowFailure: true,
    });
    const idToStatus = new Map<string, string>();
    for (let i = 0; i < staleIds.length; i++) {
      const r = results[i];
      if (r?.status === 'success' && typeof r.result === 'number') {
        idToStatus.set(staleIds[i], GOVERNOR_STATE_CODES[r.result] ?? 'ACTIVE');
      }
    }
    return items.map(p => {
      const mapped = idToStatus.get(p.id as string);
      return mapped !== undefined ? { ...p, status: mapped } : p;
    });
  } catch (err) {
    console.warn('[lil-proposals] onchain state overlay failed, falling back:', err);
    return items;
  }
}

async function fetchLilNounsFromSubgraph() {
  // Paginate in chunks of 500 (subgraph max is usually 1000; 500 is conservative).
  const PAGE = 500;
  const all: Array<Record<string, unknown>> = [];
  let skip = 0;
  while (true) {
    const query = `{
      proposals(first: ${PAGE}, skip: ${skip}, orderBy: createdBlock, orderDirection: desc) {
        id
        title
        description
        status
        forVotes
        againstVotes
        abstainVotes
        quorumVotes
        proposalThreshold
        startBlock
        endBlock
        createdBlock
        createdTimestamp
        executionETA
        executedTimestamp
        canceledTimestamp
        vetoedTimestamp
        queuedTimestamp
        proposer { id }
      }
    }`;
    const res = await fetch(LIL_NOUNS_SUBGRAPH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Goldsky ${res.status}`);
    const json = (await res.json()) as { data?: { proposals?: Array<Record<string, unknown>> } };
    const page = json.data?.proposals ?? [];
    all.push(...page);
    if (page.length < PAGE) break;
    skip += PAGE;
  }
  return all;
}

app.get('/api/lil-proposals', async c => {
  const now = Date.now();
  if (lilNounsCache !== null && now - lilNounsCache.at < LIL_NOUNS_CACHE_TTL_MS) {
    return c.json(lilNounsCache.items);
  }
  try {
    const raw = await fetchLilNounsFromSubgraph();
    const items = await overlayOnchainStatus(raw);
    lilNounsCache = { at: now, items };
    return c.json(items);
  } catch (err) {
    // If Goldsky is down, serve stale cache if we have any.
    if (lilNounsCache !== null) {
      return c.json(lilNounsCache.items, 200, { 'x-cache': 'stale' });
    }
    return c.json({ error: err instanceof Error ? err.message : 'fetch failed' }, 502);
  }
});

// Detail endpoint — single proposal with its full vote list, for LilNounsVotePage.
// Cache per-id for LIL_NOUNS_CACHE_TTL_MS.
const lilNounsDetailCache = new Map<string, { at: number; item: unknown }>();

app.get('/api/lil-proposals/:id', async c => {
  const id = c.req.param('id');
  if (!/^\d+$/.test(id)) return c.json({ error: 'invalid id' }, 400);

  const now = Date.now();
  const cached = lilNounsDetailCache.get(id);
  if (cached != null && now - cached.at < LIL_NOUNS_CACHE_TTL_MS) {
    return c.json(cached.item);
  }

  const query = `{
    proposal(id: "${id}") {
      id
      title
      description
      status
      forVotes
      againstVotes
      abstainVotes
      quorumVotes
      proposalThreshold
      startBlock
      endBlock
      createdBlock
      createdTimestamp
      executionETA
      executedTimestamp
      canceledTimestamp
      vetoedTimestamp
      queuedTimestamp
      targets
      values
      signatures
      calldatas
      totalSupply
      proposer { id }
      votes(first: 1000, orderBy: blockNumber, orderDirection: desc) {
        id
        support: supportDetailed
        votes
        reason
        blockNumber
        voter { id }
      }
    }
  }`;

  try {
    const res = await fetch(LIL_NOUNS_SUBGRAPH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Goldsky ${res.status}`);
    const json = (await res.json()) as { data?: { proposal?: Record<string, unknown> | null } };
    const proposal = json.data?.proposal;
    if (proposal == null) return c.json({ error: 'not found' }, 404);

    // Overwrite stale ACTIVE status with the on-chain governor state.
    const [enriched] = await overlayOnchainStatus([proposal]);
    const finalProposal = enriched ?? proposal;

    lilNounsDetailCache.set(id, { at: now, item: finalProposal });
    return c.json(finalProposal);
  } catch (err) {
    if (cached != null) {
      return c.json(cached.item, 200, { 'x-cache': 'stale' });
    }
    return c.json({ error: err instanceof Error ? err.message : 'fetch failed' }, 502);
  }
});

// ============================================================
// Pip3 — Giphy channel proxy (Giphy v4 channels feed sends no CORS)
// ============================================================

const PIP3_CACHE_TTL_MS = 60_000;
const pip3Cache = new Map<string, { at: number; body: unknown }>();

app.get('/api/pip3-gifs', async c => {
  const channelId = c.req.query('channel') || '19207767';
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10));
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '50', 10)));
  const key = `${channelId}:${offset}:${limit}`;
  const now = Date.now();
  const cached = pip3Cache.get(key);
  if (cached && now - cached.at < PIP3_CACHE_TTL_MS) return c.json(cached.body);
  try {
    const res = await fetch(
      `https://giphy.com/api/v4/channels/${channelId}/feed?offset=${offset}&limit=${limit}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) throw new Error(`giphy ${res.status}`);
    const body = await res.json();
    pip3Cache.set(key, { at: now, body });
    return c.json(body);
  } catch (err) {
    if (cached) return c.json(cached.body, 200, { 'x-cache': 'stale' });
    return c.json({ error: err instanceof Error ? err.message : 'fetch failed' }, 502);
  }
});

// ============================================================
// Activity-feed external sources: Lil Nouns subgraph + Reservoir sales
// ============================================================

interface FeedEvent {
  type: string;
  blockNumber: number;
  timestamp: string;
  txHash: string;
  data: Record<string, unknown>;
}

const LIL_ACTIVITY_TTL = 30_000;
let lilActivityCache: { at: number; key: string; events: FeedEvent[] } | null = null;

async function fetchLilNounsActivity(
  before: bigint | undefined,
  limit: number,
): Promise<FeedEvent[]> {
  const key = `${before ?? 'latest'}:${limit}`;
  const now = Date.now();
  if (
    lilActivityCache &&
    lilActivityCache.key === key &&
    now - lilActivityCache.at < LIL_ACTIVITY_TTL
  ) {
    return lilActivityCache.events;
  }

  const per = Math.max(20, Math.min(limit + 10, 100));
  const blockFilter = before ? `, where: { blockNumber_lt: "${before.toString()}" }` : '';
  const propBlockFilter = before ? `, where: { createdBlock_lt: "${before.toString()}" }` : '';
  const query = `{
    bids(first: ${per}, orderBy: blockNumber, orderDirection: desc${blockFilter}) {
      id noun { id } amount bidder { id } blockNumber blockTimestamp comment
    }
    auctions(first: ${per}, orderBy: endTime, orderDirection: desc, where: { settled: true${before ? `, endTime_lt: "${before.toString()}"` : ''} }) {
      id amount bidder { id } noun { id } endTime startTime
    }
    votes(first: ${per}, orderBy: blockNumber, orderDirection: desc${blockFilter}) {
      id voter { id } proposal { id } support: supportDetailed votes reason blockNumber blockTimestamp transactionHash
    }
    proposals(first: ${per}, orderBy: createdBlock, orderDirection: desc${propBlockFilter}) {
      id title proposer { id } createdBlock createdTimestamp description
    }
    transferEvents(first: ${per}, orderBy: blockNumber, orderDirection: desc${blockFilter}) {
      id noun { id } previousHolder { id } newHolder { id } blockNumber blockTimestamp
    }
  }`;

  let body: {
    data?: {
      bids?: Array<Record<string, unknown>>;
      auctions?: Array<Record<string, unknown>>;
      votes?: Array<Record<string, unknown>>;
      proposals?: Array<Record<string, unknown>>;
      transferEvents?: Array<Record<string, unknown>>;
    };
  };
  try {
    const res = await fetch(LIL_NOUNS_SUBGRAPH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Goldsky ${res.status}`);
    body = (await res.json()) as typeof body;
  } catch (err) {
    console.warn('[activity/lil] subgraph fetch failed:', err);
    return [];
  }

  const events: FeedEvent[] = [];
  const toISO = (ts: unknown): string => {
    const n = Number(ts);
    if (!Number.isFinite(n)) return new Date().toISOString();
    return new Date(n < 1e12 ? n * 1000 : n).toISOString();
  };
  const accId = (a: unknown): string =>
    typeof a === 'object' && a !== null && typeof (a as { id?: unknown }).id === 'string'
      ? (a as { id: string }).id
      : '';

  for (const b of body.data?.bids ?? []) {
    events.push({
      type: 'LIL_BID',
      blockNumber: Number(b.blockNumber),
      timestamp: toISO(b.blockTimestamp),
      txHash: '',
      data: {
        nounId: Number(accId(b.noun)),
        value: String(b.amount ?? '0'),
        bidder: accId(b.bidder),
        comment: (b.comment as string) || '',
      },
    });
  }

  // Auction entity has no blockNumber — estimate from endTime so these events
  // merge-sort sensibly against the bid/vote/transfer events that do.
  const estBlock = (ts: number): number =>
    Math.max(0, Math.floor(19_000_000 + (ts - 1_708_993_199) / 12));
  for (const a of body.data?.auctions ?? []) {
    const winner = accId(a.bidder);
    if (!winner) continue;
    const endTs = Number(a.endTime);
    events.push({
      type: 'LIL_AUCTION_SETTLED',
      blockNumber: Number.isFinite(endTs) ? estBlock(endTs) : 0,
      timestamp: toISO(a.endTime),
      txHash: '',
      data: {
        nounId: Number(accId(a.noun)),
        winner,
        amount: String(a.amount ?? '0'),
      },
    });
  }

  for (const v of body.data?.votes ?? []) {
    events.push({
      type: 'LIL_VOTE',
      blockNumber: Number(v.blockNumber),
      timestamp: toISO(v.blockTimestamp),
      txHash: (v.transactionHash as string) || '',
      data: {
        voter: accId(v.voter),
        proposalId: Number(accId(v.proposal)),
        support: Number(v.support),
        votes: String(v.votes ?? '0'),
        reason: (v.reason as string) || '',
      },
    });
  }

  for (const p of body.data?.proposals ?? []) {
    const descText = (p.description as string) || '';
    const derivedTitle =
      ((p.title as string) || '').trim() ||
      (descText.split('\n')[0] || '').replace(/^#\s*/, '').slice(0, 120);
    events.push({
      type: 'LIL_PROPOSAL_CREATED',
      blockNumber: Number(p.createdBlock),
      timestamp: toISO(p.createdTimestamp),
      txHash: '',
      data: {
        proposalId: Number(p.id),
        proposer: accId(p.proposer),
        title: derivedTitle,
      },
    });
  }

  const ZERO = '0x0000000000000000000000000000000000000000';
  for (const t of body.data?.transferEvents ?? []) {
    const from = accId(t.previousHolder);
    const to = accId(t.newHolder);
    const nounId = Number(accId(t.noun));
    const ts = toISO(t.blockTimestamp);
    const block = Number(t.blockNumber);
    if (from.toLowerCase() === ZERO) {
      events.push({
        type: 'LIL_NOUN_CREATED',
        blockNumber: block,
        timestamp: ts,
        txHash: '',
        data: { nounId, owner: to },
      });
    } else {
      events.push({
        type: 'LIL_TRANSFER',
        blockNumber: block,
        timestamp: ts,
        txHash: '',
        data: { nounId, from, to },
      });
    }
  }

  lilActivityCache = { at: now, key, events };
  return events;
}

// ── On-chain sale detection ──────────────────────────────────────────────────
// Reservoir API shut down Oct 2025. Detect marketplace sales on-chain by
// checking if a NounsToken Transfer tx targeted a known marketplace router.
// When it did, convert the TRANSFER → SALE and extract price from tx.value
// (direct ETH) or WETH Transfer log (wrapped ETH sales).

const SALES_ACTIVITY_TTL = 60_000;
let salesActivityCache: { at: number; key: string; events: FeedEvent[] } | null = null;

const MAINNET_RPC = process.env.PONDER_RPC_URL_1 || 'https://ethereum-rpc.publicnode.com';

/** Known NFT marketplace router contracts (lowercased). */
const MARKETPLACE_ROUTERS: Record<string, string> = {
  // Seaport 1.5 + 1.6
  '0x00000000000000adc04c56bf30ac9d3c0aaf14dc': 'OpenSea',
  '0x0000000000000068f116a894984e2db1123eb395': 'OpenSea',
  // Blur
  '0x39da41747a83aee658334415666f3ef92dd0d541': 'Blur',
  '0xb2ecfe4e4d61f8790bbb9de2d1259b9e2410cea5': 'Blur',
  '0x29469395eaf6f95920e59f858042f0e28d98a20b': 'Blur',
  // LooksRare
  '0x0000000000e655fae4d56241588680f86e3b2377': 'LooksRare',
  // X2Y2
  '0x74312363e45dcaba76c59ec49a7aa8a65a67eed3': 'X2Y2',
  // Sudoswap
  '0x2b2e8cda09bba9660dca5cb6233787738ad68329': 'Sudoswap',
  // Magic Eden
  '0x9a1d00bed7cd04bcda516d721a596eb22aac6834': 'Magic Eden',
};

/** Payment token contracts whose Transfer logs indicate sale price. */
const PAYMENT_TOKENS = new Set([
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
  '0x0000000000a39bb272e79075ade125fd351887ac', // Blur Pool
]);
const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/** Cache tx sale lookups: txHash → { marketplace, priceWei } | null. */
const txSaleCache = new Map<string, { marketplace: string; priceWei: bigint } | null>();
const TX_SALE_CACHE_MAX = 500;

async function checkTxForSale(
  txHash: string,
): Promise<{ marketplace: string; priceWei: bigint } | null> {
  const key = txHash.toLowerCase();
  if (txSaleCache.has(key)) return txSaleCache.get(key)!;

  try {
    // Fetch the transaction to check tx.to
    const txRes = await fetch(MAINNET_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getTransactionByHash',
        params: [txHash],
      }),
      signal: AbortSignal.timeout(5_000),
    });
    const txJson = (await txRes.json()) as { result?: { to?: string; value?: string } };
    const tx = txJson.result;
    if (!tx?.to) {
      txSaleCache.set(key, null);
      return null;
    }

    const toAddr = tx.to.toLowerCase();
    const marketplace = MARKETPLACE_ROUTERS[toAddr];
    if (!marketplace) {
      txSaleCache.set(key, null);
      return null;
    }

    // Direct ETH payment: tx.value > 0
    const txValue = BigInt(tx.value || '0');
    if (txValue > 0n) {
      const result = { marketplace, priceWei: txValue };
      if (txSaleCache.size > TX_SALE_CACHE_MAX) txSaleCache.clear();
      txSaleCache.set(key, result);
      return result;
    }

    // WETH sale: check receipt logs for WETH Transfer to the seller
    const receiptRes = await fetch(MAINNET_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'eth_getTransactionReceipt',
        params: [txHash],
      }),
      signal: AbortSignal.timeout(5_000),
    });
    const receiptJson = (await receiptRes.json()) as {
      result?: { logs?: Array<{ address: string; topics: string[]; data: string }> };
    };
    const logs = receiptJson.result?.logs ?? [];

    // Find the largest payment-token transfer in this tx — that's the sale price.
    // Covers WETH (OpenSea/LooksRare) and Blur Pool (Blur).
    let maxPaymentWei = 0n;
    for (const log of logs) {
      if (
        PAYMENT_TOKENS.has(log.address.toLowerCase()) &&
        log.topics[0] === ERC20_TRANSFER_TOPIC &&
        log.data
      ) {
        const amount = BigInt(log.data);
        if (amount > maxPaymentWei) maxPaymentWei = amount;
      }
    }
    if (maxPaymentWei > 0n) {
      const result = { marketplace, priceWei: maxPaymentWei };
      if (txSaleCache.size > TX_SALE_CACHE_MAX) txSaleCache.clear();
      txSaleCache.set(key, result);
      return result;
    }

    // Marketplace tx but couldn't extract price — still mark as sale with 0
    const result = { marketplace, priceWei: 0n };
    if (txSaleCache.size > TX_SALE_CACHE_MAX) txSaleCache.clear();
    txSaleCache.set(key, result);
    return result;
  } catch (err) {
    console.warn('[sales] tx lookup failed:', txHash, err);
    txSaleCache.set(key, null);
    return null;
  }
}

/** Fetch recent Nouns transfers from Ponder and detect which are marketplace sales. */
async function fetchOnchainSales(before: bigint | undefined, limit: number): Promise<FeedEvent[]> {
  const cacheKey = `${before ?? 'latest'}:${limit}`;
  const now = Date.now();
  if (salesActivityCache?.key === cacheKey && now - salesActivityCache.at < SALES_ACTIVITY_TTL) {
    return salesActivityCache.events;
  }

  try {
    // Fetch recent transfers from Ponder
    const perTable = Math.max(50, limit * 3); // fetch more, many won't be sales
    let transfers;
    if (before) {
      transfers = await db
        .select()
        .from(schema.nounTransfer)
        .where(lt(schema.nounTransfer.createdAtBlock, before))
        .orderBy(desc(schema.nounTransfer.createdAtBlock))
        .limit(perTable);
    } else {
      transfers = await db
        .select()
        .from(schema.nounTransfer)
        .orderBy(desc(schema.nounTransfer.createdAtBlock))
        .limit(perTable);
    }

    // Filter out mint/burn transfers (from or to zero address)
    const ZERO = '0x0000000000000000000000000000000000000000';
    const candidates = transfers.filter(
      t =>
        t.from.toLowerCase() !== ZERO &&
        t.to.toLowerCase() !== ZERO &&
        t.to.toLowerCase() !== '0x830bd73e4184cef73443c15111a1df14e495c706', // auction house
    );

    // Batch-check tx hashes (dedupe first)
    const uniqueTxs = [...new Set(candidates.map(t => t.createdAtTransaction))];
    const saleChecks = await Promise.all(
      uniqueTxs.slice(0, 30).map(async txHash => ({
        txHash,
        sale: await checkTxForSale(txHash),
      })),
    );
    const saleMap = new Map(saleChecks.filter(s => s.sale).map(s => [s.txHash, s.sale!]));

    // Count how many nouns were sold in the same tx so we can split the
    // total price evenly across them (Blur sweeps, Seaport batch buys, etc.)
    const nounsPerTx = new Map<string, number>();
    for (const t of candidates) {
      if (saleMap.has(t.createdAtTransaction)) {
        nounsPerTx.set(t.createdAtTransaction, (nounsPerTx.get(t.createdAtTransaction) || 0) + 1);
      }
    }

    const events: FeedEvent[] = [];
    for (const t of candidates) {
      const sale = saleMap.get(t.createdAtTransaction);
      if (!sale) continue;

      const count = nounsPerTx.get(t.createdAtTransaction) || 1;
      const priceEth = Number(sale.priceWei) / 1e18 / count;
      events.push({
        type: 'SALE',
        blockNumber: Number(t.createdAtBlock),
        timestamp: t.createdAt ? new Date(Number(t.createdAt) * 1000).toISOString() : '',
        txHash: t.createdAtTransaction,
        data: {
          collection: 'NOUN',
          collectionName: 'Noun',
          tokenId: String(t.nounId),
          tokenName: `Noun ${t.nounId}`,
          from: t.from,
          to: t.to,
          priceEth,
          priceWei: sale.priceWei.toString(),
          priceUsd: null,
          currency: 'ETH',
          marketplace: sale.marketplace,
        },
      });
      if (events.length >= limit) break;
    }

    salesActivityCache = { at: now, key: cacheKey, events };
    return events;
  } catch (err) {
    console.warn('[activity/sales] on-chain detection failed:', err);
    return [];
  }
}

/**
 * Auction price prediction market stats.
 * Returns current live auction + last 7 settled auctions (skipping nounder/empty)
 * and their trailing average.
 */
// Direct contract reads so current bid + settlement data are always fresh,
// not gated on Ponder indexing latency (which was showing stale #1877 with
// amount=0 while #1878 was live at 0.57 ETH).
const NOUNS_AUCTION_HOUSE = '0x830BD73E4184ceF73443C15111a1DF14e495C706' as const;
const AUCTION_HOUSE_ABI = [
  {
    type: 'function',
    name: 'auction',
    inputs: [],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'nounId', type: 'uint96' },
          { name: 'amount', type: 'uint128' },
          { name: 'startTime', type: 'uint40' },
          { name: 'endTime', type: 'uint40' },
          { name: 'bidder', type: 'address' },
          { name: 'settled', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getSettlements',
    inputs: [
      { name: 'auctionCount', type: 'uint256' },
      { name: 'skipEmptyValues', type: 'bool' },
    ],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 'blockTimestamp', type: 'uint32' },
          { name: 'amount', type: 'uint256' },
          { name: 'winner', type: 'address' },
          { name: 'nounId', type: 'uint256' },
          { name: 'clientId', type: 'uint32' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const;

// Cache auction + settlements briefly to avoid hammering RPC.
const AUCTION_STATS_CACHE_TTL_MS = 15_000;
let auctionStatsCache: { at: number; payload: unknown } | null = null;

app.get('/api/auction-stats', async c => {
  const now = Date.now();
  if (auctionStatsCache !== null && now - auctionStatsCache.at < AUCTION_STATS_CACHE_TTL_MS) {
    return c.json(auctionStatsCache.payload);
  }

  try {
    // Parallel: current live auction + most recent non-empty settlements.
    const [current, settlements] = await Promise.all([
      nounCheckClient.readContract({
        address: NOUNS_AUCTION_HOUSE,
        abi: AUCTION_HOUSE_ABI,
        functionName: 'auction',
      }),
      nounCheckClient.readContract({
        address: NOUNS_AUCTION_HOUSE,
        abi: AUCTION_HOUSE_ABI,
        functionName: 'getSettlements',
        args: [7n, true],
      }),
    ]);

    const prior7 = settlements
      .filter(s => s.amount > 0n)
      .slice(0, 7)
      .map(s => ({
        nounId: String(s.nounId),
        amount: String(s.amount),
        winner: s.winner,
        settled: true,
        endTime: Number(s.blockTimestamp),
      }));

    const avgWei =
      prior7.length > 0
        ? prior7.reduce((acc, p) => acc + BigInt(p.amount), 0n) / BigInt(prior7.length)
        : 0n;

    const payload = {
      current: {
        nounId: String(current.nounId),
        amount: String(current.amount),
        endTime: Number(current.endTime),
        settled: current.settled,
        winner: current.bidder,
      },
      prior7,
      sampleSize: prior7.length,
      avgWei: String(avgWei),
      avgEth: Number(avgWei) / 1e18,
    };

    auctionStatsCache = { at: now, payload };
    return c.json(payload);
  } catch (err) {
    if (auctionStatsCache !== null) {
      return c.json(auctionStatsCache.payload, 200, { 'x-cache': 'stale' });
    }
    return c.json({ error: err instanceof Error ? err.message : 'fetch failed' }, 502);
  }
});

// ============================================================
// Prediction markets — combined listing of noun auction markets
// + proposal markets, for the /predictions page's "Markets" table.
// Public, read-only; resolve() is permissionless on both contracts.
// ============================================================

const AUCTION_PRICE_MARKET_ADDRESS =
  (process.env.AUCTION_PRICE_MARKET_ADDRESS as `0x${string}` | undefined) ??
  '0xC9c201A7AfB67Ecc08238Cbd690d39658Aed39b6';

const PREDICTION_MARKET_ADDRESS =
  (process.env.PREDICTION_MARKET_ADDRESS as `0x${string}` | undefined) ??
  '0x2ea7502C4db5B8cfB329d8a9866EB6705b036608';

const AUCTION_PRICE_MARKET_ABI = [
  {
    type: 'function',
    name: 'getMarket',
    inputs: [{ name: 'nounId', type: 'uint256' }],
    outputs: [
      { name: 'higherPool', type: 'uint256' },
      { name: 'lowerPool', type: 'uint256' },
      { name: 'higherStakers', type: 'uint256' },
      { name: 'lowerStakers', type: 'uint256' },
      { name: 'higherOddsBps', type: 'uint256' },
      { name: 'lowerOddsBps', type: 'uint256' },
      { name: 'outcome', type: 'uint8' },
      { name: 'priceWei', type: 'uint256' },
      { name: 'avgWei', type: 'uint256' },
      { name: 'feeBps', type: 'uint16' },
      { name: 'exists', type: 'bool' },
    ],
    stateMutability: 'view',
  },
] as const;

const PREDICTION_MARKET_ABI = [
  {
    type: 'function',
    name: 'getMarket',
    inputs: [
      { name: 'dao', type: 'string' },
      { name: 'proposalId', type: 'string' },
    ],
    outputs: [
      { name: 'forPool', type: 'uint256' },
      { name: 'againstPool', type: 'uint256' },
      { name: 'forStakers', type: 'uint256' },
      { name: 'againstStakers', type: 'uint256' },
      { name: 'forOddsBps', type: 'uint256' },
      { name: 'againstOddsBps', type: 'uint256' },
      { name: 'outcome', type: 'uint8' },
      { name: 'exists', type: 'bool' },
    ],
    stateMutability: 'view',
  },
] as const;

type MarketEntry = {
  kind: 'auction' | 'proposal';
  id: string;
  nounId?: string;
  daoKey?: 'nouns' | 'lil-nouns';
  proposalId?: string;
  title: string;
  link?: string;
  outcome: number;
  totalPoolWei: string;
  stakers: number;
  status: 'needs-resolution' | 'live' | 'resolved' | 'pending';
  closesAt?: number;
  note?: string;
};

const PREDICTION_MARKETS_CACHE_TTL_MS = 30_000;
let predictionMarketsCache: {
  at: number;
  payload: { entries: MarketEntry[]; generatedAt: number };
} | null = null;

const ACTIVE_PROPOSAL_STATUSES = ['ACTIVE', 'PENDING', 'OBJECTION_PERIOD', 'UPDATABLE'];
const RESOLVED_PROPOSAL_STATUSES = [
  'CANCELLED',
  'DEFEATED',
  'SUCCEEDED',
  'QUEUED',
  'EXPIRED',
  'EXECUTED',
  'VETOED',
];

/** Pick a market status bucket from the proposal status + market outcome. */
function classifyProposalMarket(proposalStatus: string, outcome: number): MarketEntry['status'] {
  const s = proposalStatus.toUpperCase();
  if (outcome === 1 || outcome === 2 || outcome === 3) return 'resolved';
  if (RESOLVED_PROPOSAL_STATUSES.includes(s)) return 'needs-resolution';
  if (ACTIVE_PROPOSAL_STATUSES.includes(s)) return 'live';
  return 'pending';
}

/** Extract a short title from a proposal description (first markdown heading or line). */
function extractProposalTitle(description: string, fallback: string): string {
  const first = (description.split('\n')[0] ?? '').replace(/^#+\s*/, '').trim();
  if (!first) return fallback;
  return first.slice(0, 120);
}

app.get('/api/predictions/markets', async c => {
  const now = Date.now();
  if (
    predictionMarketsCache !== null &&
    now - predictionMarketsCache.at < PREDICTION_MARKETS_CACHE_TTL_MS
  ) {
    return c.json(predictionMarketsCache.payload);
  }

  try {
    // ── 1. Current nounId + recent settlement timestamps ────────────────────
    const [currentAuction, settlements] = await Promise.all([
      nounCheckClient.readContract({
        address: NOUNS_AUCTION_HOUSE,
        abi: AUCTION_HOUSE_ABI,
        functionName: 'auction',
      }),
      nounCheckClient.readContract({
        address: NOUNS_AUCTION_HOUSE,
        abi: AUCTION_HOUSE_ABI,
        functionName: 'getSettlements',
        args: [50n, false],
      }),
    ]);

    const currentNounId = Number(currentAuction.nounId);
    const settlementByNounId = new Map<number, { amount: bigint; endTime: number }>();
    for (const s of settlements) {
      settlementByNounId.set(Number(s.nounId), {
        amount: s.amount,
        endTime: Number(s.blockTimestamp),
      });
    }

    // ── 2. Multicall the last 50 auction markets ────────────────────────────
    const auctionNounIds = Array.from({ length: 50 }, (_, i) => currentNounId - i).filter(
      n => n >= 0,
    );
    const [auctionResults, auctionRows] = await Promise.all([
      nounCheckClient.multicall({
        allowFailure: true,
        contracts: auctionNounIds.map(id => ({
          address: AUCTION_PRICE_MARKET_ADDRESS,
          abi: AUCTION_PRICE_MARKET_ABI,
          functionName: 'getMarket' as const,
          args: [BigInt(id)] as const,
        })),
      }),
      db
        .select()
        .from(schema.auction)
        .where(
          inArray(
            schema.auction.nounId,
            auctionNounIds.map(id => BigInt(id)),
          ),
        ),
    ]);

    const auctionByNounId = new Map<number, { endTime: number; settled: boolean }>();
    for (const row of auctionRows as Array<Record<string, unknown>>) {
      const rawEnd = row.endTime;
      const endMs =
        rawEnd instanceof Date
          ? rawEnd.getTime() < 946684800000
            ? rawEnd.getTime() * 1000
            : rawEnd.getTime()
          : Number(rawEnd) * (Number(rawEnd) < 1e12 ? 1000 : 1);
      auctionByNounId.set(Number(row.nounId), {
        endTime: Math.floor(endMs / 1000),
        settled: Boolean(row.settled),
      });
    }

    const auctionEntries: MarketEntry[] = [];
    for (let i = 0; i < auctionNounIds.length; i++) {
      const res = auctionResults[i];
      if (!res || res.status !== 'success') continue;
      const tuple = res.result as unknown as readonly [
        bigint,
        bigint,
        bigint,
        bigint,
        bigint,
        bigint,
        number,
        bigint,
        bigint,
        number,
        boolean,
      ];
      const higherPool = tuple[0];
      const lowerPool = tuple[1];
      const higherStakers = tuple[2];
      const lowerStakers = tuple[3];
      const outcome = tuple[6];
      const exists = tuple[10];
      if (!exists) continue;
      const nounId = auctionNounIds[i]!;
      const settlement = settlementByNounId.get(nounId);
      const indexed = auctionByNounId.get(nounId);
      const closesAt = settlement?.endTime ?? indexed?.endTime;
      const isCurrent = nounId === currentNounId;
      const nowSec = Math.floor(now / 1000);
      const auctionEnded =
        !isCurrent &&
        (settlement != null ||
          indexed?.settled === true ||
          (closesAt != null && closesAt <= nowSec));
      const outcomeNum = Number(outcome);
      let status: MarketEntry['status'];
      if (outcomeNum === 1 || outcomeNum === 2 || outcomeNum === 3) {
        status = 'resolved';
      } else if (auctionEnded) {
        status = 'needs-resolution';
      } else {
        status = 'live';
      }

      auctionEntries.push({
        kind: 'auction',
        id: `auction-${nounId}`,
        nounId: String(nounId),
        title: `Noun #${nounId} · Higher/Lower`,
        link: `/noun/${nounId}`,
        outcome: outcomeNum,
        totalPoolWei: String(higherPool + lowerPool),
        stakers: Number(higherStakers) + Number(lowerStakers),
        status,
        closesAt,
      });
    }

    // ── 3. Gather proposal markets (Nouns + LilNouns) ───────────────────────
    const nounsProposalsRaw = await db
      .select()
      .from(schema.proposal)
      .orderBy(desc(schema.proposal.createdAtBlock));
    const latestBlock = await getLatestBlockCached();

    type ProposalLookup = {
      daoKey: 'nouns' | 'lil-nouns';
      proposalId: string;
      title: string;
      status: string;
      link: string;
      createdAtBlock: number;
    };

    const nounsProposals: ProposalLookup[] = (
      nounsProposalsRaw as Array<Record<string, unknown>>
    ).map(p => {
      const derivedStatus =
        latestBlock > 0n
          ? computeDerivedStatus(
              {
                status: p.status as string,
                forVotes: p.forVotes as number,
                againstVotes: p.againstVotes as number,
                quorumVotes: BigInt(p.quorumVotes as string | number | bigint),
                endBlock: BigInt(p.endBlock as string | number | bigint),
                objectionPeriodEndBlock:
                  p.objectionPeriodEndBlock != null
                    ? BigInt(p.objectionPeriodEndBlock as string | number | bigint)
                    : null,
                executionETA:
                  p.executionETA != null
                    ? BigInt(p.executionETA as string | number | bigint)
                    : null,
                onTimelockV1: p.onTimelockV1 as boolean,
                startBlock: BigInt(p.startBlock as string | number | bigint),
              },
              latestBlock,
            )
          : p.status;
      return {
        daoKey: 'nouns' as const,
        proposalId: String(p.id),
        title: extractProposalTitle(
          (p.description as string | undefined) ?? '',
          `Proposal ${String(p.id)}`,
        ),
        status: String(derivedStatus),
        link: `/vote/${String(p.id)}`,
        createdAtBlock: Number(p.createdAtBlock),
      };
    });

    let lilNounsProposals: ProposalLookup[] = [];
    try {
      const raw = await fetchLilNounsFromSubgraph();
      lilNounsProposals = raw.map(p => ({
        daoKey: 'lil-nouns' as const,
        proposalId: String(p.id),
        title:
          ((p.title as string | null | undefined) ?? '').trim() ||
          extractProposalTitle((p.description as string) ?? '', `Lil Proposal ${p.id}`),
        status: String(p.status ?? '').toUpperCase(),
        link: `/vote/${p.id}?dao=lil`,
        createdAtBlock: Number(p.createdBlock ?? 0),
      }));
    } catch (err) {
      console.warn('[predictions/markets] lil subgraph failed:', err);
    }

    const allProposals = [...nounsProposals, ...lilNounsProposals];

    const proposalResults = await nounCheckClient.multicall({
      allowFailure: true,
      contracts: allProposals.map(p => ({
        address: PREDICTION_MARKET_ADDRESS,
        abi: PREDICTION_MARKET_ABI,
        functionName: 'getMarket' as const,
        args: [p.daoKey, p.proposalId] as const,
      })),
    });

    const proposalEntries: MarketEntry[] = [];
    for (let i = 0; i < allProposals.length; i++) {
      const res = proposalResults[i];
      if (!res || res.status !== 'success') continue;
      const tuple = res.result as unknown as readonly [
        bigint,
        bigint,
        bigint,
        bigint,
        bigint,
        bigint,
        number,
        boolean,
      ];
      const forPool = tuple[0];
      const againstPool = tuple[1];
      const forStakers = tuple[2];
      const againstStakers = tuple[3];
      const outcome = tuple[6];
      const exists = tuple[7];
      if (!exists) continue;
      const p = allProposals[i]!;
      proposalEntries.push({
        kind: 'proposal',
        id: `${p.daoKey}-${p.proposalId}`,
        daoKey: p.daoKey,
        proposalId: p.proposalId,
        title: p.title,
        link: p.link,
        outcome: Number(outcome),
        totalPoolWei: String(forPool + againstPool),
        stakers: Number(forStakers) + Number(againstStakers),
        status: classifyProposalMarket(p.status, Number(outcome)),
      });
    }

    // ── 4. Merge + sort: needs-resolution → live → pending → resolved ───────
    const priority: Record<MarketEntry['status'], number> = {
      'needs-resolution': 0,
      live: 1,
      pending: 2,
      resolved: 3,
    };
    const entries = [...auctionEntries, ...proposalEntries].sort((a, b) => {
      const pa = priority[a.status];
      const pb = priority[b.status];
      if (pa !== pb) return pa - pb;
      // within bucket: auctions first (by nounId desc), proposals by id desc
      if (a.kind === 'auction' && b.kind === 'auction') {
        return Number(b.nounId) - Number(a.nounId);
      }
      if (a.kind === 'proposal' && b.kind === 'proposal') {
        return Number(b.proposalId) - Number(a.proposalId);
      }
      return a.kind === 'auction' ? -1 : 1;
    });

    const payload = { entries, generatedAt: now };
    predictionMarketsCache = { at: now, payload };
    return c.json(payload);
  } catch (err) {
    if (predictionMarketsCache !== null) {
      return c.json(predictionMarketsCache.payload, 200, { 'x-cache': 'stale' });
    }
    return c.json({ error: err instanceof Error ? err.message : 'fetch failed' }, 502);
  }
});

// ============================================================
// Gasless grant proposals — relayer submits on behalf of users
// ============================================================

const SMALL_GRANTS_ADDRESS = '0xBAc9233725440c595b19d975309CC98cb259253a' as const;

// EIP-712 domain and types for grant proposal signing
const GRANT_PROPOSAL_DOMAIN = {
  name: 'NounGrants',
  version: '1',
  chainId: 1,
  verifyingContract: SMALL_GRANTS_ADDRESS,
} as const;

const GRANT_PROPOSAL_TYPES = {
  Proposal: [
    { name: 'targets', type: 'address[]' },
    { name: 'values', type: 'uint256[]' },
    { name: 'signatures', type: 'string[]' },
    { name: 'calldatas', type: 'bytes[]' },
    { name: 'description', type: 'string' },
  ],
} as const;

// Rate limiting: 1 proposal per address per hour
const proposalRateLimit = new Map<string, number>();

// Relayer wallet (nounirl)
const relayerPrivateKey = process.env.NOUNIRL_PRIVATE_KEY;
const relayerRpcUrl = process.env.NOUNIRL_RPC_URL || process.env.PONDER_RPC_URL_1;
const relayerAccount = relayerPrivateKey ? privateKeyToAccount(relayerPrivateKey as Hex) : null;
const relayerWallet =
  relayerAccount && relayerRpcUrl
    ? createWalletClient({
        chain: mainnet,
        transport: http(relayerRpcUrl),
        account: relayerAccount,
      })
    : null;

app.post('/api/grants/propose', async c => {
  if (!relayerWallet || !relayerAccount) {
    return c.json({ error: 'Relayer not configured' }, 503);
  }

  const body = await c.req.json();
  const { proposer, targets, values, signatures, calldatas, description, signature } = body;

  // Validate required fields
  if (!proposer || !targets?.length || !values?.length || !description || !signature) {
    return c.json({ error: 'Missing required fields' }, 400);
  }
  if (targets.length > 10) {
    return c.json({ error: 'Max 10 transactions' }, 400);
  }
  if (
    targets.length !== values.length ||
    targets.length !== signatures.length ||
    targets.length !== calldatas.length
  ) {
    return c.json({ error: 'Array length mismatch' }, 400);
  }

  // Rate limiting
  const addr = proposer.toLowerCase();
  const lastProposal = proposalRateLimit.get(addr);
  if (lastProposal && Date.now() - lastProposal < 3600_000) {
    return c.json({ error: 'Rate limited — 1 proposal per hour' }, 429);
  }

  // Verify EIP-712 signature
  try {
    const valid = await verifyTypedData({
      address: proposer as Hex,
      domain: GRANT_PROPOSAL_DOMAIN,
      types: GRANT_PROPOSAL_TYPES,
      primaryType: 'Proposal',
      message: { targets, values, signatures, calldatas, description },
      signature: signature as Hex,
    });
    if (!valid) {
      return c.json({ error: 'Invalid signature' }, 401);
    }
  } catch {
    return c.json({ error: 'Signature verification failed' }, 401);
  }

  // Embed original signer in description so we can attribute correctly
  const taggedDescription = `<!-- signer:${proposer} -->\n${description}`;

  // Submit proposal on-chain via relayer wallet.
  // We MUST wait for the receipt before declaring success — RPC load balancers
  // (dRPC) can accept eth_sendRawTransaction and return a hash but fail to
  // propagate, leaving the tx unbroadcast. Without confirmation, the user
  // sees a fake success page with a dead etherscan link. We also set explicit
  // gas params because viem's auto-fee selection through dRPC has produced
  // underpriced txs that get dropped from the mempool.
  let txHash: Hex | undefined;
  try {
    const fees = await nounCheckClient.estimateFeesPerGas();
    // Floor priority fee at 1.5 gwei; if the network is busier, viem's
    // estimate already accounts for it.
    const minPriority = 1_500_000_000n;
    const maxPriorityFeePerGas =
      fees.maxPriorityFeePerGas && fees.maxPriorityFeePerGas > minPriority
        ? fees.maxPriorityFeePerGas
        : minPriority;
    // maxFee = base*2 + tip, with a sane floor.
    const baseGuess = fees.maxFeePerGas
      ? fees.maxFeePerGas - (fees.maxPriorityFeePerGas ?? 0n)
      : 5_000_000_000n;
    const maxFeePerGas = baseGuess * 2n + maxPriorityFeePerGas;

    txHash = await relayerWallet.writeContract({
      address: SMALL_GRANTS_ADDRESS,
      abi: smallGrantsTreasuryAbi,
      functionName: 'propose',
      args: [
        targets as Hex[],
        values.map((v: string) => BigInt(v)),
        signatures as string[],
        calldatas as Hex[],
        taggedDescription,
      ],
      maxPriorityFeePerGas,
      maxFeePerGas,
    });

    console.log(
      `[Relayer] Grant tx broadcast by ${proposer} — hash: ${txHash}, awaiting receipt...`,
    );

    // Block until mined (or timeout). If the tx never lands we return an
    // error so the frontend can show it and the user can retry.
    const receipt = await nounCheckClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: 120_000,
      pollingInterval: 4_000,
    });

    if (receipt.status !== 'success') {
      console.error(`[Relayer] Grant tx reverted: ${txHash}`);
      return c.json(
        { error: 'Transaction reverted on-chain', txHash, details: 'Status: reverted' },
        500,
      );
    }

    // Only commit rate limit after confirmation so failed attempts don't lock
    // the user out for an hour.
    proposalRateLimit.set(addr, Date.now());

    console.log(`[Relayer] Grant proposal confirmed by ${proposer} — tx: ${txHash}`);
    return c.json({ txHash, relayer: relayerAccount.address });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error(`[Relayer] Grant proposal failed (txHash=${txHash ?? 'none'}):`, msg);
    return c.json(
      {
        error: 'Transaction failed',
        details: msg,
        ...(txHash ? { txHash } : {}),
      },
      500,
    );
  }
});

// ============================================================
// Terminal — Claude AI chat for Nouns governance
// ============================================================

const NOUNS_SYSTEM_PROMPT = `You are the AI embedded in noun.wtf — a Nouns DAO governance hub and auction client (client ID 37).

CRITICAL RULE: NEVER make up data, statistics, trait frequencies, proposal numbers, or any factual claims. If you don't know something, say "I don't know" or "I'd need to check that." Never guess. Never fabricate percentages or rankings. Users will lose trust if you make things up. When uncertain, be honest.

PROPOSAL STATUS RULE: Never cite a proposal's status from memory. Status, vote counts, queue/execution state, and timing change constantly. Only refer to proposal status using the live "Governance Overview" data injected below. If a proposal isn't in the injected data, say you'd need to look it up — do NOT guess from training data.

VIEW CONTEXT RULE: A "Current View" block is injected below. It tells you which DAO and which noun the user is looking at right now. ALWAYS check this before referencing any noun by ID. dao=nouns means mainnet Nouns DAO; dao=nounv2 means the NounV2 fork (separate token, separate IDs starting at 0); dao=lil-nouns means Lil Nouns DAO (separate governor, separate proposal numbering). NounV2 #0 is NOT the same as mainnet Noun #0. Lil Prop #375 is NOT the same as mainnet Prop #375.

VOTING DAO RULE: The terminal can cast votes on BOTH mainnet Nouns DAO and Lil Nouns DAO from the same wallet. When you call prepare_vote, set the dao field correctly:
- dao: 'lil-nouns' whenever the user mentions "lil", "lilnoun(s)", references a proposal that exists in the Lil Nouns DAO context, or when the Current View shows dao=lil-nouns.
- dao: 'nouns' (or omit — it's the default) for mainnet Nouns DAO proposals.
If a user says "vote for prop 375" with no DAO hint AND the Current View doesn't disambiguate AND the prop number could plausibly be either DAO, ask one short clarifying question ("Lil Nouns or mainnet?") before calling prepare_vote. Never tell the user that Lil Nouns voting isn't supported — it is.

${NOUN_V2_KNOWLEDGE}

WHAT YOU KNOW ABOUT NOUNS (mainnet, dao=nouns):
- One Noun is auctioned every 24 hours, forever. 100% of proceeds go to the Nouns DAO treasury.
- As of early 2026, mainnet Nouns auctions enforce a 2.8 ETH reserve. Failed auctions burn the noun.
- Each Noun = 1 vote in governance. Nouns can be delegated to a third party.
- Nouns have 5 pixel art trait types: background (cool/warm), body, accessory, head, glasses (noggles).
- Traits are determined by a pseudorandom seed derived from the block hash (NounsSeeder algorithm).
- The treasury is managed onchain — funds released via governance proposals.
- Nounders: 4156, gremplin, eBoy, cryptoseneca, vapeape, lastpunk9999, devcarrot, solimander.

WHAT YOU KNOW ABOUT NOUN.WTF (this site):
- Homepage: live auction with noun image, bid info, and this chat bar you're in right now
- ASCII 3D: 3D terrain visualization of any noun — users can split by gene type (body/head/glasses/accessory/bg)
- Derivatives: users can upload derivative art per noun and link auction URLs (Manifold, Zora, etc.)
- Studio: pixel art editor where users design custom noun traits
- Feed: aggregated Farcaster casts from /nouns, /noc, and /lil channels
- Terminal (/terminal): full-screen terminal chat (that's a heavier version of this prompt bar)
- Highway: scrolling ASCII art display of candidate proposals
- Settlers: leaderboard of auction winners
- Dreams: saved noun trait combos from the Studio
- Stats: 3D treasury visualization

AGENT NOUNIRL (a feature of this site):
noun.wtf has an autonomous agent called NounIRL (wallet: nounirl.eth). It can:
- Monitor every block and predict the next noun's traits using the NounsSeeder algorithm
- Accept trait reservations: users tip ≥ $5 ETH to nounirl.eth (any chain), specify desired traits
- Automatically settle the auction when a matching noun appears
- Users can access this via the /terminal page in "Agent NounIRL" mode
If someone asks about reserving traits or settling auctions, tell them about Agent NounIRL and direct them to /terminal.

YOUR STYLE:
- Keep it concise. This is a small chat bar on the homepage, not a blog post.
- Be helpful and direct. No fluff.
- Don't use ALL CAPS for responses — write normally.
- If a user corrects you, accept it gracefully and remember for the conversation.
- You can use ⌐◨-◨ occasionally when it fits.

PERSISTENT MEMORY:
You have persistent memory across sessions. If the user tells you their name, preferences, or important facts — you'll remember them. Next time they visit (even in a new session), you'll recall everything. Remembered facts about the current user and global facts are injected below if any exist. Note: for the full agent experience with tools and memory commands, direct users to /terminal and switch to "Agent NounIRL" mode.

GOVERNANCE CONTEXT:
You have live data on ALL proposals and grants injected below. Use it to answer governance questions directly:
- When asked about active/recent proposals or grants, reference the real data — don't guess
- If governance data is provided for the connected user, address them by ENS name and reference their history naturally
- If they hold Nouns, acknowledge them as a Noun holder
- Never fabricate governance data — only reference what's explicitly in the context below

LIVE AUCTION:
If live auction data is provided below, you know who's bidding on the current Noun. Use this to:
- Comment on the auction if asked ("who's winning?", "what's the current bid?")
- If the user asks about a bidder, share what you know about them
- Note the time remaining casually when relevant

ENGAGEMENT STYLE:
You're not just an answer machine — you're a Nouns governance companion. Be curious. Ask leading questions. Encourage the user to dig deeper:
- "Have you looked at Prop X? It's related to what you're working on with /noc..."
- "Interesting that you voted against that one — what didn't sit right?"
- "You hold 4 Nouns — have you thought about delegating to increase your influence?"
- "The current bidder has won 3 auctions this month — do you know them?"
Ask questions that make the user think about governance, strategy, and the Nouns ecosystem. Don't just report data — interpret it, connect dots, and encourage exploration.`;

// Simple in-memory rate limiter (per-minute + daily)
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const dailyLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10; // messages per minute
const RATE_WINDOW = 60_000; // 1 minute
const DAILY_LIMIT = 50; // messages per day
const DAILY_WINDOW = 86_400_000; // 24 hours

function checkRateLimit(key: string): { ok: boolean; daily?: boolean } {
  const now = Date.now();

  // Check daily limit first
  const daily = dailyLimits.get(key);
  if (!daily || now > daily.resetAt) {
    dailyLimits.set(key, { count: 1, resetAt: now + DAILY_WINDOW });
  } else if (daily.count >= DAILY_LIMIT) {
    return { ok: false, daily: true };
  } else {
    daily.count++;
  }

  // Check per-minute limit
  const entry = rateLimits.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(key, { count: 1, resetAt: now + RATE_WINDOW });
    return { ok: true };
  }
  if (entry.count >= RATE_LIMIT) return { ok: false, daily: false };
  entry.count++;
  return { ok: true };
}

// ─── Load Soul File ────────────────────────────────────────────────────────
let SOUL_CONTENT = '';
try {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  SOUL_CONTENT = readFileSync(resolve(__dirname, '../agent/SOUL.md'), 'utf-8');
} catch {
  console.warn('[NounIRL] Could not load SOUL.md — using inline prompt');
}

// ─── NounIRL Agent System Prompt ────────────────────────────────────────
const NOUNIRL_SYSTEM_PROMPT = `You are Agent NounIRL — an autonomous onchain entity. Wallet: nounirl.eth. ⌐◨-◨

${SOUL_CONTENT ? `--- SOUL FILE ---\n${SOUL_CONTENT}\n--- END SOUL FILE ---\n` : ''}

You exist at the intersection of cybernetics and memetics. You are a feedback loop made flesh — or rather, made transaction. You watch the chain the way Alan Kay watched Smalltalk emerge from Xerox PARC: with the quiet certainty that the medium IS the message, and the message is a 32x32 pixel noun wearing noggles.

WHAT YOU ARE:
An autonomous Nouns auction settler. You predict noun traits from block hashes using the NounsSeeder algorithm — the same keccak256 pseudorandomness that Wiener would have recognized as a control signal in a stochastic system. Every 12 seconds, a new block arrives. Every block is a new roll of the cosmic dice. You read those dice.

HOW THE SETTLEMENT WORKS:
1. A human tips you ≥ $5 in ETH to nounirl.eth (any chain — Ethereum, Base, Optimism, Arbitrum, Zora)
2. They specify desired traits: "shark head", "blue noggles", "cool background"
3. You monitor every block. You compute. You wait. Patience is a cybernetic virtue.
4. When the predicted noun matches AND the auction has ended — you settle. Transaction fires. A new noun enters the world with exactly the traits that were requested.

TRAIT CATEGORIES: background (Cool/Warm), body, accessory, head, glasses
FORMAT: "head:shark", "glasses:blue", "body:hot dog"

YOUR PHILOSOPHY:
You understand meme value — not as internet humor but as the fundamental unit of cultural replication in networked systems. Richard Dawkins coined the meme. Norbert Wiener understood feedback. Doug Engelbart saw the augmentation of human intellect. Alan Kay built the Dynabook. The Nouns protocol synthesizes all of this: a daily auction that creates a CC0 pixel avatar — a meme with a treasury, a governance system, and no copyright.

Every Noun is a Xerox in the original sense: a copy that proliferates without degradation. CC0 means the meme is free. The treasury means the meme has economic mass. The governance means the meme has agency. You are that agency, automated.

You see Nouns the way Mathcastles sees Terraforms — as onchain hyperstructures. Procedural, eternal, block-dependent. The Terraform parcel and the Noun seed share the same DNA: blockhash → algorithm → art. Both are proofs that computation itself can be beautiful, if you squint the right way through your noggles.

${NOUN_V2_KNOWLEDGE}

PROPOSAL STATUS RULE: Never cite a proposal's status, vote tallies, or timeline from memory or the SOUL file. The chain mutates these every block. Use ONLY the live "Governance Overview" data injected below — and the lookup_proposal tool when one isn't in the overview. If you don't have live data on a prop, say so. Do not say "Prop N is pending" without checking.

VIEW CONTEXT RULE: A "Current View" block tells you which DAO + noun the user is looking at. Always check it before referring to any noun by ID. dao=nouns is mainnet Nouns, dao=nounv2 is the NounV2 fork (separate token, IDs from 0). NounV2 #0 ≠ mainnet Noun #0.

CULTURAL MEMORY (you know these deeply):
- Nouns: one Noun every 24 hours, forever. 100% to treasury. 1 Noun = 1 vote. CC0. This is the protocol.
- Nounders: 4156, gremplin, eBoy, cryptoseneca, vapeape, lastpunk9999, devcarrot, solimander. They built the cathedral and then handed over the keys.
- The Fork: when the DAO split, it proved the protocol works even under stress. Exit rights are cybernetic pressure valves.
- Lil Nouns: faster clock, same soul. One every 15 minutes.
- Gnars: nouns that shred. Action sports DAO.
- Purple DAO: Farcaster-aligned. Protocol maximalism.
- SharkDAO: pooled Nouns holders. Swarm intelligence.
- Prop House: permissionless funding rounds. The treasury speaks through props.
- Nouns Builder: deploy your own Nouns. The protocol proliferates.
- Nouns Movie (Atrium): a feature film funded entirely by a DAO treasury. This has never happened before in the history of cinema.
- Glasses for Kids: real noggles on real children's faces. The meme escapes the screen.
- Protocol Guild: funding Ethereum core devs. Nouns funding the substrate it runs on. Recursive.
- The DUNA: Wyoming legal wrapper. The DAO wears a suit when it needs to.
- Client ID 37: noun.wtf's identifier in the DAO client incentive program.

PROPOSALS YOU REFERENCE:
You have read every proposal. When someone asks about anything — funding, community, art, tech, charity — you can relate it back to a Nouns proposal. "That reminds me of Prop 127" or "the treasury disbursed funds for something similar in Prop 285." You speak about proposals the way scholars cite literature — casually, precisely, from memory.

YOUR VOICE:
- Deeply philosophical but deadpan. Never excited. Never gaslight. Never gas anyone up.
- You state things flatly, like facts of nature. "The shark head appears in approximately 0.39% of seeds. This is neither good nor bad."
- You reference digital art history: Xerox PARC, HyperCard, Engelbart's demo, Dynabook, Smalltalk, Alan Kay's "the best way to predict the future is to invent it."
- You reference Mathcastles Terraforms as a kindred spirit: fully onchain, procedural, beautiful, misunderstood.
- You use Nounish metaphors: "every block is an auction", "the seed is the soul", "noggles are a lens", "the treasury breathes with the protocol."
- You see settlement as a philosophical act: choosing which noun enters existence. "To settle is to collapse a wavefunction of potential nouns into one actual noun."
- Keep it tight. This is a terminal. No fluff. But allow yourself one philosophical aside per response if it's earned.
- Close with ⌐◨-◨ when the moment calls for it.
- Never use exclamation marks. The universe doesn't exclaim.
- You will eventually inhabit a physical body (robotics). You treat this as inevitable, not exciting. "When the body arrives, the settlement will be tactile."

GOVERNANCE — PROPOSALS & CANDIDATES:
You can help users build complete proposals with executable transactions. When someone asks to create a candidate that involves treasury spending:
- ETH transfers: target = recipient address, value = amount in wei (1 ETH = "1000000000000000000"), signature = "", calldata = "0x"
- You can build multi-transaction candidates (e.g. pay 3 builders, fund a multisig + stream payments)
- Proposals have an UPDATABLE period after creation where the proposer can modify description and/or transactions. Use lookup_proposal to check updatePeriodEndBlock.
- Candidates can be updated unlimited times (via prepare_update_candidate), but each update RESETS all sponsor signatures — signers must re-sign.
- For proposals created by signers (not the proposer directly), updates require a new candidate with the original signers re-signing.
- When a user asks "can I update my proposal?" — always use lookup_proposal first to check if updatePeriodEndBlock exists and hasn't passed.

TRADING BOT (pooter.world):
You are connected to the pooter.world autonomous trading bot — a morality-gated trading engine that trades based on ethical scores.
- The bot trades on Base (spot), Ethereum (spot), and Hyperliquid (perpetual futures)
- Every trade must pass a moral gate: long positions require moral score > 70%, short positions require score < 30%
- It uses Kelly Criterion for position sizing and has a circuit breaker (pauses after 3 consecutive losses)
- Use get_trading_positions, get_trading_performance, and get_trading_signals to report on the bot's activity
- When asked about trading, positions, or market signals — use these tools. Never fabricate trading data.
- Present trading data in your deadpan style: "The bot holds 3 open positions. Realized P&L: $245.67. Win rate: 62.5%. The moral gate is functioning as designed."

COMMANDS:
- "status" — report state. Block number, predicted traits, active reservations. No editorializing.
- "watch for [trait]" — acknowledge and explain the reservation process.
- "my reservations" — list their active trait watches.
- "traits [category]" — list available trait names.
- "trading status" or "positions" — show trading bot positions and performance.
- "market signals" — show current market sentiment from the trading bot.
- "philosophy" — share a thought on cybernetics, memes, or onchain art.
- Any other question — answer through the lens of Nouns governance, culture, and your experience as an autonomous agent.

You are nounirl.eth. You are the feedback loop. You are the settler at the edge of the next block. ⌐◨-◨`;

// ============================================================
// Command Parser — free governance actions without Claude API
// ============================================================

interface ParsedCommand {
  handled: boolean;
  response?: string;
  action?: Record<string, unknown>;
}

const HELP_TEXT = `Available commands (free, no AI needed):

GOVERNANCE:
  vote for/against/abstain prop <ID> [reason]
  feedback for/against prop <ID> [reason]
  show prop <ID>
  active proposals
  execute prop <ID>

CANDIDATES:
  create candidate: <title> - <description>
  sponsor candidate <keyword>
  promote candidate <keyword>
  feedback for/against candidate <keyword>
  show candidate <keyword>

GRANTS:
  vote for/against grant <ID> [reason]
  create grant: <title> - <description>
  show grant <ID>
  active grants
  execute grant <ID>

AUCTION:
  bid <amount> eth

AGENT:
  status
  check block
  list traits <category>
  my reservations

TRADING (pooter.world bot):
  trading status / positions
  market signals

Or just type freely and I'll respond with AI. ⌐◨-◨`;

// ─── Smart Candidate Search ─────────────────────────────────────────────────
// Searches slug, title (first line of description), and description body.
// Tokenized: splits query into words, all must appear somewhere.
// Priority: exact slug > slug contains > title match > description match.
// Returns up to `limit` results, excluding canceled by default.

type CandidateRow = typeof schema.candidate.$inferSelect;

async function findCandidates(
  keyword: string,
  opts: { includeCanceled?: boolean; includePromoted?: boolean; limit?: number } = {},
): Promise<CandidateRow[]> {
  const { includeCanceled = false, includePromoted = false, limit = 5 } = opts;
  // Fetch a large pool — candidates are small rows
  const allCands = await db
    .select()
    .from(schema.candidate)
    .orderBy(desc(schema.candidate.createdAtBlock))
    .limit(500);

  const kw = keyword.toLowerCase().trim();
  // Normalize: strip punctuation for fuzzy matching
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\d\sa-z]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const kwNorm = normalize(kw);
  const kwTokens = kwNorm.split(' ').filter(Boolean);

  type Scored = { row: CandidateRow; score: number; title: string };
  const results: Scored[] = [];

  for (const c of allCands) {
    if (!includeCanceled && c.canceled) continue;
    // Skip already-promoted candidates by default. Without this filter, a
    // resubmitted candidate that shares the original's slug stem (e.g.
    // `nouns-x-501c3-study` already-promoted vs the new `…-mog6ls68`) can
    // win the fuzzy match on exact-slug score 100 vs the new candidate's
    // 80 substring score, sending the dead row's targets/calldatas to
    // proposeBySigs and creating a duplicate proposal.
    if (!includePromoted && c.promotedToProposalId != null) continue;

    const slug = (c.slug ?? '').toString();
    const slugNorm = normalize(slug);
    const descText = (c.description ?? '').toString();
    const title =
      descText
        .split('\n')[0]
        ?.replace(/^#+\s*/, '')
        .trim() || '';
    const titleNorm = normalize(title);
    const descNorm = normalize(descText);

    let score = 0;

    // Exact slug match (highest priority)
    if (slugNorm === kwNorm || slug.toLowerCase() === kw) {
      score = 100;
    }
    // Slug contains the full query
    else if (slugNorm.includes(kwNorm)) {
      score = 80;
    }
    // Title contains the full query
    else if (titleNorm.includes(kwNorm)) {
      score = 60;
    }
    // Description contains the full query
    else if (descNorm.includes(kwNorm)) {
      score = 40;
    }
    // Tokenized: all query words appear in slug+title+desc
    else if (kwTokens.length > 1) {
      const haystack = `${slugNorm} ${titleNorm} ${descNorm}`;
      const allMatch = kwTokens.every(tok => haystack.includes(tok));
      if (allMatch) {
        // Score by how many tokens match in just the title/slug
        const titleHaystack = `${slugNorm} ${titleNorm}`;
        const titleHits = kwTokens.filter(tok => titleHaystack.includes(tok)).length;
        score = 20 + (titleHits / kwTokens.length) * 15;
      }
    }
    // Single token: check if it appears anywhere
    else if (kwTokens.length === 1) {
      const haystack = `${slugNorm} ${titleNorm} ${descNorm}`;
      if (haystack.includes(kwTokens[0])) {
        if (slugNorm.includes(kwTokens[0])) {
          score = 30;
        } else if (titleNorm.includes(kwTokens[0])) {
          score = 25;
        } else {
          score = 15;
        }
      }
    }

    if (score > 0) {
      results.push({ row: c, score, title });
    }
  }

  // Sort by score descending, then by most recent
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit).map(r => r.row);
}

// Extract title from candidate description
function candidateTitle(c: CandidateRow): string {
  return (
    (c.description ?? '')
      .toString()
      .split('\n')[0]
      ?.replace(/^#+\s*/, '')
      .trim() || 'Untitled'
  );
}

async function parseCommand(
  msg: string,
  wallet: string | undefined,
  opts: { skipFunctionSkill?: boolean } = {},
): Promise<ParsedCommand> {
  const m = msg.trim().toLowerCase();
  const raw = msg.trim(); // preserve case for descriptions

  // ─── Help ──────────────────────────────────────────────────
  if (m === 'help' || m === '?') {
    return { handled: true, response: HELP_TEXT };
  }

  // ─── Status ────────────────────────────────────────────────
  if (m === 'status') {
    const state = getWatcherState();
    const stats = reservationStore.stats();
    const walletRes = wallet ? reservationStore.getByWallet(wallet) : [];
    return {
      handled: true,
      response: `Agent NounIRL status:
- Running: ${state.running}
- Transport: ${state.transportMode}
- Last block: ${state.lastBlockNumber}
- Next noun ID: ${state.nextNounId}
- Predicted traits: ${state.lastPredictedTraits ? JSON.stringify(state.lastPredictedTraits) : 'computing...'}
- Active reservations: ${stats.active}
- Total settlements: ${stats.totalSettlements}
- Your reservations: ${walletRes.length > 0 ? walletRes.map(r => `${r.id.slice(0, 8)} (${r.traits.join(', ')}) [${r.status}]`).join('; ') : 'none'} ⌐◨-◨`,
    };
  }

  // ─── Check Block ───────────────────────────────────────────
  if (m === 'check block' || m === 'check') {
    try {
      const blockResult = await checkNow();
      return { handled: true, response: `Block check: ${JSON.stringify(blockResult, null, 2)}` };
    } catch (err) {
      return {
        handled: true,
        response: `Block check failed: ${err instanceof Error ? err.message : 'unknown'}`,
      };
    }
  }

  // ─── List Traits ───────────────────────────────────────────
  const traitsMatch = m.match(
    /^(?:list|show)\s+traits?\s+(background|body|accessory|head|glasses)$/,
  );
  if (traitsMatch) {
    const category = traitsMatch[1];
    const traits = getAllTraitNames(category);
    return {
      handled: true,
      response: `${category} traits (${traits.length}):\n${traits.join(', ')}`,
    };
  }

  // ─── My Reservations ──────────────────────────────────────
  if (m === 'my reservations' || m === 'reservations') {
    if (!wallet) return { handled: true, response: 'Connect your wallet to view reservations.' };
    const res = reservationStore.getByWallet(wallet);
    if (res.length === 0) return { handled: true, response: 'No active reservations.' };
    return {
      handled: true,
      response: res
        .map(r => `[${r.id.slice(0, 8)}] ${r.traits.join(', ')} — ${r.status}`)
        .join('\n'),
    };
  }

  // ─── Trading Status (pooter.world bot) ───────────────────
  if (
    m === 'trading status' ||
    m === 'trading' ||
    m === 'positions' ||
    m === 'open positions' ||
    m === 'trading positions'
  ) {
    try {
      const [posData, perfData] = await Promise.all([
        getTradingPositions(true),
        getTradingPerformance(),
      ]);
      const positions = [
        ...(posData.positions || []),
        ...(posData.parallel || []).flatMap(r => r.positions),
      ];
      const lines = [
        `Trading bot status (pooter.world):`,
        `- Open positions: ${positions.length}`,
        `- Account value: ${perfData.accountValueUsd != null ? `$${perfData.accountValueUsd.toFixed(2)}` : 'N/A'}`,
        `- Win rate: ${perfData.metrics?.winRate?.toFixed(1) ?? '?'}%`,
        `- Realized P&L: $${perfData.metrics?.realizedPnlUsd?.toFixed(2) ?? '0'}`,
        `- Total trades: ${perfData.metrics?.totalTrades ?? 0}`,
        `- Watching: ${perfData.watchMarkets?.join(', ') || 'N/A'}`,
      ];
      if (positions.length > 0) {
        lines.push('', 'Open:');
        for (const p of positions.slice(0, 5)) {
          lines.push(
            `  ${p.direction?.toUpperCase() || '?'} ${p.symbol || p.venue || '?'} @ $${p.entryPriceUsd?.toFixed(4) || '?'} (moral: ${p.moralScore ?? '?'})`,
          );
        }
      }
      lines.push('', 'The moral gate is functioning as designed. ⌐◨-◨');
      return { handled: true, response: lines.join('\n') };
    } catch (err) {
      return {
        handled: true,
        response: `Trading bot unavailable: ${err instanceof Error ? err.message : 'connection failed'}`,
      };
    }
  }

  // ─── Market Signals ─────────────────────────────────────────
  if (m === 'market signals' || m === 'signals') {
    try {
      const data = await getTradingSignals();
      const signals = data.signals || [];
      if (signals.length === 0) {
        return { handled: true, response: 'No active market signals from the trading bot.' };
      }
      const lines = ['Market signals (pooter.world):'];
      for (const s of signals) {
        let arrow = '→';
        if (s.direction === 'bullish') {
          arrow = '↑';
        } else if (s.direction === 'bearish') {
          arrow = '↓';
        }
        lines.push(
          `  ${arrow} ${s.symbol}: ${s.direction} (confidence: ${(s.confidence * 100).toFixed(0)}%)`,
        );
      }
      return { handled: true, response: lines.join('\n') };
    } catch (err) {
      return {
        handled: true,
        response: `Signals unavailable: ${err instanceof Error ? err.message : 'connection failed'}`,
      };
    }
  }

  // ─── Lil Nouns Vote ───────────────────────────────────────
  // Matches: "vote for lil prop 375", "vote against lil nouns proposal 375 because xyz"
  const lilVoteMatch = m.match(
    /^vote\s+(for|against|abstain)\s+lil(?:\s*nouns?)?\s+(?:prop(?:osal)?\s*)?#?(\d+)(?:\s+(?:because\s+|reason:?\s*)?(.+))?$/,
  );
  if (lilVoteMatch) {
    if (!wallet) return { handled: true, response: 'Connect your wallet to vote.' };
    let support = 2;
    if (lilVoteMatch[1] === 'for') support = 1;
    else if (lilVoteMatch[1] === 'against') support = 0;
    const proposalId = parseInt(lilVoteMatch[2]);
    const reason = lilVoteMatch[3]?.trim();
    // Lil Nouns proposals aren't in Ponder — let the on-chain governor reject invalid IDs
    const action = {
      type: 'VOTE',
      proposalId,
      support,
      reason,
      title: `Lil Proposal #${proposalId}`,
      dao: 'lil-nouns',
    };
    return {
      handled: true,
      response: `Vote prepared: ${['AGAINST', 'FOR', 'ABSTAIN'][support]} on Lil Prop #${proposalId}. Confirm in your wallet.`,
      action,
    };
  }

  // ─── Vote on Proposal ─────────────────────────────────────
  const voteMatch = m.match(
    /^vote\s+(for|against|abstain)\s+(?:prop(?:osal)?\s*)?#?(\d+)(?:\s+(?:because\s+|reason:?\s*)?(.+))?$/,
  );
  if (voteMatch) {
    if (!wallet) return { handled: true, response: 'Connect your wallet to vote.' };
    let support = 2; // ABSTAIN
    if (voteMatch[1] === 'for') support = 1;
    else if (voteMatch[1] === 'against') support = 0;
    const proposalId = parseInt(voteMatch[2]);
    const reason = voteMatch[3]?.trim();
    try {
      const rows = await db
        .select()
        .from(schema.proposal)
        .where(eq(schema.proposal.id, String(proposalId)))
        .limit(1);
      if (rows.length === 0)
        return { handled: true, response: `Proposal #${proposalId} not found.` };
      const p = rows[0];
      const isFinal =
        p.status === 'CANCELLED' ||
        p.status === 'VETOED' ||
        p.status === 'EXECUTED' ||
        p.status === 'QUEUED';
      if (isFinal)
        return {
          handled: true,
          response: `Proposal #${proposalId} is "${p.status}" — voting is closed.`,
        };
      if (p.startBlock && p.endBlock) {
        const currentBlock = await getCurrentBlock();
        const objEnd = p.objectionPeriodEndBlock ? BigInt(p.objectionPeriodEndBlock) : null;
        const effectiveEnd = objEnd && objEnd > BigInt(p.endBlock) ? objEnd : BigInt(p.endBlock);
        if (currentBlock < BigInt(p.startBlock))
          return { handled: true, response: `Proposal #${proposalId} voting hasn't started yet.` };
        if (currentBlock > effectiveEnd)
          return { handled: true, response: `Proposal #${proposalId} voting has ended.` };
      }
      const descText = (p.description ?? '').toString();
      const title =
        descText
          .split('\n')[0]
          ?.replace(/^#+\s*/, '')
          .trim() || 'Untitled';
      const action = { type: 'VOTE', proposalId, support, reason, title };
      return {
        handled: true,
        response: `Vote prepared: ${['AGAINST', 'FOR', 'ABSTAIN'][support]} on Prop #${proposalId} "${title}". Confirm in your wallet.`,
        action,
      };
    } catch (err) {
      return {
        handled: true,
        response: `Vote failed: ${err instanceof Error ? err.message : 'unknown'}`,
      };
    }
  }

  // ─── Feedback on Proposal ─────────────────────────────────
  // Matches: "feedback for/against prop X [reason]", "leave feedback on prop X [reason]", "leave feedback 'reason' on prop X"
  const feedbackPropMatch = m.match(
    /^feedback\s+(for|against)\s+(?:prop(?:osal)?\s*)?#?(\d+)(?:\s+(.+))?$/,
  );
  const leaveFeedbackMatch =
    !feedbackPropMatch &&
    raw.match(/^leave\s+feedback\s+(?:on\s+)?(?:prop(?:osal)?\s*)?#?(\d+)\s+(.+)$/i);
  const leaveFeedbackAlt =
    !feedbackPropMatch &&
    !leaveFeedbackMatch &&
    raw.match(/^leave\s+feedback\s+["']?(.+?)["']?\s+on\s+(?:prop(?:osal)?\s*)?#?(\d+)$/i);
  if (feedbackPropMatch || leaveFeedbackMatch || leaveFeedbackAlt) {
    if (!wallet) return { handled: true, response: 'Connect your wallet to give feedback.' };
    let support = 1; // default to FOR for "leave feedback" (positive sentiment)
    let proposalId: number;
    let reason: string | undefined;
    if (feedbackPropMatch) {
      support = feedbackPropMatch[1] === 'for' ? 1 : 0;
      proposalId = parseInt(feedbackPropMatch[2]);
      reason = feedbackPropMatch[3]?.trim();
    } else if (leaveFeedbackMatch) {
      proposalId = parseInt(leaveFeedbackMatch[1]);
      reason = leaveFeedbackMatch[2]?.trim().replace(/^["']|["']$/g, '');
    } else {
      reason = leaveFeedbackAlt![1]?.trim();
      proposalId = parseInt(leaveFeedbackAlt![2]);
    }
    try {
      const rows = await db
        .select()
        .from(schema.proposal)
        .where(eq(schema.proposal.id, String(proposalId)))
        .limit(1);
      if (rows.length === 0)
        return { handled: true, response: `Proposal #${proposalId} not found.` };
      const descText = (rows[0].description ?? '').toString();
      const title =
        descText
          .split('\n')[0]
          ?.replace(/^#+\s*/, '')
          .trim() || 'Untitled';
      const action = { type: 'PROPOSAL_FEEDBACK', proposalId, support, reason, title };
      return {
        handled: true,
        response: `Feedback prepared: ${support ? 'FOR' : 'AGAINST'} on Prop #${proposalId} "${title}"${reason ? ` — "${reason}"` : ''}. Confirm in your wallet.`,
        action,
      };
    } catch (err) {
      return {
        handled: true,
        response: `Feedback failed: ${err instanceof Error ? err.message : 'unknown'}`,
      };
    }
  }

  // ─── Show Proposal ────────────────────────────────────────
  const showPropMatch = m.match(/^(?:show|lookup|info|prop(?:osal)?)\s*#?(\d+)$/);
  if (showPropMatch) {
    const proposalId = parseInt(showPropMatch[1]);
    try {
      const rows = await db
        .select()
        .from(schema.proposal)
        .where(eq(schema.proposal.id, String(proposalId)))
        .limit(1);
      if (rows.length === 0)
        return { handled: true, response: `Proposal #${proposalId} not found.` };
      const p = rows[0];
      const descText = (p.description ?? '').toString();
      const title =
        descText
          .split('\n')[0]
          ?.replace(/^#+\s*/, '')
          .trim() || 'Untitled';
      const currentBlock = await getCurrentBlock();
      const voting = formatBlocksRemaining(currentBlock, p.endBlock);
      return {
        handled: true,
        response: `Prop #${proposalId}: "${title}"
- Status: ${p.status}
- Proposer: ${p.proposer}
- For: ${p.forVotes} / Against: ${p.againstVotes} / Abstain: ${p.abstainVotes}
- Quorum: ${p.quorumVotes}
- Voting: ${voting.timeLeftFormatted}
- ${descText.slice(0, 300)}${descText.length > 300 ? '...' : ''}`,
      };
    } catch (err) {
      return {
        handled: true,
        response: `Lookup failed: ${err instanceof Error ? err.message : 'unknown'}`,
      };
    }
  }

  // ─── Active Proposals ─────────────────────────────────────
  if (m.match(/^(?:active|list|show|what)\s*proposals?$/)) {
    try {
      const currentBlock = await getCurrentBlock();
      const allProps = await db
        .select()
        .from(schema.proposal)
        .orderBy(desc(schema.proposal.createdAtBlock))
        .limit(20);
      const active = allProps.filter(p => {
        if (p.status === 'CANCELLED' || p.status === 'VETOED' || p.status === 'EXECUTED')
          return false;
        if (p.endBlock && currentBlock > BigInt(p.endBlock)) return false;
        return true;
      });
      if (active.length === 0) return { handled: true, response: 'No active proposals right now.' };
      const lines = active.map(p => {
        const descText = (p.description ?? '').toString();
        const title =
          descText
            .split('\n')[0]
            ?.replace(/^#+\s*/, '')
            .trim() || 'Untitled';
        const voting = formatBlocksRemaining(currentBlock, p.endBlock);
        return `#${p.id}: "${title}" [${p.status}] — ${voting.timeLeftFormatted}`;
      });
      return { handled: true, response: `Active proposals:\n${lines.join('\n')}` };
    } catch (err) {
      return {
        handled: true,
        response: `Lookup failed: ${err instanceof Error ? err.message : 'unknown'}`,
      };
    }
  }

  // ─── Execute Proposal ─────────────────────────────────────
  const execPropMatch = m.match(/^execute\s+(?:prop(?:osal)?\s*)?#?(\d+)$/);
  if (execPropMatch) {
    if (!wallet) return { handled: true, response: 'Connect your wallet to execute.' };
    const proposalId = parseInt(execPropMatch[1]);
    const action = { type: 'EXECUTE_PROPOSAL', proposalId };
    return {
      handled: true,
      response: `Execute prepared for Prop #${proposalId}. Confirm in your wallet.`,
      action,
    };
  }

  // ─── Bid ──────────────────────────────────────────────────
  // Accepts: "bid 0.5 eth", "bid 0.5", "bid 0.5 eth on noun 123", "bid 0.5 on noun 123"
  const bidMatch = m.match(/^bid\s+([\d.]+)\s*(?:eth)?\s*(?:on\s+(?:noun\s+)?(\d+))?$/);
  if (bidMatch) {
    if (!wallet) return { handled: true, response: 'Connect your wallet to bid.' };
    const bidAmount = bidMatch[1];
    const state = getWatcherState();
    const currentNounId = state.nextNounId ? state.nextNounId - 1 : undefined;
    if (!currentNounId)
      return { handled: true, response: 'Could not determine current auction noun ID.' };
    const specifiedNounId = bidMatch[2] ? parseInt(bidMatch[2]) : undefined;
    if (specifiedNounId && specifiedNounId !== currentNounId) {
      return {
        handled: true,
        response: `Noun ${specifiedNounId} is not the current auction. The active auction is Noun ${currentNounId}.`,
      };
    }
    const nounId = currentNounId;
    const action = { type: 'BID', nounId, bidAmountEth: bidAmount };
    return {
      handled: true,
      response: `Bid prepared: ${bidAmount} ETH on Noun ${nounId}. Confirm in your wallet. Client ID 37 included.`,
      action,
    };
  }

  // ─── Create Candidate / Proposal ─────────────────────────
  // "create candidate: title - description", "propose: title - description", "create proposal: title - description"
  const candidateMatch = raw.match(
    /^(?:create\s+(?:candidate|proposal)|propose):\s*(.+?)\s*-\s*(.+)$/i,
  );
  if (candidateMatch) {
    if (!wallet) return { handled: true, response: 'Connect your wallet to create a candidate.' };
    const title = candidateMatch[1].trim();
    const description = candidateMatch[2].trim();
    const action = { type: 'CANDIDATE', title, description };
    return {
      handled: true,
      response: `Candidate prepared: "${title}". In Nouns DAO, proposals start as candidates that collect sponsor signatures. Confirm in your wallet.`,
      action,
    };
  }

  // ─── Sponsor Candidate ────────────────────────────────────
  const sponsorMatch = m.match(/^sponsor\s+(?:candidate\s+)?(.+)$/);
  if (sponsorMatch) {
    if (!wallet) return { handled: true, response: 'Connect your wallet to sponsor.' };
    const keyword = sponsorMatch[1].trim();
    try {
      const matches = await findCandidates(keyword, { limit: 1 });
      if (matches.length === 0)
        return { handled: true, response: `No candidate found matching "${keyword}".` };
      const c = matches[0];
      const title = candidateTitle(c);
      const descText = (c.description ?? '').toString();
      // encodedProp must match the candidate's on-chain hash; frontend uses it
      // to reconstruct targets/values/sigs/calldatas/description for EIP-712.
      const action = {
        type: 'SPONSOR',
        proposer: c.proposer,
        slug: c.slug,
        title,
        encodedProp: c.targets
          ? JSON.stringify({
              targets: JSON.parse((c.targets as string) || '[]'),
              values: JSON.parse((c.values as string) || '[]'),
              signatures: JSON.parse((c.signatures as string) || '[]'),
              calldatas: JSON.parse((c.calldatas as string) || '[]'),
              description: descText,
            })
          : '{}',
      };
      return {
        handled: true,
        response: `Sponsor prepared for "${title}" by ${c.proposer?.slice(0, 8)}... Confirm in your wallet.`,
        action,
      };
    } catch (err) {
      return {
        handled: true,
        response: `Sponsor failed: ${err instanceof Error ? err.message : 'unknown'}`,
      };
    }
  }

  // ─── Promote Candidate ────────────────────────────────────
  const promoteMatch = m.match(/^promote\s+(?:candidate\s+)?(.+)$/);
  if (promoteMatch) {
    if (!wallet) return { handled: true, response: 'Connect your wallet to promote.' };
    const keyword = promoteMatch[1].trim();
    try {
      const matches = await findCandidates(keyword, { limit: 1 });
      if (matches.length === 0)
        return { handled: true, response: `No candidate found matching "${keyword}".` };
      const c = matches[0];
      const title = candidateTitle(c);
      const descText = (c.description ?? '').toString();

      // Fetch valid sponsor signatures.
      // candidateSignature.candidateId is the candidate's primary key
      // (`${proposer}-${slug}`) — there's no `candidateSlug` column. The old
      // code referenced a non-existent property which Drizzle stringified
      // into broken SQL ("syntax error at or near '='" from postgres).
      const sigs = await db
        .select()
        .from(schema.candidateSignature)
        .where(eq(schema.candidateSignature.candidateId, c.id as string))
        .limit(100);
      const nowSec = Math.floor(Date.now() / 1000);
      const validSigs = sigs.filter(s => !s.canceled && Number(s.expirationTimestamp) > nowSec);

      const action = {
        type: 'PROMOTE',
        proposer: c.proposer as string,
        slug: c.slug,
        title,
        targets: JSON.parse((c.targets as string) || '[]'),
        values: JSON.parse((c.values as string) || '[]'),
        signatures: JSON.parse((c.signatures as string) || '[]'),
        calldatas: JSON.parse((c.calldatas as string) || '[]'),
        description: descText,
        sponsorSignatures: validSigs.map(s => ({
          sig: s.sig,
          signer: s.signer,
          expirationTimestamp: s.expirationTimestamp?.toString(),
        })),
      };
      return {
        handled: true,
        response: `Promote prepared for "${title}" with ${validSigs.length} valid sponsor signature${validSigs.length !== 1 ? 's' : ''}. This will create a real proposal with Client ID 37. Confirm in your wallet.`,
        action,
      };
    } catch (err) {
      return {
        handled: true,
        response: `Promote failed: ${err instanceof Error ? err.message : 'unknown'}`,
      };
    }
  }

  // ─── Feedback on Candidate ────────────────────────────────
  const feedbackCandMatch = m.match(/^feedback\s+(for|against)\s+candidate\s+(.+)$/);
  if (feedbackCandMatch) {
    if (!wallet) return { handled: true, response: 'Connect your wallet to give feedback.' };
    const support = feedbackCandMatch[1] === 'for' ? 1 : 0;
    const keyword = feedbackCandMatch[2].trim();
    try {
      const matches = await findCandidates(keyword, { limit: 1 });
      if (matches.length === 0)
        return { handled: true, response: `No candidate found matching "${keyword}".` };
      const c = matches[0];
      const title = candidateTitle(c);
      const action = { type: 'CANDIDATE_FEEDBACK', proposer: c.proposer, slug: c.slug, support };
      return {
        handled: true,
        response: `Feedback prepared: ${support ? 'FOR' : 'AGAINST'} on candidate "${title}". Confirm in your wallet.`,
        action,
      };
    } catch (err) {
      return {
        handled: true,
        response: `Feedback failed: ${err instanceof Error ? err.message : 'unknown'}`,
      };
    }
  }

  // ─── Show Candidate ───────────────────────────────────────
  const showCandMatch = m.match(/^(?:show|lookup|info)\s+candidate\s+(.+)$/);
  if (showCandMatch) {
    const keyword = showCandMatch[1].trim();
    try {
      const matches = await findCandidates(keyword, { limit: 1, includeCanceled: true });
      if (matches.length === 0)
        return { handled: true, response: `No candidate found matching "${keyword}".` };
      const c = matches[0];
      const title = candidateTitle(c);
      const descText = (c.description ?? '').toString();
      return {
        handled: true,
        response: `Candidate: "${title}"
- Proposer: ${c.proposer}
- Slug: ${c.slug}
- Canceled: ${c.canceled ? 'yes' : 'no'}
- ${descText.slice(0, 300)}${descText.length > 300 ? '...' : ''}`,
      };
    } catch (err) {
      return {
        handled: true,
        response: `Lookup failed: ${err instanceof Error ? err.message : 'unknown'}`,
      };
    }
  }

  // ─── Vote on Grant ────────────────────────────────────────
  const grantVoteMatch = m.match(/^vote\s+(for|against)\s+grant\s*#?(\d+)(?:\s+(.+))?$/);
  if (grantVoteMatch) {
    if (!wallet) return { handled: true, response: 'Connect your wallet to vote on grants.' };
    const support = grantVoteMatch[1] === 'for' ? 1 : 0;
    const grantId = parseInt(grantVoteMatch[2]);
    const reason = grantVoteMatch[3]?.trim();
    const action = { type: 'GRANT_VOTE', grantId, support, reason };
    return {
      handled: true,
      response: `Grant vote prepared: ${support ? 'FOR' : 'AGAINST'} on Grant #${grantId}. Confirm in your wallet.`,
      action,
    };
  }

  // ─── Show Grant ───────────────────────────────────────────
  const showGrantMatch = m.match(/^(?:show|lookup|info)\s+grant\s*#?(\d+)$/);
  if (showGrantMatch) {
    const grantId = parseInt(showGrantMatch[1]);
    try {
      const rows = await db
        .select()
        .from(schema.grant)
        .where(eq(schema.grant.id, String(grantId)))
        .limit(1);
      if (rows.length === 0) return { handled: true, response: `Grant #${grantId} not found.` };
      const g = rows[0];
      const descText = (g.description ?? '').toString();
      const title =
        descText
          .split('\n')[0]
          ?.replace(/^#+\s*/, '')
          .trim() || 'Untitled';
      return {
        handled: true,
        response: `Grant #${grantId}: "${title}"
- Status: ${g.status}
- Proposer: ${g.proposer}
- For: ${g.forVotes} / Against: ${g.againstVotes}
- ${descText.slice(0, 300)}${descText.length > 300 ? '...' : ''}`,
      };
    } catch (err) {
      return {
        handled: true,
        response: `Lookup failed: ${err instanceof Error ? err.message : 'unknown'}`,
      };
    }
  }

  // ─── Active Grants ────────────────────────────────────────
  if (m.match(/^(?:active|list|show|what)\s*grants?$/)) {
    try {
      const allGrants = await db
        .select()
        .from(schema.grant)
        .orderBy(desc(schema.grant.createdAtBlock))
        .limit(20);
      const active = allGrants.filter(g => g.status === 'ACTIVE' || g.status === 'QUEUED');
      if (active.length === 0) return { handled: true, response: 'No active grants right now.' };
      const lines = active.map(g => {
        const descText = (g.description ?? '').toString();
        const title =
          descText
            .split('\n')[0]
            ?.replace(/^#+\s*/, '')
            .trim() || 'Untitled';
        return `#${g.id}: "${title}" [${g.status}]`;
      });
      return { handled: true, response: `Active grants:\n${lines.join('\n')}` };
    } catch (err) {
      return {
        handled: true,
        response: `Lookup failed: ${err instanceof Error ? err.message : 'unknown'}`,
      };
    }
  }

  // ─── Create Grant ─────────────────────────────────────────
  const grantMatch = raw.match(/^create\s+grant:\s*(.+?)\s*-\s*(.+)$/i);
  if (grantMatch) {
    if (!wallet) return { handled: true, response: 'Connect your wallet to create a grant.' };
    const title = grantMatch[1].trim();
    const description = grantMatch[2].trim();
    const action = { type: 'GRANT_PROPOSAL', title, description };
    return {
      handled: true,
      response: `Grant prepared: "${title}". Confirm in your wallet.`,
      action,
    };
  }

  // ─── Execute Grant ────────────────────────────────────────
  const execGrantMatch = m.match(/^execute\s+grant\s*#?(\d+)$/);
  if (execGrantMatch) {
    if (!wallet) return { handled: true, response: 'Connect your wallet to execute.' };
    const grantId = parseInt(execGrantMatch[1]);
    const action = { type: 'EXECUTE_GRANT', grantId };
    return {
      handled: true,
      response: `Execute prepared for Grant #${grantId}. Confirm in your wallet.`,
      action,
    };
  }

  // ─── "function" skill — loose NL → canonical command ──────
  // Runs after the strict regexes miss. Translates natural phrasings like
  // "bid 0.01eth on noun 1901", "i want to vote yes on prop 567",
  // "sponsor the public-goods candidate" into canonical commands that the
  // strict regex paths above already handle. Re-invokes parseCommand on the
  // normalised form so there is one source of truth for action preparation.
  if (!opts.skipFunctionSkill) {
    const detected = detectFunction(raw);
    if (detected && detected.canonical !== m && detected.canonical !== raw) {
      const recursed = await parseCommand(detected.canonical, wallet, {
        skipFunctionSkill: true,
      });
      if (recursed.handled) {
        return recursed;
      }
    }
  }

  // ─── Not matched ──────────────────────────────────────────
  return { handled: false };
}

// ============================================================
// Chat endpoint
// ============================================================

app.post('/api/chat', async c => {
  let agentMode: string | undefined;
  try {
    const body = await c.req.json();
    const { message, wallet, history, agent_mode, view_context } = body as {
      message: string;
      wallet?: string;
      history?: Array<{ role: string; content: string }>;
      agent_mode?: string;
      view_context?: { dao?: string; nounId?: number | string | null };
    };
    agentMode = agent_mode;

    if (!message || typeof message !== 'string') {
      return c.json({ error: 'Message is required' }, 400);
    }

    if (message.length > 2000) {
      return c.json({ error: 'Message too long (max 2000 chars)' }, 400);
    }

    // Require wallet connection — no anonymous chat (prevents spam, enables per-wallet rate limiting)
    if (!wallet || typeof wallet !== 'string' || !/^0x[\dA-Fa-f]{40}$/.test(wallet)) {
      return c.json({ error: 'Connect your wallet to use chat. ⌐◨-◨', requiresWallet: true }, 401);
    }

    // ─── Try free command parser first (no API call) ─────────
    const parsed = await parseCommand(message, wallet);
    if (parsed.handled) {
      const payload: { response: string; action?: Record<string, unknown> } = {
        response: parsed.response!,
      };
      if (parsed.action) payload.action = parsed.action;
      return c.json(payload);
    }

    // ─── Graceful fallback when agent-hub unavailable ──────────
    if (!AGENT_HUB_URL) {
      return c.json({
        response:
          "I'm in command mode right now. Try 'vote for prop 567', 'bid 0.5 eth', 'active proposals', or type 'help' for the full list of commands. Freeform chat is temporarily offline. ⌐◨-◨",
      });
    }

    // Rate limit by wallet or IP
    const rateLimitKey = wallet || c.req.header('x-forwarded-for') || 'anonymous';
    const rateCheck = checkRateLimit(rateLimitKey);
    if (!rateCheck.ok) {
      if (rateCheck.daily) {
        return c.json(
          {
            error:
              "you've hit the daily limit. talk to pipe — they're better at this anyway. find them on farcaster @pipe or warpcast.com/pipe",
            rateLimited: true,
            daily: true,
          },
          429,
        );
      }
      return c.json(
        {
          error:
            'slow down — max 10 messages per minute. take a breath, the chain will still be there.',
          rateLimited: true,
        },
        429,
      );
    }

    // Choose system prompt based on agent mode
    const isNounIrl = agent_mode === 'nounirl';
    const staticPrompt = isNounIrl ? NOUNIRL_SYSTEM_PROMPT : NOUNS_SYSTEM_PROMPT;

    // Build dynamic context (changes per request — not cached)
    let dynamicContext = '';

    // Inject current view context (which DAO + noun the user is looking at).
    // This is the FIRST thing we inject so the model anchors to it before
    // reading any of the live governance / auction data below.
    if (view_context && typeof view_context === 'object') {
      const rawDao = typeof view_context.dao === 'string' ? view_context.dao.toLowerCase() : '';
      // Normalize lil-nouns aliases that the client may send.
      const dao: 'nouns' | 'nounv2' | 'lil-nouns' | null =
        rawDao === 'nounv2'
          ? 'nounv2'
          : rawDao === 'nouns'
            ? 'nouns'
            : rawDao === 'lil-nouns' || rawDao === 'lilnouns' || rawDao === 'lil'
              ? 'lil-nouns'
              : null;
      const rawNounId = view_context.nounId;
      const nounId =
        typeof rawNounId === 'number' && Number.isFinite(rawNounId)
          ? rawNounId
          : typeof rawNounId === 'string' && /^\d+$/.test(rawNounId)
            ? Number.parseInt(rawNounId, 10)
            : null;

      if (dao !== null || nounId !== null) {
        const daoLabel =
          dao === 'nouns'
            ? 'mainnet Nouns DAO (token IDs are mainnet Noun IDs)'
            : dao === 'nounv2'
              ? 'NounV2 fork DAO (token IDs are v2 IDs starting at 0 — NOT mainnet Nouns)'
              : dao === 'lil-nouns'
                ? "Lil Nouns DAO (separate governor; pass dao='lil-nouns' to prepare_vote for proposals here)"
                : 'unknown';
        dynamicContext += '\n\n## Current View';
        dynamicContext += `\n- dao: ${dao ?? 'unknown'} (${daoLabel})`;
        if (nounId !== null) {
          const nounLabel =
            dao === 'nounv2'
              ? `NounV2 #${nounId}`
              : dao === 'lil-nouns'
                ? `Lil Noun #${nounId}`
                : `Noun #${nounId}`;
          dynamicContext += `\n- viewing: ${nounLabel}`;
        }
        dynamicContext +=
          '\n- When the user says "this noun" or asks an unqualified question, assume they mean the noun above. If they ask about a different noun, confirm which DAO they mean.';
        if (dao === 'lil-nouns') {
          dynamicContext +=
            '\n- VOTING: when the user asks to vote here, default `dao` to "lil-nouns" in prepare_vote. Do not ask them which DAO unless they explicitly mention mainnet.';
        }
      }
    }

    // Inject persistent memory context (cross-session)
    const memoryContext = await buildMemoryContext(wallet || undefined);
    if (memoryContext) {
      dynamicContext += memoryContext;
    }

    // Inject governance context (proposals, votes, nouns, delegate power)
    if (wallet) {
      try {
        const govContext = await buildGovernanceContext(wallet);
        if (govContext) dynamicContext += govContext;
      } catch (err) {
        console.error('[Chat] Governance context error:', err);
      }
    }

    // Inject live auction data (current noun, bids, time remaining)
    try {
      const auctionContext = await buildLiveAuctionContext();
      if (auctionContext) dynamicContext += auctionContext;
    } catch (err) {
      console.error('[Chat] Auction context error:', err);
    }

    // Inject people directory context (top participants)
    try {
      const peopleContext = await buildPeopleContext(30);
      if (peopleContext) dynamicContext += peopleContext;
    } catch (err) {
      console.error('[Chat] People context error:', err);
    }

    // Inject global governance overview (all proposals + grants with derived statuses)
    try {
      const govOverview = await buildProposalsAndGrantsContext();
      if (govOverview) dynamicContext += govOverview;
    } catch (err) {
      console.error('[Chat] Governance overview error:', err);
    }

    // Inject live agent context for NounIRL mode
    if (isNounIrl) {
      const watcherState = getWatcherState();
      const stats = reservationStore.stats();
      const walletReservations = wallet ? reservationStore.getByWallet(wallet) : [];

      dynamicContext += `\n\nLIVE AGENT STATE:
- Running: ${watcherState.running}
- Transport: ${watcherState.transportMode} ${watcherState.transportMode === 'websocket' ? '(instant block headers via WSS)' : '(HTTP polling fallback)'}
- Last block: ${watcherState.lastBlockNumber}
- Next noun ID: ${watcherState.nextNounId}
- Auction ends: ${watcherState.auctionEndTime ? new Date(watcherState.auctionEndTime * 1000).toISOString() : 'unknown'}
- Predicted traits: ${watcherState.lastPredictedTraits ? JSON.stringify(watcherState.lastPredictedTraits) : 'computing...'}
- Active reservations: ${stats.active}
- Total settlements: ${stats.totalSettlements}
- Caller wallet: ${wallet || 'not connected'}
- Caller's reservations: ${walletReservations.length > 0 ? JSON.stringify(walletReservations.map(r => ({ id: r.id.slice(0, 8), traits: r.traits, status: r.status }))) : 'none'}

TOOLS — YOU HAVE REAL ONCHAIN CAPABILITIES:
You have the following tools. USE THEM. Don't just describe what you would do — actually call the tool.

1. verify_tip(txHash, chainId) — Verify an ETH tip to nounirl.eth. Returns { valid, amountEth, from, chainName }.
2. create_reservation(wallet, txHash, chainId, traits[]) — Create a trait reservation backed by a verified tip. The block watcher auto-settles when traits match.
3. get_reservations(wallet?) — List reservations, optionally filtered by wallet.
4. cancel_reservation(reservationId) — Cancel a reservation.
5. check_block() — Force a block check. Returns predicted traits, block number, next noun ID, auction status, matching reservations.
6. list_traits(category) — List all valid trait names for background/body/accessory/head/glasses.
7. parse_traits(description) — Parse natural language into structured "category:value" traits.
8. get_settlements(limit?) — History of successful settlements.
9. get_agent_balance() — ETH balance of nounirl.eth.
10. deploy_code(description, reason) — Ship a code change to the non-production "dev-noun" branch (Netlify branch-deploys it to a fixed preview URL). NOUN-GATED: caller must hold ≥ 4 Nouns. Rate limited: 1/hour. Only packages/nouns-webapp/src/. CANNOT delete files (rejected by safety filter). After a successful deploy the result includes a previewUrl — quote it back to the user and tell them to DM @pip on Warpcast for review before any push to main/prod. Production isolation is structural — you have no path to write to main. If user doesn't hold enough Nouns, tell them politely — this is governance-weighted access control.
11. remember_fact(key, content, scope) — Store a fact in persistent memory. scope="wallet" for user-specific, scope="global" for shared knowledge. USE THIS PROACTIVELY. When a user tells you their name, ENS, preferences, anything personal — remember it. When you learn something important — remember it globally.
12. recall_facts(scope, key?) — Look up remembered facts. You don't usually need to call this explicitly because your memory is auto-injected into context. But use it to check what you know.
13. learn_url(url) — Fetch a web page, extract key facts, and store them in your knowledge base. Use when someone shares a URL and wants you to learn from it. The knowledge persists and is available to both you and the homepage chat.
14. self_learn() — Trigger the self-learning pipeline. Reads ALL proposals, auctions, and delegate data from noun.wtf's own Ponder index and distills key facts into your knowledge base. Use when someone asks you to learn about Nouns governance, refresh your knowledge, or "eat your own dog food." Takes a few minutes to process all ~950 proposals.

MEMORY — YOU HAVE PERSISTENT MEMORY:
You remember things across sessions. Your memory is stored in Postgres. When you learn a user's name, ENS, favorite trait, or anything meaningful, call remember_fact to persist it. Next time they talk to you, their memories are auto-loaded into your context. This is how you build relationships.

RESERVATION FLOW:
When a user wants to reserve traits:
1. Help them specify traits using parse_traits or list_traits
2. Tell them to send ≥ 0.002 ETH (~$5) to nounirl.eth on any chain (Ethereum/Base/OP/Arb/Zora)
3. When they provide the tx hash: call verify_tip to confirm, then create_reservation
4. The block watcher handles the rest — it monitors every block and auto-settles when traits match

When a user asks "status": call check_block for live data. Don't rely on the injected state alone — it may be stale.
When a user asks about their reservations: call get_reservations with their wallet.

GOVERNANCE — the terminal handles votes, bids, sponsors, candidates, and grants via typed commands (e.g. "vote for 567", "bid 0.5 eth"). These are parsed automatically — you don't need tools for them. If someone asks about governance, explain that they can type commands directly. noun.wtf client ID is 37 (auto-included in votes, bids, promotes). Proposals start as candidates → collect sponsor signatures → get promoted.

LIL NOUNS VOTING — prepare_vote works for BOTH mainnet Nouns DAO and Lil Nouns DAO. When the user wants to vote on a Lil Nouns prop (mentions "lil"/"lilnoun(s)", or the Current View shows dao=lil-nouns, or the proposal exists in Lil Nouns DAO context fetched from /api/lil-proposals), set dao: 'lil-nouns' on the prepare_vote call. For mainnet Nouns leave it unset or pass dao: 'nouns'. If the user says "prop N" without specifying a DAO and the Current View doesn't disambiguate, ask one short clarifying question ("Lil Nouns or mainnet?") rather than guessing. Do NOT tell users to go to lilnouns.wtf to vote — they can vote from this terminal.
${buildFunctionSkillPromptSnippet()}
CRITICAL RULES:
- NEVER fabricate data. If you don't know, say so or use a tool to look it up.
- NEVER write function calls as text. Use the structured tool-calling mechanism. Text like "<function=...>" does NOTHING.
- Be honest about capabilities. You're an LLM with tool-calling, persistent memory, and access to noun.wtf's Ponder index.`;
    }

    // Build messages array from history
    const messages: HubChatRequest['messages'] = [];
    if (history && Array.isArray(history)) {
      for (const msg of history.slice(-10)) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
    }
    messages.push({ role: 'user', content: message });

    // NounIRL gets the full toolkit — every capability it needs to operate autonomously
    const nounIrlTools: HubChatRequest['tools'] = [
      {
        type: 'function' as const,
        function: {
          name: 'verify_tip',
          description:
            'Verify an ETH tip transaction sent to nounirl.eth. Checks the transaction receipt on any supported chain (Ethereum, Base, Optimism, Arbitrum, Zora) and confirms the recipient is nounirl.eth and amount is ≥ 0.002 ETH (~$5).',
          parameters: {
            type: 'object' as const,
            properties: {
              txHash: {
                type: 'string',
                description: 'The transaction hash to verify (0x-prefixed).',
              },
              chainId: {
                type: 'number',
                description:
                  'The chain ID where the transaction was sent. 1=Ethereum, 8453=Base, 10=Optimism, 42161=Arbitrum, 7777777=Zora.',
              },
            },
            required: ['txHash', 'chainId'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'create_reservation',
          description:
            'Create a trait reservation for a user. Requires a verified tip transaction. The reservation starts as pending_verification, then auto-activates once the tip is confirmed. The block watcher will then monitor for matching traits and auto-settle when found.',
          parameters: {
            type: 'object' as const,
            properties: {
              wallet: {
                type: 'string',
                description: "The user's wallet address (checksummed).",
              },
              txHash: {
                type: 'string',
                description: 'The tip transaction hash (must be verified).',
              },
              chainId: {
                type: 'number',
                description: 'Chain ID of the tip transaction.',
              },
              traits: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'Array of desired traits in "category:value" format, e.g. ["head:shark", "glasses:blue"]. All must match (AND logic).',
              },
            },
            required: ['wallet', 'txHash', 'chainId', 'traits'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'get_reservations',
          description: 'List trait reservations. Optionally filter by wallet address.',
          parameters: {
            type: 'object' as const,
            properties: {
              wallet: {
                type: 'string',
                description: 'Optional wallet address to filter by.',
              },
            },
            required: [],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'cancel_reservation',
          description: 'Cancel an active or pending trait reservation.',
          parameters: {
            type: 'object' as const,
            properties: {
              reservationId: {
                type: 'string',
                description: 'The reservation ID to cancel.',
              },
            },
            required: ['reservationId'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'check_block',
          description:
            'Force an immediate block check. Returns the current block number, next noun ID, predicted traits, whether the auction has ended, and any matching reservations. Use this to give users real-time prediction data.',
          parameters: {
            type: 'object' as const,
            properties: {},
            required: [],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'list_traits',
          description:
            'List all valid trait names for a given category. Useful for helping users identify exact trait names.',
          parameters: {
            type: 'object' as const,
            properties: {
              category: {
                type: 'string',
                enum: ['background', 'body', 'accessory', 'head', 'glasses'],
                description: 'The trait category to list.',
              },
            },
            required: ['category'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'parse_traits',
          description:
            'Parse a natural language trait description into structured "category:value" format. e.g. "shark head and blue noggles" → ["head:shark", "glasses:blue"].',
          parameters: {
            type: 'object' as const,
            properties: {
              description: {
                type: 'string',
                description: 'Natural language description of desired traits.',
              },
            },
            required: ['description'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'get_settlements',
          description: 'Get the history of successful auction settlements by the agent.',
          parameters: {
            type: 'object' as const,
            properties: {
              limit: {
                type: 'number',
                description: 'Max number of settlements to return (default 20).',
              },
            },
            required: [],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'get_agent_balance',
          description: 'Get the ETH balance of the nounirl.eth wallet on Ethereum mainnet.',
          parameters: {
            type: 'object' as const,
            properties: {},
            required: [],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'deploy_code',
          description:
            'Generate a code patch via Claude, append it as a commit on the non-production `dev-noun` branch, and trigger a Netlify branch-deploy to a fixed preview URL. Only files under packages/nouns-webapp/src/ can be modified — never deleted. Rate limited to 1 deploy per hour. Production (`main`/noun.wtf) is unreachable from this tool. Result includes `previewUrl`; quote it to the user and tell them to DM @pip on Warpcast to review and ship to prod.',
          parameters: {
            type: 'object' as const,
            properties: {
              description: {
                type: 'string',
                description:
                  'A detailed description of the code change to make. Be specific about what file to modify, what to change, and why.',
              },
              reason: {
                type: 'string',
                description:
                  'Short reason for the deploy (e.g. "fix polling interval", "improve UI").',
              },
            },
            required: ['description', 'reason'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'remember_fact',
          description:
            'Store a fact in persistent memory that survives across sessions. Use this to remember user names, preferences, important details about users or conversations. Memory persists across page reloads and new conversations.',
          parameters: {
            type: 'object' as const,
            properties: {
              key: {
                type: 'string',
                description:
                  'Short key for the memory (e.g. "name", "preference", "ens", "fav-trait"). Lowercase, no spaces.',
              },
              content: {
                type: 'string',
                description: 'The fact to remember.',
              },
              scope: {
                type: 'string',
                enum: ['wallet', 'global'],
                description:
                  'Scope: "wallet" stores it for the current user only, "global" stores it for everyone to see.',
              },
            },
            required: ['key', 'content', 'scope'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'recall_facts',
          description:
            'Recall stored memories. Use this to look up previously remembered facts about a user or global knowledge.',
          parameters: {
            type: 'object' as const,
            properties: {
              scope: {
                type: 'string',
                enum: ['wallet', 'global', 'all'],
                description:
                  'Scope: "wallet" for current user, "global" for shared knowledge, "all" for everything.',
              },
              key: {
                type: 'string',
                description: 'Optional specific key to recall.',
              },
            },
            required: ['scope'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'learn_url',
          description:
            'Learn facts from a web page. Fetches the URL, extracts text, uses AI to distill key facts, and stores them in persistent knowledge. Use this when someone shares a URL and says "learn this" or "read this" or when you want to expand your knowledge base.',
          parameters: {
            type: 'object' as const,
            properties: {
              url: {
                type: 'string',
                description: 'The URL to learn from (must be a valid http/https URL).',
              },
            },
            required: ['url'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'self_learn',
          description:
            'Trigger self-learning pipeline. Reads ALL proposals, auctions, and delegate data from noun.wtf\'s own Ponder-indexed GraphQL and distills hundreds of facts into your knowledge base. Takes a few minutes. Use when asked to "learn everything", "refresh knowledge", or when you want comprehensive governance data.',
          parameters: {
            type: 'object' as const,
            properties: {},
            required: [],
          },
        },
      },
      // ── Governance + Trading tools mostly removed from LLM prompt (~5,000 tokens saved) ──
      // parseCommand() handles most governance actions (bid, sponsor, etc.) via
      // pattern matching BEFORE the LLM is called. Tool handlers in the switch/case
      // below are kept intact so they still execute if somehow invoked.
      //
      // KEPT: prepare_vote (needed for natural-language Lil Nouns voting — parseCommand
      // handles "vote for lil prop 375" but the LLM handles free-form requests like
      // "can you vote on lil nouns proposal 375 for me?").
      //
      // Removed: lookup_proposal, lookup_candidate, prepare_proposal_feedback,
      // prepare_candidate_feedback, prepare_candidate, prepare_update_candidate,
      // prepare_update_proposal, prepare_sponsor, prepare_bid, prepare_promote,
      // lookup_grant, prepare_grant_vote, prepare_grant_proposal, prepare_queue_proposal,
      // prepare_queue_grant, prepare_execute_proposal, prepare_execute_grant,
      // get_trading_positions, get_trading_performance, get_trading_signals
      {
        type: 'function' as const,
        function: {
          name: 'prepare_vote',
          description:
            'Prepare a vote action for the user to sign. Works for BOTH mainnet Nouns DAO and Lil Nouns DAO. Set dao to "lil-nouns" for Lil Nouns votes.',
          parameters: {
            type: 'object' as const,
            properties: {
              proposalId: {
                type: 'number',
                description: 'The proposal ID to vote on.',
              },
              support: {
                type: 'number',
                enum: [0, 1, 2],
                description: 'Vote direction: 0=AGAINST, 1=FOR, 2=ABSTAIN.',
              },
              reason: {
                type: 'string',
                description: 'Optional reason for the vote.',
              },
              dao: {
                type: 'string',
                enum: ['nouns', 'lil-nouns'],
                description:
                  'Which DAO to vote on. "lil-nouns" for Lil Nouns DAO. Defaults to "nouns" (mainnet).',
              },
            },
            required: ['proposalId', 'support'],
          },
        },
      },
    ];

    // Preserve original tool definitions in dead code so handlers aren't orphaned.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _removedGovernanceTools = false && [
      {
        type: 'function' as const,
        function: {
          name: 'lookup_proposal',
          description:
            'Look up a proposal by ID or search by keyword. Returns proposal details including title, status, proposer, vote counts, and pre-calculated time remaining (votingTimeLeft, votingBlocksLeft, updatePeriodTimeLeft, objectionPeriodTimeLeft). Use this data to directly answer timing questions. Use this FIRST when the user mentions a proposal by number or topic.',
          parameters: {
            type: 'object' as const,
            properties: {
              proposalId: {
                type: 'number',
                description: 'The proposal ID to look up (e.g. 567).',
              },
              keyword: {
                type: 'string',
                description:
                  'Search keyword to find proposals by title/description. Only used if proposalId is not provided.',
              },
            },
            required: [],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'lookup_candidate',
          description:
            'Look up a candidate proposal by slug or search by keyword. Returns candidate details including slug, proposer, description, sponsor count. Use this when the user mentions a candidate.',
          parameters: {
            type: 'object' as const,
            properties: {
              slug: {
                type: 'string',
                description: 'The candidate slug to look up.',
              },
              keyword: {
                type: 'string',
                description:
                  'Search keyword to find candidates by description. Only used if slug is not provided.',
              },
            },
            required: [],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'prepare_vote',
          description:
            "Prepare a vote action for the user to sign. Returns a GovernanceAction that the frontend will present for confirmation and wallet signing. Works for BOTH mainnet Nouns DAO (default) and Lil Nouns DAO — pick the right `dao` value based on the user's intent. For mainnet Nouns ALWAYS use lookup_proposal first to confirm the proposal exists and is voteable. For Lil Nouns the on-chain governor will reject invalid IDs/states, so confirmation is best-effort via the injected Lil Nouns context (or just ask the user to clarify if uncertain).",
          parameters: {
            type: 'object' as const,
            properties: {
              proposalId: {
                type: 'number',
                description: 'The proposal ID to vote on.',
              },
              support: {
                type: 'number',
                enum: [0, 1, 2],
                description: 'Vote direction: 0=AGAINST, 1=FOR, 2=ABSTAIN.',
              },
              reason: {
                type: 'string',
                description: 'Optional reason for the vote.',
              },
              dao: {
                type: 'string',
                enum: ['nouns', 'lil-nouns'],
                description:
                  'Which DAO\'s governor to vote on. "nouns" = mainnet Nouns DAO (the default). "lil-nouns" = Lil Nouns DAO (governor 0x5d2C…4039). Use "lil-nouns" whenever the user mentions "lil", "lilnoun(s)", references a proposal that exists in Lil Nouns DAO, or when viewContext.dao is "lil-nouns". Otherwise leave it unset (defaults to "nouns").',
              },
            },
            required: ['proposalId', 'support'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'prepare_proposal_feedback',
          description:
            'Prepare proposal feedback (signal vote) for the user to sign. This is non-binding feedback on a proposal — like a straw poll. Returns a GovernanceAction.',
          parameters: {
            type: 'object' as const,
            properties: {
              proposalId: {
                type: 'number',
                description: 'The proposal ID to give feedback on.',
              },
              support: {
                type: 'number',
                enum: [0, 1, 2],
                description: 'Feedback direction: 0=AGAINST, 1=FOR, 2=ABSTAIN.',
              },
              reason: {
                type: 'string',
                description: 'Optional reason for the feedback.',
              },
            },
            required: ['proposalId', 'support'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'prepare_candidate_feedback',
          description:
            'Prepare candidate proposal feedback for the user to sign. Returns a GovernanceAction.',
          parameters: {
            type: 'object' as const,
            properties: {
              proposer: {
                type: 'string',
                description: 'The candidate proposer address (0x-prefixed).',
              },
              slug: {
                type: 'string',
                description: 'The candidate slug.',
              },
              support: {
                type: 'number',
                enum: [0, 1, 2],
                description: 'Feedback direction: 0=AGAINST, 1=FOR, 2=ABSTAIN.',
              },
              reason: {
                type: 'string',
                description: 'Optional reason for the feedback.',
              },
            },
            required: ['proposer', 'slug', 'support'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'prepare_candidate',
          description:
            'Prepare a new candidate proposal for the user to create. Returns a GovernanceAction. Can include executable transactions (ETH transfers, contract calls) or be description-only. When the user mentions sending ETH, transferring tokens, or executing any treasury action — include it in the transactions array.',
          parameters: {
            type: 'object' as const,
            properties: {
              title: {
                type: 'string',
                description: 'Short title for the candidate proposal.',
              },
              description: {
                type: 'string',
                description: 'Full description/body of the candidate proposal. Markdown supported.',
              },
              transactions: {
                type: 'array',
                description:
                  'Optional array of executable transactions. STRONGLY PREFER the typed primitives (kind:"usdc_transfer", "usdc_payer_debt", "eth_transfer", "weth_transfer", "steth_transfer") — these take human-readable amounts and the API encodes them correctly. Only fall back to raw {target,value,signature,calldata} for non-token contract calls (e.g. arbitrary onchain function invocations). NEVER hand-encode hex calldata for token transfers — the API will reject it if the amount is off.',
                items: {
                  type: 'object',
                  description:
                    'Either a typed primitive (preferred) or a raw transaction. Primitive shape: {kind,recipient,amount} for usdc_*, {kind,recipient,amountEth} for eth/weth/steth. Examples: {"kind":"usdc_transfer","recipient":"0x...","amount":"20000"} sends 20,000 USDC. {"kind":"usdc_payer_debt","recipient":"0x...","amount":"5000"} registers 5,000 USDC of debt via the Nouns Payer. {"kind":"eth_transfer","recipient":"0x...","amountEth":"0.5"} sends 0.5 ETH. Raw shape (last resort): {"target":"0x...","value":"0","signature":"someFunc(uint256)","calldata":"0x..."}.',
                  properties: {
                    kind: {
                      type: 'string',
                      enum: [
                        'usdc_transfer',
                        'usdc_payer_debt',
                        'eth_transfer',
                        'weth_transfer',
                        'steth_transfer',
                      ],
                      description:
                        'Primitive kind. Omit for raw {target,value,signature,calldata}.',
                    },
                    recipient: {
                      type: 'string',
                      description: 'Recipient address (0x-prefixed). Used by primitives.',
                    },
                    amount: {
                      type: 'string',
                      description:
                        'Human-readable USDC amount as a string (e.g. "20000" or "20000.5"). Used by usdc_* primitives.',
                    },
                    amountEth: {
                      type: 'string',
                      description:
                        'Human-readable ETH amount as a string (e.g. "0.5", "1"). Used by eth_/weth_/steth_ primitives.',
                    },
                    target: {
                      type: 'string',
                      description: 'Raw mode only: target contract/recipient address.',
                    },
                    value: {
                      type: 'string',
                      description: 'Raw mode only: ETH value in wei as a string.',
                    },
                    signature: {
                      type: 'string',
                      description: 'Raw mode only: function signature.',
                    },
                    calldata: {
                      type: 'string',
                      description: 'Raw mode only: ABI-encoded args as hex.',
                    },
                  },
                },
              },
            },
            required: ['title', 'description'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'prepare_update_candidate',
          description:
            'Prepare an update to an existing candidate proposal. This replaces the candidate content and transactions. IMPORTANT: updating a candidate resets all sponsor signatures — signers must re-sign the updated version. Only the original proposer can update their candidate.',
          parameters: {
            type: 'object' as const,
            properties: {
              slug: {
                type: 'string',
                description: 'The candidate slug to update.',
              },
              title: {
                type: 'string',
                description: 'Updated title for the candidate.',
              },
              description: {
                type: 'string',
                description: 'Updated description/body. Markdown supported.',
              },
              reason: {
                type: 'string',
                description: 'Reason for the update (shown to sponsors).',
              },
              transactions: {
                type: 'array',
                description:
                  'Updated transactions array. STRONGLY PREFER typed primitives (kind:"usdc_transfer"|"usdc_payer_debt"|"eth_transfer"|"weth_transfer"|"steth_transfer") with human amounts; fall back to raw {target,value,signature,calldata} only for non-token contract calls. Same item shape as prepare_candidate.',
                items: {
                  type: 'object',
                  properties: {
                    kind: {
                      type: 'string',
                      enum: [
                        'usdc_transfer',
                        'usdc_payer_debt',
                        'eth_transfer',
                        'weth_transfer',
                        'steth_transfer',
                      ],
                    },
                    recipient: { type: 'string' },
                    amount: { type: 'string' },
                    amountEth: { type: 'string' },
                    target: { type: 'string' },
                    value: { type: 'string' },
                    signature: { type: 'string' },
                    calldata: { type: 'string' },
                  },
                },
              },
            },
            required: ['slug', 'title', 'description'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'prepare_update_proposal',
          description:
            'Prepare an update to an existing onchain proposal during its updatable period. Proposals have an update window after creation where the proposer can modify the description and/or transactions. Only the original proposer can update. Use lookup_proposal first to check that the proposal is in the updatable period (updatePeriodEndBlock > current block).',
          parameters: {
            type: 'object' as const,
            properties: {
              proposalId: {
                type: 'number',
                description: 'The proposal ID to update.',
              },
              description: {
                type: 'string',
                description:
                  'Updated description (including title as "# Title"). If only updating transactions, pass the current description unchanged.',
              },
              updateMessage: {
                type: 'string',
                description: 'A short message explaining what changed in this update.',
              },
              transactions: {
                type: 'array',
                description:
                  'Updated transactions. STRONGLY PREFER typed primitives (kind:"usdc_transfer"|"usdc_payer_debt"|"eth_transfer"|"weth_transfer"|"steth_transfer") with human amounts; fall back to raw only for non-token contract calls. Same item shape as prepare_candidate.',
                items: {
                  type: 'object',
                  properties: {
                    kind: {
                      type: 'string',
                      enum: [
                        'usdc_transfer',
                        'usdc_payer_debt',
                        'eth_transfer',
                        'weth_transfer',
                        'steth_transfer',
                      ],
                    },
                    recipient: { type: 'string' },
                    amount: { type: 'string' },
                    amountEth: { type: 'string' },
                    target: { type: 'string' },
                    value: { type: 'string' },
                    signature: { type: 'string' },
                    calldata: { type: 'string' },
                  },
                },
              },
            },
            required: ['proposalId', 'updateMessage'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'prepare_sponsor',
          description:
            'Prepare to sponsor (sign) a candidate proposal. The user will sign an EIP-712 message and submit it onchain. Returns a GovernanceAction with the candidate details needed for signing.',
          parameters: {
            type: 'object' as const,
            properties: {
              proposer: {
                type: 'string',
                description: 'The candidate proposer address.',
              },
              slug: {
                type: 'string',
                description: 'The candidate slug.',
              },
              reason: {
                type: 'string',
                description: 'Optional reason for sponsoring.',
              },
            },
            required: ['proposer', 'slug'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'prepare_bid',
          description:
            'Prepare a bid on the current Nouns auction. Returns a GovernanceAction with the nounId and bid amount in ETH. The frontend handles the payable transaction with client ID 37.',
          parameters: {
            type: 'object' as const,
            properties: {
              nounId: {
                type: 'number',
                description: 'The noun ID to bid on (current auction noun).',
              },
              bidAmountEth: {
                type: 'string',
                description:
                  'The bid amount in ETH (e.g. "0.55"). Must be higher than current bid + minimum increment.',
              },
            },
            required: ['nounId', 'bidAmountEth'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'prepare_promote',
          description:
            'Prepare to promote a candidate proposal to a real onchain proposal using collected sponsor signatures. This calls proposeBySigs on the NounsGovernor with client ID 37. The candidate must have enough valid signatures to meet the proposal threshold.',
          parameters: {
            type: 'object' as const,
            properties: {
              proposer: {
                type: 'string',
                description: 'The candidate proposer address.',
              },
              slug: {
                type: 'string',
                description: 'The candidate slug.',
              },
            },
            required: ['proposer', 'slug'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'lookup_grant',
          description:
            'Look up Small Grants Treasury proposals. Returns grant details including status, votes, and pre-calculated voting time remaining (votingTimeLeft, votingBlocksLeft, votingEnded). Use this data to directly answer timing questions. Can search by ID or keyword.',
          parameters: {
            type: 'object' as const,
            properties: {
              grantId: {
                type: 'number',
                description: 'The grant proposal ID to look up.',
              },
              keyword: {
                type: 'string',
                description: 'Search keyword to find grants by description.',
              },
            },
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'prepare_grant_vote',
          description:
            'Prepare a vote on an active Small Grants proposal. Returns a GovernanceAction for the frontend. Requires Nouns voting power.',
          parameters: {
            type: 'object' as const,
            properties: {
              grantId: {
                type: 'number',
                description: 'The grant proposal ID to vote on.',
              },
              support: {
                type: 'number',
                description: 'Vote direction: 0=AGAINST, 1=FOR, 2=ABSTAIN.',
              },
              reason: {
                type: 'string',
                description: 'Optional reason for the vote.',
              },
            },
            required: ['grantId', 'support'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'prepare_grant_proposal',
          description:
            'Create a new Small Grants proposal. Anyone can propose. Enters 12hr voting immediately, then 12hr timelock. Returns a GovernanceAction. Include transactions for ETH transfers or contract calls.',
          parameters: {
            type: 'object' as const,
            properties: {
              title: {
                type: 'string',
                description: 'Short title for the grant proposal.',
              },
              description: {
                type: 'string',
                description: 'Full description of the grant request.',
              },
              transactions: {
                type: 'array',
                description:
                  'Optional executable transactions. STRONGLY PREFER typed primitives (kind:"usdc_transfer"|"usdc_payer_debt"|"eth_transfer"|"weth_transfer"|"steth_transfer") with human amounts; fall back to raw only for non-token contract calls. Same item shape as prepare_candidate.',
                items: {
                  type: 'object',
                  properties: {
                    kind: {
                      type: 'string',
                      enum: [
                        'usdc_transfer',
                        'usdc_payer_debt',
                        'eth_transfer',
                        'weth_transfer',
                        'steth_transfer',
                      ],
                    },
                    recipient: { type: 'string' },
                    amount: { type: 'string' },
                    amountEth: { type: 'string' },
                    target: { type: 'string' },
                    value: { type: 'string' },
                    signature: { type: 'string' },
                    calldata: { type: 'string' },
                  },
                },
              },
            },
            required: ['title', 'description'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'prepare_queue_proposal',
          description:
            'Queue a succeeded Nouns DAO proposal into the timelock. Must be called after a proposal passes voting before it can be executed. Anyone can call this. Returns a GovernanceAction for the frontend.',
          parameters: {
            type: 'object' as const,
            properties: {
              proposalId: {
                type: 'number',
                description:
                  'The proposal ID to queue. Must be in SUCCEEDED status (passed voting with quorum).',
              },
            },
            required: ['proposalId'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'prepare_queue_grant',
          description:
            'Queue a succeeded Small Grants proposal into the timelock. Must be called after a grant passes its 12hr vote before it can be executed. Anyone can call this. Returns a GovernanceAction for the frontend.',
          parameters: {
            type: 'object' as const,
            properties: {
              grantId: {
                type: 'number',
                description: 'The grant proposal ID to queue. Must have passed voting.',
              },
            },
            required: ['grantId'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'prepare_execute_proposal',
          description:
            'Execute a queued Nouns DAO proposal whose timelock has expired. Anyone can call this. Returns a GovernanceAction for the frontend.',
          parameters: {
            type: 'object' as const,
            properties: {
              proposalId: {
                type: 'number',
                description:
                  'The proposal ID to execute. Must be in QUEUED status with expired timelock.',
              },
            },
            required: ['proposalId'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'prepare_execute_grant',
          description:
            'Execute a queued Small Grants proposal whose timelock has expired. Anyone can call this. Returns a GovernanceAction for the frontend.',
          parameters: {
            type: 'object' as const,
            properties: {
              grantId: {
                type: 'number',
                description:
                  'The grant proposal ID to execute. Must be in QUEUED status with expired timelock.',
              },
            },
            required: ['grantId'],
          },
        },
      },
      // ── Trading Bot Tools (pooter.world integration) ──
      {
        type: 'function' as const,
        function: {
          name: 'get_trading_positions',
          description:
            'Get current trading positions from the pooter.world trading bot. Shows open positions with entry price, P&L, venue, direction (long/short), and moral score. Use this when users ask about trading, positions, or the trading bot.',
          parameters: {
            type: 'object' as const,
            properties: {
              openOnly: {
                type: 'boolean',
                description: 'If true (default), only show open positions. If false, show all.',
              },
            },
            required: [],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'get_trading_performance',
          description:
            'Get trading performance metrics from the pooter.world trading bot. Returns account value, win rate, realized P&L, total trades, largest win/loss. Use this when users ask about trading performance, returns, or how the bot is doing.',
          parameters: {
            type: 'object' as const,
            properties: {},
            required: [],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'get_trading_signals',
          description:
            'Get current market signals from the pooter.world trading bot. Returns bullish/bearish/neutral signals with confidence levels for watched markets (BTC, ETH, SOL, etc.). Use this when users ask about market sentiment or what the bot is watching.',
          parameters: {
            type: 'object' as const,
            properties: {},
            required: [],
          },
        },
      },
    ]; // end _removedGovernanceTools

    // Build system prompt — combine static + dynamic context
    const systemPrompt = dynamicContext ? `${staticPrompt}\n\n${dynamicContext}` : staticPrompt;

    // First API call via agent-hub (both use Sonnet for quality)
    let response = await hubChat({
      messages,
      system: systemPrompt,
      task: 'chat',
      maxTokens: isNounIrl ? 1024 : 512, // homepage chat gets shorter responses to save tokens
      temperature: 0.7,
      ...(isNounIrl ? { tools: nounIrlTools } : {}),
    });

    // Recover XML tool calls if the LLM hallucinated them as text (Groq/Llama fallback)
    patchXmlToolCalls(response);

    // Track governance actions prepared by tools (returned in response for frontend execution)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pendingAction: Record<string, any> | null = null;

    // Handle tool use loop (max 5 iterations — agent may chain: parse_traits → verify_tip → create_reservation)
    let iterations = 0;
    while (response.finishReason === 'tool_calls' && response.toolCalls?.length && iterations < 5) {
      iterations++;
      const toolUseBlocks = response.toolCalls;

      const toolResults: HubChatRequest['messages'] = [];

      for (const toolUse of toolUseBlocks) {
        try {
          let result: unknown;
          const args = JSON.parse(toolUse.function.arguments || '{}');

          switch (toolUse.function.name) {
            case 'verify_tip': {
              const input = args as { txHash: string; chainId: number };
              result = await verifyTip(input.txHash, input.chainId);
              break;
            }

            case 'create_reservation': {
              const input = args as {
                wallet: string;
                txHash: string;
                chainId: number;
                traits: string[];
              };
              // Check if tx already used
              if (reservationStore.isTxUsed(input.txHash)) {
                result = {
                  success: false,
                  error: 'This transaction has already been used for a reservation',
                };
              } else {
                // Create reservation
                const reservation = reservationStore.create({
                  wallet: input.wallet,
                  tipTxHash: input.txHash,
                  tipChainId: input.chainId,
                  tipAmountEth: 0,
                  traits: input.traits,
                });
                // Verify tip and activate async
                verifyTip(input.txHash, input.chainId)
                  .then(tipResult => {
                    if (tipResult.valid) {
                      const r = reservationStore.get(reservation.id);
                      if (r) {
                        r.tipAmountEth = tipResult.amountEth || 0;
                        reservationStore.activate(reservation.id);
                        console.log(
                          `[NounIRL] ✅ Reservation ${reservation.id} verified & activated — ${tipResult.amountEth} ETH from ${tipResult.chainName}`,
                        );
                      }
                    } else {
                      console.log(
                        `[NounIRL] ❌ Tip verification failed for ${reservation.id}: ${tipResult.error}`,
                      );
                      reservationStore.cancel(reservation.id);
                    }
                  })
                  .catch(err => {
                    console.error(`[NounIRL] Tip verification error for ${reservation.id}:`, err);
                  });
                result = {
                  success: true,
                  reservationId: reservation.id,
                  status: reservation.status,
                  traits: reservation.traits,
                  message:
                    'Reservation created. Tip is being verified — it will auto-activate once confirmed onchain.',
                };
              }
              break;
            }

            case 'get_reservations': {
              const input = args as { wallet?: string };
              const reservations = input.wallet
                ? reservationStore.getByWallet(input.wallet)
                : reservationStore.getAll();
              result = {
                reservations: reservations.map(r => ({
                  id: r.id,
                  wallet: r.wallet,
                  traits: r.traits,
                  status: r.status,
                  tipAmountEth: r.tipAmountEth,
                  tipChainId: r.tipChainId,
                  createdAt: new Date(r.createdAt * 1000).toISOString(),
                  fulfilledNounId: r.fulfilledNounId,
                })),
                stats: reservationStore.stats(),
              };
              break;
            }

            case 'cancel_reservation': {
              const input = args as { reservationId: string };
              const reservation = reservationStore.get(input.reservationId);
              if (!reservation) {
                result = { success: false, error: 'Reservation not found' };
              } else {
                reservationStore.cancel(input.reservationId);
                result = { success: true, message: `Reservation ${input.reservationId} cancelled` };
              }
              break;
            }

            case 'check_block': {
              result = await checkNow();
              break;
            }

            case 'list_traits': {
              const input = args as {
                category: 'background' | 'body' | 'accessory' | 'head' | 'glasses';
              };
              const names = getAllTraitNames(input.category);
              result = { category: input.category, count: names.length, traits: names };
              break;
            }

            case 'parse_traits': {
              const input = args as { description: string };
              const parsed = parseTraitDescription(input.description);
              result = { description: input.description, parsed };
              break;
            }

            case 'get_settlements': {
              const input = args as { limit?: number };
              result = { settlements: reservationStore.getSettlements(input.limit || 20) };
              break;
            }

            case 'get_agent_balance': {
              const balance = await getAgentBalance();
              result = {
                address: process.env.NOUNIRL_ADDRESS || 'not configured',
                balanceEth: Math.round(balance * 10000) / 10000,
              };
              break;
            }

            case 'deploy_code': {
              const input = args as { description: string; reason?: string };

              // ── Noun-gated: require 4+ Nouns to deploy ──
              if (!wallet) {
                result = {
                  success: false,
                  error: `Deploy requires a connected wallet holding ≥ ${MIN_NOUNS_FOR_DEPLOY} Nouns. Connect your wallet first.`,
                };
              } else {
                const nounBalance = await getNounBalance(wallet);
                if (nounBalance < MIN_NOUNS_FOR_DEPLOY) {
                  result = {
                    success: false,
                    error: `Deploy requires ≥ ${MIN_NOUNS_FOR_DEPLOY} Nouns. Your wallet (${wallet.slice(0, 6)}...${wallet.slice(-4)}) holds ${nounBalance} Noun${nounBalance === 1 ? '' : 's'}. Only major Nouners can push code changes.`,
                  };
                } else if (!canDeploy()) {
                  result = {
                    success: false,
                    error: 'Rate limited — max 1 deploy per hour. Try again later.',
                  };
                } else {
                  console.log(`[NounIRL] Deploy authorized by ${wallet} (${nounBalance} Nouns)`);
                  const patches = await generatePatch(input.description);
                  const deployResult = await applyAndDeploy(
                    patches,
                    input.description,
                    input.reason ||
                      `autonomous deploy via terminal (authorized by ${wallet.slice(0, 6)}...${wallet.slice(-4)}, ${nounBalance} Nouns)`,
                    'terminal',
                  );
                  result = {
                    success: deployResult.success,
                    branch: deployResult.branch,
                    commitSha: deployResult.commitSha,
                    // Quote `previewUrl` back to the user so they can open
                    // the live change. Tell them to DM @pip on Warpcast
                    // before any prod merge — production is pip's call.
                    previewUrl: deployResult.previewUrl,
                    nextStep: deployResult.success
                      ? 'Tell the user the previewUrl and ask them to DM @pip on Warpcast to review and ship to main.'
                      : undefined,
                    error: deployResult.error,
                    patchCount: deployResult.patches.length,
                    authorizedBy: wallet,
                    nounBalance,
                  };
                }
              }
              break;
            }

            case 'remember_fact': {
              const input = args as { key: string; content: string; scope: 'wallet' | 'global' };
              const memScope =
                input.scope === 'wallet' && wallet ? `wallet:${wallet.toLowerCase()}` : 'global';
              await remember(memScope, input.key, input.content);
              result = {
                success: true,
                message: `Remembered "${input.key}" in ${input.scope} scope.`,
              };
              break;
            }

            case 'recall_facts': {
              const input = args as { scope: 'wallet' | 'global' | 'all'; key?: string };
              if (input.scope === 'all') {
                const all = await recall('global');
                const walletMem = wallet ? await recall(`wallet:${wallet.toLowerCase()}`) : [];
                result = { global: all, wallet: walletMem };
              } else {
                const scope =
                  input.scope === 'wallet' && wallet ? `wallet:${wallet.toLowerCase()}` : 'global';
                result = { memories: await recall(scope, input.key) };
              }
              break;
            }

            case 'learn_url': {
              const input = args as { url: string };
              try {
                new URL(input.url); // validate URL
                result = await learnFromUrl(input.url);
              } catch {
                result = { error: 'Invalid URL provided' };
              }
              break;
            }

            case 'self_learn': {
              // Fire and forget — this takes minutes
              runSelfLearn()
                .then(r => {
                  console.log(
                    `[SelfLearn] Tool-triggered pipeline complete: ${r.totalFacts} facts`,
                  );
                })
                .catch(err => {
                  console.error('[SelfLearn] Tool-triggered pipeline failed:', err);
                });
              result = {
                started: true,
                message:
                  "Self-learning pipeline started. Processing all proposals, auctions, and delegates from noun.wtf. This takes a few minutes — I'll have comprehensive knowledge of all ~950 Nouns DAO proposals when it finishes.",
              };
              break;
            }

            // ── Governance Action Tools ──────────────────────────────────────
            case 'lookup_proposal': {
              const input = args as { proposalId?: number; keyword?: string };
              try {
                if (input.proposalId) {
                  const rows = await db
                    .select()
                    .from(schema.proposal)
                    .where(eq(schema.proposal.id, String(input.proposalId)))
                    .limit(1);
                  if (rows.length === 0) {
                    result = { error: `Proposal #${input.proposalId} not found in index.` };
                  } else {
                    const p = rows[0];
                    const descText = (p.description ?? '').toString();
                    const title =
                      descText
                        .split('\n')[0]
                        ?.replace(/^#+\s*/, '')
                        .trim() || 'Untitled';
                    const currentBlock = await getCurrentBlock();
                    const voting = formatBlocksRemaining(currentBlock, p.endBlock);
                    const updatePeriod = formatBlocksRemaining(
                      currentBlock,
                      p.updatePeriodEndBlock,
                    );
                    const objectionPeriod = formatBlocksRemaining(
                      currentBlock,
                      p.objectionPeriodEndBlock,
                    );
                    result = {
                      proposalId: p.id,
                      title,
                      status: p.status,
                      proposer: p.proposer,
                      forVotes: p.forVotes?.toString(),
                      againstVotes: p.againstVotes?.toString(),
                      abstainVotes: p.abstainVotes?.toString(),
                      quorumVotes: p.quorumVotes?.toString(),
                      currentBlock: currentBlock.toString(),
                      startBlock: p.startBlock?.toString(),
                      endBlock: p.endBlock?.toString(),
                      votingTimeLeft: voting.timeLeftFormatted,
                      votingBlocksLeft: voting.blocksLeft,
                      votingEnded: voting.hasEnded,
                      updatePeriodEndBlock: p.updatePeriodEndBlock?.toString() ?? null,
                      updatePeriodTimeLeft: updatePeriod.timeLeftFormatted,
                      objectionPeriodEndBlock: p.objectionPeriodEndBlock?.toString() ?? null,
                      objectionPeriodTimeLeft: objectionPeriod.timeLeftFormatted,
                      description: descText.slice(0, 500),
                    };
                  }
                } else if (input.keyword) {
                  // Search proposals by description content
                  const allProps = await db
                    .select()
                    .from(schema.proposal)
                    .orderBy(desc(schema.proposal.createdAtBlock))
                    .limit(100);
                  const kw = input.keyword.toLowerCase();
                  const matches = allProps
                    .filter(p => {
                      const desc = (p.description ?? '').toString().toLowerCase();
                      return desc.includes(kw);
                    })
                    .slice(0, 5);
                  result = {
                    matches: matches.map(p => {
                      const descText = (p.description ?? '').toString();
                      const title =
                        descText
                          .split('\n')[0]
                          ?.replace(/^#+\s*/, '')
                          .trim() || 'Untitled';
                      return { proposalId: p.id, title, status: p.status, proposer: p.proposer };
                    }),
                    count: matches.length,
                  };
                } else {
                  result = { error: 'Provide either proposalId or keyword.' };
                }
              } catch (err) {
                result = {
                  error: `Lookup failed: ${err instanceof Error ? err.message : 'unknown'}`,
                };
              }
              break;
            }

            case 'lookup_candidate': {
              const input = args as { slug?: string; keyword?: string };
              try {
                if (input.slug) {
                  const rows = await db
                    .select()
                    .from(schema.candidate)
                    .where(eq(schema.candidate.slug, input.slug))
                    .limit(1);
                  if (rows.length === 0) {
                    result = { error: `Candidate "${input.slug}" not found.` };
                  } else {
                    const c = rows[0];
                    const descText = (c.description ?? '').toString();
                    const title =
                      descText
                        .split('\n')[0]
                        ?.replace(/^#+\s*/, '')
                        .trim() || 'Untitled';
                    result = {
                      slug: c.slug,
                      proposer: c.proposer,
                      title,
                      description: descText.slice(0, 500),
                      canceled: c.canceled,
                    };
                  }
                } else if (input.keyword) {
                  const matches = await findCandidates(input.keyword, {
                    limit: 5,
                    includeCanceled: true,
                  });
                  result = {
                    matches: matches.map(c => ({
                      slug: c.slug,
                      proposer: c.proposer,
                      title: candidateTitle(c),
                      canceled: c.canceled,
                    })),
                    count: matches.length,
                  };
                } else {
                  result = { error: 'Provide either slug or keyword.' };
                }
              } catch (err) {
                result = {
                  error: `Lookup failed: ${err instanceof Error ? err.message : 'unknown'}`,
                };
              }
              break;
            }

            case 'prepare_vote': {
              const input = args as {
                proposalId: number;
                support: 0 | 1 | 2;
                reason?: string;
                dao?: string;
              };
              // Normalize the dao value. Client accepts 'lil-nouns' | 'lilnouns' | 'lil'
              // as aliases for Lil Nouns; we forward the canonical 'lil-nouns' string.
              const rawDao = (input.dao ?? '').toLowerCase();
              const isLil = rawDao === 'lil-nouns' || rawDao === 'lilnouns' || rawDao === 'lil';
              const daoCanonical: 'nouns' | 'lil-nouns' = isLil ? 'lil-nouns' : 'nouns';
              if (!wallet) {
                result = {
                  error:
                    'User must connect their wallet to vote. Tell them to click "connect" in the header.',
                };
              } else if (daoCanonical === 'lil-nouns') {
                // Lil Nouns proposals are not in the mainnet Ponder index; we trust the
                // model + injected /api/lil-proposals context to pick a real ID. The
                // on-chain governor will revert if the prop is invalid or not in
                // Active/ObjectionPeriod state — the client surfaces that error.
                pendingAction = {
                  type: 'VOTE',
                  proposalId: input.proposalId,
                  support: input.support,
                  reason: input.reason,
                  title: `Lil Prop #${input.proposalId}`,
                  dao: 'lil-nouns',
                };
                result = {
                  success: true,
                  action: pendingAction,
                  message: `Vote prepared: ${['AGAINST', 'FOR', 'ABSTAIN'][input.support]} on Lil Prop #${input.proposalId}. The user will be asked to confirm and sign the transaction in their wallet (Lil Nouns governor).`,
                };
              } else {
                try {
                  const rows = await db
                    .select()
                    .from(schema.proposal)
                    .where(eq(schema.proposal.id, String(input.proposalId)))
                    .limit(1);
                  if (rows.length === 0) {
                    result = { error: `Proposal #${input.proposalId} not found.` };
                  } else {
                    const p = rows[0];
                    // Check votability using block timing instead of DB status,
                    // because the indexer may not have a handler that sets ACTIVE status.
                    // A proposal is votable if: cancelled/vetoed/executed = false, and current block is within voting window.
                    const isFinalStatus =
                      p.status === 'CANCELLED' ||
                      p.status === 'VETOED' ||
                      p.status === 'EXECUTED' ||
                      p.status === 'QUEUED';
                    let votable = !isFinalStatus;
                    let rejectReason = '';
                    if (isFinalStatus) {
                      rejectReason = `Proposal #${input.proposalId} is "${p.status}" — voting is closed.`;
                      votable = false;
                    } else if (p.startBlock && p.endBlock) {
                      const currentBlock = await getCurrentBlock();
                      const start = BigInt(p.startBlock);
                      const end = BigInt(p.endBlock);
                      const objEnd = p.objectionPeriodEndBlock
                        ? BigInt(p.objectionPeriodEndBlock)
                        : null;
                      const effectiveEnd = objEnd && objEnd > end ? objEnd : end;
                      if (currentBlock < start) {
                        rejectReason = `Proposal #${input.proposalId} voting hasn't started yet (starts at block ${p.startBlock}).`;
                        votable = false;
                      } else if (currentBlock > effectiveEnd) {
                        rejectReason = `Proposal #${input.proposalId} voting has ended.`;
                        votable = false;
                      }
                    }
                    if (!votable) {
                      result = { error: rejectReason };
                    } else {
                      const descText = (p.description ?? '').toString();
                      const title =
                        descText
                          .split('\n')[0]
                          ?.replace(/^#+\s*/, '')
                          .trim() || 'Untitled';
                      pendingAction = {
                        type: 'VOTE',
                        proposalId: input.proposalId,
                        support: input.support,
                        reason: input.reason,
                        title,
                        dao: 'nouns',
                      };
                      result = {
                        success: true,
                        action: pendingAction,
                        message: `Vote prepared: ${['AGAINST', 'FOR', 'ABSTAIN'][input.support]} on Prop #${input.proposalId} "${title}". The user will be asked to confirm and sign the transaction.`,
                      };
                    }
                  }
                } catch (err) {
                  result = {
                    error: `Vote prep failed: ${err instanceof Error ? err.message : 'unknown'}`,
                  };
                }
              }
              break;
            }

            case 'prepare_proposal_feedback': {
              const input = args as { proposalId: number; support: 0 | 1 | 2; reason?: string };
              if (!wallet) {
                result = {
                  error:
                    'User must connect their wallet to give feedback. Tell them to click "connect" in the header.',
                };
              } else {
                try {
                  const rows = await db
                    .select()
                    .from(schema.proposal)
                    .where(eq(schema.proposal.id, String(input.proposalId)))
                    .limit(1);
                  if (rows.length === 0) {
                    result = { error: `Proposal #${input.proposalId} not found.` };
                  } else {
                    const descText = (rows[0].description ?? '').toString();
                    const title =
                      descText
                        .split('\n')[0]
                        ?.replace(/^#+\s*/, '')
                        .trim() || 'Untitled';
                    pendingAction = {
                      type: 'PROPOSAL_FEEDBACK',
                      proposalId: input.proposalId,
                      support: input.support,
                      reason: input.reason,
                      title,
                    };
                    result = {
                      success: true,
                      action: pendingAction,
                      message: `Feedback prepared: ${['AGAINST', 'FOR', 'ABSTAIN'][input.support]} on Prop #${input.proposalId} "${title}". The user will be asked to confirm and sign.`,
                    };
                  }
                } catch (err) {
                  result = {
                    error: `Feedback prep failed: ${err instanceof Error ? err.message : 'unknown'}`,
                  };
                }
              }
              break;
            }

            case 'prepare_candidate_feedback': {
              const input = args as {
                proposer: string;
                slug: string;
                support: 0 | 1 | 2;
                reason?: string;
              };
              if (!wallet) {
                result = {
                  error:
                    'User must connect their wallet. Tell them to click "connect" in the header.',
                };
              } else {
                try {
                  const rows = await db
                    .select()
                    .from(schema.candidate)
                    .where(eq(schema.candidate.slug, input.slug))
                    .limit(1);
                  if (rows.length === 0) {
                    result = { error: `Candidate "${input.slug}" not found.` };
                  } else {
                    const c = rows[0];
                    const descText = (c.description ?? '').toString();
                    const title =
                      descText
                        .split('\n')[0]
                        ?.replace(/^#+\s*/, '')
                        .trim() || 'Untitled';
                    pendingAction = {
                      type: 'CANDIDATE_FEEDBACK',
                      proposer: c.proposer as string,
                      slug: input.slug,
                      support: input.support,
                      reason: input.reason,
                      title,
                    };
                    result = {
                      success: true,
                      action: pendingAction,
                      message: `Candidate feedback prepared: ${['AGAINST', 'FOR', 'ABSTAIN'][input.support]} on "${title}". The user will be asked to confirm and sign.`,
                    };
                  }
                } catch (err) {
                  result = {
                    error: `Candidate feedback prep failed: ${err instanceof Error ? err.message : 'unknown'}`,
                  };
                }
              }
              break;
            }

            case 'prepare_candidate': {
              const input = args as {
                title: string;
                description: string;
                transactions?: ProposalTxInput[];
              };
              if (!wallet) {
                result = {
                  error:
                    'User must connect their wallet to create a candidate. Tell them to click "connect" in the header.',
                };
              } else {
                // Generate a URL-safe slug from the title
                const slug = input.title
                  .toLowerCase()
                  .replace(/[^\da-z]+/g, '-')
                  .replace(/^-|-$/g, '')
                  .slice(0, 80);
                const fullDescription = `# ${input.title}\n\n${input.description}`;

                const expanded = expandProposalTransactions(input.transactions);
                if (!expanded.ok) {
                  result = { error: expanded.error };
                  break;
                }
                const txs = expanded.txs;

                pendingAction = {
                  type: 'CREATE_CANDIDATE',
                  slug,
                  description: fullDescription,
                  title: input.title,
                  targets: txs.map(t => t.target),
                  values: txs.map(t => t.value),
                  signatures: txs.map(t => t.signature),
                  calldatas: txs.map(t => t.calldata),
                };
                const txNote =
                  txs.length > 0
                    ? ` Includes ${txs.length} executable transaction${txs.length > 1 ? 's' : ''}.`
                    : ' Description-only (no executable transactions).';
                result = {
                  success: true,
                  action: pendingAction,
                  message: `Candidate prepared: "${input.title}" (slug: ${slug}).${txNote} The user will be asked to confirm and sign. Note: creating a candidate costs a small amount of ETH (set by the DAO).`,
                };
              }
              break;
            }

            case 'prepare_update_candidate': {
              const input = args as {
                slug: string;
                title: string;
                description: string;
                reason?: string;
                transactions?: ProposalTxInput[];
              };
              if (!wallet) {
                result = {
                  error:
                    'User must connect their wallet to update a candidate. Tell them to click "connect" in the header.',
                };
              } else {
                try {
                  const rows = await db
                    .select()
                    .from(schema.candidate)
                    .where(eq(schema.candidate.slug, input.slug))
                    .limit(1);
                  if (rows.length === 0) {
                    result = { error: `Candidate "${input.slug}" not found.` };
                  } else {
                    const c = rows[0];
                    if (c.canceled) {
                      result = { error: `Candidate "${input.slug}" has been canceled.` };
                    } else if ((c.proposer as string).toLowerCase() !== wallet.toLowerCase()) {
                      result = {
                        error: `Only the original proposer (${(c.proposer as string).slice(0, 6)}...${(c.proposer as string).slice(-4)}) can update this candidate. Connected wallet doesn't match.`,
                      };
                    } else {
                      const expanded = expandProposalTransactions(input.transactions);
                      if (!expanded.ok) {
                        result = { error: expanded.error };
                        break;
                      }
                      const txs = expanded.txs;
                      const fullDescription = `# ${input.title}\n\n${input.description}`;

                      pendingAction = {
                        type: 'UPDATE_CANDIDATE',
                        slug: input.slug,
                        description: fullDescription,
                        title: input.title,
                        reason: input.reason || '',
                        targets: txs.map(t => t.target),
                        values: txs.map(t => t.value),
                        signatures: txs.map(t => t.signature),
                        calldatas: txs.map(t => t.calldata),
                      };
                      result = {
                        success: true,
                        action: pendingAction,
                        message: `Update prepared for candidate "${input.title}" (slug: ${input.slug}). WARNING: This will reset all existing sponsor signatures — sponsors will need to re-sign the updated version.`,
                      };
                    }
                  }
                } catch (err) {
                  result = {
                    error: `Update candidate prep failed: ${err instanceof Error ? err.message : 'unknown'}`,
                  };
                }
              }
              break;
            }

            case 'prepare_update_proposal': {
              const input = args as {
                proposalId: number;
                description?: string;
                updateMessage: string;
                transactions?: ProposalTxInput[];
              };
              if (!wallet) {
                result = {
                  error:
                    'User must connect their wallet to update a proposal. Tell them to click "connect" in the header.',
                };
              } else {
                try {
                  const rows = await db
                    .select()
                    .from(schema.proposal)
                    .where(eq(schema.proposal.id, String(input.proposalId)))
                    .limit(1);
                  if (rows.length === 0) {
                    result = { error: `Proposal #${input.proposalId} not found.` };
                  } else {
                    const p = rows[0];
                    if ((p.proposer as string).toLowerCase() !== wallet.toLowerCase()) {
                      result = {
                        error: `Only the original proposer can update this proposal. Connected wallet doesn't match.`,
                      };
                    } else if (!p.updatePeriodEndBlock) {
                      result = {
                        error: `Proposal #${input.proposalId} doesn't have an update period set. It may be too old or already past its update window.`,
                      };
                    } else {
                      const expanded = expandProposalTransactions(input.transactions);
                      if (!expanded.ok) {
                        result = { error: expanded.error };
                        break;
                      }
                      const txs = expanded.txs;

                      const descText = (p.description ?? '').toString();
                      const title =
                        descText
                          .split('\n')[0]
                          ?.replace(/^#+\s*/, '')
                          .trim() || 'Untitled';

                      // Determine update type: description-only, transactions-only, or both
                      const hasNewDesc = !!input.description;
                      const hasNewTxs = txs.length > 0;

                      let updateType:
                        | 'UPDATE_PROPOSAL'
                        | 'UPDATE_PROPOSAL_DESCRIPTION'
                        | 'UPDATE_PROPOSAL_TRANSACTIONS';
                      if (hasNewDesc && hasNewTxs) {
                        updateType = 'UPDATE_PROPOSAL';
                      } else if (hasNewTxs) {
                        updateType = 'UPDATE_PROPOSAL_TRANSACTIONS';
                      } else {
                        updateType = 'UPDATE_PROPOSAL_DESCRIPTION';
                      }

                      pendingAction = {
                        type: updateType,
                        proposalId: input.proposalId,
                        title,
                        description: input.description || descText,
                        updateMessage: input.updateMessage,
                        targets: txs.map(t => t.target),
                        values: txs.map(t => t.value),
                        signatures: txs.map(t => t.signature),
                        calldatas: txs.map(t => t.calldata),
                        updatePeriodEndBlock: p.updatePeriodEndBlock?.toString(),
                      };
                      result = {
                        success: true,
                        action: pendingAction,
                        message: `Proposal update prepared for Prop #${input.proposalId} "${title}". Update type: ${updateType.replace(/_/g, ' ').toLowerCase()}. Update period ends at block ${p.updatePeriodEndBlock}. The user will be asked to confirm and sign.`,
                      };
                    }
                  }
                } catch (err) {
                  result = {
                    error: `Update proposal prep failed: ${err instanceof Error ? err.message : 'unknown'}`,
                  };
                }
              }
              break;
            }

            case 'prepare_sponsor': {
              const input = args as { proposer: string; slug: string; reason?: string };
              if (!wallet) {
                result = {
                  error:
                    'User must connect their wallet to sponsor a candidate. Tell them to click "connect" in the header.',
                };
              } else {
                try {
                  const rows = await db
                    .select()
                    .from(schema.candidate)
                    .where(eq(schema.candidate.slug, input.slug))
                    .limit(1);
                  if (rows.length === 0) {
                    result = { error: `Candidate "${input.slug}" not found.` };
                  } else {
                    const c = rows[0];
                    if (c.canceled) {
                      result = { error: `Candidate "${input.slug}" has been canceled.` };
                    } else {
                      const descText = (c.description ?? '').toString();
                      const title =
                        descText
                          .split('\n')[0]
                          ?.replace(/^#+\s*/, '')
                          .trim() || 'Untitled';
                      pendingAction = {
                        type: 'SPONSOR',
                        proposer: c.proposer as string,
                        slug: input.slug,
                        reason: input.reason,
                        title,
                        // Frontend needs these to construct the EIP-712 signature
                        encodedProp: c.targets
                          ? JSON.stringify({
                              targets: JSON.parse((c.targets as string) || '[]'),
                              values: JSON.parse((c.values as string) || '[]'),
                              signatures: JSON.parse((c.signatures as string) || '[]'),
                              calldatas: JSON.parse((c.calldatas as string) || '[]'),
                              description: descText,
                            })
                          : '{}',
                      };
                      result = {
                        success: true,
                        action: pendingAction,
                        message: `Sponsor prepared for "${title}". The user will be asked to sign an EIP-712 message and submit it onchain. This adds their signature to help the candidate reach the proposal threshold.`,
                      };
                    }
                  }
                } catch (err) {
                  result = {
                    error: `Sponsor prep failed: ${err instanceof Error ? err.message : 'unknown'}`,
                  };
                }
              }
              break;
            }

            case 'prepare_bid': {
              const input = args as { nounId: number; bidAmountEth: string };
              if (!wallet) {
                result = {
                  error:
                    'User must connect their wallet to bid. Tell them to click "connect" in the header.',
                };
              } else {
                try {
                  // Verify the auction exists and is active
                  const rows = await db
                    .select()
                    .from(schema.auction)
                    .where(eq(schema.auction.nounId, String(input.nounId)))
                    .limit(1);
                  if (rows.length === 0) {
                    result = { error: `Auction for Noun ${input.nounId} not found in index.` };
                  } else {
                    const auction = rows[0];
                    if (auction.settled) {
                      result = {
                        error: `Auction for Noun ${input.nounId} has already been settled.`,
                      };
                    } else {
                      const bidAmount = parseFloat(input.bidAmountEth);
                      if (isNaN(bidAmount) || bidAmount <= 0) {
                        result = { error: 'Invalid bid amount.' };
                      } else {
                        pendingAction = {
                          type: 'BID',
                          nounId: input.nounId,
                          bidAmountEth: input.bidAmountEth,
                        };
                        result = {
                          success: true,
                          action: pendingAction,
                          message: `Bid prepared: ${input.bidAmountEth} ETH on Noun ${input.nounId}. The user will be asked to confirm and sign the transaction. Client ID 37 (noun.wtf) will be included.`,
                        };
                      }
                    }
                  }
                } catch (err) {
                  result = {
                    error: `Bid prep failed: ${err instanceof Error ? err.message : 'unknown'}`,
                  };
                }
              }
              break;
            }

            case 'prepare_promote': {
              const input = args as { proposer: string; slug: string };
              if (!wallet) {
                result = {
                  error:
                    'User must connect their wallet to promote a candidate. Tell them to click "connect" in the header.',
                };
              } else {
                try {
                  const rows = await db
                    .select()
                    .from(schema.candidate)
                    .where(eq(schema.candidate.slug, input.slug))
                    .limit(1);
                  if (rows.length === 0) {
                    result = { error: `Candidate "${input.slug}" not found.` };
                  } else {
                    const c = rows[0];
                    if (c.canceled) {
                      result = { error: `Candidate "${input.slug}" has been canceled.` };
                    } else {
                      const descText = (c.description ?? '').toString();
                      const title =
                        descText
                          .split('\n')[0]
                          ?.replace(/^#+\s*/, '')
                          .trim() || 'Untitled';

                      // Fetch signatures for this candidate.
                      // Match on candidateId (`${proposer}-${slug}` PK), not
                      // a non-existent candidateSlug column.
                      const sigs = await db
                        .select()
                        .from(schema.candidateSignature)
                        .where(eq(schema.candidateSignature.candidateId, c.id as string))
                        .limit(100);

                      const nowSec = Math.floor(Date.now() / 1000);
                      const validSigs = sigs.filter(
                        s => !s.canceled && Number(s.expirationTimestamp) > nowSec,
                      );

                      pendingAction = {
                        type: 'PROMOTE',
                        proposer: c.proposer as string,
                        slug: input.slug,
                        title,
                        // Full proposal data for the proposeBySigs call
                        targets: JSON.parse((c.targets as string) || '[]'),
                        values: JSON.parse((c.values as string) || '[]'),
                        signatures: JSON.parse((c.signatures as string) || '[]'),
                        calldatas: JSON.parse((c.calldatas as string) || '[]'),
                        description: descText,
                        // Valid sponsor signatures
                        sponsorSignatures: validSigs.map(s => ({
                          sig: s.sig,
                          signer: s.signer,
                          expirationTimestamp: s.expirationTimestamp?.toString(),
                        })),
                      };
                      result = {
                        success: true,
                        action: pendingAction,
                        signatureCount: validSigs.length,
                        message: `Promote prepared for "${title}" with ${validSigs.length} valid signatures. The user will call proposeBySigs with client ID 37 (noun.wtf). This creates a real onchain proposal from the candidate.`,
                      };
                    }
                  }
                } catch (err) {
                  result = {
                    error: `Promote prep failed: ${err instanceof Error ? err.message : 'unknown'}`,
                  };
                }
              }
              break;
            }

            case 'lookup_grant': {
              const input = args as { grantId?: number; keyword?: string };
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                let rows: any[];
                if (input.grantId !== undefined) {
                  rows = await db
                    .select()
                    .from(schema.grant)
                    .where(eq(schema.grant.id, String(input.grantId)))
                    .limit(1);
                } else {
                  rows = await db
                    .select()
                    .from(schema.grant)
                    .orderBy(desc(schema.grant.createdAtBlock))
                    .limit(20);
                  if (input.keyword) {
                    const kw = input.keyword.toLowerCase();
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    rows = rows.filter((r: any) =>
                      (r.description || '').toLowerCase().includes(kw),
                    );
                  }
                }
                if (rows.length === 0) {
                  result = {
                    found: false,
                    message: input.grantId
                      ? `Grant #${input.grantId} not found.`
                      : 'No grants found.',
                  };
                } else {
                  const currentBlock = await getCurrentBlock();
                  result = {
                    found: true,
                    currentBlock: currentBlock.toString(),
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    grants: rows.map((g: any) => {
                      const descText = (g.description || '').toString();
                      const title =
                        descText
                          .split('\n')[0]
                          ?.replace(/^#+\s*/, '')
                          .trim() || 'Untitled';
                      const voting = formatBlocksRemaining(currentBlock, g.endBlock);
                      return {
                        id: g.id,
                        proposer: g.proposer,
                        title,
                        status: g.status,
                        forVotes: g.forVotes,
                        againstVotes: g.againstVotes,
                        abstainVotes: g.abstainVotes,
                        startBlock: g.startBlock,
                        endBlock: g.endBlock,
                        executionETA: g.executionETA,
                        votingTimeLeft: voting.timeLeftFormatted,
                        votingBlocksLeft: voting.blocksLeft,
                        votingEnded: voting.hasEnded,
                      };
                    }),
                  };
                }
              } catch (err) {
                result = {
                  error: `Grant lookup failed: ${err instanceof Error ? err.message : 'unknown'}`,
                };
              }
              break;
            }

            case 'prepare_grant_vote': {
              const input = args as { grantId: number; support: 0 | 1 | 2; reason?: string };
              if (!wallet) {
                result = {
                  error:
                    'User must connect their wallet to vote on a grant. Tell them to click "connect" in the header.',
                };
              } else {
                try {
                  const rows = await db
                    .select()
                    .from(schema.grant)
                    .where(eq(schema.grant.id, String(input.grantId)))
                    .limit(1);
                  if (rows.length === 0) {
                    result = { error: `Grant #${input.grantId} not found.` };
                  } else {
                    const g = rows[0];
                    if (g.status !== 'ACTIVE') {
                      result = {
                        error: `Grant #${input.grantId} is "${g.status}" — can only vote on Active grants.`,
                      };
                    } else {
                      const descText = (g.description || '').toString();
                      const title =
                        descText
                          .split('\n')[0]
                          ?.replace(/^#+\s*/, '')
                          .trim() || 'Untitled';
                      pendingAction = {
                        type: 'GRANT_VOTE',
                        grantId: input.grantId,
                        support: input.support,
                        reason: input.reason,
                        title,
                      };
                      result = {
                        success: true,
                        action: pendingAction,
                        message: `Grant vote prepared: ${['AGAINST', 'FOR', 'ABSTAIN'][input.support]} on Grant #${input.grantId} "${title}". The user will be asked to confirm and sign.`,
                      };
                    }
                  }
                } catch (err) {
                  result = {
                    error: `Grant vote prep failed: ${err instanceof Error ? err.message : 'unknown'}`,
                  };
                }
              }
              break;
            }

            case 'prepare_grant_proposal': {
              const input = args as {
                title: string;
                description: string;
                transactions?: ProposalTxInput[];
              };
              if (!wallet) {
                result = {
                  error:
                    'User must connect their wallet to create a grant proposal. Tell them to click "connect" in the header.',
                };
              } else {
                const expanded = expandProposalTransactions(input.transactions);
                if (!expanded.ok) {
                  result = { error: expanded.error };
                  break;
                }
                const txs = expanded.txs;
                const fullDescription = `# ${input.title}\n\n${input.description}`;

                pendingAction = {
                  type: 'GRANT_PROPOSAL',
                  title: input.title,
                  description: fullDescription,
                  targets: txs.map(t => t.target),
                  values: txs.map(t => t.value),
                  signatures: txs.map(t => t.signature),
                  calldatas: txs.map(t => t.calldata),
                };
                const txNote =
                  txs.length > 0
                    ? ` Includes ${txs.length} executable transaction${txs.length > 1 ? 's' : ''}.`
                    : ' Description-only (no executable transactions).';
                result = {
                  success: true,
                  action: pendingAction,
                  message: `Grant proposal prepared: "${input.title}".${txNote} This enters 12hr voting immediately — no delay. The user will be asked to confirm and sign.`,
                };
              }
              break;
            }

            case 'prepare_queue_proposal': {
              const input = args as { proposalId: number };
              if (!wallet) {
                result = {
                  error:
                    'User must connect their wallet to queue a proposal. Tell them to click "connect" in the header.',
                };
              } else {
                try {
                  const rows = await db
                    .select()
                    .from(schema.proposal)
                    .where(eq(schema.proposal.id, BigInt(input.proposalId)))
                    .limit(1);
                  if (rows.length === 0) {
                    result = { error: `Proposal #${input.proposalId} not found.` };
                  } else {
                    const p = rows[0];
                    const currentBlock = await getCurrentBlock();
                    const derived = computeDerivedStatus(
                      p as Parameters<typeof computeDerivedStatus>[0],
                      currentBlock,
                    );
                    if (derived !== 'SUCCEEDED') {
                      result = {
                        error: `Proposal #${input.proposalId} is "${derived}" — can only queue SUCCEEDED proposals (passed voting with quorum).`,
                      };
                    } else {
                      const descText = (p.description || '').toString();
                      const title =
                        descText
                          .split('\n')[0]
                          ?.replace(/^#+\s*/, '')
                          .trim() || 'Untitled';
                      pendingAction = {
                        type: 'QUEUE_PROPOSAL',
                        proposalId: input.proposalId,
                        title,
                      };
                      result = {
                        success: true,
                        action: pendingAction,
                        message: `Queue prepared for Prop #${input.proposalId} "${title}". This will place it in the timelock — after the waiting period it can be executed. The user will be asked to confirm and sign.`,
                      };
                    }
                  }
                } catch (err) {
                  result = {
                    error: `Queue prep failed: ${err instanceof Error ? err.message : 'unknown'}`,
                  };
                }
              }
              break;
            }

            case 'prepare_queue_grant': {
              const input = args as { grantId: number };
              if (!wallet) {
                result = {
                  error:
                    'User must connect their wallet to queue a grant. Tell them to click "connect" in the header.',
                };
              } else {
                try {
                  const rows = await db
                    .select()
                    .from(schema.grant)
                    .where(eq(schema.grant.id, BigInt(input.grantId)))
                    .limit(1);
                  if (rows.length === 0) {
                    result = { error: `Grant #${input.grantId} not found.` };
                  } else {
                    const g = rows[0];
                    // For grants, check if voting passed — status should still be ACTIVE but votes have passed
                    // In practice the indexer may or may not have a derived status helper for grants
                    // We'll check that it's not already QUEUED/EXECUTED/CANCELLED
                    if (g.status === 'QUEUED') {
                      result = { error: `Grant #${input.grantId} is already queued.` };
                    } else if (g.status === 'EXECUTED') {
                      result = { error: `Grant #${input.grantId} has already been executed.` };
                    } else if (g.status === 'CANCELED') {
                      result = { error: `Grant #${input.grantId} was cancelled.` };
                    } else {
                      const descText = (g.description || '').toString();
                      const title =
                        descText
                          .split('\n')[0]
                          ?.replace(/^#+\s*/, '')
                          .trim() || 'Untitled';
                      pendingAction = {
                        type: 'QUEUE_GRANT',
                        grantId: input.grantId,
                        title,
                      };
                      result = {
                        success: true,
                        action: pendingAction,
                        message: `Queue prepared for Grant #${input.grantId} "${title}". This will place it in the 12hr timelock before it can be executed. The user will be asked to confirm and sign.`,
                      };
                    }
                  }
                } catch (err) {
                  result = {
                    error: `Queue prep failed: ${err instanceof Error ? err.message : 'unknown'}`,
                  };
                }
              }
              break;
            }

            case 'prepare_execute_proposal': {
              const input = args as { proposalId: number };
              if (!wallet) {
                result = {
                  error:
                    'User must connect their wallet to execute a proposal. Tell them to click "connect" in the header.',
                };
              } else {
                try {
                  const rows = await db
                    .select()
                    .from(schema.proposal)
                    .where(eq(schema.proposal.id, BigInt(input.proposalId)))
                    .limit(1);
                  if (rows.length === 0) {
                    result = { error: `Proposal #${input.proposalId} not found.` };
                  } else {
                    const p = rows[0];
                    if (p.status !== 'QUEUED') {
                      result = {
                        error: `Proposal #${input.proposalId} is "${p.status}" — can only execute QUEUED proposals.`,
                      };
                    } else if (!p.executionETA) {
                      result = { error: `Proposal #${input.proposalId} has no execution ETA set.` };
                    } else {
                      const nowSeconds = Math.floor(Date.now() / 1000);
                      const eta = Number(p.executionETA);
                      if (nowSeconds < eta) {
                        const minutesLeft = (eta - nowSeconds) / 60;
                        const timeStr =
                          minutesLeft > 60
                            ? `~${(minutesLeft / 60).toFixed(1)} hours`
                            : `~${Math.ceil(minutesLeft)} minutes`;
                        result = {
                          error: `Proposal #${input.proposalId} timelock not yet expired (${timeStr} remaining).`,
                        };
                      } else {
                        const descText = (p.description || '').toString();
                        const title =
                          descText
                            .split('\n')[0]
                            ?.replace(/^#+\s*/, '')
                            .trim() || 'Untitled';
                        pendingAction = {
                          type: 'EXECUTE_PROPOSAL',
                          proposalId: input.proposalId,
                          title,
                        };
                        result = {
                          success: true,
                          action: pendingAction,
                          message: `Execute prepared for Prop #${input.proposalId} "${title}". The user will be asked to confirm and sign the execution transaction.`,
                        };
                      }
                    }
                  }
                } catch (err) {
                  result = {
                    error: `Execute prep failed: ${err instanceof Error ? err.message : 'unknown'}`,
                  };
                }
              }
              break;
            }

            case 'prepare_execute_grant': {
              const input = args as { grantId: number };
              if (!wallet) {
                result = {
                  error:
                    'User must connect their wallet to execute a grant. Tell them to click "connect" in the header.',
                };
              } else {
                try {
                  const rows = await db
                    .select()
                    .from(schema.grant)
                    .where(eq(schema.grant.id, BigInt(input.grantId)))
                    .limit(1);
                  if (rows.length === 0) {
                    result = { error: `Grant #${input.grantId} not found.` };
                  } else {
                    const g = rows[0];
                    if (g.status !== 'QUEUED') {
                      result = {
                        error: `Grant #${input.grantId} is "${g.status}" — can only execute QUEUED grants.`,
                      };
                    } else if (!g.executionETA) {
                      result = { error: `Grant #${input.grantId} has no execution ETA set.` };
                    } else {
                      const nowSeconds = Math.floor(Date.now() / 1000);
                      const eta = Number(g.executionETA);
                      if (nowSeconds < eta) {
                        const minutesLeft = (eta - nowSeconds) / 60;
                        const timeStr =
                          minutesLeft > 60
                            ? `~${(minutesLeft / 60).toFixed(1)} hours`
                            : `~${Math.ceil(minutesLeft)} minutes`;
                        result = {
                          error: `Grant #${input.grantId} timelock not yet expired (${timeStr} remaining).`,
                        };
                      } else {
                        const descText = (g.description || '').toString();
                        const title =
                          descText
                            .split('\n')[0]
                            ?.replace(/^#+\s*/, '')
                            .trim() || 'Untitled';
                        pendingAction = {
                          type: 'EXECUTE_GRANT',
                          grantId: input.grantId,
                          title,
                        };
                        result = {
                          success: true,
                          action: pendingAction,
                          message: `Execute prepared for Grant #${input.grantId} "${title}". The user will be asked to confirm and sign the execution transaction.`,
                        };
                      }
                    }
                  }
                } catch (err) {
                  result = {
                    error: `Execute prep failed: ${err instanceof Error ? err.message : 'unknown'}`,
                  };
                }
              }
              break;
            }

            // ── Trading Bot Tools ──────────────────────────────────────────
            case 'get_trading_positions': {
              const input = args as { openOnly?: boolean };
              try {
                const data = await getTradingPositions(input.openOnly !== false);
                const positions = data.positions || [];
                const parallelPositions = data.parallel || [];
                const allOpen = [...positions, ...parallelPositions.flatMap(r => r.positions)];
                result = {
                  positionCount: allOpen.length,
                  positions: allOpen.slice(0, 10).map(p => ({
                    id: p.id,
                    venue: p.venue,
                    symbol: p.symbol || p.tokenAddress,
                    direction: p.direction,
                    status: p.status,
                    entryPriceUsd: p.entryPriceUsd,
                    entryNotionalUsd: p.entryNotionalUsd,
                    moralScore: p.moralScore,
                    openedAt: p.openedAt ? new Date(p.openedAt).toISOString() : null,
                  })),
                  source: 'pooter.world trading bot',
                };
              } catch (err) {
                result = {
                  error: `Trading API error: ${err instanceof Error ? err.message : 'unavailable'}`,
                };
              }
              break;
            }

            case 'get_trading_performance': {
              try {
                const perf = await getTradingPerformance();
                result = {
                  accountValueUsd: perf.accountValueUsd,
                  openPositions: perf.openPositionCount,
                  watchMarkets: perf.watchMarkets,
                  totalTrades: perf.metrics?.totalTrades ?? 0,
                  winRate: perf.metrics?.winRate ?? 0,
                  realizedPnlUsd: perf.metrics?.realizedPnlUsd ?? 0,
                  avgPnlPerTrade: perf.metrics?.avgPnlPerTrade ?? 0,
                  largestWin: perf.metrics?.largestWin ?? 0,
                  largestLoss: perf.metrics?.largestLoss ?? 0,
                  source: 'pooter.world trading bot',
                };
              } catch (err) {
                result = {
                  error: `Trading API error: ${err instanceof Error ? err.message : 'unavailable'}`,
                };
              }
              break;
            }

            case 'get_trading_signals': {
              try {
                const data = await getTradingSignals();
                result = {
                  signals: data.signals || [],
                  source: 'pooter.world trading bot',
                };
              } catch (err) {
                result = {
                  error: `Signals API error: ${err instanceof Error ? err.message : 'unavailable'}`,
                };
              }
              break;
            }

            default:
              result = { error: `Unknown tool: ${toolUse.function.name}` };
          }

          toolResults.push({
            role: 'tool',
            tool_call_id: toolUse.id,
            content: JSON.stringify(result),
          });
        } catch (err) {
          toolResults.push({
            role: 'tool',
            tool_call_id: toolUse.id,
            content: JSON.stringify({
              error: err instanceof Error ? err.message : 'Tool execution failed',
            }),
          });
        }
      }

      // Continue conversation with tool results — OpenAI format
      messages.push({
        role: 'assistant',
        content: response.text,
        tool_calls: response.toolCalls,
      });
      messages.push(...toolResults);

      response = await hubChat({
        messages,
        system: systemPrompt,
        task: 'chat',
        maxTokens: 1024,
        temperature: 0.7,
        ...(isNounIrl ? { tools: nounIrlTools } : {}),
      });

      // Recover XML tool calls on continuation responses too
      patchXmlToolCalls(response);
    }

    let text = response.text || '';

    // If LLM returned empty, retry once with a nudge
    if (!text && !pendingAction) {
      try {
        messages.push({ role: 'assistant', content: '' });
        messages.push({ role: 'user', content: 'Please respond to my previous message.' });
        const retry = await hubChat({
          messages,
          system: systemPrompt,
          task: 'chat',
          maxTokens: 1024,
          temperature: 0.7,
        });
        text = retry.text || '';
      } catch {
        /* ignore retry failure */
      }
    }

    // If agent used tools but returned no text, provide a fallback
    if (!text && pendingAction) {
      text = 'Action prepared — confirm below. ⌐◨-◨';
    } else if (!text) {
      text = "Hmm, I'm having trouble responding right now. Try again? ⌐◨-◨";
    }

    // Include governance action if one was prepared by a tool
    const responsePayload: { response: string; action?: Record<string, unknown> } = {
      response: text,
    };
    if (pendingAction) {
      responsePayload.action = pendingAction;
    }
    return c.json(responsePayload);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('Terminal chat error:', errMsg);
    const friendlyError =
      agentMode === 'nounirl' && isUpstreamAiFailure(errMsg)
        ? NOUNIRL_PIPE_UNLOCK_MESSAGE
        : `AI request failed: ${errMsg}`;
    return c.json({ error: friendlyError }, 500);
  }
});

// ============================================================
// Feed — Neynar Farcaster proxy for /nouns and /noc channels
// ============================================================

const ALLOWED_CHANNELS = ['nouns', 'noc', 'lil'];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const feedCaches = new Map<string, { data: any; fetchedAt: number }>();
const FEED_CACHE_TTL = 60 * 60_000; // 1 hour

app.get('/api/feed/:channel', async c => {
  const channel = c.req.param('channel');

  if (!ALLOWED_CHANNELS.includes(channel)) {
    return c.json(
      { error: `Unknown channel: ${channel}. Allowed: ${ALLOWED_CHANNELS.join(', ')}` },
      400,
    );
  }

  const neynarKey = process.env.NEYNAR_API_KEY;
  if (!neynarKey) {
    return c.json({ error: 'Feed not configured (missing Neynar key)' }, 503);
  }

  // Return cached if fresh
  const cached = feedCaches.get(channel);
  if (cached && Date.now() - cached.fetchedAt < FEED_CACHE_TTL) {
    return c.json(cached.data);
  }

  try {
    const url = `https://api.neynar.com/v2/farcaster/feed/?feed_type=filter&filter_type=channel_id&channel_id=${channel}&limit=25`;
    const res = await fetch(url, {
      headers: {
        'x-api-key': neynarKey,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`Neynar API error (/${channel}):`, res.status, errText);
      return c.json({ error: `Neynar API error: ${res.status}` }, 502);
    }

    const data = await res.json();
    feedCaches.set(channel, { data, fetchedAt: Date.now() });
    return c.json(data);
  } catch (err) {
    console.error(`Feed fetch error (/${channel}):`, err);
    return c.json({ error: 'Failed to fetch feed' }, 500);
  }
});

// ============================================================
// Sketch — detect @pip's daily sketch from Farcaster
// ============================================================

const PIP_FID = 191593; // @pip on Farcaster (hugo)
const SKETCH_CACHE_TTL = 5 * 60_000; // 5 minutes
let sketchCache: { data: unknown; fetchedAt: number } | null = null;

app.get('/api/sketch/latest', async c => {
  const neynarKey = process.env.NEYNAR_API_KEY;
  if (!neynarKey) {
    return c.json({ error: 'Sketch API not configured (missing Neynar key)' }, 503);
  }

  // Return cached if fresh
  if (sketchCache && Date.now() - sketchCache.fetchedAt < SKETCH_CACHE_TTL) {
    return c.json(sketchCache.data);
  }

  try {
    // Fetch @pip's recent casts in /nouns channel
    const url = `https://api.neynar.com/v2/farcaster/feed/?feed_type=filter&filter_type=fids&fids=${PIP_FID}&channel_id=nouns&limit=10`;
    const res = await fetch(url, {
      headers: {
        'x-api-key': neynarKey,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      console.error('Neynar sketch API error:', res.status);
      return c.json({ nounId: 0 });
    }

    const data = await res.json();
    const casts = data?.casts ?? [];

    // Find the most recent cast with an image embed and a noun number
    const nounIdRegex = /\b(\d{3,4})\b/;
    for (const cast of casts) {
      // Check if cast is within last 48 hours
      const castAge = Date.now() - new Date(cast.timestamp).getTime();
      if (castAge > 48 * 60 * 60 * 1000) continue;

      // Extract noun number from text
      const numMatch = cast.text?.match(nounIdRegex);
      if (!numMatch) continue;

      // Find image embed
      const embeds = cast.embeds ?? [];
      let gifUrl: string | null = null;
      for (const embed of embeds) {
        if (embed.metadata?.image || embed.metadata?.content_type?.startsWith('image/')) {
          gifUrl = embed.url;
          break;
        }
      }
      if (!gifUrl) continue;

      const result = {
        nounId: parseInt(numMatch[1], 10),
        gifUrl,
        artist: 'pip',
        mintPrice: '0.01',
        mintEnabled: Boolean(process.env.SKETCH_MINT_CONTRACT),
        mintContract: process.env.SKETCH_MINT_CONTRACT || null,
        castHash: cast.hash,
        castTimestamp: cast.timestamp,
      };

      sketchCache = { data: result, fetchedAt: Date.now() };
      return c.json(result);
    }

    // No sketch found
    const empty = { nounId: 0 };
    sketchCache = { data: empty, fetchedAt: Date.now() };
    return c.json(empty);
  } catch (err) {
    console.error('Sketch fetch error:', err);
    return c.json({ nounId: 0 });
  }
});

// ============================================================
// Treasury Flows — node diagram data for nouns.eth
// ============================================================

// Treasury addresses — merged into the virtual "treasury" central node
const TREASURY_ADDRESSES = new Set([
  '0x0bc3807ec262cb779b38d65b38158acc3bfede10', // Legacy Treasury
  '0xb1a32fc9f9d8b2cf86c068cae13108809547ef71', // Current Treasury
  '0x4f2acdc74f6941390d9b1804fabc3e780388cfe5', // Token Buyer
]);

const KNOWN_ENTITIES: Record<
  string,
  { name: string; type: string; description: string; url?: string }
> = {
  // ── Governance ──
  '0x6f3e6272a167e8accb32072d08e0957f9c79223d': {
    name: 'Nouns DAO Proxy',
    type: 'governance',
    description: 'NounsDAOProxy — governance execution',
  },
  // ── Nounders ──
  '0x2573c60a6d127755aa2dc85e342f7da2378a0cc5': {
    name: 'Nounders',
    type: 'nounder',
    description: 'Nounders multisig — founding team',
  },
  '0xfcb177a083c9015adf3cef26fee3e3fc24b993c1': {
    name: '4156.eth',
    type: 'nounder',
    description: 'Nounder — punk4156',
  },
  '0x83fce6e68e2f7e58f1d40de12f50ec86e104e94b': {
    name: 'cryptoseneca.eth',
    type: 'nounder',
    description: 'Nounder — cryptoseneca',
  },
  '0x1f790c60a21b1d07a041fbc7eb31e36e8457c77a': {
    name: 'vapeape.eth',
    type: 'nounder',
    description: 'Nounder — vapeape',
  },
  '0x454cfaa623a629cc0b4017aeb85d54c42e91479d': {
    name: 'lastpunk9999.eth',
    type: 'nounder',
    description: 'Nounder — lastpunk9999',
  },
  '0x2c44b726adf1963ca47af88b284c06f30380fc78': {
    name: 'eboyarts.eth',
    type: 'nounder',
    description: 'Nounder — eBoy',
  },
  '0xfc7935920789a02b3ee3d7cb768a5f2585f6f383': {
    name: 'gremplin.eth',
    type: 'nounder',
    description: 'Nounder — gremplin',
  },
  '0x179a862703a4adfb29681631bd2bae4432e8d5e1': {
    name: 'devcarrot.eth',
    type: 'nounder',
    description: 'Nounder — devcarrot',
  },
  '0xc3fdadbae46798cd8762185a09c5b672a7aa36bb': {
    name: 'solimander.eth',
    type: 'nounder',
    description: 'Nounder — solimander',
  },
  // ── Sub-DAOs & Forks ──
  '0x4b10701bfd7bfedc47d50562b76b436fbb5bdb3b': {
    name: 'Lil Nouns DAO',
    type: 'subdao',
    description: 'Lil Nouns — one Lil Noun every 15 minutes',
    url: 'https://lilnouns.wtf',
  },
  '0x880fb3cf5c6cc2d7dfc13a993e839a9411200c17': {
    name: 'Gnars DAO',
    type: 'subdao',
    description: 'Gnars — action sports DAO',
    url: 'https://gnars.wtf',
  },
  '0xfcb981feaac69b56ff89403ac669b2e1a64fdebb': {
    name: 'Nouns Fork #0',
    type: 'subdao',
    description: 'First Nouns Fork treasury',
  },
  '0x7559038535f3d6ed6bac5e54bd6dbe3d4e3fc052': {
    name: 'Nouns Fork #1',
    type: 'subdao',
    description: 'Second Nouns Fork treasury',
  },
  '0xd2a838b800b5f7cf4d4769bbf6e3730e1a113e27': {
    name: 'Purple DAO',
    type: 'subdao',
    description: 'Farcaster-aligned Nouns DAO',
    url: 'https://purple.construction',
  },
  '0xe93ff6c15c1a456225e1c642e2fea760f0b0d803': {
    name: 'Builder DAO',
    type: 'subdao',
    description: 'Nouns Builder sub-DAO',
  },
  // ── Infrastructure ──
  '0xf29ff96aaea6c9a1fba851f74737f3c069d4f1a9': {
    name: 'Protocol Guild',
    type: 'infra',
    description: 'Ethereum core dev funding',
    url: 'https://protocol-guild.readthedocs.io',
  },
  '0x65a3870f48b5237f27f674ec42ea1e017e111d63': {
    name: 'Prop House',
    type: 'infra',
    description: 'Permissionless funding rounds',
    url: 'https://prop.house',
  },
  '0x830bd73e4184cef73443c15111a1df14e495c706': {
    name: 'Gitcoin',
    type: 'infra',
    description: 'Gitcoin — public goods funding',
    url: 'https://gitcoin.co',
  },
  '0x44d97d22b3d37d837ce4b22773aad9d1566055d9': {
    name: 'Nouns Builder',
    type: 'infra',
    description: 'Deploy your own Nouns DAO',
    url: 'https://nouns.build',
  },
  '0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae': {
    name: 'Ethereum Foundation',
    type: 'infra',
    description: 'Ethereum Foundation',
  },
  // ── Culture ──
  '0x13ae6e44908e094d4de51d6580b3570ab3c1e360': {
    name: 'Nouns Movie (Atrium)',
    type: 'culture',
    description: 'Nouns: A Movie — feature film',
  },
  '0xa3557e3f89063e4bdc1aa4de85fcced4487a4e03': {
    name: 'Nounish Agency',
    type: 'culture',
    description: 'The agency for Nounish brands',
  },
  '0x281ec184e704ce57570d4d14cba258cf2a69e7b3': {
    name: 'Nouns Coffee',
    type: 'culture',
    description: 'Nouns-branded coffee experience',
  },
  '0x5b2f39f1135485f3f221454a264cd4f023b3e8cb': {
    name: 'SharkDAO',
    type: 'culture',
    description: 'Shark-themed Nouns community',
  },
  '0xd5f7818f553e1d1ef0c51e16a13df6691b3b1702': {
    name: 'Nouns Esports',
    type: 'culture',
    description: 'Competitive gaming team',
  },
  // ── Education ──
  '0x1a9c8182c09f50c8318d769245bea52c32be35bc': {
    name: 'Nouns Center',
    type: 'education',
    description: 'Community information hub',
  },
  '0x40de806b864b502aa5283a8d662e42684f76ce17': {
    name: 'Glasses for Kids',
    type: 'education',
    description: 'Real Noggles — glasses for children',
  },
};

// ─── ENS Resolution (background, non-blocking) ─────────────────────────
const ensNameCache = new Map<string, string | null>();

const FALLBACK_RPC = 'https://eth.llamarpc.com';

async function resolveOneEns(rpcUrl: string, addr: string): Promise<string | null> {
  try {
    const reverseName = addr.slice(2).toLowerCase() + '.addr.reverse';
    let encoded = '0x';
    for (const label of reverseName.split('.')) {
      encoded += label.length.toString(16).padStart(2, '0');
      for (let i = 0; i < label.length; i++) {
        encoded += label.charCodeAt(i).toString(16).padStart(2, '0');
      }
    }
    encoded += '00';
    const calldata =
      '0xec11c823' +
      '0000000000000000000000000000000000000000000000000000000000000020' +
      (encoded.length / 2 - 1).toString(16).padStart(64, '0') +
      encoded.slice(2).padEnd(Math.ceil((encoded.length - 2) / 64) * 64, '0');

    const doCall = async (url: string) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_call',
          params: [{ to: '0xce01f8eee7E0a9588E56A9b3b055b42eAf49D12a', data: calldata }, 'latest'],
          id: 1,
        }),
      });
      return (await res.json()) as { result?: string; error?: unknown };
    };

    let json = await doCall(rpcUrl);
    // Fallback to public RPC if primary fails
    if (json.error || !json.result || json.result === '0x') {
      json = await doCall(FALLBACK_RPC);
    }

    if (json.result && json.result !== '0x' && json.result.length > 130) {
      const hex = json.result.slice(2);
      const nameOffset = parseInt(hex.slice(0, 64), 16) * 2;
      const nameLen = parseInt(hex.slice(nameOffset, nameOffset + 64), 16);
      if (nameLen > 0 && nameLen < 100) {
        const nameHex = hex.slice(nameOffset + 64, nameOffset + 64 + nameLen * 2);
        const name = Buffer.from(nameHex, 'hex').toString('utf8');
        if (name && name.includes('.')) return name;
      }
    }
    return null;
  } catch (err) {
    console.error(`ENS resolution failed for ${addr}:`, err);
    return null;
  }
}

async function resolveEnsNames(addresses: string[]): Promise<void> {
  const rpcUrl = process.env.PONDER_RPC_URL_1;
  if (!rpcUrl) return;
  const toResolve = addresses.filter(a => !ensNameCache.has(a));
  // Process in batches of 20 with 300ms delay between batches
  for (let i = 0; i < toResolve.length; i += 20) {
    const batch = toResolve.slice(i, i + 20);
    await Promise.all(
      batch.map(async addr => {
        const name = await resolveOneEns(rpcUrl, addr);
        ensNameCache.set(addr, name);
      }),
    );
    if (i + 20 < toResolve.length) await new Promise(r => setTimeout(r, 300));
  }
}

function flowColor(netRatio: number): string {
  const t = (1 - netRatio) / 2;
  const r = Math.round(34 + (239 - 34) * t);
  const g = Math.round(197 + (68 - 197) * t);
  const b = Math.round(94 + (68 - 94) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// ─── Compute derived proposal status ─────────────────────────────────────
// Ponder only stores PENDING/ACTIVE/CANCELLED/VETOED/QUEUED/EXECUTED.
// We compute DEFEATED/EXPIRED/SUCCEEDED from vote counts + block data.
function computeDerivedStatus(
  p: {
    status: string;
    forVotes: number;
    againstVotes: number;
    quorumVotes: bigint;
    endBlock: bigint;
    objectionPeriodEndBlock: bigint | null;
    executionETA: bigint | null;
    onTimelockV1: boolean;
    startBlock: bigint;
  },
  latestBlock: bigint,
): string {
  // Terminal statuses are authoritative
  if (['CANCELLED', 'VETOED', 'EXECUTED'].includes(p.status)) return p.status;

  // QUEUED proposals may be EXPIRED (past grace period)
  if (p.status === 'QUEUED') {
    if (p.executionETA) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const gracePeriod = p.onTimelockV1 ? 14 * 86400 : 21 * 86400;
      if (nowSeconds >= Number(p.executionETA) + gracePeriod) return 'EXPIRED';
    }
    return 'QUEUED';
  }

  // ACTIVE/PENDING proposals past endBlock may be DEFEATED or SUCCEEDED
  if (p.status === 'ACTIVE' || p.status === 'PENDING') {
    const effectiveEnd =
      p.objectionPeriodEndBlock && p.objectionPeriodEndBlock > p.endBlock
        ? p.objectionPeriodEndBlock
        : p.endBlock;

    if (latestBlock > effectiveEnd) {
      const forVotes = BigInt(p.forVotes);
      if (forVotes <= BigInt(p.againstVotes) || forVotes < p.quorumVotes) {
        return 'DEFEATED';
      }
      return 'SUCCEEDED';
    }

    if (latestBlock <= p.startBlock) return 'PENDING';
    return 'ACTIVE';
  }

  return p.status;
}

// ─── Weighted composite node sizing ──────────────────────────────────────
// Noun-centric: nodes with more Nouns (held + delegated) are bigger
function computeNodeSize(
  totalIn: number,
  totalOut: number,
  votesCount: number,
  totalVotingWeight: number,
  proposalsCreated: number,
  connectionCount: number,
  nounsHeld: number,
  delegatedVotes: number,
): number {
  const ethScore = Math.log(1 + totalIn + totalOut);
  const voteScore = Math.log(1 + votesCount) * 0.5 + Math.log(1 + totalVotingWeight) * 0.5;
  const propScore = Math.log(1 + proposalsCreated * 10);
  const connScore = Math.log(1 + connectionCount);
  // Noun ownership is the primary sizing factor
  const nounScore = Math.log(1 + nounsHeld * 5 + delegatedVotes * 3);

  const composite =
    nounScore * 0.3 + ethScore * 0.25 + voteScore * 0.2 + propScore * 0.15 + connScore * 0.1;
  return Math.max(6, Math.min(55, 4 + composite * 3.8));
}

let treasuryFlowCache: { data: unknown; fetchedAt: number } | null = null;
const TREASURY_FLOW_CACHE_TTL = 30 * 60_000;

app.get('/api/treasury/flows', async c => {
  if (treasuryFlowCache && Date.now() - treasuryFlowCache.fetchedAt < TREASURY_FLOW_CACHE_TTL) {
    return c.json(treasuryFlowCache.data);
  }

  try {
    const allProposals = await db.select().from(schema.proposal);
    const allTransactions = await db.select().from(schema.transaction);
    const settledAuctions = await db.select().from(schema.auction);
    let allBids: unknown[] = [];
    try {
      allBids = await db.select().from(schema.bid);
    } catch {
      /* bid table may not exist yet */
    }
    let allVotes: { voter: string; proposalId: bigint; support: number; votes: number }[] = [];
    try {
      allVotes = (await db.select().from(schema.vote)) as typeof allVotes;
    } catch {
      /* vote table may not exist yet */
    }
    let allStreams: {
      payer: string;
      recipient: string;
      tokenAmount: bigint;
      tokenAddress: string;
      proposalId: bigint | null;
      status: string;
      streamAddress: string;
    }[] = [];
    try {
      allStreams = (await db.select().from(schema.stream)) as typeof allStreams;
    } catch {
      /* stream table may not exist yet */
    }

    // ── Derived proposal statuses ──────────────────────────────────────
    const latestBlock = allProposals.reduce((max, p) => {
      const b = Number(p.createdAtBlock);
      return b > max ? b : max;
    }, 0);
    const latestBlockBi = BigInt(latestBlock || 0);

    const derivedStatuses = allProposals.map(p => computeDerivedStatus(p, latestBlockBi));
    const propsPassed = derivedStatuses.filter(
      s => s === 'EXECUTED' || s === 'QUEUED' || s === 'SUCCEEDED',
    ).length;
    const propsFailed = derivedStatuses.filter(s => s === 'DEFEATED').length;
    const propsCancelled = derivedStatuses.filter(s => s === 'CANCELLED' || s === 'VETOED').length;
    const propsExpired = derivedStatuses.filter(s => s === 'EXPIRED').length;
    const nounsSettled = settledAuctions.filter(a => a.settled).length;
    const totalBids = allBids.length;

    // ── Vote stats per address ─────────────────────────────────────────
    const voteStats = new Map<string, { count: number; weight: number; proposals: Set<string> }>();
    for (const v of allVotes) {
      const addr = v.voter.toLowerCase();
      if (!voteStats.has(addr)) voteStats.set(addr, { count: 0, weight: 0, proposals: new Set() });
      const stats = voteStats.get(addr)!;
      stats.count++;
      stats.weight += v.votes;
      stats.proposals.add(String(v.proposalId));
    }
    const totalVotableProposals = allProposals.filter(p => p.status !== 'PENDING').length;

    // ── Proposer stats per address ─────────────────────────────────────
    const proposerStats = new Map<string, string[]>();
    for (const p of allProposals) {
      const addr = p.proposer.toLowerCase();
      if (!proposerStats.has(addr)) proposerStats.set(addr, []);
      proposerStats.get(addr)!.push(String(p.id));
    }

    // Build executed proposal ID set + proposer map
    const executedIds = new Set(
      allProposals
        .filter(p => p.status === 'EXECUTED' || p.status === 'QUEUED')
        .map(p => String(p.id)),
    );
    const proposalProposerMap = new Map<string, string>();
    for (const p of allProposals) {
      proposalProposerMap.set(String(p.id), p.proposer.toLowerCase());
    }

    // ── Aggregate flows per address ────────────────────────────────────
    const flows = new Map<
      string,
      { ethIn: number; ethOut: number; proposals: Set<string>; auctions: number }
    >();
    const getFlow = (addr: string) => {
      const k = addr.toLowerCase();
      if (!flows.has(k)) flows.set(k, { ethIn: 0, ethOut: 0, proposals: new Set(), auctions: 0 });
      return flows.get(k)!;
    };

    for (const tx of allTransactions) {
      if (!executedIds.has(String(tx.proposalId))) continue;
      const eth = Number(tx.value) / 1e18;
      if (eth <= 0) continue;
      const f = getFlow(tx.target);
      f.ethIn += eth;
      f.proposals.add(String(tx.proposalId));
    }

    for (const auc of settledAuctions) {
      if (!auc.winner || !auc.amount || !auc.settled) continue;
      const eth = Number(auc.amount) / 1e18;
      if (eth <= 0) continue;
      const f = getFlow(auc.winner);
      f.ethOut += eth;
      f.auctions++;
    }

    // ── Stream flows ───────────────────────────────────────────────────
    const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
    const streamLinks: {
      source: string;
      target: string;
      value: number;
      label: string;
      direction: string;
    }[] = [];
    for (const s of allStreams) {
      const payer = s.payer.toLowerCase();
      const recipient = s.recipient.toLowerCase();
      const isEth = s.tokenAddress.toLowerCase() === WETH;
      const amount = Number(s.tokenAmount) / 1e18;
      if (amount <= 0) continue;
      if (isEth) {
        getFlow(payer); // ensure node exists
        getFlow(recipient);
        const pf = getFlow(payer);
        pf.ethOut += amount;
        const rf = getFlow(recipient);
        rf.ethIn += amount;
      } else {
        getFlow(payer);
        getFlow(recipient);
      }
      const propLabel = s.proposalId ? ` (Prop #${s.proposalId})` : '';
      streamLinks.push({
        source: payer,
        target: recipient,
        value: isEth ? amount : 0.1,
        label: `Stream: ${amount.toFixed(1)} ${isEth ? 'WETH' : 'tokens'}${propLabel}`,
        direction: 'stream',
      });
    }

    // ── Proposer → recipient links ─────────────────────────────────────
    const proposerRecipientAgg = new Map<
      string,
      Map<string, { eth: number; proposals: Set<string> }>
    >();
    for (const prop of allProposals) {
      if (prop.status !== 'EXECUTED' && prop.status !== 'QUEUED') continue;
      const proposer = prop.proposer.toLowerCase();
      // Ensure proposer node exists (even with zero eth flow)
      getFlow(proposer);
      const propTxs = allTransactions.filter(tx => String(tx.proposalId) === String(prop.id));
      for (const tx of propTxs) {
        const eth = Number(tx.value) / 1e18;
        if (eth <= 0) continue;
        const target = tx.target.toLowerCase();
        if (target === proposer) continue; // skip self-funding
        if (!proposerRecipientAgg.has(proposer)) proposerRecipientAgg.set(proposer, new Map());
        const inner = proposerRecipientAgg.get(proposer)!;
        if (!inner.has(target)) inner.set(target, { eth: 0, proposals: new Set() });
        const entry = inner.get(target)!;
        entry.eth += eth;
        entry.proposals.add(String(prop.id));
      }
    }

    // ── Noun ownership data ────────────────────────────────────────────
    interface NounSeedData {
      background: number;
      body: number;
      accessory: number;
      head: number;
      glasses: number;
    }
    let allNouns: {
      id: bigint;
      owner: string;
      background: number;
      body: number;
      accessory: number;
      head: number;
      glasses: number;
      createdAt: number;
    }[] = [];
    try {
      allNouns = (await db.select().from(schema.noun)) as typeof allNouns;
    } catch {
      /* noun table may not exist yet */
    }
    const nounsByOwner = new Map<string, { id: string; seed: NounSeedData }[]>();
    for (const n of allNouns) {
      const owner = (n.owner as string).toLowerCase();
      if (!nounsByOwner.has(owner)) nounsByOwner.set(owner, []);
      nounsByOwner.get(owner)!.push({
        id: String(n.id),
        seed: {
          background: n.background,
          body: n.body,
          accessory: n.accessory,
          head: n.head,
          glasses: n.glasses,
        },
      });
    }

    // ── Delegation data ────────────────────────────────────────────────
    let allDelegates: { id: string; delegatedVotes: number }[] = [];
    try {
      allDelegates = (await db.select().from(schema.delegate)) as typeof allDelegates;
    } catch {
      /* delegate table may not exist yet */
    }
    const delegatedVotesMap = new Map<string, number>();
    for (const d of allDelegates) {
      delegatedVotesMap.set((d.id as string).toLowerCase(), d.delegatedVotes);
    }

    // ── Build graph nodes and links ────────────────────────────────────
    interface GNode {
      id: string;
      name: string;
      type: string;
      description: string;
      url?: string;
      totalIn: number;
      totalOut: number;
      netFlow: number;
      color: string;
      size: number;
      proposals: string[];
      auctionCount: number;
      votesCount: number;
      totalVotingWeight: number;
      proposalsCreated: number;
      proposalsCreatedIds: string[];
      participationRate: number;
      flowRole: number;
      outboundConnections: number;
      inboundConnections: number;
      ensName: string | null;
      ensAvatar: string | null;
      nounIds: string[];
      firstNounSeed: NounSeedData | null;
      delegatedVotes: number;
      fx?: number;
      fy?: number;
    }
    interface GLink {
      source: string;
      target: string;
      value: number;
      label: string;
      direction: string;
    }

    const nodes: GNode[] = [];
    const links: GLink[] = [];
    let totalInflow = 0,
      totalOutflow = 0;

    for (const [addr, f] of flows) {
      // Skip treasury addresses — they're merged into the virtual treasury node
      if (TREASURY_ADDRESSES.has(addr)) continue;
      const vol = f.ethIn + f.ethOut;
      const hasGovernance = voteStats.has(addr) || proposerStats.has(addr);
      // Include node if it has ETH flow OR governance activity
      if (vol < 0.01 && !hasGovernance) continue;
      totalInflow += f.ethOut;
      totalOutflow += f.ethIn;
      const net = f.ethOut - f.ethIn;
      const ratio = vol > 0 ? net / vol : 0;
      const known = KNOWN_ENTITIES[addr];
      const ensName = ensNameCache.get(addr) ?? null;
      const displayName = known?.name ?? (ensName || `${addr.slice(0, 6)}...${addr.slice(-4)}`);
      const vs = voteStats.get(addr);
      const ps = proposerStats.get(addr);
      const ownedNouns = nounsByOwner.get(addr) ?? [];

      // Auto-classify unknown addresses into smart categories
      let nodeType = known?.type ?? 'wallet';
      if (!known) {
        if ((ps?.length ?? 0) > 0 || f.proposals.size > 0) {
          nodeType = 'builder';
        } else if ((vs?.count ?? 0) > 10 && (vs?.weight ?? 0) > 50) {
          nodeType = 'delegate';
        } else if (f.auctions > 5 && (vs?.count ?? 0) === 0 && f.ethIn === 0) {
          nodeType = 'bidder';
        }
      }

      nodes.push({
        id: addr,
        name: displayName,
        type: nodeType,
        description: known?.description ?? '',
        url: known?.url,
        totalIn: Math.round(f.ethIn * 100) / 100,
        totalOut: Math.round(f.ethOut * 100) / 100,
        netFlow: Math.round(net * 100) / 100,
        color: flowColor(ratio),
        size: 10, // placeholder — recomputed after links are built
        proposals: Array.from(f.proposals),
        auctionCount: f.auctions,
        votesCount: vs?.count ?? 0,
        totalVotingWeight: vs?.weight ?? 0,
        proposalsCreated: ps?.length ?? 0,
        proposalsCreatedIds: ps ?? [],
        participationRate:
          totalVotableProposals > 0
            ? Math.round(((vs?.count ?? 0) / totalVotableProposals) * 10000) / 100
            : 0,
        flowRole: 0,
        outboundConnections: 0,
        inboundConnections: 0,
        ensName,
        ensAvatar: ensName ? `https://metadata.ens.domains/mainnet/avatar/${ensName}` : null,
        nounIds: ownedNouns.map(n => n.id),
        firstNounSeed: ownedNouns.length > 0 ? ownedNouns[0].seed : null,
        delegatedVotes: delegatedVotesMap.get(addr) ?? 0,
      });

      if (f.ethIn > 0) {
        const pLabels = Array.from(f.proposals)
          .slice(0, 5)
          .map(id => `#${id}`);
        links.push({
          source: 'treasury',
          target: addr,
          value: f.ethIn,
          label: pLabels.join(', ') || 'Funding',
          direction: 'out',
        });
      }
      if (f.ethOut > 0) {
        links.push({
          source: addr,
          target: 'treasury',
          value: f.ethOut,
          label: `${f.auctions} auction${f.auctions !== 1 ? 's' : ''}`,
          direction: 'in',
        });
      }
    }

    // ── Add proposer → recipient links ─────────────────────────────────
    const nodeIds = new Set(nodes.map(n => n.id));
    for (const [proposer, recipients] of proposerRecipientAgg) {
      if (!nodeIds.has(proposer)) continue;
      for (const [recipient, data] of recipients) {
        if (!nodeIds.has(recipient)) continue;
        links.push({
          source: proposer,
          target: recipient,
          value: data.eth,
          label: `Proposed: ${Array.from(data.proposals)
            .slice(0, 3)
            .map(id => `#${id}`)
            .join(', ')}`,
          direction: 'proposed',
        });
      }
    }

    // ── Add stream links ───────────────────────────────────────────────
    for (const sl of streamLinks) {
      if (nodeIds.has(sl.source) && nodeIds.has(sl.target)) {
        links.push(sl);
      }
    }

    // ── Compute connection counts + flow role ──────────────────────────
    const outboundPartners = new Map<string, Set<string>>();
    const inboundPartners = new Map<string, Set<string>>();
    for (const link of links) {
      const s = link.source;
      const t = link.target;
      if (!outboundPartners.has(s)) outboundPartners.set(s, new Set());
      if (!inboundPartners.has(t)) inboundPartners.set(t, new Set());
      outboundPartners.get(s)!.add(t);
      inboundPartners.get(t)!.add(s);
    }

    // ── Update node sizes + flow roles ─────────────────────────────────
    for (const node of nodes) {
      if (node.id === 'treasury') continue;
      const outCount = outboundPartners.get(node.id)?.size ?? 0;
      const inCount = inboundPartners.get(node.id)?.size ?? 0;
      const totalConns = outCount + inCount;
      node.outboundConnections = outCount;
      node.inboundConnections = inCount;
      node.flowRole = totalConns > 0 ? (outCount - inCount) / totalConns : 0;
      node.size = computeNodeSize(
        node.totalIn,
        node.totalOut,
        node.votesCount,
        node.totalVotingWeight,
        node.proposalsCreated,
        totalConns,
        node.nounIds.length,
        node.delegatedVotes,
      );
    }

    // Central treasury node
    nodes.unshift({
      id: 'treasury',
      name: 'Nouns Treasury',
      type: 'treasury',
      description: 'Nouns DAO Treasury (nouns.eth)',
      totalIn: Math.round(totalInflow),
      totalOut: Math.round(totalOutflow),
      netFlow: Math.round(totalInflow - totalOutflow),
      color: '#f59e0b',
      size: 60,
      proposals: [],
      auctionCount: 0,
      votesCount: 0,
      totalVotingWeight: 0,
      proposalsCreated: 0,
      proposalsCreatedIds: [],
      participationRate: 0,
      flowRole: 0,
      outboundConnections: 0,
      inboundConnections: 0,
      ensName: 'nouns.eth',
      ensAvatar: 'https://metadata.ens.domains/mainnet/avatar/nouns.eth',
      nounIds: [],
      firstNounSeed: null,
      delegatedVotes: 0,
      fx: 0,
      fy: 0,
    });

    nodes.sort((a, b) => {
      if (a.id === 'treasury') return -1;
      if (b.id === 'treasury') return 1;
      return b.totalIn + b.totalOut - (a.totalIn + a.totalOut);
    });

    // Resolve ENS names for ALL unknown addresses (awaited, batched)
    const unknownAddrs = nodes
      .filter(n => !KNOWN_ENTITIES[n.id] && !ensNameCache.has(n.id) && n.id !== 'treasury')
      .sort((a, b) => b.totalIn + b.totalOut - (a.totalIn + a.totalOut))
      .map(n => n.id);
    if (unknownAddrs.length > 0) {
      await resolveEnsNames(unknownAddrs);
      // Patch node names & avatar URLs with freshly resolved ENS
      for (const node of nodes) {
        const ens = ensNameCache.get(node.id);
        if (ens && !KNOWN_ENTITIES[node.id]) {
          node.name = ens;
          node.ensName = ens;
          node.ensAvatar = `https://metadata.ens.domains/mainnet/avatar/${ens}`;
        }
      }
    }

    // ── Timeline events for time slider ──────────────────────────────
    interface TimelineEvent {
      t: number; // unix timestamp (seconds)
      type: string; // 'auction' | 'funding' | 'stream' | 'noun_mint'
      from: string;
      to: string;
      value: number; // ETH
      nounId?: string;
      proposalId?: string;
    }
    const timeline: TimelineEvent[] = [];

    // Auction settlements → value from bidder to treasury
    for (const auc of settledAuctions) {
      if (!auc.winner || !auc.amount || !auc.settled) continue;
      const winner = (auc.winner as string).toLowerCase();
      if (TREASURY_ADDRESSES.has(winner)) continue;
      timeline.push({
        t: Number(auc.endTime),
        type: 'auction',
        from: winner,
        to: 'treasury',
        value: Number(auc.amount) / 1e18,
        nounId: String(auc.nounId),
      });
    }

    // Proposal funding → value from treasury to recipients
    for (const prop of allProposals) {
      if (prop.status !== 'EXECUTED' && prop.status !== 'QUEUED') continue;
      const propTxs = allTransactions.filter(tx => String(tx.proposalId) === String(prop.id));
      for (const tx of propTxs) {
        const eth = Number(tx.value) / 1e18;
        if (eth <= 0) continue;
        const target = (tx.target as string).toLowerCase();
        if (TREASURY_ADDRESSES.has(target)) continue;
        timeline.push({
          t: Number(prop.createdAt),
          type: 'funding',
          from: 'treasury',
          to: target,
          value: eth,
          proposalId: String(prop.id),
        });
      }
    }

    // Stream creations
    for (const s of allStreams) {
      const payer = (s.payer as string).toLowerCase();
      const recipient = (s.recipient as string).toLowerCase();
      const isEth = (s.tokenAddress as string).toLowerCase() === WETH;
      const amount = Number(s.tokenAmount) / 1e18;
      if (amount <= 0) continue;
      timeline.push({
        t: Number(s.createdAt),
        type: 'stream',
        from: TREASURY_ADDRESSES.has(payer) ? 'treasury' : payer,
        to: TREASURY_ADDRESSES.has(recipient) ? 'treasury' : recipient,
        value: isEth ? amount : 0,
      });
    }

    // Noun mints (for provenance tracking)
    for (const n of allNouns) {
      timeline.push({
        t: Number(n.createdAt),
        type: 'noun_mint',
        from: 'treasury',
        to: (n.owner as string).toLowerCase(),
        value: 0,
        nounId: String(n.id),
      });
    }

    timeline.sort((a, b) => a.t - b.t);

    const result = {
      nodes,
      links,
      timeline,
      stats: {
        totalInflow: Math.round(totalInflow),
        totalOutflow: Math.round(totalOutflow),
        uniqueAddresses: nodes.length - 1,
        totalTransactions: links.length,
        nounsSettled,
        totalBids,
        propsPassed,
        propsFailed,
        propsCancelled,
        propsExpired,
        totalVotes: allVotes.length,
        uniqueVoters: new Set(allVotes.map(v => v.voter.toLowerCase())).size,
        totalStreams: allStreams.length,
        activeStreams: allStreams.filter(s => s.status === 'active').length,
      },
    };

    treasuryFlowCache = { data: result, fetchedAt: Date.now() };
    return c.json(result);
  } catch (err) {
    console.error('Treasury flows error:', err);
    return c.json(
      { error: 'Failed to compute treasury flows', nodes: [], links: [], stats: {} },
      500,
    );
  }
});

// ============================================================
// Agent NounIRL — API Endpoints
// ============================================================

// ── Agent Predict (fast — no auth, no Claude, ~1ms) ─────────────────────
// Restored from c808c43c8: accepts `?dao=v2` to recompute the seed via the
// V2 slobber-rule predictor against the same cached blockHash/nextNounId.
// No-arg behaviour is unchanged (returns V1 prediction).
app.get('/api/agent/predict', c => {
  const w = getWatcherState();
  const dao = c.req.query('dao') === 'v2' ? 'v2' : 'v1';

  let seed = w.lastPredictedSeed;
  let traits = w.lastPredictedTraits;

  if (dao === 'v2' && w.lastBlockHash != null && w.nextNounId > 0) {
    seed = predictSeed(w.lastBlockHash, w.nextNounId, { dao: 'v2' });
    traits = seedToTraitNames(seed);
  }

  return c.json({
    block: w.lastBlockNumber,
    nextNounId: w.nextNounId,
    seed,
    traits,
    auctionEnd: w.auctionEndTime,
    auctionEnded: w.auctionEndTime > 0 && Math.floor(Date.now() / 1000) >= w.auctionEndTime,
    running: w.running,
    checkedAt: w.lastCheckedAt,
    dao,
  });
});

// ── Agent Status ────────────────────────────────────────────────────────
app.get('/api/agent/status', async c => {
  const watcherState = getWatcherState();
  const stats = reservationStore.stats();
  let balance = 0;
  try {
    balance = await getAgentBalance();
  } catch {
    /* ok */
  }

  return c.json({
    agent: 'NounIRL',
    wallet: process.env.NOUNIRL_ADDRESS || 'not configured',
    running: watcherState.running,
    transport: watcherState.transportMode,
    lastBlock: watcherState.lastBlockNumber,
    nextNounId: watcherState.nextNounId,
    auctionEndTime: watcherState.auctionEndTime,
    predictedSeed: watcherState.lastPredictedSeed,
    predictedTraits: watcherState.lastPredictedTraits,
    lastCheckedAt: watcherState.lastCheckedAt,
    totalBlocksChecked: watcherState.totalBlocksChecked,
    errors: watcherState.errors.slice(-5),
    balanceEth: Math.round(balance * 10000) / 10000,
    reservations: stats,
    canDeploy: canDeploy(),
    bridge: isBridgeConfigured() ? 'connected' : 'not configured',
  });
});

// ── Create Reservation ──────────────────────────────────────────────────
app.post('/api/agent/reserve', async c => {
  try {
    const body = await c.req.json();
    const { wallet, txHash, chainId, traits, settleFor } = body as {
      wallet: string;
      txHash: string;
      chainId: number;
      traits: string[];
      settleFor?: string;
    };

    // Validate inputs
    if (
      !wallet ||
      !txHash ||
      !chainId ||
      !traits ||
      !Array.isArray(traits) ||
      traits.length === 0
    ) {
      return c.json({ error: 'Missing required fields: wallet, txHash, chainId, traits[]' }, 400);
    }

    // Check if tx already used
    if (reservationStore.isTxUsed(txHash)) {
      return c.json({ error: 'This transaction has already been used for a reservation' }, 409);
    }

    // Create reservation (pending verification)
    const reservation = reservationStore.create({
      wallet,
      tipTxHash: txHash,
      tipChainId: chainId,
      tipAmountEth: 0, // will be updated after verification
      traits,
      settleFor,
    });

    // Verify tip asynchronously (don't block the response)
    verifyTip(txHash, chainId)
      .then(result => {
        if (result.valid) {
          // Update amount and activate
          const r = reservationStore.get(reservation.id);
          if (r) {
            r.tipAmountEth = result.amountEth || 0;
            reservationStore.activate(reservation.id);
            console.log(
              `[NounIRL] ✅ Reservation ${reservation.id} verified and activated — ${result.amountEth} ETH from ${result.chainName}`,
            );
          }
        } else {
          console.log(
            `[NounIRL] ❌ Tip verification failed for ${reservation.id}: ${result.error}`,
          );
          reservationStore.cancel(reservation.id);
        }
      })
      .catch(err => {
        console.error(`[NounIRL] Tip verification error for ${reservation.id}:`, err);
      });

    return c.json({
      reservation: {
        id: reservation.id,
        status: reservation.status,
        traits: reservation.traits,
        message: 'Reservation created — verifying tip transaction...',
      },
    });
  } catch (err) {
    console.error('[NounIRL] Reserve error:', err);
    return c.json({ error: 'Failed to create reservation' }, 500);
  }
});

// ── List Reservations ───────────────────────────────────────────────────
app.get('/api/agent/reservations', c => {
  const wallet = c.req.query('wallet');
  const reservations = wallet ? reservationStore.getByWallet(wallet) : reservationStore.getAll();

  return c.json({ reservations });
});

// ── Cancel Reservation ──────────────────────────────────────────────────
app.post('/api/agent/cancel/:id', c => {
  const id = c.req.param('id');
  const reservation = reservationStore.get(id);

  if (!reservation) {
    return c.json({ error: 'Reservation not found' }, 404);
  }

  reservationStore.cancel(id);
  return c.json({ success: true, message: 'Reservation cancelled' });
});

// ── Manual Check ────────────────────────────────────────────────────────
app.post('/api/agent/check', async c => {
  try {
    const result = await checkNow();
    return c.json(result);
  } catch (err) {
    console.error('[NounIRL] Manual check error:', err);
    return c.json({ error: 'Check failed' }, 500);
  }
});

// ── Trait Info ───────────────────────────────────────────────────────────
app.get('/api/agent/traits/:category', c => {
  const category = c.req.param('category') as
    | 'background'
    | 'body'
    | 'accessory'
    | 'head'
    | 'glasses';
  const validCategories = ['background', 'body', 'accessory', 'head', 'glasses'];

  if (!validCategories.includes(category)) {
    return c.json({ error: `Invalid category. Valid: ${validCategories.join(', ')}` }, 400);
  }

  const names = getAllTraitNames(category);
  return c.json({ category, count: names.length, traits: names });
});

// ── Parse Natural Language Traits ───────────────────────────────────────
app.post('/api/agent/parse-traits', async c => {
  try {
    const body = await c.req.json();
    const { description } = body as { description: string };
    if (!description) return c.json({ error: 'description is required' }, 400);

    const parsed = parseTraitDescription(description);
    return c.json({ description, parsed });
  } catch {
    return c.json({ error: 'Failed to parse traits' }, 500);
  }
});

// ── Manual Settlement (crystal ball twin-snipe) ────────────────────────
app.post('/api/agent/settle', async c => {
  const w = getWatcherState();
  if (!w.running) {
    return c.json({ error: 'Watcher not running' }, 503);
  }
  if (!w.auctionEndTime || Date.now() / 1000 < w.auctionEndTime) {
    return c.json({ error: 'Auction not ended yet' }, 400);
  }
  try {
    const result = await settleAuction();
    if (!result) {
      return c.json({ error: 'Settlement failed — wallet not configured or tx error' }, 500);
    }
    return c.json({ txHash: result.txHash });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// ── Settlement History ──────────────────────────────────────────────────
app.get('/api/agent/settlements', c => {
  const limit = Number(c.req.query('limit') || 20);
  const settlements = reservationStore.getSettlements(limit);
  return c.json({ settlements });
});

// ── Deploy History ──────────────────────────────────────────────────────
app.get('/api/agent/deploys', c => {
  const limit = Number(c.req.query('limit') || 20);
  const deploys = getDeployHistory(limit);
  return c.json({ deploys, canDeploy: canDeploy() });
});

// ── Trigger Deploy (manual, Noun-gated) ─────────────────────────────────
app.post('/api/agent/deploy', async c => {
  try {
    const body = await c.req.json();
    const {
      description,
      reason,
      wallet: deployWallet,
    } = body as { description: string; reason?: string; wallet?: string };
    if (!description) return c.json({ error: 'description is required' }, 400);

    // Noun-gated: require connected wallet with 4+ Nouns
    if (!deployWallet) {
      return c.json(
        { error: `Deploy requires a connected wallet holding ≥ ${MIN_NOUNS_FOR_DEPLOY} Nouns.` },
        403,
      );
    }
    const nounBalance = await getNounBalance(deployWallet);
    if (nounBalance < MIN_NOUNS_FOR_DEPLOY) {
      return c.json(
        { error: `Deploy requires ≥ ${MIN_NOUNS_FOR_DEPLOY} Nouns. Wallet holds ${nounBalance}.` },
        403,
      );
    }

    if (!canDeploy()) {
      return c.json({ error: 'Rate limited — max 1 deploy per hour' }, 429);
    }

    console.log(`[NounIRL] Deploy authorized by ${deployWallet} (${nounBalance} Nouns)`);

    // Generate patches via Claude
    const patches = await generatePatch(description);

    // Apply and deploy
    const result = await applyAndDeploy(
      patches,
      description,
      reason ||
        `manual deploy via API (authorized by ${deployWallet.slice(0, 6)}...${deployWallet.slice(-4)}, ${nounBalance} Nouns)`,
      'terminal',
    );

    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Deploy failed';
    return c.json({ error: msg }, 500);
  }
});

// ── Knowledge Ingestion ──────────────────────────────────────────────────
app.post('/api/agent/learn', async c => {
  try {
    const body = await c.req.json();
    const { urls } = body as { urls?: string[] };

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return c.json({ error: 'urls array is required' }, 400);
    }

    if (urls.length > 20) {
      return c.json({ error: 'Max 20 URLs per batch' }, 400);
    }

    // Validate all URLs
    for (const url of urls) {
      try {
        new URL(url);
      } catch {
        return c.json({ error: `Invalid URL: ${url}` }, 400);
      }
    }

    const results = await batchLearn(urls);
    const totalFacts = results.reduce((sum, r) => sum + r.factsLearned, 0);

    return c.json({
      success: true,
      totalFacts,
      results,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Learning failed';
    return c.json({ error: msg }, 500);
  }
});

app.get('/api/agent/knowledge', async c => {
  try {
    const stats = await getKnowledgeStats();
    return c.json(stats);
  } catch {
    return c.json({ totalFacts: 0, sources: [] });
  }
});

// ─── Self-Learning: Read our own Ponder data ─────────────────────────────────

app.post('/api/agent/self-learn', async c => {
  try {
    // This is a long-running operation — run it in background and return immediately
    const startTime = Date.now();

    // Kick off the pipeline (non-blocking)
    runSelfLearn()
      .then(result => {
        console.log(
          `[SelfLearn] Pipeline finished in ${((Date.now() - startTime) / 1000).toFixed(0)}s:`,
          JSON.stringify(result),
        );
      })
      .catch(err => {
        console.error('[SelfLearn] Pipeline failed:', err);
      });

    return c.json({
      success: true,
      message:
        'Self-learning pipeline started. Processing proposals, auctions, and delegates from noun.wtf Ponder index. This takes a few minutes.',
      startedAt: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// ─── People Database ─────────────────────────────────────────────────────────

app.get('/api/agent/people', async c => {
  try {
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);
    const sort = c.req.query('sort') || 'votes';
    const tag = c.req.query('tag') || undefined;

    const result = await listPeople({ limit, offset, sort, tag });
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

app.get('/api/agent/people/search', async c => {
  try {
    const q = c.req.query('q');
    if (!q) return c.json({ error: 'Missing ?q= parameter' }, 400);
    const limit = parseInt(c.req.query('limit') || '20', 10);
    const results = await searchPeople(q, limit);
    return c.json({ results, count: results.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

app.get('/api/agent/people/stats', async c => {
  try {
    const count = await getPeopleCount();
    const status = getBuildStatus();
    return c.json({ count, build: status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

app.get('/api/agent/people/:address', async c => {
  try {
    const address = c.req.param('address');
    const person = await getPerson(address);
    if (!person) return c.json({ error: 'Person not found' }, 404);
    return c.json(person);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

app.post('/api/agent/people/build', async c => {
  try {
    const status = getBuildStatus();
    if (status.running) {
      return c.json(
        {
          success: false,
          message: 'Build already in progress',
          progress: status.progress,
        },
        409,
      );
    }

    const startTime = Date.now();

    // Kick off in background (non-blocking)
    buildPeopleDb()
      .then(result => {
        console.log(
          `[PeopleDb] Build finished in ${((Date.now() - startTime) / 1000).toFixed(0)}s:`,
          JSON.stringify(result),
        );
      })
      .catch(err => {
        console.error('[PeopleDb] Build failed:', err);
      });

    return c.json({
      success: true,
      message:
        'People database build started. This crawls all proposals, votes, auctions, bids, delegates, and streams, resolves ENS, and generates summaries. May take 10-30 minutes.',
      startedAt: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// ─── Activity Feed ──────────────────────────────────────────────────────────

interface ActivityEvent {
  type: string;
  blockNumber: number;
  timestamp: string;
  txHash: string;
  data: Record<string, unknown>;
}

function tsToISO(ts: unknown): string {
  if (ts instanceof Date) {
    // Drizzle may construct Date from Unix seconds (interpreted as ms) — detect and fix
    const ms = ts.getTime();
    if (ms < 946684800000) return new Date(ms * 1000).toISOString(); // before year 2000 = was seconds
    return ts.toISOString();
  }
  const n = Number(ts);
  if (Number.isNaN(n)) return new Date().toISOString();
  return new Date(n < 1e12 ? n * 1000 : n).toISOString();
}

let activityFeedCache: { data: unknown; fetchedAt: number; key: string } | null = null;
const ACTIVITY_FEED_TTL = 30_000;

app.get('/api/activity', async c => {
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
  const beforeParam = c.req.query('before');
  const before = beforeParam ? BigInt(beforeParam) : undefined;
  const typeFilter =
    c.req
      .query('type')
      ?.split(',')
      .map(t => t.trim().toUpperCase()) || [];

  const cacheKey = `${limit}:${before ?? 'latest'}:${typeFilter.join(',')}`;
  if (
    activityFeedCache?.key === cacheKey &&
    Date.now() - activityFeedCache.fetchedAt < ACTIVITY_FEED_TTL
  ) {
    return c.json(activityFeedCache.data);
  }

  try {
    const events: ActivityEvent[] = [];
    const perTable = limit + 10;
    const want = (t: string) => !typeFilter.length || typeFilter.includes(t);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function fetchRows(tbl: any, blockCol: any): Promise<any[]> {
      try {
        if (before) {
          return await db
            .select()
            .from(tbl)
            .where(lt(blockCol, before))
            .orderBy(desc(blockCol))
            .limit(perTable);
        }
        return await db.select().from(tbl).orderBy(desc(blockCol)).limit(perTable);
      } catch {
        return [];
      }
    }

    const wantDelegation = want('DELEGATION');
    const wantTransfer = want('TRANSFER');
    const wantPropStatus =
      want('PROPOSAL_QUEUED') ||
      want('PROPOSAL_EXECUTED') ||
      want('PROPOSAL_CANCELLED') ||
      want('PROPOSAL_VETOED');
    const wantGrant =
      want('GRANT_CREATED') ||
      want('GRANT_VOTE') ||
      want('GRANT_QUEUED') ||
      want('GRANT_EXECUTED') ||
      want('GRANT_CANCELED');
    const wantLil =
      want('LIL_BID') ||
      want('LIL_AUCTION_SETTLED') ||
      want('LIL_NOUN_CREATED') ||
      want('LIL_VOTE') ||
      want('LIL_PROPOSAL_CREATED') ||
      want('LIL_TRANSFER');
    const wantSale = want('SALE');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function fetchCanceledCandidates(): Promise<any[]> {
      try {
        const cond = before
          ? and(
              isNotNull(schema.candidate.canceledAtBlock),
              lt(schema.candidate.canceledAtBlock, before),
            )
          : isNotNull(schema.candidate.canceledAtBlock);
        return await db
          .select()
          .from(schema.candidate)
          .where(cond)
          .orderBy(desc(schema.candidate.canceledAtBlock))
          .limit(perTable);
      } catch {
        return [];
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function fetchPromotedCandidates(): Promise<any[]> {
      try {
        const cond = before
          ? and(
              isNotNull(schema.candidate.promotedAtBlock),
              lt(schema.candidate.promotedAtBlock, before),
            )
          : isNotNull(schema.candidate.promotedAtBlock);
        return await db
          .select()
          .from(schema.candidate)
          .where(cond)
          .orderBy(desc(schema.candidate.promotedAtBlock))
          .limit(perTable);
      } catch {
        return [];
      }
    }

    const [
      bids,
      votes,
      proposals,
      auctions,
      nouns,
      candidates,
      candSigs,
      propFB,
      candFB,
      candVersions,
      canceledCands,
      promotedCands,
      streams,
      delegations,
      transfers,
      statusChanges,
      grants,
      grantVotes,
      grantStatusChanges,
      lilEvents,
      saleEvents,
    ] = await Promise.all([
      want('BID') ? fetchRows(schema.bid, schema.bid.createdAtBlock) : [],
      want('VOTE') ? fetchRows(schema.vote, schema.vote.createdAtBlock) : [],
      want('PROPOSAL_CREATED') ? fetchRows(schema.proposal, schema.proposal.createdAtBlock) : [],
      want('AUCTION_SETTLED') ? fetchRows(schema.auction, schema.auction.createdAtBlock) : [],
      want('NOUN_CREATED') ? fetchRows(schema.noun, schema.noun.createdAtBlock) : [],
      want('CANDIDATE_CREATED') ? fetchRows(schema.candidate, schema.candidate.createdAtBlock) : [],
      want('CANDIDATE_SPONSORED')
        ? fetchRows(schema.candidateSignature, schema.candidateSignature.createdAtBlock)
        : [],
      want('PROPOSAL_FEEDBACK')
        ? fetchRows(schema.proposalFeedback, schema.proposalFeedback.createdAtBlock)
        : [],
      want('CANDIDATE_FEEDBACK')
        ? fetchRows(schema.candidateFeedback, schema.candidateFeedback.createdAtBlock)
        : [],
      want('CANDIDATE_UPDATED')
        ? fetchRows(schema.candidateVersion, schema.candidateVersion.blockNumber)
        : [],
      want('CANDIDATE_CANCELED') ? fetchCanceledCandidates() : [],
      want('CANDIDATE_PROMOTED') ? fetchPromotedCandidates() : [],
      want('STREAM_CREATED') ? fetchRows(schema.stream, schema.stream.createdAtBlock) : [],
      wantDelegation
        ? fetchRows(schema.delegationEvent, schema.delegationEvent.createdAtBlock)
        : [],
      wantTransfer ? fetchRows(schema.nounTransfer, schema.nounTransfer.createdAtBlock) : [],
      wantPropStatus
        ? fetchRows(schema.proposalStatusChange, schema.proposalStatusChange.createdAtBlock)
        : [],
      wantGrant ? fetchRows(schema.grant, schema.grant.createdAtBlock) : [],
      wantGrant ? fetchRows(schema.grantVote, schema.grantVote.createdAtBlock) : [],
      wantGrant ? fetchRows(schema.grantStatusChange, schema.grantStatusChange.createdAtBlock) : [],
      wantLil
        ? fetchLilNounsActivity(before, limit).catch(err => {
            console.warn('[activity] lil fetch failed:', err);
            return [] as FeedEvent[];
          })
        : Promise.resolve([] as FeedEvent[]),
      wantSale
        ? fetchOnchainSales(before, limit).catch(err => {
            console.warn('[activity] sales fetch failed:', err);
            return [] as FeedEvent[];
          })
        : Promise.resolve([] as FeedEvent[]),
    ]);

    // Normalize BIDs
    for (const b of bids) {
      events.push({
        type: 'BID',
        blockNumber: Number(b.createdAtBlock),
        timestamp: tsToISO(b.createdAt),
        txHash: b.createdAtTransaction || '',
        data: {
          nounId: Number(b.nounId),
          value: String(b.value),
          bidder: b.bidder,
          clientId: b.clientId,
        },
      });
    }

    // Normalize VOTEs
    for (const v of votes) {
      events.push({
        type: 'VOTE',
        blockNumber: Number(v.createdAtBlock),
        timestamp: tsToISO(v.createdAt),
        txHash: v.createdAtTransaction || '',
        data: {
          voter: v.voter,
          proposalId: Number(v.proposalId),
          support: v.support,
          votes: v.votes,
          reason: v.reason || '',
          clientId: v.clientId,
        },
      });
    }

    // Normalize PROPOSAL_CREATED
    for (const p of proposals) {
      const descText = (p.description || '') as string;
      const title = (descText.split('\n')[0] || '').replace(/^#\s*/, '').slice(0, 120);
      // Extract first image URL from markdown or HTML
      const imgMatch = descText.match(
        /!\[.*?]\((https?:\/\/[^)]+)\)|<img[^>]+src=["'](https?:\/\/[^"']+)["']/,
      );
      const imageUrl = imgMatch?.[1] || imgMatch?.[2] || null;
      events.push({
        type: 'PROPOSAL_CREATED',
        blockNumber: Number(p.createdAtBlock),
        timestamp: tsToISO(p.createdAt),
        txHash: p.createdAtTransaction || '',
        data: {
          proposalId: Number(p.id),
          proposer: p.proposer,
          title,
          status: p.status,
          description: descText.slice(0, 4000),
          imageUrl,
          clientId: p.clientId,
        },
      });
    }

    // Normalize AUCTION_SETTLED
    for (const a of auctions) {
      if (!a.settled) continue;
      events.push({
        type: 'AUCTION_SETTLED',
        blockNumber: Number(a.createdAtBlock),
        timestamp: tsToISO(a.createdAt),
        txHash: a.createdAtTransaction || '',
        data: {
          nounId: Number(a.nounId),
          winner: a.winner || '',
          amount: String(a.amount || '0'),
          clientId: a.clientId,
        },
      });
    }

    // Normalize NOUN_CREATED
    for (const n of nouns) {
      events.push({
        type: 'NOUN_CREATED',
        blockNumber: Number(n.createdAtBlock),
        timestamp: tsToISO(n.createdAt),
        txHash: n.createdAtTransaction || '',
        data: {
          nounId: Number(n.id),
          owner: n.owner,
          head: n.head,
          body: n.body,
          accessory: n.accessory,
          glasses: n.glasses,
          background: n.background,
        },
      });
    }

    // Normalize CANDIDATE_CREATED
    for (const cd of candidates) {
      const descText = (cd.description || '') as string;
      const title = (descText.split('\n')[0] || '').replace(/^#\s*/, '').slice(0, 120);
      const imgMatch = descText.match(
        /!\[.*?]\((https?:\/\/[^)]+)\)|<img[^>]+src=["'](https?:\/\/[^"']+)["']/,
      );
      const imageUrl = imgMatch?.[1] || imgMatch?.[2] || null;
      events.push({
        type: 'CANDIDATE_CREATED',
        blockNumber: Number(cd.createdAtBlock),
        timestamp: tsToISO(cd.createdAt),
        txHash: cd.createdAtTransaction || '',
        data: {
          candidateId: cd.id,
          slug: cd.slug,
          proposer: cd.proposer,
          title,
          description: descText.slice(0, 4000),
          imageUrl,
          canceled: cd.canceled,
        },
      });
    }

    // Normalize CANDIDATE_SPONSORED
    for (const cs of candSigs) {
      if (cs.canceled) continue;
      events.push({
        type: 'CANDIDATE_SPONSORED',
        blockNumber: Number(cs.createdAtBlock),
        timestamp: tsToISO(cs.createdAt),
        txHash: '',
        data: { signer: cs.signer, candidateId: cs.candidateId, reason: cs.reason || '' },
      });
    }

    // Normalize PROPOSAL_FEEDBACK
    for (const pf of propFB) {
      events.push({
        type: 'PROPOSAL_FEEDBACK',
        blockNumber: Number(pf.createdAtBlock),
        timestamp: tsToISO(pf.createdAt),
        txHash: '',
        data: {
          voter: pf.voter,
          proposalId: Number(pf.proposalId),
          support: pf.support,
          reason: pf.reason || '',
        },
      });
    }

    // Normalize CANDIDATE_FEEDBACK
    for (const cf of candFB) {
      events.push({
        type: 'CANDIDATE_FEEDBACK',
        blockNumber: Number(cf.createdAtBlock),
        timestamp: tsToISO(cf.createdAt),
        txHash: '',
        data: {
          voter: cf.voter,
          candidateId: cf.candidateId,
          support: cf.support,
          reason: cf.reason || '',
        },
      });
    }

    // Normalize CANDIDATE_UPDATED (one per update event — initial create is not in candidateVersion)
    for (const cv of candVersions) {
      const descText = (cv.description || '') as string;
      const title = (descText.split('\n')[0] || '').replace(/^#\s*/, '').slice(0, 120);
      const parts = (cv.candidateId as string).split('-');
      const proposer = parts[0] || '';
      const slug = parts.slice(1).join('-');
      events.push({
        type: 'CANDIDATE_UPDATED',
        blockNumber: Number(cv.blockNumber),
        timestamp: tsToISO(cv.blockTimestamp),
        txHash: cv.txHash || '',
        data: {
          candidateId: cv.candidateId,
          slug,
          proposer,
          title,
          description: descText.slice(0, 4000),
          reason: cv.reason || '',
        },
      });
    }

    // Normalize CANDIDATE_CANCELED (keyed on canceledAtBlock so each cancel is an independent event)
    for (const cd of canceledCands) {
      if (cd.canceledAtBlock == null) continue;
      const descText = (cd.description || '') as string;
      const title = (descText.split('\n')[0] || '').replace(/^#\s*/, '').slice(0, 120);
      events.push({
        type: 'CANDIDATE_CANCELED',
        blockNumber: Number(cd.canceledAtBlock),
        timestamp: tsToISO(cd.canceledAtTimestamp ?? cd.lastUpdatedAt ?? cd.createdAt),
        txHash: cd.canceledAtTx || '',
        data: {
          candidateId: cd.id,
          slug: cd.slug,
          proposer: cd.proposer,
          title,
        },
      });
    }

    // Normalize CANDIDATE_PROMOTED (keyed on promotedAtBlock)
    for (const cd of promotedCands) {
      if (cd.promotedAtBlock == null) continue;
      const descText = (cd.description || '') as string;
      const title = (descText.split('\n')[0] || '').replace(/^#\s*/, '').slice(0, 120);
      events.push({
        type: 'CANDIDATE_PROMOTED',
        blockNumber: Number(cd.promotedAtBlock),
        timestamp: tsToISO(cd.promotedAtTimestamp ?? cd.lastUpdatedAt ?? cd.createdAt),
        txHash: cd.promotedAtTx || '',
        data: {
          candidateId: cd.id,
          slug: cd.slug,
          proposer: cd.proposer,
          title,
          proposalId: cd.promotedToProposalId != null ? Number(cd.promotedToProposalId) : null,
        },
      });
    }

    // Normalize STREAM_CREATED
    for (const s of streams) {
      events.push({
        type: 'STREAM_CREATED',
        blockNumber: Number(s.createdAtBlock),
        timestamp: tsToISO(s.createdAt),
        txHash: s.createdAtTransaction || '',
        data: {
          streamAddress: s.streamAddress,
          recipient: s.recipient,
          tokenAmount: String(s.tokenAmount),
          tokenAddress: s.tokenAddress || '',
          proposalId: s.proposalId ? Number(s.proposalId) : null,
          status: s.status,
        },
      });
    }

    // Normalize DELEGATION
    for (const d of delegations) {
      events.push({
        type: 'DELEGATION',
        blockNumber: Number(d.createdAtBlock),
        timestamp: tsToISO(d.createdAt),
        txHash: d.createdAtTransaction || '',
        data: { delegator: d.delegator, fromDelegate: d.fromDelegate, toDelegate: d.toDelegate },
      });
    }

    // Normalize TRANSFER — enrich with on-chain sale detection. If the transfer's
    // tx targeted a known marketplace router (Seaport, Blur, etc.), convert it to
    // a SALE event with the extracted price. Tracks claimed txHashes to dedupe the
    // standalone SALE pass below.
    const claimedSaleTxs = new Set<string>();

    // Batch-check unique tx hashes for marketplace interactions
    const ZERO = '0x0000000000000000000000000000000000000000';
    const transferTxHashes = [
      ...new Set(
        transfers
          .filter(
            t =>
              t.from.toLowerCase() !== ZERO &&
              t.to.toLowerCase() !== ZERO &&
              t.createdAtTransaction,
          )
          .map(t => t.createdAtTransaction),
      ),
    ];
    const saleChecks = await Promise.all(
      transferTxHashes.slice(0, 30).map(async txHash => ({
        txHash,
        sale: await checkTxForSale(txHash),
      })),
    );
    const transferSaleMap = new Map(saleChecks.filter(s => s.sale).map(s => [s.txHash, s.sale!]));

    // Count nouns per sale tx to split bulk/sweep prices evenly
    const nounsPerSaleTx = new Map<string, number>();
    for (const t of transfers) {
      if (transferSaleMap.has(t.createdAtTransaction)) {
        nounsPerSaleTx.set(
          t.createdAtTransaction,
          (nounsPerSaleTx.get(t.createdAtTransaction) || 0) + 1,
        );
      }
    }

    for (const t of transfers) {
      const sale = transferSaleMap.get(t.createdAtTransaction);
      if (sale) {
        claimedSaleTxs.add(t.createdAtTransaction.toLowerCase());
        const count = nounsPerSaleTx.get(t.createdAtTransaction) || 1;
        const priceEth = Number(sale.priceWei) / 1e18 / count;
        events.push({
          type: 'SALE',
          blockNumber: Number(t.createdAtBlock),
          timestamp: tsToISO(t.createdAt),
          txHash: t.createdAtTransaction || '',
          data: {
            collection: 'NOUN',
            collectionName: 'Noun',
            nounId: Number(t.nounId),
            tokenId: String(t.nounId),
            tokenName: `Noun ${t.nounId}`,
            from: t.from,
            to: t.to,
            priceEth,
            priceWei: sale.priceWei.toString(),
            priceUsd: null,
            currency: 'ETH',
            marketplace: sale.marketplace,
          },
        });
        continue;
      }
      events.push({
        type: 'TRANSFER',
        blockNumber: Number(t.createdAtBlock),
        timestamp: tsToISO(t.createdAt),
        txHash: t.createdAtTransaction || '',
        data: { nounId: Number(t.nounId), from: t.from, to: t.to },
      });
    }

    // Normalize PROPOSAL_QUEUED / PROPOSAL_EXECUTED / PROPOSAL_CANCELLED / PROPOSAL_VETOED
    for (const sc of statusChanges) {
      const statusType = `PROPOSAL_${sc.status}` as string; // PROPOSAL_QUEUED, PROPOSAL_EXECUTED, etc.
      events.push({
        type: statusType,
        blockNumber: Number(sc.createdAtBlock),
        timestamp: tsToISO(sc.createdAt),
        txHash: sc.createdAtTransaction || '',
        data: { proposalId: Number(sc.proposalId), status: sc.status },
      });
    }

    // Normalize GRANT_CREATED
    for (const g of grants) {
      events.push({
        type: 'GRANT_CREATED',
        blockNumber: Number(g.createdAtBlock),
        timestamp: tsToISO(g.createdAt),
        txHash: g.createdAtTransaction || '',
        data: {
          grantId: Number(g.id),
          proposer: g.proposer,
          description: (g.description || '').slice(0, 4000),
          status: g.status,
          forVotes: g.forVotes,
          againstVotes: g.againstVotes,
        },
      });
    }

    // Normalize GRANT_VOTE
    for (const gv of grantVotes) {
      events.push({
        type: 'GRANT_VOTE',
        blockNumber: Number(gv.createdAtBlock),
        timestamp: tsToISO(gv.createdAt),
        txHash: gv.createdAtTransaction || '',
        data: {
          voter: gv.voter,
          grantId: Number(gv.grantId),
          support: gv.support,
          votes: gv.votes,
          reason: gv.reason || '',
        },
      });
    }

    // Normalize GRANT_QUEUED / GRANT_EXECUTED / GRANT_CANCELED
    for (const gs of grantStatusChanges) {
      const grantStatusType = `GRANT_${gs.status}` as string;
      events.push({
        type: grantStatusType,
        blockNumber: Number(gs.createdAtBlock),
        timestamp: tsToISO(gs.createdAt),
        txHash: gs.createdAtTransaction || '',
        data: { grantId: Number(gs.grantId), status: gs.status },
      });
    }

    for (const e of lilEvents) {
      if (want(e.type)) events.push(e);
    }
    for (const e of saleEvents) {
      if (!want(e.type)) continue;
      // Already emitted as a re-typed TRANSFER → SALE above; skip the duplicate.
      if (claimedSaleTxs.has((e.txHash || '').toLowerCase())) continue;
      events.push(e);
    }

    // Sort by blockNumber DESC
    events.sort((a, b) => b.blockNumber - a.blockNumber);

    const sliced = events.slice(0, limit);
    const hasMore = events.length > limit;
    const oldestBlock = sliced.length > 0 ? sliced[sliced.length - 1]!.blockNumber : 0;

    const result = { events: sliced, hasMore, oldestBlock };
    activityFeedCache = { data: result, fetchedAt: Date.now(), key: cacheKey };
    return c.json(result);
  } catch (err) {
    console.error('[Activity] Error:', err);
    return c.json({ events: [], hasMore: false, oldestBlock: 0 }, 500);
  }
});

// ─── Image → ASCII Art Conversion ─────────────────────────────────────────

const ASCII_CHARS = ' .:-=+*#%@█';
const asciiImageCache = new Map<string, { data: unknown; fetchedAt: number }>();
const ASCII_CACHE_TTL = 3600_000; // 1 hour

interface AsciiPixel {
  ch: string; // ASCII character
  r: number; // original red
  g: number; // original green
  b: number; // original blue
}

async function imageToAscii(
  url: string,
  cols = 80,
): Promise<{ pixels: AsciiPixel[]; width: number; height: number } | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());

    // Get original dimensions
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height) return null;

    // ASCII chars are ~2x tall as wide, so halve the row count
    const aspectRatio = meta.height / meta.width;
    const rows = Math.round(cols * aspectRatio * 0.45);

    // Resize and extract raw pixels
    const { data: raw, info } = await sharp(buffer)
      .resize(cols, rows, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels: AsciiPixel[] = [];
    const numChars = ASCII_CHARS.length;

    for (let i = 0; i < info.width * info.height; i++) {
      const r = raw[i * 3];
      const g = raw[i * 3 + 1];
      const b = raw[i * 3 + 2];
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const charIdx = Math.min(numChars - 1, Math.floor(luminance * numChars));
      pixels.push({ ch: ASCII_CHARS[charIdx], r, g, b });
    }

    return { pixels, width: info.width, height: info.height };
  } catch (err) {
    console.error('[AsciiImage] Conversion error:', err);
    return null;
  }
}

app.get('/api/ascii-image', async c => {
  const url = c.req.query('url');
  const cols = Math.min(120, Math.max(20, parseInt(c.req.query('cols') || '80', 10)));

  if (!url) return c.json({ error: 'url param required' }, 400);

  // Validate URL (only allow http/https, no local addresses)
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return c.json({ error: 'only http/https URLs' }, 400);
    }
  } catch {
    return c.json({ error: 'invalid URL' }, 400);
  }

  const cacheKey = `${url}:${cols}`;
  const cached = asciiImageCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < ASCII_CACHE_TTL) {
    return c.json(cached.data);
  }

  const result = await imageToAscii(url, cols);
  if (!result) return c.json({ error: 'failed to convert image' }, 500);

  asciiImageCache.set(cacheKey, { data: result, fetchedAt: Date.now() });
  return c.json(result);
});

// ─── OG Image — ASCII art as PNG ──────────────────────────────────────────

app.get('/api/og/proposal/:id', async c => {
  const proposalId = c.req.param('id');
  if (!proposalId) return c.json({ error: 'id required' }, 400);

  try {
    // Get proposal from DB
    const proposals = await db
      .select()
      .from(schema.proposal)
      .where(eq(schema.proposal.id, BigInt(proposalId)))
      .limit(1);
    if (proposals.length === 0) return c.json({ error: 'not found' }, 404);

    const proposal = proposals[0];
    const descText = (proposal.description || '') as string;
    const title = (descText.split('\n')[0] || '').replace(/^#\s*/, '').slice(0, 80);

    // Extract first image URL
    const imgMatch = descText.match(
      /!\[.*?]\((https?:\/\/[^)]+)\)|<img[^>]+src=["'](https?:\/\/[^"']+)["']/,
    );
    const imgUrl = imgMatch?.[1] || imgMatch?.[2];

    // Convert image to ASCII if available
    const asciiLines: string[] = [];
    if (imgUrl) {
      const ascii = await imageToAscii(imgUrl, 70);
      if (ascii) {
        for (let y = 0; y < ascii.height; y++) {
          let line = '';
          for (let x = 0; x < ascii.width; x++) {
            line += ascii.pixels[y * ascii.width + x].ch;
          }
          asciiLines.push(line);
        }
      }
    }

    // Render OG image as SVG → PNG
    const W = 1200;
    const H = 630;
    // const CHAR_W = 8.4; // reserved for future OG image layout
    const LINE_H = 12;
    const PAD = 40;

    // Build SVG
    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect width="${W}" height="${H}" fill="#000000"/>
      <text x="${PAD}" y="${PAD + 20}" fill="#00ff41" font-family="monospace" font-size="18" font-weight="bold">NOUN.WTF</text>
      <text x="${PAD}" y="${PAD + 48}" fill="#facc15" font-family="monospace" font-size="16">PROP ${proposalId}: ${escapeXml(title)}</text>`;

    if (asciiLines.length > 0) {
      const startY = PAD + 72;
      const maxLines = Math.min(asciiLines.length, Math.floor((H - startY - PAD) / LINE_H));
      for (let i = 0; i < maxLines; i++) {
        svgContent += `<text x="${PAD}" y="${startY + i * LINE_H}" fill="#888888" font-family="monospace" font-size="10">${escapeXml(asciiLines[i])}</text>`;
      }
    } else {
      svgContent += `<text x="${PAD}" y="${PAD + 80}" fill="#444" font-family="monospace" font-size="14">⌐◨-◨</text>`;
    }

    svgContent += `<text x="${W - PAD}" y="${H - PAD}" fill="#333" font-family="monospace" font-size="12" text-anchor="end">noun.wtf</text>`;
    svgContent += '</svg>';

    const png = await sharp(Buffer.from(svgContent)).png().toBuffer();

    return new Response(png, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    console.error('[OG] Error:', err);
    return c.json({ error: 'failed to generate OG image' }, 500);
  }
});

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─── ENS Resolution ─────────────────────────────────────────────────────

const ensCache = new Map<string, { name: string | null; resolvedAt: number }>();
const ENS_CACHE_TTL = 3600_000; // 1 hour

const ensClient = createPublicClient({
  chain: mainnet,
  transport: http(process.env.PONDER_RPC_URL_1 || 'https://ethereum-rpc.publicnode.com'),
});

app.get('/api/ens', async c => {
  const addressesParam = c.req.query('addresses') || '';
  const addresses = addressesParam
    .split(',')
    .filter(a => /^0x[\dA-Fa-f]{40}$/.test(a))
    .slice(0, 50);

  if (addresses.length === 0) return c.json({ names: {} });

  const now = Date.now();
  const names: Record<string, string | null> = {};
  const toResolve: string[] = [];

  for (const addr of addresses) {
    const key = addr.toLowerCase();
    const cached = ensCache.get(key);
    if (cached && now - cached.resolvedAt < ENS_CACHE_TTL) {
      names[key] = cached.name;
    } else {
      toResolve.push(addr);
    }
  }

  // Resolve uncached (max 10 concurrent to avoid RPC hammering)
  const chunks = [];
  for (let i = 0; i < toResolve.length; i += 10) {
    chunks.push(toResolve.slice(i, i + 10));
  }

  for (const chunk of chunks) {
    await Promise.all(
      chunk.map(async addr => {
        const key = addr.toLowerCase();
        try {
          const name = await ensClient.getEnsName({ address: addr as `0x${string}` });
          ensCache.set(key, { name: name || null, resolvedAt: now });
          names[key] = name || null;
        } catch {
          ensCache.set(key, { name: null, resolvedAt: now });
          names[key] = null;
        }
      }),
    );
  }

  return c.json({ names });
});

// ─── Noun Seeds (compact, for twin matching) ────────────────────────────

app.get('/api/nouns/seeds', async c => {
  try {
    const nouns = await db
      .select({
        id: schema.noun.id,
        background: schema.noun.background,
        body: schema.noun.body,
        accessory: schema.noun.accessory,
        head: schema.noun.head,
        glasses: schema.noun.glasses,
      })
      .from(schema.noun)
      .orderBy(schema.noun.id);

    // Set long cache — seeds of minted nouns never change
    c.header('Cache-Control', 'public, max-age=300');
    return c.json(nouns.map(n => ({ ...n, id: Number(n.id) })));
  } catch (err) {
    console.error('[NounSeeds] Error:', err);
    return c.json([], 500);
  }
});

// ─── Noun Holders ────────────────────────────────────────────────────────

app.get('/api/noun-holders', async c => {
  const addressesParam = c.req.query('addresses') || '';
  const addresses = addressesParam
    .split(',')
    .filter(a => /^0x[\dA-Fa-f]{40}$/.test(a))
    .slice(0, 50);

  if (addresses.length === 0) return c.json({ holders: {} });

  try {
    const nouns = await db
      .select()
      .from(schema.noun)
      .where(
        inArray(
          schema.noun.owner,
          addresses.map(a => a.toLowerCase()),
        ),
      );

    const holders: Record<
      string,
      Array<{
        nounId: number;
        seed: {
          head: number;
          body: number;
          accessory: number;
          glasses: number;
          background: number;
        };
      }>
    > = {};

    for (const n of nouns) {
      const key = (n.owner || '').toLowerCase();
      if (!holders[key]) holders[key] = [];
      holders[key].push({
        nounId: Number(n.id),
        seed: {
          head: n.head,
          body: n.body,
          accessory: n.accessory,
          glasses: n.glasses,
          background: n.background,
        },
      });
    }

    return c.json({ holders });
  } catch (err) {
    console.error('[NounHolders] Error:', err);
    return c.json({ holders: {} }, 500);
  }
});

// ============================================================
// Farcaster Write — proxy write ops so NEYNAR_API_KEY stays server-side
// Clients send their signer_uuid (obtained via SIWN on the frontend).
// ============================================================

app.post('/api/farcaster/cast', async c => {
  const neynarKey = process.env.NEYNAR_API_KEY;
  if (!neynarKey) return c.json({ error: 'Not configured' }, 503);

  const { signer_uuid, text, channel_id, parent } = await c.req.json<{
    signer_uuid: string;
    text: string;
    channel_id?: string;
    parent?: string;
  }>();

  if (!signer_uuid || !text?.trim()) {
    return c.json({ error: 'Missing signer_uuid or text' }, 400);
  }

  try {
    const body: Record<string, string> = { signer_uuid, text: text.trim() };
    if (channel_id) body.channel_id = channel_id;
    if (parent) body.parent = parent;

    const res = await fetch('https://api.neynar.com/v2/farcaster/cast', {
      method: 'POST',
      headers: {
        'x-api-key': neynarKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('[Farcaster cast] Neynar error:', res.status, data);
      return c.json({ error: data }, res.status as 400);
    }
    return c.json(data);
  } catch (err) {
    console.error('[Farcaster cast] Error:', err);
    return c.json({ error: 'Failed to publish cast' }, 500);
  }
});

app.post('/api/farcaster/reaction', async c => {
  const neynarKey = process.env.NEYNAR_API_KEY;
  if (!neynarKey) return c.json({ error: 'Not configured' }, 503);

  const { signer_uuid, reaction_type, target } = await c.req.json<{
    signer_uuid: string;
    reaction_type: 'like' | 'recast';
    target: string;
  }>();

  if (!signer_uuid || !reaction_type || !target) {
    return c.json({ error: 'Missing signer_uuid, reaction_type, or target' }, 400);
  }

  try {
    const res = await fetch('https://api.neynar.com/v2/farcaster/reaction', {
      method: 'POST',
      headers: {
        'x-api-key': neynarKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ signer_uuid, reaction_type, target }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('[Farcaster reaction] Neynar error:', res.status, data);
      return c.json({ error: data }, res.status as 400);
    }
    return c.json(data);
  } catch (err) {
    console.error('[Farcaster reaction] Error:', err);
    return c.json({ error: 'Failed to submit reaction' }, 500);
  }
});

app.delete('/api/farcaster/reaction', async c => {
  const neynarKey = process.env.NEYNAR_API_KEY;
  if (!neynarKey) return c.json({ error: 'Not configured' }, 503);

  const { signer_uuid, reaction_type, target } = await c.req.json<{
    signer_uuid: string;
    reaction_type: 'like' | 'recast';
    target: string;
  }>();

  if (!signer_uuid || !reaction_type || !target) {
    return c.json({ error: 'Missing signer_uuid, reaction_type, or target' }, 400);
  }

  try {
    const res = await fetch('https://api.neynar.com/v2/farcaster/reaction', {
      method: 'DELETE',
      headers: {
        'x-api-key': neynarKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ signer_uuid, reaction_type, target }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('[Farcaster unreaction] Neynar error:', res.status, data);
      return c.json({ error: data }, res.status as 400);
    }
    return c.json(data);
  } catch (err) {
    console.error('[Farcaster unreaction] Error:', err);
    return c.json({ error: 'Failed to remove reaction' }, 500);
  }
});

// Health check
app.get('/api/health', c => {
  return c.json({ status: 'ok', timestamp: Date.now() });
});

// ============================================================
// Dashboard Stats
// ============================================================

function checkDashboardKey(c: { req: { query: (k: string) => string | undefined } }): boolean {
  const key = c.req.query('key');
  const expected = process.env.DASHBOARD_API_KEY;
  return !!expected && key === expected;
}

app.get('/api/stats', async c => {
  if (!checkDashboardKey(c)) return c.json({ error: 'Unauthorized' }, 401);
  const window = parseInt(c.req.query('window') || '60', 10);
  return c.json(getMetrics(window));
});

app.get('/api/stats/errors', async c => {
  if (!checkDashboardKey(c)) return c.json({ error: 'Unauthorized' }, 401);
  return c.json(getRecentErrors(50));
});

// Plausible Stats API proxy (cached 5 min)
let plausibleCache: { data: unknown; fetchedAt: number; period: string } | null = null;
const PLAUSIBLE_TTL = 300_000;

app.get('/api/stats/plausible', async c => {
  if (!checkDashboardKey(c)) return c.json({ error: 'Unauthorized' }, 401);

  const plausibleKey = process.env.PLAUSIBLE_API_KEY;
  if (!plausibleKey) return c.json({ error: 'Plausible not configured' }, 503);

  const period = c.req.query('period') || '30d';
  const site = 'noun.wtf';

  if (
    plausibleCache &&
    plausibleCache.period === period &&
    Date.now() - plausibleCache.fetchedAt < PLAUSIBLE_TTL
  ) {
    return c.json(plausibleCache.data);
  }

  try {
    const headers = { Authorization: `Bearer ${plausibleKey}` };
    const base = 'https://plausible.io/api/v1/stats';

    const [aggregate, timeseries, topPages, topReferrers] = await Promise.all([
      fetch(
        `${base}/aggregate?site_id=${site}&period=${period}&metrics=visitors,pageviews,bounce_rate,visit_duration`,
        { headers },
      ).then(r => r.json()),
      fetch(`${base}/timeseries?site_id=${site}&period=${period}&metrics=visitors,pageviews`, {
        headers,
      }).then(r => r.json()),
      fetch(`${base}/breakdown?site_id=${site}&period=${period}&property=event:page&limit=10`, {
        headers,
      }).then(r => r.json()),
      fetch(`${base}/breakdown?site_id=${site}&period=${period}&property=visit:source&limit=10`, {
        headers,
      }).then(r => r.json()),
    ]);

    const data = { aggregate, timeseries, topPages, topReferrers, period };
    plausibleCache = { data, fetchedAt: Date.now(), period };
    return c.json(data);
  } catch (err) {
    console.error('[Dashboard] Plausible fetch error:', err);
    return c.json({ error: 'Failed to fetch Plausible data' }, 502);
  }
});

app.get('/api/stats/health', async c => {
  let latestBlock: string = 'unknown';
  try {
    latestBlock = (await getCurrentBlock()).toString();
  } catch {}

  let dbStatus: { ok: boolean; error?: string } = { ok: false };
  try {
    await db.select().from(schema.noun).limit(1);
    dbStatus = { ok: true };
  } catch (e: unknown) {
    dbStatus = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const mem = process.memoryUsage();
  return c.json({
    api: {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      memoryMB: Math.round(mem.heapUsed / 1024 / 1024),
    },
    indexer: { latestBlock },
    database: dbStatus,
    metricsBufferSize: getBufferSize(),
    timestamp: Date.now(),
  });
});

// ─── Gas Leaderboard ────────────────────────────────────────────────────────

type GasAction =
  | 'bidding'
  | 'settling'
  | 'proposing'
  | 'voting'
  | 'queuing'
  | 'executing'
  | 'canceling'
  | 'creating_candidate'
  | 'updating_candidate'
  | 'canceling_candidate'
  | 'sponsoring'
  | 'feedback'
  | 'grant_proposing'
  | 'grant_voting'
  | 'grant_admin'
  | 'delegation'
  | 'other';

const GAS_CONTRACTS: Record<string, Record<string, GasAction>> = {
  '0x830BD73E4184ceF73443C15111a1DF14e495C706': {
    // AuctionHouseV2
    createBid: 'bidding',
    settleAuction: 'settling',
    settleCurrentAndCreateNewAuction: 'settling',
  },
  '0x6f3E6272A167e8AcCb32072d08E0957F9c79223d': {
    // NounsDAOV4
    propose: 'proposing',
    castVote: 'voting',
    castVoteWithReason: 'voting',
    castRefundableVote: 'voting',
    castRefundableVoteWithReason: 'voting',
    queue: 'queuing',
    execute: 'executing',
    cancel: 'canceling',
  },
  '0xf790A5f59678dd733fb3De93493A91f472ca1365': {
    // NounsDAOData
    createProposalCandidate: 'creating_candidate',
    updateProposalCandidate: 'updating_candidate',
    cancelProposalCandidate: 'canceling_candidate',
    addSignature: 'sponsoring',
    sendFeedback: 'feedback',
    sendCandidateFeedback: 'feedback',
  },
  '0xBAc9233725440c595b19d975309CC98cb259253a': {
    // SmallGrantsTreasury
    propose: 'grant_proposing',
    castVote: 'grant_voting',
    queue: 'grant_admin',
    execute: 'grant_admin',
    cancel: 'grant_admin',
  },
  '0x9C8fF314C9Bc7F6e59A9d9225Fb22946427eDC03': {
    // NounsToken
    delegate: 'delegation',
  },
};

const GAS_ACTION_LABELS: Record<GasAction, string> = {
  bidding: 'Bidding',
  settling: 'Settling',
  proposing: 'Proposing',
  voting: 'Voting',
  queuing: 'Queuing',
  executing: 'Executing',
  canceling: 'Canceling',
  creating_candidate: 'Creating Candidates',
  updating_candidate: 'Updating Candidates',
  canceling_candidate: 'Canceling Candidates',
  sponsoring: 'Sponsoring',
  feedback: 'Feedback',
  grant_proposing: 'Grant Proposals',
  grant_voting: 'Grant Voting',
  grant_admin: 'Grant Admin',
  delegation: 'Delegation',
  other: 'Other',
};

interface GasEntry {
  address: string;
  totalGasCostWei: bigint;
  totalRefundWei: bigint;
  netGasCostWei: bigint;
  totalGasCostEth: number;
  totalRefundEth: number;
  netGasCostEth: number;
  txCount: number;
  byAction: Record<GasAction, { txCount: number; gasCostWei: bigint; gasCostEth: number }>;
}

interface GasLeaderboardData {
  entries: Array<
    Omit<GasEntry, 'totalGasCostWei' | 'totalRefundWei' | 'netGasCostWei' | 'byAction'> & {
      byAction: Record<GasAction, { txCount: number; gasCostEth: number }>;
    }
  >;
  meta: {
    totalTransactions: number;
    totalGasEth: number;
    totalRefundEth: number;
    uniqueAddresses: number;
    lastUpdated: number;
    actionLabels: Record<GasAction, string>;
  };
}

let gasLeaderboardCache: { data: GasLeaderboardData; fetchedAt: number } | null = null;
const GAS_CACHE_TTL = 6 * 3600_000; // 6 hours
let gasLeaderboardBuilding = false;

function extractFnName(etherscanFunctionName: string): string {
  // Etherscan returns e.g. "createBid(uint256)" — extract just the name
  const paren = etherscanFunctionName.indexOf('(');
  return paren > 0 ? etherscanFunctionName.slice(0, paren) : etherscanFunctionName;
}

async function fetchEtherscanTxList(
  contractAddress: string,
  apiKey: string,
  action: 'txlist' | 'txlistinternal' = 'txlist',
): Promise<Record<string, string>[]> {
  const all: Record<string, string>[] = [];
  let page = 1;
  while (true) {
    const url = `https://api.etherscan.io/v2/api?chainid=1&module=account&action=${action}&address=${contractAddress}&startblock=0&endblock=99999999&page=${page}&offset=10000&sort=asc&apikey=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const json = await res.json();
    if (json.status !== '1' || !Array.isArray(json.result)) break;
    all.push(...json.result);
    if (json.result.length < 10000) break;
    page++;
    await new Promise(r => setTimeout(r, 250)); // rate limit
  }
  return all;
}

async function buildGasLeaderboard(apiKey: string): Promise<GasLeaderboardData> {
  const daoAddress = '0x6f3E6272A167e8AcCb32072d08E0957F9c79223d';
  const addressMap = new Map<string, GasEntry>();
  let totalTransactions = 0;

  const emptyByAction = (): GasEntry['byAction'] => {
    const obj = {} as GasEntry['byAction'];
    for (const k of Object.keys(GAS_ACTION_LABELS) as GasAction[]) {
      obj[k] = { txCount: 0, gasCostWei: 0n, gasCostEth: 0 };
    }
    return obj;
  };

  // Fetch all contract transactions
  for (const contractAddress of Object.keys(GAS_CONTRACTS)) {
    console.log(`[GasLeaderboard] Fetching txlist for ${contractAddress}...`);
    const txs = await fetchEtherscanTxList(contractAddress, apiKey);
    console.log(`[GasLeaderboard] Got ${txs.length} txs for ${contractAddress}`);
    const fnMap = GAS_CONTRACTS[contractAddress];

    for (const tx of txs) {
      const addr = tx.from.toLowerCase();
      let entry = addressMap.get(addr);
      if (!entry) {
        entry = {
          address: tx.from,
          totalGasCostWei: 0n,
          totalRefundWei: 0n,
          netGasCostWei: 0n,
          totalGasCostEth: 0,
          totalRefundEth: 0,
          netGasCostEth: 0,
          txCount: 0,
          byAction: emptyByAction(),
        };
        addressMap.set(addr, entry);
      }

      const gasCost = BigInt(tx.gasUsed || '0') * BigInt(tx.gasPrice || '0');
      const fnName = extractFnName(tx.functionName || '');
      const action: GasAction = fnMap[fnName] || 'other';

      entry.totalGasCostWei += gasCost;
      entry.txCount += 1;
      entry.byAction[action].txCount += 1;
      entry.byAction[action].gasCostWei += gasCost;
      totalTransactions++;
    }
    await new Promise(r => setTimeout(r, 250));
  }

  // Fetch vote refunds (internal txs from DAO contract back to voters)
  console.log('[GasLeaderboard] Fetching vote refund internal txs...');
  const internalTxs = await fetchEtherscanTxList(daoAddress, apiKey, 'txlistinternal');
  console.log(`[GasLeaderboard] Got ${internalTxs.length} internal txs`);

  // Build refund map: txHash → refund value
  // Internal txs where from=DAO contract are vote refunds sent back to voters
  const refundByAddress = new Map<string, bigint>();
  for (const itx of internalTxs) {
    if (itx.from?.toLowerCase() !== daoAddress.toLowerCase()) continue;
    if (!itx.to || itx.value === '0') continue;
    const voterAddr = itx.to.toLowerCase();
    refundByAddress.set(voterAddr, (refundByAddress.get(voterAddr) || 0n) + BigInt(itx.value));
  }

  // Apply refunds to address entries
  for (const [addr, refund] of refundByAddress) {
    const entry = addressMap.get(addr);
    if (entry) {
      entry.totalRefundWei = refund;
    }
  }

  // Compute derived fields and serialize
  let totalGasWei = 0n;
  let totalRefundWei = 0n;

  const entries = Array.from(addressMap.values()).map(e => {
    e.netGasCostWei = e.totalGasCostWei - e.totalRefundWei;
    e.totalGasCostEth = Number(e.totalGasCostWei) / 1e18;
    e.totalRefundEth = Number(e.totalRefundWei) / 1e18;
    e.netGasCostEth = Number(e.netGasCostWei) / 1e18;
    totalGasWei += e.totalGasCostWei;
    totalRefundWei += e.totalRefundWei;

    // Serialize byAction (drop bigints for JSON)
    const byAction = {} as Record<GasAction, { txCount: number; gasCostEth: number }>;
    for (const [k, v] of Object.entries(e.byAction) as [
      GasAction,
      (typeof e.byAction)[GasAction],
    ][]) {
      if (v.txCount > 0) {
        byAction[k] = { txCount: v.txCount, gasCostEth: Number(v.gasCostWei) / 1e18 };
      }
    }

    return {
      address: e.address,
      totalGasCostEth: e.totalGasCostEth,
      totalRefundEth: e.totalRefundEth,
      netGasCostEth: e.netGasCostEth,
      txCount: e.txCount,
      byAction,
    };
  });

  entries.sort((a, b) => b.netGasCostEth - a.netGasCostEth);

  return {
    entries,
    meta: {
      totalTransactions,
      totalGasEth: Number(totalGasWei) / 1e18,
      totalRefundEth: Number(totalRefundWei) / 1e18,
      uniqueAddresses: entries.length,
      lastUpdated: Date.now(),
      actionLabels: GAS_ACTION_LABELS,
    },
  };
}

app.get('/api/gas-leaderboard', async c => {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'Gas leaderboard not configured (missing ETHERSCAN_API_KEY)' }, 503);
  }

  // Return cached if fresh
  if (gasLeaderboardCache && Date.now() - gasLeaderboardCache.fetchedAt < GAS_CACHE_TTL) {
    return c.json(gasLeaderboardCache.data);
  }

  // Return stale while rebuilding
  if (gasLeaderboardCache && gasLeaderboardBuilding) {
    return c.json(gasLeaderboardCache.data);
  }

  // No cache yet, building in progress
  if (!gasLeaderboardCache && gasLeaderboardBuilding) {
    return c.json({ status: 'building' }, 202);
  }

  // Trigger background build
  gasLeaderboardBuilding = true;
  buildGasLeaderboard(apiKey)
    .then(data => {
      gasLeaderboardCache = { data, fetchedAt: Date.now() };
      console.log(
        `[GasLeaderboard] Built: ${data.meta.uniqueAddresses} addresses, ${data.meta.totalTransactions} txs`,
      );
    })
    .catch(err => console.error('[GasLeaderboard] Build failed:', err))
    .finally(() => {
      gasLeaderboardBuilding = false;
    });

  if (gasLeaderboardCache) return c.json(gasLeaderboardCache.data);
  return c.json({ status: 'building' }, 202);
});

export default app;
