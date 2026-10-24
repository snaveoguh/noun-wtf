// ─── Treasury flow builder ───────────────────────────────────────────────────
//
// Pure function from indexed rows (+ cached eth_getCode / ENS lookups) to the
// /api/treasury/flows response. No DB or RPC here, so it's unit-testable
// against fixtures.
//
// What counts:
//   IN   — winning auction bids (auction-house AuctionSettled, winner ≠ 0).
//   OUT  — what EXECUTED proposals actually sent, decoded from their actions
//          (decode.ts), plus what DAO forks took (timelock ETHSent/ERC20Sent).
//   Not counted — moves between the two timelocks, ETH wrapped/staked/swapped
//          into another treasury asset (reported as `convertedEth`), USDC
//          topping up the Payer, approvals and other zero-value calls.
//   Streams count once: the createStream commitment, minus anything refunded
//          on cancel. The transfer that funds a stream's address is skipped.

import type {
  EntityType,
  Flow,
  FlowKind,
  FlowNode,
  FlowStats,
  KindTotals,
  ProposalRef,
  StreamInfo,
  StreamState,
  TreasuryFlowsResponse,
  YearSlice,
} from './types.js';

import { formatUnits } from 'viem';

import { decodeProposalTx, type Action } from './decode.js';
import {
  KNOWN_ADDRESSES,
  NOUNDERS,
  PAYER,
  TOKEN_BUYER,
  TOKENS,
  TREASURY_ADDRESSES,
  USDC,
} from './knownAddresses.js';

// ── Input rows (structural subsets of ponder.schema.ts tables) ──────────────

/** Ponder `t.timestamp()` columns here hold unix SECONDS in a Date (see the handlers). */
type Ts = Date | number | bigint | string;

export interface ProposalRow {
  id: bigint | number;
  proposer: string;
  description: string;
  status: string;
  createdAt: Ts;
}
export interface TransactionRow {
  proposalId: bigint | number;
  index: number | null;
  target: string;
  value: bigint;
  signature: string;
  calldata: string;
}
export interface ExecutionRow {
  proposalId: bigint | number;
  createdAt: Ts;
  createdAtTransaction: string;
}
export interface AuctionRow {
  nounId: bigint | number;
  winner: string | null;
  amount: bigint | null;
  settled: boolean;
  burned: boolean;
  endTime: Ts;
  settledAt: Ts | null;
  settledAtTransaction: string | null;
}
export interface NounRow {
  id: bigint | number;
}
export interface StreamRow {
  streamAddress: string;
  proposalId: bigint | number | null;
  creator: string;
  payer: string;
  recipient: string;
  tokenAmount: bigint;
  withdrawnAmount: bigint;
  tokenAddress: string;
  startTime: Ts;
  stopTime: Ts;
  status: string;
  createdAt: Ts;
  createdAtTransaction: string;
}
export interface StreamCancelRow {
  streamAddress: string;
  amount: bigint | null; // recipient balance paid out at cancel
  createdAt: Ts;
}
export interface ForkSendRow {
  to: string;
  /** null = ETH */
  token: string | null;
  amount: bigint;
  createdAt: Ts;
  createdAtTransaction: string;
}
export interface ForkRow {
  forkId: number;
  forkTreasury: string | null;
}

export type CodeKind = 'eoa' | 'safe' | 'contract';

export interface BuildInput {
  now: number; // unix s
  proposals: ProposalRow[];
  transactions: TransactionRow[];
  executions: ExecutionRow[];
  auctions: AuctionRow[];
  nouns: NounRow[];
  streams: StreamRow[];
  streamCancels: StreamCancelRow[];
  forkSends: ForkSendRow[];
  forks: ForkRow[];
  /** Lowercase address → code kind (eth_getCode). Missing = unknown. */
  code: Record<string, CodeKind>;
  /** Lowercase address → primary ENS name. */
  ens: Record<string, string>;
  indexing: TreasuryFlowsResponse['indexing'];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const lc = (s: string) => s.toLowerCase();

export function toSec(v: Ts | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = v instanceof Date ? v.getTime() : Number(v);
  if (!Number.isFinite(n)) return 0;
  // Handlers store seconds in the Date; tolerate real ms timestamps too.
  return n > 1e12 ? Math.floor(n / 1000) : n;
}

export const isNounderNoun = (id: number) => id <= 1820 && id % 10 === 0;

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function titleOf(description: string): string {
  const first = (description || '').replace(/^\s+/, '').split('\n')[0] ?? '';
  return (
    first
      .replace(/^#+\s*/, '')
      .trim()
      .slice(0, 140) || 'Untitled'
  );
}

const node = (addr: string) => (TREASURY_ADDRESSES.has(lc(addr)) ? 'treasury' : lc(addr));

interface Priced {
  asset: string;
  amount: number;
  eth: number;
  usd: number;
  token?: string;
}

function priceToken(token: string | null, raw: bigint): Priced {
  if (token === null) {
    const amount = Number(formatUnits(raw, 18));
    return { asset: 'ETH', amount, eth: amount, usd: 0 };
  }
  const t = lc(token);
  const info = TOKENS[t];
  if (!info) return { asset: 'TOKEN', amount: Number(raw), eth: 0, usd: 0, token: t };
  const amount = Number(formatUnits(raw, info.decimals));
  return {
    asset: info.symbol,
    amount,
    eth: info.ethLike ? amount : 0,
    usd: info.usdLike ? amount : 0,
    token: t,
  };
}

/** Classify a Safe proxy by its runtime code (1.0–1.4 proxies share this prologue). */
export function codeKindFromBytecode(code: string | null | undefined): CodeKind {
  const c = (code || '0x').toLowerCase();
  if (c === '0x' || c === '') return 'eoa';
  // EIP-7702 delegated EOA: 0xef0100 ‖ address
  if (c.startsWith('0xef0100') && c.length === 2 + 46) return 'eoa';
  // GnosisSafeProxy runtime: loads masterCopy from slot 0 and checks the
  // masterCopy() selector 0xa619486e before delegating.
  if (c.includes('a619486e') && c.length < 1400) return 'safe';
  return 'contract';
}

// ── Build ───────────────────────────────────────────────────────────────────

export function buildTreasuryFlows(input: BuildInput): TreasuryFlowsResponse {
  const { now } = input;
  const flows: Flow[] = [];
  let convertedEth = 0;
  let ethToUsdc = 0;
  const ethToUsdcByYear = new Map<number, number>();
  const yearOf = (t: number) => new Date(t * 1000).getUTCFullYear();

  const proposalsById = new Map(input.proposals.map(p => [String(p.id), p]));
  const executedAt = new Map<string, { t: number; tx: string }>();
  for (const e of input.executions) {
    executedAt.set(String(e.proposalId), { t: toSec(e.createdAt), tx: e.createdAtTransaction });
  }

  // ── Inflows: auctions ──
  let nounsToTreasury = 0;
  let nounsBurned = 0;
  let auctions = 0;
  for (const a of input.auctions) {
    if (!a.settled) continue;
    const winner = a.winner ? lc(a.winner) : null;
    const amount = a.amount ?? 0n;
    if (!winner || winner === '0x0000000000000000000000000000000000000000' || amount === 0n) {
      if (a.burned) nounsBurned++;
      else nounsToTreasury++;
      continue;
    }
    auctions++;
    const eth = Number(formatUnits(amount, 18));
    flows.push({
      id: `auction-${a.nounId}`,
      kind: 'auction',
      from: node(winner),
      to: 'treasury',
      asset: 'ETH',
      amount: r6(eth),
      eth: r6(eth),
      usd: 0,
      t: toSec(a.settledAt) || toSec(a.endTime),
      nounId: Number(a.nounId),
    });
  }

  // ── Nounder rewards ──
  // NounsToken.mint(): `if (_currentNounId <= 1820 && _currentNounId % 10 == 0)
  // _mintTo(noundersDAO, …)`. (noun.mintedTo can't tell: the ERC721 mint emits
  // 0x0 → token owner → recipient, so it always holds a treasury.)
  let nounderNouns = 0;
  for (const n of input.nouns) if (isNounderNoun(Number(n.id))) nounderNouns++;

  // ── Streams: index rows, cancels ──
  const streamByAddr = new Map(input.streams.map(s => [lc(s.streamAddress), s]));
  const cancelByAddr = new Map(input.streamCancels.map(c => [lc(c.streamAddress), c]));
  const usedStreams = new Set<string>();
  const streamFlow = (
    row: StreamRow | undefined,
    act: Extract<Action, { type: 'stream' }> | null,
    pid: number | undefined,
    t: number,
    txHash: string | undefined,
    idx: string,
  ) => {
    const recipient = lc(row?.recipient ?? act!.recipient);
    const token = lc(row?.tokenAddress ?? act!.token);
    const totalRaw = row?.tokenAmount ?? act!.raw;
    const start = row ? toSec(row.startTime) : act!.start;
    const stop = row ? toSec(row.stopTime) : act!.stop;
    const cancel = row ? cancelByAddr.get(lc(row.streamAddress)) : undefined;
    // Stream.cancel() pays the recipient's vested balance through the same
    // withdraw path, so TokensWithdrawn — and withdrawnAmount — already
    // include it (checked on mainnet: stream 0xe165…25a2, prop 471).
    const paidRaw = row?.withdrawnAmount ?? 0n;
    const refundRaw = cancel ? (totalRaw > paidRaw ? totalRaw - paidRaw : 0n) : 0n;
    const netRaw = totalRaw - refundRaw;
    const priced = priceToken(token, netRaw);
    const decimals = TOKENS[token]?.decimals ?? 0;
    const units = (raw: bigint) => Number(formatUnits(raw, decimals));
    const endT = cancel ? toSec(cancel.createdAt) : now;
    const span = Math.max(1, stop - start);
    const progress = Math.min(1, Math.max(0, (Math.min(endT, stop) - start) / span));
    let state: StreamState = 'vesting';
    if (cancel) state = 'cancelled';
    else if (now < start) state = 'not-started';
    else if (now >= stop) state = 'ended';
    const info: StreamInfo = {
      address: row ? lc(row.streamAddress) : (act!.predicted ?? ''),
      start,
      stop,
      progress: r6(progress),
      state,
      total: r6(units(totalRaw)),
      paidOut: r6(units(paidRaw)),
      refunded: r6(units(refundRaw)),
    };
    flows.push({
      id: `stream-${info.address || idx}`,
      kind: 'stream',
      from: 'treasury',
      to: node(recipient),
      asset: priced.asset,
      amount: r6(priced.amount),
      eth: r6(priced.eth),
      usd: r6(priced.usd),
      token: priced.token,
      t,
      proposalId: pid,
      txHash,
      stream: info,
    });
  };

  // ── Outflows: executed proposals ──
  const txsByProposal = new Map<string, TransactionRow[]>();
  for (const tx of input.transactions) {
    const k = String(tx.proposalId);
    if (!txsByProposal.has(k)) txsByProposal.set(k, []);
    txsByProposal.get(k)!.push(tx);
  }

  let propsExecuted = 0;
  for (const p of input.proposals) {
    if (p.status !== 'EXECUTED') continue;
    propsExecuted++;
    const pidKey = String(p.id);
    const pid = Number(p.id);
    const exec = executedAt.get(pidKey);
    const t = exec?.t ?? toSec(p.createdAt);
    const txs = [...(txsByProposal.get(pidKey) ?? [])].sort(
      (a, b) => (a.index ?? 0) - (b.index ?? 0),
    );
    const actions = txs.map(tx => ({ tx, act: decodeProposalTx(tx) }));

    // Stream addresses this proposal creates (predicted) — their funding
    // transfers are part of the stream, not separate payouts.
    const streamAddrs = new Set<string>();
    for (const { act } of actions) {
      if (act.type === 'stream' && act.predicted) streamAddrs.add(act.predicted);
    }
    const isStreamAddr = (a: string) => streamAddrs.has(a) || streamByAddr.has(a);

    for (const { tx, act } of actions) {
      const idx = `${pid}-${tx.index ?? 0}`;
      const base = { from: 'treasury', t, proposalId: pid, txHash: exec?.tx };
      switch (act.type) {
        case 'eth': {
          if (act.wei === 0n) break;
          if (TREASURY_ADDRESSES.has(act.to)) break; // timelock ↔ timelock
          if (isStreamAddr(act.to)) break; // ETH funding a stream
          const pr = priceToken(null, act.wei);
          flows.push({ id: `p${idx}`, kind: 'direct', to: node(act.to), ...pr, ...base });
          break;
        }
        case 'token': {
          if (act.raw === 0n) break;
          if (act.from && !TREASURY_ADDRESSES.has(act.from)) break; // not the treasury's tokens
          if (TREASURY_ADDRESSES.has(act.to)) break;
          if (act.to === PAYER || act.to === TOKEN_BUYER) break; // topping up DAO plumbing
          if (isStreamAddr(act.to)) break; // funds a stream (counted at createStream)
          const pr = priceToken(act.token, act.raw);
          flows.push({ id: `p${idx}`, kind: 'direct', to: node(act.to), ...pr, ...base });
          break;
        }
        case 'payer': {
          if (act.raw === 0n) break;
          if (TREASURY_ADDRESSES.has(act.to) || act.to === PAYER || act.to === TOKEN_BUYER) break;
          if (isStreamAddr(act.to)) break; // USDC funding a stream
          const usd = Number(formatUnits(act.raw, 6));
          flows.push({
            id: `p${idx}`,
            kind: 'payer',
            to: node(act.to),
            asset: 'USDC',
            amount: r6(usd),
            eth: 0,
            usd: r6(usd),
            token: USDC,
            ...base,
          });
          break;
        }
        case 'stream': {
          // Find the indexed stream row: predicted address, else same
          // proposal + recipient + amount, else created in the execution tx.
          let row: StreamRow | undefined = act.predicted
            ? streamByAddr.get(act.predicted)
            : undefined;
          if (!row) {
            row = input.streams.find(
              s =>
                !usedStreams.has(lc(s.streamAddress)) &&
                lc(s.recipient) === act.recipient &&
                s.tokenAmount === act.raw &&
                ((s.proposalId !== null && String(s.proposalId) === pidKey) ||
                  (exec && s.createdAtTransaction === exec.tx)),
            );
          }
          if (row) usedStreams.add(lc(row.streamAddress));
          streamFlow(row, act, pid, t, exec?.tx, idx);
          break;
        }
        case 'noun': {
          if (!TREASURY_ADDRESSES.has(act.from) || TREASURY_ADDRESSES.has(act.to)) break;
          flows.push({
            id: `p${idx}`,
            kind: 'direct',
            to: node(act.to),
            asset: 'NOUN',
            amount: 1,
            eth: 0,
            usd: 0,
            nounId: act.nounId,
            ...base,
          });
          break;
        }
        case 'conversion': {
          const eth = Number(formatUnits(act.wei, 18));
          convertedEth += eth;
          if (act.target === TOKEN_BUYER) {
            ethToUsdc += eth;
            ethToUsdcByYear.set(yearOf(t), (ethToUsdcByYear.get(yearOf(t)) ?? 0) + eth);
          }
          break;
        }
        case 'call': {
          if (act.wei === 0n) break;
          if (TREASURY_ADDRESSES.has(act.target)) break;
          const pr = priceToken(null, act.wei);
          flows.push({
            id: `p${idx}`,
            kind: 'call',
            to: node(act.target),
            ...pr,
            ...base,
            fn: act.fn,
          });
          break;
        }
      }
    }
  }

  // Streams the treasury created that no decoded action matched (e.g. an
  // undecodable signature) — still real commitments from a proposal.
  for (const s of input.streams) {
    const addr = lc(s.streamAddress);
    if (usedStreams.has(addr)) continue;
    if (!TREASURY_ADDRESSES.has(lc(s.creator))) continue;
    const pid = s.proposalId !== null ? Number(s.proposalId) : undefined;
    streamFlow(s, null, pid, toSec(s.createdAt), s.createdAtTransaction, addr);
    usedStreams.add(addr);
  }

  // ── Forks: what leaving members took (timelock ETHSent / ERC20Sent) ──
  // One row per escrow/join tx is hundreds of rows; fold them per fork
  // treasury, asset and UTC day (txHash = the day's first send).
  const forkAgg = new Map<string, Flow>();
  for (const f of input.forkSends) {
    if (f.amount === 0n) continue;
    const pr = priceToken(f.token, f.amount);
    const t = toSec(f.createdAt);
    const day = Math.floor(t / 86400);
    const key = `${lc(f.to)}-${pr.token ?? 'eth'}-${day}`;
    const prev = forkAgg.get(key);
    if (prev) {
      prev.amount += pr.amount;
      prev.eth += pr.eth;
      prev.usd += pr.usd;
      prev.count = (prev.count ?? 1) + 1;
      continue;
    }
    forkAgg.set(key, {
      id: `fork-${key}`,
      kind: 'fork',
      from: 'treasury',
      to: node(f.to),
      asset: pr.asset,
      amount: pr.amount,
      eth: pr.eth,
      usd: pr.usd,
      token: pr.token,
      t,
      txHash: f.createdAtTransaction,
      count: 1,
    });
  }
  for (const f of forkAgg.values()) {
    flows.push({ ...f, amount: r6(f.amount), eth: r6(f.eth), usd: r6(f.usd) });
  }

  flows.sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));

  // ── Nodes ──
  const forkTreasury = new Map<string, number>();
  for (const f of input.forks) if (f.forkTreasury) forkTreasury.set(lc(f.forkTreasury), f.forkId);

  const nodes = new Map<string, FlowNode>();
  const getNode = (id: string): FlowNode => {
    let n = nodes.get(id);
    if (!n) {
      n = {
        id,
        type: 'bidder',
        name: id,
        ens: null,
        receivedEth: 0,
        receivedUsd: 0,
        paidEth: 0,
        auctionsWon: 0,
        nounsReceived: 0,
        streams: 0,
        proposals: [],
        kinds: [],
        firstT: Infinity,
        lastT: 0,
      };
      nodes.set(id, n);
    }
    return n;
  };
  getNode('treasury');
  getNode(NOUNDERS);

  for (const f of flows) {
    const outward = f.kind !== 'auction';
    const n = getNode(outward ? f.to : f.from);
    if (outward) {
      n.receivedEth += f.eth;
      n.receivedUsd += f.usd;
      if (f.asset === 'NOUN') n.nounsReceived += f.amount;
      if (f.kind === 'stream') n.streams++;
      if (f.proposalId !== undefined && !n.proposals.includes(f.proposalId))
        n.proposals.push(f.proposalId);
    } else {
      n.paidEth += f.eth;
      n.auctionsWon++;
    }
    if (!n.kinds.includes(f.kind)) n.kinds.push(f.kind);
    n.firstT = Math.min(n.firstT, f.t);
    n.lastT = Math.max(n.lastT, f.t);
  }
  getNode(NOUNDERS).nounsReceived = nounderNouns;

  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  for (const n of nodes.values()) {
    if (n.firstT === Infinity) n.firstT = 0;
    const known =
      n.id === 'treasury' ? KNOWN_ADDRESSES[[...TREASURY_ADDRESSES][0]!] : KNOWN_ADDRESSES[n.id];
    const ens = n.id === 'treasury' ? 'nouns.eth' : (input.ens[n.id] ?? null);
    n.ens = ens;
    const received = n.kinds.some(k => k !== 'auction');
    let type: EntityType;
    if (n.id === 'treasury') type = 'treasury';
    else if (known?.kind === 'nounders') type = 'nounders';
    else if (known?.kind === 'subdao' || forkTreasury.has(n.id)) type = 'subdao';
    else if (known?.kind === 'dao-contract') type = 'contract';
    // A primary name under nouns.eth (forward-verified by ReverseRecords) was
    // issued by the DAO, which owns nouns.eth: a DAO program's wallet.
    else if (received && ens?.endsWith('.nouns.eth')) type = 'subdao';
    else if (received) {
      const code = input.code[n.id];
      if (!code) n.codeUnknown = true;
      const byCode: Record<CodeKind, EntityType> = {
        safe: 'multisig',
        contract: 'contract',
        eoa: 'person',
      };
      type = code ? byCode[code] : 'person';
    } else type = 'bidder';
    n.type = type;
    if (known) {
      n.label = known.name;
      n.description = known.description;
      n.source = known.source;
      if (known.url) n.url = known.url;
    }
    if (n.id === 'treasury') {
      n.label = 'Nouns Treasury';
      n.description = 'nouns.eth (Timelock V2) + the legacy Timelock V1, shown as one';
    }
    const fork = forkTreasury.get(n.id);
    if (fork !== undefined && !known) {
      n.label = `Nouns Fork #${fork} treasury`;
      n.description = 'Treasury of a DAO fork: what leaving Nouners took with them';
      n.source = 'onchain';
    }
    n.name = n.label ?? ens ?? short(n.id);
    n.receivedEth = r6(n.receivedEth);
    n.receivedUsd = r6(n.receivedUsd);
    n.paidEth = r6(n.paidEth);
    n.proposals.sort((a, b) => a - b);
  }

  // Treasury node totals mirror the headline stats
  const zero = (): KindTotals => ({ eth: 0, usd: 0, count: 0 });
  const byKind: FlowStats['byKind'] = {
    direct: zero(),
    stream: zero(),
    payer: zero(),
    call: zero(),
    fork: zero(),
  };
  let inEth = 0;
  let unpriced = 0;
  let nounsGiven = 0;
  const otherTokens: Record<string, number> = {};
  const recipients = new Set<string>();
  const propsWithPayouts = new Set<number>();
  for (const f of flows) {
    if (f.kind === 'auction') {
      inEth += f.eth;
      continue;
    }
    const k = byKind[f.kind];
    k.eth += f.eth;
    k.usd += f.usd;
    k.count++;
    if (f.asset === 'NOUN') nounsGiven += f.amount;
    else if (f.eth === 0 && f.usd === 0 && f.amount > 0) {
      // (a cancelled stream that paid nothing nets to 0: not an unpriced payout)
      unpriced++;
      const sym = f.asset === 'TOKEN' ? (f.token ?? 'TOKEN') : f.asset;
      otherTokens[sym] = (otherTokens[sym] ?? 0) + f.amount;
    }
    recipients.add(f.to);
    if (f.proposalId !== undefined) propsWithPayouts.add(f.proposalId);
  }
  for (const k of Object.values(byKind)) {
    k.eth = r6(k.eth);
    k.usd = r6(k.usd);
  }
  const outEth = Object.values(byKind).reduce((s, k) => s + k.eth, 0);
  const outUsd = Object.values(byKind).reduce((s, k) => s + k.usd, 0);

  const streamFlows = flows.filter(f => f.stream);
  const stats: FlowStats = {
    inEth: r6(inEth),
    auctions,
    outEth: r6(outEth),
    outUsd: r6(outUsd),
    convertedEth: r6(convertedEth),
    ethToUsdc: r6(ethToUsdc),
    netEth: r6(inEth - outEth - ethToUsdc),
    byKind,
    recipients: recipients.size,
    streams: {
      total: streamFlows.length,
      vesting: streamFlows.filter(f => f.stream!.state === 'vesting').length,
      ended: streamFlows.filter(f => f.stream!.state === 'ended').length,
      cancelled: streamFlows.filter(f => f.stream!.state === 'cancelled').length,
      notStarted: streamFlows.filter(f => f.stream!.state === 'not-started').length,
    },
    propsExecuted,
    propsWithPayouts: propsWithPayouts.size,
    nounsGiven,
    nounderNouns,
    nounsToTreasury,
    nounsBurned,
    unpriced,
    otherTokens: Object.fromEntries(Object.entries(otherTokens).map(([k, v]) => [k, r6(v)])),
  };

  const tn = nodes.get('treasury')!;
  tn.paidEth = stats.inEth;
  tn.receivedEth = stats.outEth;
  tn.receivedUsd = stats.outUsd;

  // ── Year slices ──
  const yearMap = new Map<number, YearSlice & { _props: Set<number> }>();
  for (const f of flows) {
    if (!f.t) continue;
    const year = yearOf(f.t);
    let y = yearMap.get(year);
    if (!y) {
      y = {
        year,
        inEth: 0,
        outEth: 0,
        outUsd: 0,
        ethToUsdc: 0,
        auctions: 0,
        props: 0,
        _props: new Set(),
      };
      yearMap.set(year, y);
    }
    if (f.kind === 'auction') {
      y.inEth += f.eth;
      y.auctions++;
    } else {
      y.outEth += f.eth;
      y.outUsd += f.usd;
      if (f.proposalId !== undefined) y._props.add(f.proposalId);
    }
  }
  const years: YearSlice[] = [...yearMap.values()]
    .sort((a, b) => a.year - b.year)
    .map(({ _props, ...y }) => ({
      ...y,
      inEth: r6(y.inEth),
      outEth: r6(y.outEth),
      outUsd: r6(y.outUsd),
      ethToUsdc: r6(ethToUsdcByYear.get(y.year) ?? 0),
      props: _props.size,
    }));

  // ── Proposal refs for every proposal a flow points at ──
  const proposals: Record<string, ProposalRef> = {};
  for (const f of flows) {
    if (f.proposalId === undefined || proposals[f.proposalId]) continue;
    const p = proposalsById.get(String(f.proposalId));
    if (!p) continue;
    proposals[f.proposalId] = {
      id: f.proposalId,
      title: titleOf(p.description),
      proposer: lc(p.proposer),
      executedAt: executedAt.get(String(p.id))?.t ?? 0,
    };
  }

  const nodeList = [...nodes.values()].sort((a, b) => {
    if (a.id === 'treasury') return -1;
    if (b.id === 'treasury') return 1;
    return b.receivedEth + b.paidEth - (a.receivedEth + a.paidEth);
  });

  return {
    version: 2,
    generatedAt: now,
    indexing: input.indexing,
    // filled in by the route from a live chain read (holdings.ts)
    holdings: null,
    reconciliation: null,
    stats,
    years,
    nodes: nodeList,
    flows,
    proposals,
  };
}

/** Addresses that need an eth_getCode verdict: every outflow recipient that isn't known. */
export function addressesNeedingCode(resp: Pick<TreasuryFlowsResponse, 'flows'>): string[] {
  const out = new Set<string>();
  for (const f of resp.flows) {
    if (f.kind === 'auction' || f.to === 'treasury' || KNOWN_ADDRESSES[f.to]) continue;
    out.add(f.to);
  }
  return [...out];
}

export type { FlowKind };
