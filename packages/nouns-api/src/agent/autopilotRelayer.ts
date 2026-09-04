// ─── Autopilot relayer — casts delegated votes ──────────────────────────────
//
// A voter grants a scoped ERC-7710 delegation (see `autopilotDelegations.ts`)
// letting THIS relayer key call `DelegationManager.redeemDelegations`, which
// executes `castRefundableVote*` FROM THE VOTER'S ADDRESS (EIP-7702 account)
// on the Nouns / Lil Nouns governor. The sweep below decides when to do that.
//
// Isolation from the NounIRL settler (`blockWatcher.ts`): separate key
// (`AUTOPILOT_RELAYER_PRIVATE_KEY`), separate nonce space, separate clients.
// Never touches `NOUNIRL_PRIVATE_KEY` or the pre-signed settlement txs.
//
// Every decision — vote, skip, failure — becomes an `autopilot_votes` row with
// a human-readable `reason` / `error`, and is logged with the `[Autopilot]`
// prefix, so a mainnet test can be audited from the rows alone.
//
// Env:
//   AUTOPILOT_RELAYER_PRIVATE_KEY   hex key (required to send; read-only without)
//   AUTOPILOT_RELAYER_ADDRESS       address shown when no key is configured
//   AUTOPILOT_RELAYER_ENABLED       '1' (default) / '0' — kill switch for sends
//   AUTOPILOT_DRY_RUN               '1' → simulate only, never broadcast
//   AUTOPILOT_MAX_FEE_GWEI          maxFeePerGas cap (default 30); skip when base fee is above it
//   AUTOPILOT_SWEEP_MS              sweep interval (default 10 min)
//   AUTOPILOT_MAX_TX_PER_SWEEP      default 5
//   AGENT_RPC_URL | NOUNIRL_RPC_URL | PONDER_RPC_URL_1   RPC (first set wins)

import type { PublicClient, WalletClient } from 'viem';

import {
  ABIS,
  buildRedeemVoteCall,
  deserializeDelegation,
  FRAMEWORK,
  NOUN_WTF_CLIENT_ID,
  type Delegation,
} from '@nouns/vote-permit';
import {
  BaseError,
  createWalletClient,
  decodeErrorResult,
  formatEther,
  formatGwei,
  http,
  isHex,
  parseGwei,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';

import { governorFor } from './autopilotDelegations.js';
import {
  AUTOPILOT_RPC_URL,
  getReadClient,
  listLilActiveProposals,
  proposalTiming,
  readDelegatorCode,
  readReceipt,
  readVoteWeight,
  type ActiveProposal,
} from './autopilotGov.js';
import { readAutopilotRecord, type AutopilotDao, type AutopilotRecord } from './autopilotPrefs.js';
import {
  bumpDelegationUses,
  countVotesByStatus,
  findVote,
  insertVote,
  listActiveDelegations,
  listAutoWallets,
  listRecentVotes,
  markDelegationChecked,
  updateVote,
  VOTE_IN_FLIGHT,
  type DelegationRow,
  type VoteRow,
} from './autopilotStore.js';

type Hex = `0x${string}`;

// ─── Config ────────────────────────────────────────────────────────────────

const LOG = '[Autopilot]';
const DEFAULT_RELAYER_ADDRESS = '0x1ca9D8EA6cFC8702d722dA1a8459c8aa0cA825C3';
const FAILED_RETRY_MS = 6 * 3600_000;
const RECEIPT_TIMEOUT_MS = 5 * 60_000;
const BALANCE_TTL = 60_000;
const DISABLED_TTL = 5 * 60_000;
const BOOT_DELAY_MS = 60_000;

const envInt = (k: string, dflt: number) => {
  const n = Number(process.env[k]);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};
export const AUTOPILOT_SWEEP_MS = envInt('AUTOPILOT_SWEEP_MS', 10 * 60_000);
export const AUTOPILOT_MAX_TX_PER_SWEEP = envInt('AUTOPILOT_MAX_TX_PER_SWEEP', 5);
export const AUTOPILOT_MAX_FEE_GWEI = envInt('AUTOPILOT_MAX_FEE_GWEI', 30);
const MAX_FEE_WEI = parseGwei(String(AUTOPILOT_MAX_FEE_GWEI));
const MAX_PRIORITY_WEI = parseGwei('2');

export const isRelayerEnabled = (): boolean =>
  (process.env.AUTOPILOT_RELAYER_ENABLED ?? '1') !== '0';
export const isDryRun = (): boolean => process.env.AUTOPILOT_DRY_RUN === '1';

// ─── Clients ───────────────────────────────────────────────────────────────

let account: PrivateKeyAccount | null = null;
let walletClient: WalletClient | null = null;
let clientsInit = false;

function initClients(): void {
  if (clientsInit) return;
  clientsInit = true;
  const key = process.env.AUTOPILOT_RELAYER_PRIVATE_KEY;
  if (!key) {
    console.warn(`${LOG} AUTOPILOT_RELAYER_PRIVATE_KEY not set — relayer is read-only`);
    return;
  }
  try {
    account = privateKeyToAccount(key as Hex);
    walletClient = createWalletClient({
      chain: mainnet,
      transport: http(AUTOPILOT_RPC_URL),
      account,
    });
    console.log(`${LOG} relayer wallet ${account.address}`);
  } catch (err) {
    console.error(`${LOG} relayer key invalid:`, err instanceof Error ? err.message : err);
    account = null;
    walletClient = null;
  }
}

function publicClient(): PublicClient {
  return getReadClient();
}

/** The relayer address — from the key when configured, else the documented address. */
export function getRelayerAddress(): Hex {
  initClients();
  return (account?.address ??
    process.env.AUTOPILOT_RELAYER_ADDRESS ??
    DEFAULT_RELAYER_ADDRESS) as Hex;
}

export function canSend(): boolean {
  initClients();
  return account !== null && walletClient !== null;
}

let balanceCache: { at: number; eth: number } | null = null;
export async function getRelayerBalanceEth(): Promise<number> {
  if (balanceCache && Date.now() - balanceCache.at < BALANCE_TTL) return balanceCache.eth;
  try {
    const wei = await publicClient().getBalance({ address: getRelayerAddress() });
    balanceCache = { at: Date.now(), eth: Number(formatEther(wei)) };
  } catch (err) {
    console.warn(`${LOG} balance read failed:`, err instanceof Error ? err.message : err);
    if (!balanceCache) return 0;
  }
  return balanceCache.eth;
}

const disabledCache = new Map<string, { at: number; disabled: boolean }>();
/** `DelegationManager.disabledDelegations(hash)` — the voter's on-chain revoke. Cached 5 min. */
export async function isDelegationDisabledOnchain(hash: string): Promise<boolean | null> {
  const key = hash.toLowerCase();
  const hit = disabledCache.get(key);
  if (hit && Date.now() - hit.at < DISABLED_TTL) return hit.disabled;
  try {
    const disabled = await publicClient().readContract({
      address: FRAMEWORK.delegationManager,
      abi: ABIS.delegationManager,
      functionName: 'disabledDelegations',
      args: [key as Hex],
    });
    if (disabledCache.size > 5000) disabledCache.clear();
    disabledCache.set(key, { at: Date.now(), disabled });
    return disabled;
  } catch (err) {
    console.warn(`${LOG} disabledDelegations(${key.slice(0, 10)}…) failed:`, errMsg(err));
    return hit?.disabled ?? null;
  }
}

// ─── Recommendation contract (engine lives in api/walletProfile.ts) ────────

export interface Recommendation {
  dao: AutopilotDao;
  proposalId: number;
  title: string;
  support: 0 | 1 | 2 | null;
  confidence: number;
  reason: string;
  generatedAt: number;
  model?: string;
  alreadyVoted?: boolean;
  pending?: boolean;
}

export interface AutopilotProviders {
  /** Nouns proposals inside their voting window (Ponder-backed). */
  listNounsActiveProposals: () => Promise<ActiveProposal[]>;
  /** The recommendation engine for one proposal (cached per prefs hash by the engine). */
  recommend: (
    address: string,
    record: AutopilotRecord,
    proposal: ActiveProposal,
  ) => Promise<Recommendation | null>;
  readAutopilot: (address: string) => Promise<AutopilotRecord | null>;
}

let providers: AutopilotProviders = {
  listNounsActiveProposals: async () => {
    console.warn(`${LOG} no Nouns proposal provider registered — Nouns sweep is empty`);
    return [];
  },
  recommend: async () => null,
  readAutopilot: readAutopilotRecord,
};

export function registerAutopilotProviders(p: Partial<AutopilotProviders>): void {
  providers = { ...providers, ...p };
}

// ─── Error decoding ────────────────────────────────────────────────────────

const REVERT_ABI = [
  ...ABIS.delegationManager,
  ...ABIS.deleGatorErrors,
  ...ABIS.limitedCallsEnforcer,
  ...ABIS.nonceEnforcer,
] as const;

/** Friendlier wording for the framework's require-strings / custom errors. */
const REVERT_HINTS: Array<[RegExp, string]> = [
  [/CannotUseADisabledDelegation/, 'delegation was revoked on-chain (disableDelegation)'],
  [/TimestampEnforcer:expired-delegation/, 'delegation expired (TimestampEnforcer)'],
  [/TimestampEnforcer:early-delegation/, 'delegation not yet valid (TimestampEnforcer notBefore)'],
  [
    /LimitedCallsEnforcer:limit-exceeded-call/,
    'delegation vote limit reached (LimitedCallsEnforcer)',
  ],
  [
    /RedeemerEnforcer:unauthorized-redeemer/,
    'relayer is not the allowed redeemer (RedeemerEnforcer)',
  ],
  [
    /AllowedMethodsEnforcer:method-not-allowed/,
    'function not in the delegation scope (AllowedMethodsEnforcer)',
  ],
  [
    /AllowedTargetsEnforcer:target-address-not-allowed/,
    'governor not in the delegation scope (AllowedTargetsEnforcer)',
  ],
  [/NonceEnforcer:invalid-nonce/, 'delegation nonce revoked (NonceEnforcer)'],
  [
    /InvalidEOASignature|InvalidERC1271Signature|ECDSAInvalidSignature/,
    'delegation signature rejected by DelegationManager',
  ],
  [/voter already voted/, 'voter already voted on this proposal'],
  [/voting is closed/, 'voting is closed for this proposal'],
  [
    /only vote against during objection period/,
    'objection period: only AGAINST votes are accepted',
  ],
  [/must have votes/, 'voter has no votes at the snapshot block'],
  [/invalid vote type/, 'invalid support value'],
];

function errMsg(err: unknown): string {
  if (err instanceof BaseError) return err.shortMessage || err.message;
  return err instanceof Error ? err.message : String(err);
}

/** Pull revert data (hex) out of a viem error chain, if any. */
function revertData(err: unknown): Hex | null {
  if (!(err instanceof BaseError)) return null;
  const found = err.walk(e => {
    const d = (e as { data?: unknown }).data;
    return typeof d === 'string' && isHex(d) && d.length > 2;
  }) as { data?: Hex } | null;
  if (found?.data) return found.data;
  const nested = err.walk(e => {
    const d = (e as { data?: { data?: unknown } }).data;
    return typeof d === 'object' && d !== null && typeof d.data === 'string';
  }) as { data?: { data?: Hex } } | null;
  return nested?.data?.data ?? null;
}

/** Human-readable revert description: decoded custom error / Error(string) + a hint. */
export function describeRevert(err: unknown): string {
  let text = errMsg(err);
  const data = revertData(err);
  if (data) {
    try {
      const decoded = decodeErrorResult({ abi: REVERT_ABI, data });
      const args = decoded.args?.length ? `(${decoded.args.map(String).join(', ')})` : '';
      text = `${decoded.errorName}${args}`;
    } catch {
      text = `${text} [data ${data.slice(0, 10)}…]`;
    }
  }
  for (const [re, hint] of REVERT_HINTS) {
    if (re.test(text)) return `${hint} — ${text}`;
  }
  // The EOA was never upgraded (no 7702 code): the manager's call into it reverts with no data.
  if (!data && /revert/i.test(text)) {
    return `${text} (no revert data — typical when the delegator's EOA carries no EIP-7702 code, or the 7702 account rejects the DelegationManager)`;
  }
  return text;
}

// ─── Simulation + send ─────────────────────────────────────────────────────

export interface SimulationResult {
  ok: boolean;
  gas?: bigint;
  error?: string;
  to: Hex;
  data: Hex;
}

export function buildVoteCall(args: {
  delegation: Delegation;
  dao: AutopilotDao;
  proposalId: number;
  support: 0 | 1 | 2;
  reason?: string;
}): { to: Hex; data: Hex } {
  const gov = governorFor(args.dao);
  const call = buildRedeemVoteCall({
    delegation: args.delegation,
    governorKind: gov.kind,
    governor: gov.address,
    proposalId: BigInt(args.proposalId),
    support: args.support,
    reason: args.reason && args.reason.length > 0 ? args.reason : undefined,
    clientId: gov.kind === 'nouns' ? NOUN_WTF_CLIENT_ID : undefined,
  });
  return { to: call.to, data: call.data };
}

/** eth_call from the relayer, then estimateGas. Never throws — errors are described in `error`. */
export async function simulateVote(args: {
  delegation: Delegation;
  dao: AutopilotDao;
  proposalId: number;
  support: 0 | 1 | 2;
  reason?: string;
}): Promise<SimulationResult> {
  const { to, data } = buildVoteCall(args);
  const client = publicClient();
  const from = getRelayerAddress();
  try {
    await client.call({ account: from, to, data });
  } catch (err) {
    return { ok: false, error: describeRevert(err), to, data };
  }
  try {
    const gas = await client.estimateGas({ account: from, to, data });
    return { ok: true, gas, to, data };
  } catch (err) {
    return { ok: false, error: `estimateGas: ${describeRevert(err)}`, to, data };
  }
}

// Serialized send queue: one nonce fetch + one broadcast at a time.
let sendChain: Promise<unknown> = Promise.resolve();
let queueLength = 0;
let localNextNonce: number | null = null;
const inFlightReceipts = new Set<string>();

async function nextNonce(): Promise<number> {
  const pending = await publicClient().getTransactionCount({
    address: getRelayerAddress(),
    blockTag: 'pending',
  });
  const nonce = localNextNonce == null ? pending : Math.max(pending, localNextNonce);
  return nonce;
}

interface FeeCheck {
  ok: boolean;
  baseFeeGwei: number;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  reason?: string;
}

async function checkFees(): Promise<FeeCheck> {
  const client = publicClient();
  const block = await client.getBlock({ blockTag: 'latest' });
  const baseFee = block.baseFeePerGas ?? 0n;
  const baseFeeGwei = Number(formatGwei(baseFee));
  if (baseFee > MAX_FEE_WEI) {
    return {
      ok: false,
      baseFeeGwei,
      maxFeePerGas: MAX_FEE_WEI,
      maxPriorityFeePerGas: 0n,
      reason: `base fee ${baseFeeGwei.toFixed(2)} gwei above cap ${AUTOPILOT_MAX_FEE_GWEI} gwei — will retry next sweep`,
    };
  }
  let priority = MAX_PRIORITY_WEI;
  try {
    const fees = await client.estimateFeesPerGas();
    if (fees.maxPriorityFeePerGas != null && fees.maxPriorityFeePerGas < priority) {
      priority = fees.maxPriorityFeePerGas;
    }
  } catch {
    /* keep default priority */
  }
  if (priority < parseGwei('0.1')) priority = parseGwei('0.1');
  // 2× base fee headroom, capped; priority never exceeds the max fee.
  let maxFee = baseFee * 2n + priority;
  if (maxFee > MAX_FEE_WEI) maxFee = MAX_FEE_WEI;
  if (priority > maxFee) priority = maxFee;
  return { ok: true, baseFeeGwei, maxFeePerGas: maxFee, maxPriorityFeePerGas: priority };
}

/** Sign + broadcast through the serialized queue. Resolves to the tx hash. */
function sendVoteTx(args: { to: Hex; data: Hex; gas: bigint; fees: FeeCheck }): Promise<Hex> {
  if (!account || !walletClient) return Promise.reject(new Error('relayer key not configured'));
  const wc = walletClient;
  const acct = account;
  queueLength++;
  const job = sendChain.then(async () => {
    const nonce = await nextNonce();
    const hash = await wc.sendTransaction({
      account: acct,
      chain: mainnet,
      to: args.to,
      data: args.data,
      gas: args.gas,
      maxFeePerGas: args.fees.maxFeePerGas,
      maxPriorityFeePerGas: args.fees.maxPriorityFeePerGas,
      nonce,
      type: 'eip1559',
    });
    localNextNonce = nonce + 1;
    return hash;
  });
  sendChain = job
    .catch(() => undefined)
    .finally(() => {
      queueLength--;
    });
  return job;
}

async function trackReceipt(row: VoteRow, delegation: DelegationRow, hash: Hex): Promise<void> {
  inFlightReceipts.add(row.id);
  try {
    const receipt = await publicClient().waitForTransactionReceipt({
      hash,
      timeout: RECEIPT_TIMEOUT_MS,
      pollingInterval: 6_000,
    });
    if (receipt.status === 'success') {
      await updateVote(row.id, { status: 'confirmed', error: null });
      await bumpDelegationUses(delegation.id);
      console.log(
        `${LOG} ✅ confirmed ${row.dao} #${row.proposalId} for ${row.address} in block ${receipt.blockNumber} (${hash})`,
      );
    } else {
      await updateVote(row.id, {
        status: 'failed',
        error: `tx reverted on-chain in block ${receipt.blockNumber} (${hash})`,
      });
      console.error(`${LOG} ❌ reverted ${row.dao} #${row.proposalId} for ${row.address}: ${hash}`);
    }
  } catch (err) {
    await updateVote(row.id, {
      status: 'failed',
      error: `no receipt after ${RECEIPT_TIMEOUT_MS / 60_000} min (${errMsg(err)}) — tx ${hash} may still land; the on-chain receipt check will notice`,
    });
    console.error(`${LOG} receipt wait failed for ${hash}: ${errMsg(err)}`);
  } finally {
    inFlightReceipts.delete(row.id);
  }
}

// ─── Sweep ─────────────────────────────────────────────────────────────────

export type SweepAction = 'sent' | 'simulated' | 'skipped' | 'failed' | 'noop';

export interface SweepItem {
  address: string;
  dao: AutopilotDao | null;
  proposalId: number | null;
  action: SweepAction;
  reason: string;
  support?: 0 | 1 | 2 | null;
  confidence?: number;
  txHash?: string;
  gas?: string;
}

export interface SweepReport {
  trigger: string;
  dryRun: boolean;
  startedAt: number;
  finishedAt: number;
  wallets: number;
  considered: number;
  sent: number;
  simulated: number;
  skipped: number;
  failed: number;
  items: SweepItem[];
  note?: string;
}

let sweepRunning = false;
let lastSweep: SweepReport | null = null;
let sweepTimer: NodeJS.Timeout | null = null;
let bootTimer: NodeJS.Timeout | null = null;

const SUPPORT_WORD = ['against', 'for', 'abstain'] as const;
const word = (s: number | null | undefined) =>
  s == null ? 'skip' : (SUPPORT_WORD[s] ?? String(s));

/**
 * Persist a non-vote decision. One `skipped` row per (address, dao, proposal)
 * is kept and updated in place so a 10-minute sweep can't spam rows; a fresh
 * row is only inserted when nothing is there or the previous one is terminal.
 */
async function recordSkip(
  existing: VoteRow | null,
  base: { address: string; dao: AutopilotDao; proposalId: number },
  reason: string,
  extra: {
    support?: 0 | 1 | 2 | null;
    confidence?: number | null;
    status?: 'skipped' | 'failed';
  } = {},
): Promise<VoteRow> {
  const status = extra.status ?? 'skipped';
  if (existing && existing.status === 'skipped') {
    const updated = await updateVote(existing.id, {
      status,
      reason,
      support: extra.support ?? undefined,
      confidence: extra.confidence ?? undefined,
      error: status === 'failed' ? reason : null,
    });
    if (updated) return updated;
  }
  return insertVote({
    ...base,
    support: extra.support ?? null,
    reason,
    confidence: extra.confidence ?? null,
    txHash: null,
    status,
    error: status === 'failed' ? reason : null,
  });
}

interface EvalCtx {
  address: string;
  record: AutopilotRecord;
  delegation: DelegationRow;
  proposal: ActiveProposal;
  latestBlock: bigint;
  dryRun: boolean;
  budget: { sent: number };
}

async function evaluate(ctx: EvalCtx): Promise<SweepItem> {
  const { address, record, delegation, proposal, latestBlock, dryRun } = ctx;
  const prefs = record.prefs;
  const dao = proposal.dao;
  const base = { address, dao, proposalId: proposal.id };
  const tag = `${dao} #${proposal.id} ${address.slice(0, 8)}`;
  const item = (
    action: SweepAction,
    reason: string,
    extra: Partial<SweepItem> = {},
  ): SweepItem => ({
    address,
    dao,
    proposalId: proposal.id,
    action,
    reason,
    ...extra,
  });

  // 1. Our own ledger.
  const existing = await findVote(address, dao, proposal.id);
  if (existing && VOTE_IN_FLIGHT.includes(existing.status)) {
    return item(
      'noop',
      `already ${existing.status}${existing.txHash ? ` (${existing.txHash})` : ''}`,
    );
  }
  if (existing?.status === 'failed' && Date.now() - existing.updatedAt < FAILED_RETRY_MS) {
    const mins = Math.round((FAILED_RETRY_MS - (Date.now() - existing.updatedAt)) / 60_000);
    return item('noop', `failed ${existing.error ?? ''} — retry in ~${mins} min`);
  }

  // 2. On-chain receipt (source of truth for "already voted").
  const receipt = await readReceipt(dao, proposal.id, address);
  if (receipt.hasVoted) {
    const reason = `already voted on-chain (${word(receipt.support)}, ${receipt.votes} votes)`;
    await recordSkip(existing, base, reason, { support: receipt.support as 0 | 1 | 2 });
    return item('skipped', reason);
  }

  // 3. Delay window: wait unless waiting would miss the vote.
  const { openForHours, remainingHours } = proposalTiming(proposal, latestBlock);
  if (openForHours < prefs.autoVoteDelayHours && remainingHours > prefs.autoVoteDelayHours) {
    const reason = `waiting: voting open ${openForHours.toFixed(1)}h < delay ${prefs.autoVoteDelayHours}h (${remainingHours.toFixed(1)}h remain)`;
    await recordSkip(existing, base, reason);
    return item('skipped', reason);
  }

  // 4. Vote weight at the snapshot.
  const weight = await readVoteWeight(proposal, address);
  if (weight.votes === 0n) {
    const reason = `0 votes at snapshot block${weight.tried.length > 1 ? 's' : ''} ${weight.tried.join(', ')} — nothing to cast`;
    await recordSkip(existing, base, reason);
    return item('skipped', reason);
  }

  // 4b. The account must be an EIP-7702 delegator, or redeem can't call into it.
  const code = await readDelegatorCode(address);
  if (!code.hasCode) {
    const reason =
      'delegator has no EIP-7702 code — upgrade the account (MetaMask smart account) before the relayer can redeem';
    await recordSkip(existing, base, reason);
    return item('skipped', reason);
  }
  if (code.delegate7702 && !code.isMetaMaskDelegator) {
    console.warn(
      `${LOG} ${tag}: delegator's 7702 designation is ${code.delegate7702}, not MetaMask's ${FRAMEWORK.metamask7702Delegator} — proceeding, simulation decides`,
    );
  }

  // 5. Recommendation.
  const rec = await providers.recommend(address, record, proposal);
  if (!rec || rec.pending) {
    const reason = 'no recommendation yet (engine pending / unavailable)';
    await recordSkip(existing, base, reason);
    return item('skipped', reason);
  }
  if (rec.alreadyVoted) {
    const reason = `engine reports an existing vote (${word(rec.support)}) — on-chain receipt disagreed; not sending`;
    await recordSkip(existing, base, reason, { support: rec.support });
    return item('skipped', reason);
  }
  const conf = Math.round(rec.confidence * 100) / 100;
  const explain = `engine: ${word(rec.support)} @ ${conf}${rec.reason ? ` — "${rec.reason}"` : ''}`;
  if (rec.support === null) {
    const reason = `engine says skip (${conf}): ${rec.reason || 'no reason given'}`;
    await recordSkip(existing, base, reason, { support: null, confidence: conf });
    return item('skipped', reason, { support: null, confidence: conf });
  }
  if (conf < prefs.minConfidence) {
    const reason = `confidence ${conf} below minConfidence ${prefs.minConfidence} (${explain})`;
    await recordSkip(existing, base, reason, { support: rec.support, confidence: conf });
    return item('skipped', reason, { support: rec.support, confidence: conf });
  }
  if (prefs.autoVoteOnlyWithReason && !rec.reason.trim()) {
    const reason = `autoVoteOnlyWithReason is on and the recommendation has no reason (${explain})`;
    await recordSkip(existing, base, reason, { support: rec.support, confidence: conf });
    return item('skipped', reason, { support: rec.support, confidence: conf });
  }
  if (proposal.objectionOnly && rec.support !== 0) {
    const reason = `objection period: only AGAINST is accepted, engine wants ${word(rec.support)} (${explain})`;
    await recordSkip(existing, base, reason, { support: rec.support, confidence: conf });
    return item('skipped', reason, { support: rec.support, confidence: conf });
  }
  if (!dryRun && ctx.budget.sent >= AUTOPILOT_MAX_TX_PER_SWEEP) {
    const reason = `per-sweep cap of ${AUTOPILOT_MAX_TX_PER_SWEEP} txs reached — next sweep (${explain})`;
    await recordSkip(existing, base, reason, { support: rec.support, confidence: conf });
    return item('skipped', reason, { support: rec.support, confidence: conf });
  }

  // 6. Build + simulate.
  const voteReason = prefs.voteReasonStyle === 'none' ? '' : rec.reason.trim();
  let delegationObj: Delegation;
  try {
    delegationObj = deserializeDelegation(delegation.delegationJson);
  } catch (err) {
    const reason = `stored delegation ${delegation.id} does not parse: ${errMsg(err)}`;
    await recordSkip(existing, base, reason, {
      support: rec.support,
      confidence: conf,
      status: 'failed',
    });
    return item('failed', reason);
  }

  let row: VoteRow;
  if (existing && existing.status === 'skipped') {
    row =
      (await updateVote(existing.id, {
        status: 'queued',
        support: rec.support,
        confidence: conf,
        reason: voteReason || rec.reason || explain,
        error: null,
      })) ?? existing;
  } else {
    row = await insertVote({
      ...base,
      support: rec.support,
      confidence: conf,
      reason: voteReason || rec.reason || explain,
      txHash: null,
      status: 'queued',
      error: null,
    });
  }
  console.log(`${LOG} ${tag}: ${explain} → building tx (delegation ${delegation.id})`);

  const sim = await simulateVote({
    delegation: delegationObj,
    dao,
    proposalId: proposal.id,
    support: rec.support,
    reason: voteReason,
  });
  if (!sim.ok || sim.gas == null) {
    const error = `simulation reverted: ${sim.error ?? 'unknown'}`;
    await updateVote(row.id, { status: 'failed', error });
    console.error(`${LOG} ${tag}: ${error}`);
    return item('failed', error, { support: rec.support, confidence: conf });
  }
  await updateVote(row.id, { status: 'simulated', error: null });
  const gasLimit = (sim.gas * 13n) / 10n + 30_000n;

  if (dryRun) {
    const reason = `dry-run: simulation ok, gas ${sim.gas} (would cast ${word(rec.support)}${voteReason ? ' with reason' : ''})`;
    await updateVote(row.id, { status: 'skipped', reason, error: null });
    console.log(`${LOG} ${tag}: ${reason}`);
    return item('simulated', reason, {
      support: rec.support,
      confidence: conf,
      gas: String(sim.gas),
    });
  }
  if (!isRelayerEnabled()) {
    const reason = 'relayer disabled (AUTOPILOT_RELAYER_ENABLED=0) — simulated only';
    await updateVote(row.id, { status: 'skipped', reason, error: null });
    return item('skipped', reason, { support: rec.support, confidence: conf });
  }
  if (!canSend()) {
    const reason = 'relayer key not configured — simulated only';
    await updateVote(row.id, { status: 'skipped', reason, error: null });
    return item('skipped', reason, { support: rec.support, confidence: conf });
  }

  // 7. Gas cap, then send.
  let fees: FeeCheck;
  try {
    fees = await checkFees();
  } catch (err) {
    const reason = `fee lookup failed: ${errMsg(err)} — retry next sweep`;
    await updateVote(row.id, { status: 'skipped', reason, error: null });
    return item('skipped', reason, { support: rec.support, confidence: conf });
  }
  if (!fees.ok) {
    await updateVote(row.id, {
      status: 'skipped',
      reason: fees.reason ?? 'fees too high',
      error: null,
    });
    console.log(`${LOG} ${tag}: ${fees.reason}`);
    return item('skipped', fees.reason ?? 'fees too high', {
      support: rec.support,
      confidence: conf,
    });
  }

  try {
    const hash = await sendVoteTx({ to: sim.to, data: sim.data, gas: gasLimit, fees });
    ctx.budget.sent++;
    const sent = (await updateVote(row.id, { status: 'sent', txHash: hash, error: null })) ?? row;
    console.log(
      `${LOG} 🗳️ ${tag}: sent ${word(rec.support)} — ${hash} (gas ${gasLimit}, maxFee ${formatGwei(fees.maxFeePerGas)} gwei)`,
    );
    void trackReceipt(sent, delegation, hash);
    return item('sent', explain, {
      support: rec.support,
      confidence: conf,
      txHash: hash,
      gas: String(gasLimit),
    });
  } catch (err) {
    const error = `send failed: ${describeRevert(err)}`;
    await updateVote(row.id, { status: 'failed', error });
    console.error(`${LOG} ${tag}: ${error}`);
    return item('failed', error, { support: rec.support, confidence: conf });
  }
}

export async function runSweep(
  opts: { trigger?: string; dryRun?: boolean; addresses?: string[] } = {},
): Promise<SweepReport> {
  const startedAt = Date.now();
  const dryRun = opts.dryRun ?? isDryRun();
  const trigger = opts.trigger ?? 'manual';
  const report: SweepReport = {
    trigger,
    dryRun,
    startedAt,
    finishedAt: startedAt,
    wallets: 0,
    considered: 0,
    sent: 0,
    simulated: 0,
    skipped: 0,
    failed: 0,
    items: [],
  };
  if (sweepRunning) {
    report.note = 'a sweep is already running';
    report.finishedAt = Date.now();
    return report;
  }
  sweepRunning = true;
  initClients();
  const budget = { sent: 0 };
  const push = (it: SweepItem) => {
    report.items.push(it);
    if (it.proposalId != null) report.considered++;
    if (it.action === 'sent') report.sent++;
    else if (it.action === 'simulated') report.simulated++;
    else if (it.action === 'skipped') report.skipped++;
    else if (it.action === 'failed') report.failed++;
  };
  try {
    const wallets = opts.addresses?.map(a => a.toLowerCase()) ?? (await listAutoWallets());
    report.wallets = wallets.length;
    console.log(
      `${LOG} sweep (${trigger}${dryRun ? ', DRY RUN' : ''}): ${wallets.length} wallet(s)`,
    );
    if (wallets.length === 0) return report;

    const latestBlock = await publicClient().getBlockNumber();
    const proposalCache = new Map<AutopilotDao, Promise<ActiveProposal[]>>();
    const proposalsFor = (dao: AutopilotDao) => {
      let p = proposalCache.get(dao);
      if (!p) {
        p = (
          dao === 'nouns' ? providers.listNounsActiveProposals() : listLilActiveProposals()
        ).catch(err => {
          console.warn(`${LOG} listing ${dao} proposals failed:`, errMsg(err));
          return [] as ActiveProposal[];
        });
        proposalCache.set(dao, p);
      }
      return p;
    };

    for (const address of wallets) {
      const noop = (reason: string) =>
        push({ address, dao: null, proposalId: null, action: 'noop', reason });
      let record: AutopilotRecord | null = null;
      try {
        record = await providers.readAutopilot(address);
      } catch (err) {
        noop(`prefs unreadable: ${errMsg(err)}`);
        continue;
      }
      if (!record) {
        noop('no autopilot prefs stored');
        continue;
      }
      if (!record.enabled) {
        noop('autopilot disabled');
        continue;
      }
      if (record.prefs.mode !== 'auto') {
        noop(`mode is '${record.prefs.mode}' (not auto)`);
        continue;
      }
      const delegations = await listActiveDelegations(address);
      for (const dao of record.prefs.daos) {
        const delegation = delegations.find(d => d.dao === dao);
        if (!delegation) {
          push({
            address,
            dao,
            proposalId: null,
            action: 'noop',
            reason: 'no active delegation for this dao',
          });
          continue;
        }
        const disabled = await isDelegationDisabledOnchain(delegation.delegationHash);
        await markDelegationChecked(delegation.id).catch(() => undefined);
        if (disabled === true) {
          push({
            address,
            dao,
            proposalId: null,
            action: 'noop',
            reason: `delegation ${delegation.id} is disabled on-chain (voter revoked it)`,
          });
          continue;
        }
        const proposals = await proposalsFor(dao);
        if (proposals.length === 0) {
          push({
            address,
            dao,
            proposalId: null,
            action: 'noop',
            reason: 'no proposals in voting window',
          });
          continue;
        }
        for (const proposal of proposals) {
          try {
            push(
              await evaluate({
                address,
                record,
                delegation,
                proposal,
                latestBlock,
                dryRun,
                budget,
              }),
            );
          } catch (err) {
            const reason = `evaluation crashed: ${errMsg(err)}`;
            console.error(`${LOG} ${dao} #${proposal.id} ${address}: ${reason}`);
            push({ address, dao, proposalId: proposal.id, action: 'failed', reason });
          }
        }
      }
    }
    return report;
  } finally {
    report.finishedAt = Date.now();
    lastSweep = report;
    sweepRunning = false;
    console.log(
      `${LOG} sweep done in ${report.finishedAt - startedAt}ms — sent ${report.sent}, simulated ${report.simulated}, skipped ${report.skipped}, failed ${report.failed}`,
    );
  }
}

// ─── Lifecycle + status ────────────────────────────────────────────────────

export function startAutopilotRelayer(): void {
  if (sweepTimer) return;
  initClients();
  console.log(
    `${LOG} relayer ${getRelayerAddress()} — enabled=${isRelayerEnabled()} dryRun=${isDryRun()} canSend=${canSend()} sweep every ${AUTOPILOT_SWEEP_MS / 1000}s, maxFee ${AUTOPILOT_MAX_FEE_GWEI} gwei, ≤${AUTOPILOT_MAX_TX_PER_SWEEP} tx/sweep`,
  );
  const tick = (trigger: string) => {
    runSweep({ trigger }).catch(err => console.error(`${LOG} sweep crashed:`, errMsg(err)));
  };
  bootTimer = setTimeout(() => tick('boot'), BOOT_DELAY_MS);
  sweepTimer = setInterval(() => tick('interval'), AUTOPILOT_SWEEP_MS);
  bootTimer.unref?.();
  sweepTimer.unref?.();
}

export function stopAutopilotRelayer(): void {
  if (bootTimer) clearTimeout(bootTimer);
  if (sweepTimer) clearInterval(sweepTimer);
  bootTimer = null;
  sweepTimer = null;
}

export async function getAutopilotStatus() {
  const [balanceEth, active, recent, sentRows] = await Promise.all([
    getRelayerBalanceEth(),
    listActiveDelegations().catch(() => [] as DelegationRow[]),
    listRecentVotes(10).catch(() => [] as VoteRow[]),
    countVotesByStatus('sent').catch(() => 0),
  ]);
  return {
    relayer: {
      address: getRelayerAddress(),
      enabled: isRelayerEnabled(),
      canSend: canSend(),
      dryRun: isDryRun(),
      balanceEth,
      maxFeeGwei: AUTOPILOT_MAX_FEE_GWEI,
      maxTxPerSweep: AUTOPILOT_MAX_TX_PER_SWEEP,
      sweepMs: AUTOPILOT_SWEEP_MS,
    },
    activeDelegations: active.length,
    activeWallets: new Set(active.map(d => d.address)).size,
    lastSweep: lastSweep
      ? {
          trigger: lastSweep.trigger,
          dryRun: lastSweep.dryRun,
          startedAt: lastSweep.startedAt,
          finishedAt: lastSweep.finishedAt,
          wallets: lastSweep.wallets,
          considered: lastSweep.considered,
          sent: lastSweep.sent,
          simulated: lastSweep.simulated,
          skipped: lastSweep.skipped,
          failed: lastSweep.failed,
          note: lastSweep.note ?? null,
        }
      : null,
    sweepRunning,
    queueLength: queueLength + inFlightReceipts.size,
    awaitingReceipt: sentRows,
    recentVotes: recent,
  };
}

export function getLastSweep(): SweepReport | null {
  return lastSweep;
}
