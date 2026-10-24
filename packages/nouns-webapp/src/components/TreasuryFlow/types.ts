// ─── /api/treasury/flows response contract (version 2) ───────────────────────
// Copy of packages/nouns-api/src/api/treasury/types.ts — change both together.

/**
 * How money moved.
 *  auction  — a Noun's winning bid, paid into the treasury (the only inflow counted)
 *  direct   — ETH / WETH / stETH / USDC / a Noun sent straight from the treasury by a proposal
 *  stream   — a vesting stream created by a proposal (Stream Factory `createStream`)
 *  payer    — USDC paid through the DAO's USDC Payer (`sendOrRegisterDebt`)
 *  call     — ETH sent along with a contract call that isn't a plain transfer
 *  fork     — ETH / tokens a DAO fork took with it (`ETHSent` / `ERC20Sent` on the timelock)
 */
export type FlowKind = 'auction' | 'direct' | 'stream' | 'payer' | 'call' | 'fork';

/**
 * Who an address is. Derived by explicit rules (see buildFlows.ts `classify`):
 *  treasury  — nouns.eth + the legacy timelock (known-address table), merged into one node
 *  nounders  — nounders.eth (known-address table)
 *  subdao    — a fork treasury (governor ExecuteFork event), a known sub-DAO, or a
 *              recipient whose primary ENS name is a *.nouns.eth subname (DAO-issued)
 *  contract  — a DAO contract (known table) or any recipient with non-Safe contract code
 *  multisig  — a recipient whose code is a Safe proxy (team / grant multisigs)
 *  person    — a recipient with no code (an EOA)
 *  bidder    — won at least one auction and never received money from the treasury
 */
export type EntityType =
  | 'treasury'
  | 'nounders'
  | 'subdao'
  | 'contract'
  | 'multisig'
  | 'person'
  | 'bidder';

export type StreamState = 'vesting' | 'ended' | 'cancelled' | 'not-started';

export interface StreamInfo {
  address: string;
  start: number; // unix s
  stop: number; // unix s
  /** Share of the vesting period elapsed, 0..1 (cancelled: at cancel time). */
  progress: number;
  state: StreamState;
  /** Committed amount, token units. */
  total: number;
  /** Withdrawn by the recipient so far (on cancel this includes their vested balance). */
  paidOut: number;
  /** Cancelled streams: total − paidOut, i.e. returned to the treasury (or never funded). */
  refunded: number;
}

export interface Flow {
  id: string;
  kind: FlowKind;
  /** Node id ('treasury' or a lowercase address). */
  from: string;
  to: string;
  asset: string; // 'ETH' | 'WETH' | 'stETH' | 'USDC' | 'NOUN' | symbol | 'TOKEN'
  /** Token units (ETH, USDC, …); for NOUN the count. Net of stream refunds. */
  amount: number;
  /** ETH-equivalent (ETH, WETH, stETH only), net of refunds. */
  eth: number;
  /** USD-equivalent (USDC only), net of refunds. */
  usd: number;
  t: number; // unix s: settlement / execution time
  proposalId?: number;
  nounId?: number;
  txHash?: string;
  /** Raw token address for non-ETH assets. */
  token?: string;
  stream?: StreamInfo;
  /** Function name for `call` flows. */
  fn?: string;
  /** Fork flows are folded per day: how many sends this row stands for. */
  count?: number;
}

export interface FlowNode {
  id: string;
  type: EntityType;
  name: string;
  ens: string | null;
  /** From the known-address table, when listed. */
  label?: string;
  description?: string;
  source?: string;
  url?: string;
  /** Received from the treasury (ETH-equivalent / USD). */
  receivedEth: number;
  receivedUsd: number;
  /** Paid into the treasury at auction. */
  paidEth: number;
  auctionsWon: number;
  nounsReceived: number;
  streams: number;
  proposals: number[];
  kinds: FlowKind[];
  firstT: number;
  lastT: number;
  /** True when eth_getCode failed, so person/multisig/contract is unverified. */
  codeUnknown?: boolean;
}

export interface KindTotals {
  eth: number;
  usd: number;
  count: number;
}

export interface FlowStats {
  /** Auction proceeds. */
  inEth: number;
  auctions: number;
  /** ETH-equivalent paid out (direct + streams + calls + forks). */
  outEth: number;
  outUsd: number;
  /** ETH swapped/staked into other treasury assets (not spending). */
  convertedEth: number;
  /** The part of convertedEth sent to the Token Buyer to buy USDC. */
  ethToUsdc: number;
  /** inEth − outEth − ethToUsdc. */
  netEth: number;
  byKind: Record<Exclude<FlowKind, 'auction'>, KindTotals>;
  recipients: number;
  streams: { total: number; vesting: number; ended: number; cancelled: number; notStarted: number };
  propsExecuted: number;
  propsWithPayouts: number;
  nounsGiven: number;
  nounderNouns: number;
  nounsToTreasury: number;
  nounsBurned: number;
  /** Outflows we can't price in ETH or USD (wstETH, rETH, unknown ERC-20s). */
  unpriced: number;
  /** Their totals by symbol (unknown tokens by address, raw units). */
  otherTokens: Record<string, number>;
}

export interface YearSlice {
  year: number;
  inEth: number;
  outEth: number;
  outUsd: number;
  /** ETH sent to the Token Buyer that year (net = inEth − outEth − ethToUsdc). */
  ethToUsdc: number;
  auctions: number;
  props: number;
}

export interface ProposalRef {
  id: number;
  title: string;
  proposer: string;
  executedAt: number;
}

export interface TreasuryFlowsResponse {
  version: 2;
  generatedAt: number;
  indexing: { complete: boolean; block: number | null; timestamp: number | null };
  stats: FlowStats;
  years: YearSlice[];
  nodes: FlowNode[];
  flows: Flow[];
  proposals: Record<string, ProposalRef>;
}
