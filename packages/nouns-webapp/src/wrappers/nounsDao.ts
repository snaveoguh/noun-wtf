import type { Address, Hash, Hex } from '@/utils/types';

// Ponder-compatible proposal shape (replaces old GraphQL codegen types)
type Maybe<T> = T | null;

interface GraphQLProposal {
  id: string;
  description: string;
  status: string;
  proposalThreshold?: bigint | null;
  quorumVotes?: bigint | null;
  forVotes: bigint;
  againstVotes: bigint;
  abstainVotes: bigint;
  createdAtTransaction: string;
  createdAtBlock: bigint;
  createdAt: string;
  startBlock: bigint;
  endBlock: bigint;
  updatePeriodEndBlock?: bigint | null;
  objectionPeriodEndBlock: bigint;
  executionETA?: bigint | null;
  onTimelockV1?: boolean | null;
  proposer: string;
  clientId?: number | null;
  title?: string;
  // Old subgraph nested fields — provided by adapter
  targets?: string[];
  values?: string[];
  signatures?: string[];
  calldatas?: string[];
  createdBlock: bigint;
  createdTimestamp: bigint;
  createdTransactionHash: string;
  voteSnapshotBlock: bigint;
  signers?: { id: string }[];
}

import { useEffect, useMemo, useState } from 'react';

import { useQuery } from '@apollo/client';
import { useQuery as useReactQuery } from '@tanstack/react-query';
import { filter, flatMap, forEach, isBigInt, isNonNullish, isNullish, map, pipe } from 'remeda';
import {
  type AbiParameter,
  decodeAbiParameters,
  decodeEventLog,
  formatEther,
  keccak256,
  parseAbiItem,
  stringToBytes,
} from 'viem';
import { mainnet } from 'viem/chains';
import { useAccount, useBlockNumber, usePublicClient, useReadContracts } from 'wagmi';

import {
  nounsGovernorAbi,
  nounsGovernorAddress,
  useReadNounsGovernorAdjustedTotalSupply,
  useReadNounsGovernorForkThreshold,
  useReadNounsGovernorState,
  useReadNounsGovernorForkThresholdBps,
  useReadNounsGovernorGetDynamicQuorumParamsAt,
  useReadNounsGovernorGetReceipt,
  useReadNounsGovernorNumTokensInForkEscrow,
  useReadNounsGovernorProposalCount,
  useReadNounsGovernorProposalThreshold,
  useWriteNounsGovernorCancel,
  useWriteNounsGovernorCancelSig,
  useWriteNounsGovernorCastRefundableVote,
  useWriteNounsGovernorCastRefundableVoteWithReason,
  useWriteNounsGovernorEscrowToFork,
  useWriteNounsGovernorExecute,
  useWriteNounsGovernorExecuteFork,
  useWriteNounsGovernorJoinFork,
  useWriteNounsGovernorPropose,
  useWriteNounsGovernorProposeOnTimelockV1,
  useWriteNounsGovernorQueue,
  useWriteNounsGovernorUpdateProposal,
  useWriteNounsGovernorUpdateProposalDescription,
  useWriteNounsGovernorUpdateProposalTransactions,
  useWriteNounsGovernorWithdrawFromForkEscrow,
} from '@/contracts';
import { useBlockTimestamp } from '@/hooks/useBlockTimestamp';
import { getSubgraphUrl } from '@/lib/subgraphSettings';
import { defaultChain } from '@/wagmi';

import {
  activePendingUpdatableProposersQuery,
  escrowDepositEventsQuery,
  escrowWithdrawEventsQuery,
  forkDetailsQuery,
  forkJoinsQuery,
  forksQuery,
  isForkActiveQuery,
  proposalQuery,
  proposalTitlesQuery,
  proposalVersionsQuery,
  updatableProposalsQuery,
} from './subgraph';

export interface DynamicQuorumParams {
  minQuorumVotesBPS: number;
  maxQuorumVotesBPS: number;
  quorumCoefficient: number;
}

export enum Vote {
  AGAINST = 0,
  FOR = 1,
  ABSTAIN = 2,
}

export enum ProposalState {
  UNDETERMINED = -1,
  PENDING,
  ACTIVE,
  CANCELLED,
  DEFEATED,
  SUCCEEDED,
  QUEUED,
  EXPIRED,
  EXECUTED,
  VETOED,
  OBJECTION_PERIOD,
  UPDATABLE,
}

export enum ForkState {
  UNDETERMINED = -1,
  ESCROW,
  ACTIVE,
  EXECUTED,
}

interface ProposalCallResult {
  abstainVotes: bigint;
  againstVotes: bigint;
  canceled: boolean;
  creationBlock: bigint;
  endBlock: bigint;
  eta: bigint;
  executed: boolean;
  forVotes: bigint;
  id: bigint;
  proposalThreshold: bigint;
  proposer: `0x${string}`;
  quorumVotes: bigint;
  startBlock: bigint;
  totalSupply: bigint;
  vetoed: boolean;
  objectionPeriodEndBlock?: bigint;
  updatePeriodEndBlock?: bigint;
}

export interface ProposalDetail {
  target: Address;
  value?: bigint;
  functionSig?: string;
  callData: Hex;
}

export interface PartialProposal {
  id: string | undefined;
  title: string;
  status: ProposalState;
  forCount: number;
  againstCount: number;
  abstainCount: number;
  startBlock: bigint;
  endBlock: bigint;
  eta: Date | undefined;
  quorumVotes: number;
  objectionPeriodEndBlock: bigint;
  updatePeriodEndBlock: bigint;
  /** Proposer wallet address (lowercased). Surfaced for sidebar bylines. */
  proposer?: string;
  /** Unix seconds when the proposal was created on-chain (subgraph value). */
  createdTimestamp?: bigint;
}

export interface Proposal extends PartialProposal {
  description: string;
  createdBlock: bigint;
  createdTimestamp: bigint;
  proposer: Address | undefined;
  proposalThreshold: bigint;
  details: ProposalDetail[];
  transactionHash: Hash;
  signers: { id: Address }[];
  onTimelockV1: boolean;
  voteSnapshotBlock: bigint;
}

export interface ProposalVersion {
  id: string;
  createdAt: bigint;
  updateMessage: string;
  description: string;
  targets: Address[];
  values: bigint[];
  signatures: string[];
  calldatas: Hex[];
  title: string;
  details: ProposalDetail[];
  proposal: {
    id: string;
  };
  versionNumber: number;
}

export interface ProposalTransactionDetails {
  targets: Address[];
  values: bigint[];
  signatures: string[];
  calldatas: Hex[];
  encodedProposalHash: Hash;
}

export interface PartialProposalSubgraphEntity {
  id: string;
  title: string;
  status: keyof typeof ProposalState;
  forVotes: bigint;
  againstVotes: bigint;
  abstainVotes: bigint;
  startBlock: bigint;
  endBlock: bigint;
  executionETA: bigint | null;
  quorumVotes: bigint;
  objectionPeriodEndBlock: bigint;
  updatePeriodEndBlock: bigint;
  onTimelockV1: boolean | null;
  signers: { id: Address }[];
}

interface PartialProposalData {
  data: PartialProposal[] | undefined;
  error?: Error;
  loading: boolean;
}

export interface ProposalProposerAndSigners {
  id: string;
  proposer: {
    id: string;
  };
  signers: {
    id: string;
  }[];
}

export interface ProposalTransaction {
  address: Address;
  value: bigint;
  signature: string;
  calldata: Hex;
  decodedCalldata?: string;
  usdcValue?: number;
}

export interface EscrowDeposit {
  eventType: 'EscrowDeposit' | 'ForkJoin';
  id: string;
  createdAt: bigint;
  owner: { id: Address };
  reason: string;
  tokenIDs: bigint[];
  proposalIDs: number[];
}

export interface EscrowWithdrawal {
  eventType: 'EscrowWithdrawal';
  id: string;
  createdAt: bigint;
  owner: { id: Address };
  tokenIDs: bigint[];
}

export interface ForkCycleEvent {
  eventType: 'ForkStarted' | 'ForkExecuted' | 'ForkingEnded';
  id: string;
  createdAt: bigint | null;
}

export interface ProposalTitle {
  id: string;
  title: string;
}

export interface Fork {
  id: string;
  forkID: bigint;
  executed: boolean | null;
  executedAt: bigint | null;
  forkTreasury: string | null;
  forkToken: string | null;
  tokensForkingCount: number;
  tokensInEscrowCount: number;
  forkingPeriodEndTimestamp: string | null;
  addedNouns: string[];
}

export interface ForkSubgraphEntity {
  id: string;
  forkID: bigint;
  executed: boolean | null;
  executedAt: bigint | null;
  forkTreasury: string | null;
  forkToken: string | null;
  tokensForkingCount: number;
  tokensInEscrowCount: number;
  forkingPeriodEndTimestamp: string | null;
  escrowedNouns: {
    noun: {
      id: string;
    };
  }[];
  joinedNouns: {
    noun: {
      id: string;
    };
  }[];
}

const hashRegex = /^\s*#{1,6}\s+([^\n]+)/;
const equalTitleRegex = /^\s*([^\n]{1,256})\r?\n(?:={3,25}|-{3,25})/;

/**
 * Extract a markdown title from a proposal body that uses the `# Title` format
 * Returns null if no title found.
 */
const extractHashTitle = (body: string) => RegExp(hashRegex).exec(body);
/**
 * Extract a markdown title from a proposal body that uses the `Title\n===` format.
 * Returns null if no title found.
 */
const extractEqualTitle = (body: string) => RegExp(equalTitleRegex).exec(body);

/**
 * Extract title from a proposal's body/description. Returns null if no title found in the first line.
 * @param body proposal body
 */
export const extractTitle = (body: string | undefined): string | null => {
  if (!body) return null;

  // Unescape literal \n sequences (Solidity event descriptions may store them escaped)
  const normalized = body.replace(/\\n/g, '\n');

  const hashResult = extractHashTitle(normalized);
  if (hashResult && hashResult[1]) {
    return hashResult[1];
  }

  const equalResult = extractEqualTitle(normalized);
  return equalResult && equalResult[1] ? equalResult[1] : null;
};

const removeBold = (text: string): string => text.replace(/\*\*/g, '');
const removeItalics = (text: string): string => text.replace(/__/g, '');

export const removeMarkdownStyle = (text: string | null): string | null =>
  text === null ? null : pipe(text, removeBold, removeItalics);
/**
 * Add missing schemes to Markdown links in a proposal's description.
 * @param descriptionText The description text of a proposal
 */
const addMissingSchemes = (descriptionText: string | undefined) => {
  if (!descriptionText) return descriptionText;

  // Match Markdown links: [text](url)
  const markdownLinkRegex = /\[([^\]]+)]\(([^)]+)\)/g;

  return descriptionText.replace(markdownLinkRegex, (match, text, url) => {
    // If the URL already has a scheme or starts with #, leave it as is
    if (
      typeof url === 'string' &&
      (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('#'))
    ) {
      return match;
    }
    // Otherwise, add the https:// scheme
    return `[${text}](https://${url})`;
  });
};

/**
 * Replace invalid dropbox image download links in a proposal's description.
 * @param descriptionText The description text of a proposal
 */
const replaceInvalidDropboxImageLinks = (descriptionText: string | undefined) => {
  const regex = /(https:\/\/www.dropbox.com\/([^?]+))\?dl=1/g;
  const replacement = '$1?raw=1';

  return descriptionText?.replace(regex, replacement);
};

export function useDynamicQuorumProps(block: bigint): DynamicQuorumParams | undefined {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const { data } = useReadNounsGovernorGetDynamicQuorumParamsAt({
    args: [block],
  });

  if (!data) return undefined;

  return {
    minQuorumVotesBPS: Number(data.minQuorumVotesBPS),
    maxQuorumVotesBPS: Number(data.maxQuorumVotesBPS),
    quorumCoefficient: Number(data.quorumCoefficient),
  };
}

export function useHasVotedOnProposal(proposalId: bigint): boolean {
  const { address } = useAccount();
  /**
   * @ts-expect-error wagmi hook's argument types might be inferred incorrectly
   */
  const { data: receipt } = useReadNounsGovernorGetReceipt({
    args: [proposalId, address!],
    query: { enabled: Boolean(proposalId && address) },
  });

  return receipt?.hasVoted ?? false;
}

export function useProposalVote(proposalId: bigint): 'Against' | 'For' | 'Abstain' | '' {
  const { address } = useAccount();
  const enabled = Boolean(proposalId) && Boolean(address);

  /**
   * @ts-expect-error wagmi hook's return type might be inferred incorrectly or too broadly
   */
  const { data: receipt } = useReadNounsGovernorGetReceipt({
    args: [proposalId, address!],
    query: { enabled },
  });

  const voteStatus = receipt ? Number(receipt.support) : -1;

  if (voteStatus === 0) return 'Against';
  if (voteStatus === 1) return 'For';
  if (voteStatus === 2) return 'Abstain';
  return '';
}

export function useProposalCount(): number | undefined {
  const { data: count } = useReadNounsGovernorProposalCount();

  return count != null ? Number(count) : undefined;
}

export function useProposalThreshold(): number | null {
  const { data } = useReadNounsGovernorProposalThreshold();

  return data == null ? null : Number(data);
}

const countToIndices = (count: number | undefined) => {
  return typeof count === 'number' ? new Array(count).fill(0).map((_, i) => [i + 1]) : [];
};

export const concatSelectorToCalldata = (signature: string, callData: Hex): Hex => {
  if (signature) {
    return `0x${keccak256(stringToBytes(signature)).substring(2, 10)}${callData.substring(2)}` as Hex;
  }
  return callData;
};

const determineCallData = (types: string | undefined, value: bigint | undefined): string => {
  if (types) {
    return types;
  }
  if (value !== undefined) {
    return `${formatEther(BigInt(value))} ETH`;
  }
  return '';
};

export const formatProposalTransactionDetails = (details: {
  readonly targets: readonly Address[];
  readonly signatures: readonly string[];
  readonly values: readonly bigint[];
  readonly calldatas: readonly Hex[];
}) =>
  details.targets.map((target, i) => {
    const signature = details.signatures[i];
    const value = details.values[i] ?? 0n;
    const callData = details.calldatas[i];

    const [name = 'unknown', types] = (signature?.slice?.(0, -1) ?? 'unknown()').split(/\((.*)/s);

    if (!types) {
      // no types to decode, show raw calldata or fallback
      if (callData && callData !== '0x') {
        return { target, callData: concatSelectorToCalldata(signature, callData), value };
      }
      return {
        target,
        functionSig: name || 'unknown',
        callData: determineCallData('', value) as Hex,
        value,
      };
    }

    if (callData === '0x') {
      return {
        target,
        functionSig: name,
        callData: callData as Hex,
        value,
      };
    }

    try {
      const abiParams: AbiParameter[] = splitTopLevelTypes(types).map(parseOneType);

      // Pure parameter encoding is always 32-byte-aligned. If not, the calldata
      // almost certainly has a 4-byte function selector prefix or is malformed;
      // skip the decode attempt and go straight to the raw hex fallback so we
      // don't spam viem's PositionOutOfBoundsError across the console.
      const bytesLen = (callData.length - 2) / 2;
      if (bytesLen % 32 !== 0) {
        return { target, callData: concatSelectorToCalldata(signature, callData), value };
      }

      const decoded = decodeAbiParameters(abiParams, callData);
      return {
        target,
        functionSig: name,
        callData: (decoded as string[]).join() as Hex,
        value,
      };
    } catch (err) {
      // Fallback renders raw hex; debug-level so stale/malformed proposals
      // don't flood the production console.
      console.debug('decodeAbiParameters fallback:', err);
      return { target, callData: concatSelectorToCalldata(signature, callData), value };
    }
  });

/**
 * Split a comma-separated Solidity types string on top-level commas only, keeping
 * nested tuples together. "(uint32,uint32),uint256" → ["(uint32,uint32)", "uint256"]
 */
function splitTopLevelTypes(types: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < types.length; i++) {
    const ch = types[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      if (buf.trim() !== '') out.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim() !== '') out.push(buf.trim());
  return out;
}

/**
 * Turn one Solidity type string into a viem AbiParameter.
 * Builds the AbiParameter tree directly rather than relying on parseAbiParameter,
 * because abitype rejects bare anonymous tuples like "tuple(uint,address)"
 * (it expects named components in its string parser).
 * Handles:
 * - "uint256"                   → { type: 'uint256' }
 * - "(uint32,address)"          → { type: 'tuple', components: [...] }
 * - "(uint32,address)[]"        → { type: 'tuple[]', components: [...] }
 * - "((uint,bytes),address)"    → recursive nested tuples
 */
function parseOneType(t: string): AbiParameter {
  const trimmed = t.trim();

  // Pull off trailing array suffixes: "foo[]", "foo[3]", "foo[][4]" etc.
  const arrayMatch = trimmed.match(/^(.+?)((?:\[\d*])+)$/);
  if (arrayMatch !== null) {
    const base = parseOneType(arrayMatch[1]);
    return { ...base, type: `${base.type}${arrayMatch[2]}` } as AbiParameter;
  }

  // Tuple: "(t1,t2,t3)" → recurse into each inner type.
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    const inner = trimmed.slice(1, -1);
    return {
      type: 'tuple',
      components: splitTopLevelTypes(inner).map(parseOneType),
    } as AbiParameter;
  }

  // Primitive.
  return { type: trimmed };
}

export const formatProposalTransactionDetailsToUpdate = (details: {
  targets: Address[];
  signatures: string[];
  values?: bigint[];
  calldatas: Hex[];
}) =>
  details.targets.map((target, i) => ({
    target,
    functionSig: details.signatures[i],
    callData: details.calldatas[i],
    value: details.values?.[i] ?? 0n,
  }));

export function useFormattedProposalCreatedLogs(skip: boolean, fromBlockOverride?: number) {
  const publicClient = usePublicClient();
  const chainId = defaultChain.id;

  const proposalCreatedEvent = parseAbiItem(
    'event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, bytes[] calldatas, uint256 startBlock, uint256 endBlock, string description)',
  );

  // pick the right starting block
  let fromBlock: bigint;
  if (fromBlockOverride != null) {
    fromBlock = BigInt(fromBlockOverride);
  } else if (chainId === mainnet.id) {
    fromBlock = 12985453n;
  } else {
    fromBlock = 0n;
  }

  const { data: logs } = useReactQuery({
    queryKey: ['proposalCreatedLogs', fromBlock.toString()],
    queryFn: () =>
      publicClient.getLogs({
        address: nounsGovernorAddress[chainId],
        event: proposalCreatedEvent,
        fromBlock,
      }),
    enabled: !skip,
  });

  // decode and massage the results
  return useMemo(() => {
    if (!logs) return [];
    return logs.map(log => {
      const parsed = decodeEventLog({
        abi: nounsGovernorAbi,
        eventName: 'ProposalCreated',
        data: log.data,
        topics: log.topics,
      });
      return {
        description: parsed.args.description,
        transactionHash: log.transactionHash,
        details: formatProposalTransactionDetails(parsed.args),
      };
    });
  }, [logs]);
}

const getProposalState = (
  blockNumber: number | undefined,
  blockTimestamp: Date | undefined,
  proposal: GraphQLProposal,
  isDaoGteV3?: boolean,
  onTimelockV1?: boolean,
  dynamicQuorum?: bigint,
) => {
  // Get the initial status from the proposal
  const status = isNonNullish(proposal.status)
    ? ProposalState[proposal.status as keyof typeof ProposalState]
    : ProposalState.UNDETERMINED;

  // Handle specific status cases with dedicated functions
  if (status === ProposalState.PENDING || status === ProposalState.ACTIVE) {
    return handlePendingOrActiveState(blockNumber, proposal, isDaoGteV3, dynamicQuorum);
  }

  if (status === ProposalState.QUEUED) {
    return handleQueuedState(blockTimestamp, proposal, isDaoGteV3, onTimelockV1);
  }

  return status;
};

// Handle the state for PENDING or ACTIVE proposals
const handlePendingOrActiveState = (
  blockNumber: number | undefined,
  proposal: GraphQLProposal,
  isDaoGteV3?: boolean,
  dynamicQuorum?: bigint,
): ProposalState => {
  if (blockNumber === undefined) {
    return ProposalState.UNDETERMINED;
  }

  // Check if it's in UPDATABLE state
  if (isUpdatableProposal(blockNumber, proposal, isDaoGteV3)) {
    return ProposalState.UPDATABLE;
  }

  // Check if it's in PENDING state
  if (blockNumber <= BigInt(proposal.startBlock ?? 0)) {
    return ProposalState.PENDING;
  }

  // Check if it's in OBJECTION_PERIOD state
  if (isInObjectionPeriod(blockNumber, proposal, isDaoGteV3)) {
    return ProposalState.OBJECTION_PERIOD;
  }

  // Check if past end block and determine resulting state
  if (isPastEndBlock(blockNumber, proposal)) {
    return getPastEndBlockState(proposal, dynamicQuorum);
  }

  return ProposalState.ACTIVE;
};

// Check if a proposal is in UPDATABLE state
const isUpdatableProposal = (
  blockNumber: number,
  proposal: GraphQLProposal,
  isDaoGteV3?: boolean,
): boolean => {
  return Boolean(
    isDaoGteV3 === true &&
      isBigInt(proposal.updatePeriodEndBlock) &&
      blockNumber <= proposal.updatePeriodEndBlock,
  );
};

// Check if a proposal is in OBJECTION_PERIOD state
const isInObjectionPeriod = (
  blockNumber: number,
  proposal: GraphQLProposal,
  isDaoGteV3?: boolean,
): boolean => {
  if (!proposal.objectionPeriodEndBlock) return false;
  return Boolean(
    isDaoGteV3 === true &&
      blockNumber > proposal.endBlock &&
      blockNumber <= proposal.objectionPeriodEndBlock,
  );
};

// Check if a proposal is past its end block
const isPastEndBlock = (blockNumber: number, proposal: GraphQLProposal): boolean => {
  return (
    blockNumber > BigInt(proposal.endBlock ?? 0) &&
    blockNumber > BigInt(proposal.objectionPeriodEndBlock ?? 0)
  );
};

// Determine the state for a proposal that is past its end block
// dynamicQuorum overrides proposal.quorumVotes when available (accounts for dynamic quorum)
const getPastEndBlockState = (proposal: GraphQLProposal, dynamicQuorum?: bigint): ProposalState => {
  const forVotes = BigInt(proposal.forVotes ?? 0);
  const quorum = dynamicQuorum ?? BigInt(proposal.quorumVotes ?? 0);
  if (forVotes <= BigInt(proposal.againstVotes ?? 0) || forVotes < quorum) {
    return ProposalState.DEFEATED;
  }

  if (proposal.executionETA == null) {
    return ProposalState.SUCCEEDED;
  }

  return ProposalState.ACTIVE;
};

// Handle the state for QUEUED proposals
const handleQueuedState = (
  blockTimestamp: Date | undefined,
  proposal: GraphQLProposal,
  isDaoGteV3?: boolean,
  onTimelockV1?: boolean,
): ProposalState => {
  if (blockTimestamp == null || proposal.executionETA == null) {
    return ProposalState.UNDETERMINED;
  }

  if (isExpiredProposal(blockTimestamp, proposal, isDaoGteV3, onTimelockV1)) {
    return ProposalState.EXPIRED;
  }

  return ProposalState.QUEUED;
};

// Check if a queued proposal has expired
const isExpiredProposal = (
  blockTimestamp: Date,
  proposal: GraphQLProposal,
  isDaoGteV3?: boolean,
  onTimelockV1?: boolean,
): boolean => {
  // If v3+ and not on time lock v1, grace period is 21 days, otherwise 14 days
  const GRACE_PERIOD =
    isDaoGteV3 != null && isDaoGteV3 && onTimelockV1 != null && !onTimelockV1
      ? 21 * 60 * 60 * 24
      : 14 * 60 * 60 * 24;

  return blockTimestamp.getTime() / 1_000 >= Number(proposal.executionETA) + Number(GRACE_PERIOD);
};

const parsePartialSubgraphProposal = (
  proposal: GraphQLProposal | undefined,
  blockNumber: bigint | number | undefined,
  timestamp: number | undefined,
  isDaoGteV3?: boolean,
): PartialProposal | undefined => {
  if (isNullish(proposal)) {
    return undefined;
  }

  const onTimelockV1 = proposal.onTimelockV1 !== null;
  return {
    id: proposal.id,
    title: proposal.title ?? extractTitle(proposal.description) ?? `Proposal ${proposal.id}`,
    status: getProposalState(
      Number(blockNumber),
      new Date((timestamp ?? 0) * 1000),
      proposal,
      isDaoGteV3,
      onTimelockV1,
    ),
    startBlock: BigInt(proposal.startBlock ?? 0),
    endBlock: BigInt(proposal.endBlock ?? 0),
    updatePeriodEndBlock: BigInt(proposal?.updatePeriodEndBlock ?? 0),
    forCount: Number(proposal.forVotes ?? 0),
    againstCount: Number(proposal.againstVotes ?? 0),
    abstainCount: Number(proposal.abstainVotes ?? 0),
    quorumVotes: Number(proposal?.quorumVotes ?? 0),
    eta: proposal.executionETA != null ? new Date(Number(proposal.executionETA) * 1000) : undefined,
    objectionPeriodEndBlock: BigInt(proposal?.objectionPeriodEndBlock ?? 0),
    proposer:
      typeof proposal.proposer === 'string'
        ? proposal.proposer.toLowerCase()
        : ((proposal.proposer as unknown as { id?: string })?.id?.toLowerCase() ?? undefined),
    createdTimestamp: proposal.createdAt
      ? BigInt(proposal.createdAt)
      : proposal.createdTimestamp
        ? BigInt(proposal.createdTimestamp)
        : undefined,
  };
};

const parseSubgraphProposal = (
  proposal: GraphQLProposal | undefined,
  blockNumber: number | undefined,
  timestamp: number | undefined,
  toUpdate?: boolean,
  isDaoGteV3?: boolean,
  dynamicQuorum?: bigint,
): Proposal | undefined => {
  if (isNullish(proposal)) {
    return;
  }

  const description = addMissingSchemes(
    replaceInvalidDropboxImageLinks(
      proposal.description?.replace(/\\n/g, '\n').replace(/(^["']|["']$)/g, ''),
    ),
  );
  const transactionDetails: ProposalTransactionDetails = {
    targets: map(proposal.targets ?? [], t => t as Address),
    values: map(proposal.values ?? [], v => BigInt(v)),
    signatures: map(proposal.signatures ?? [], s => s),
    calldatas: map(proposal.calldatas ?? [], t => t as Hex),
    encodedProposalHash: '' as Hash,
  };

  let details;
  if (toUpdate !== undefined && toUpdate) {
    details = formatProposalTransactionDetailsToUpdate(transactionDetails);
  } else {
    details = formatProposalTransactionDetails(transactionDetails);
  }
  const onTimelockV1 = proposal.onTimelockV1 != null;
  return {
    id: proposal.id,
    title: pipe(description, extractTitle, removeMarkdownStyle) ?? 'Untitled',
    description: description ?? 'No description.',
    proposer: (typeof proposal.proposer === 'string'
      ? proposal.proposer
      : (proposal.proposer as unknown as { id: string })?.id) as Address,
    status: getProposalState(
      blockNumber,
      new Date((timestamp ?? 0) * 1000),
      proposal,
      isDaoGteV3,
      onTimelockV1,
      dynamicQuorum,
    ),
    proposalThreshold: BigInt(proposal.proposalThreshold ?? 0),
    quorumVotes: Number(proposal.quorumVotes ?? 0),
    forCount: Number(proposal.forVotes ?? 0),
    againstCount: Number(proposal.againstVotes ?? 0),
    abstainCount: Number(proposal.abstainVotes ?? 0),
    createdBlock: BigInt(proposal.createdBlock ?? 0),
    startBlock: BigInt(proposal.startBlock ?? 0),
    endBlock: BigInt(proposal.endBlock ?? 0),
    createdTimestamp: BigInt(proposal.createdTimestamp ?? 0),
    eta: proposal.executionETA != null ? new Date(Number(proposal.executionETA) * 1000) : undefined,
    details: details,
    transactionHash: proposal.createdTransactionHash as Hash,
    objectionPeriodEndBlock: BigInt(proposal.objectionPeriodEndBlock ?? 0),
    updatePeriodEndBlock: BigInt(proposal.updatePeriodEndBlock ?? 0),
    signers: map(proposal.signers ?? [], v => ({ id: v.id as Address })),
    onTimelockV1: onTimelockV1,
    voteSnapshotBlock: BigInt(proposal.voteSnapshotBlock ?? proposal.startBlock ?? 0),
  };
};

// Module-level cache so paginated fetch survives React remounts
let _proposalsCache: GraphQLProposal[] | null = null;
let _proposalsFetchPromise: Promise<GraphQLProposal[]> | null = null;

function fetchAllProposals(url: string): Promise<GraphQLProposal[]> {
  if (_proposalsCache) return Promise.resolve(_proposalsCache);
  if (_proposalsFetchPromise) return _proposalsFetchPromise;

  _proposalsFetchPromise = (async () => {
    // Use REST endpoint — single request, no chunked encoding, no Fastly truncation.
    const baseUrl = url.replace(/\/graphql$/, '').replace(/\/$/, '');
    const res = await fetch(`${baseUrl}/api/proposals`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items: Array<GraphQLProposal & { signers?: string[] }> = await res.json();
    // Adapt REST response shape to match GraphQL shape expected downstream
    const allItems: GraphQLProposal[] = items.map(p => ({
      ...p,
      signers: (p.signers ?? []).map((s: string) => ({ id: s })),
    }));

    _proposalsCache = allItems;
    _proposalsFetchPromise = null;
    return allItems;
  })().catch(e => {
    _proposalsFetchPromise = null;
    throw e;
  });

  return _proposalsFetchPromise;
}

export const useAllProposalsViaSubgraph = (): PartialProposalData => {
  const chainId = defaultChain.id;

  const [data, setData] = useState<{ proposals: { items: GraphQLProposal[] } } | undefined>(
    _proposalsCache ? { proposals: { items: _proposalsCache } } : undefined,
  );
  const [loading, setLoading] = useState(!_proposalsCache);
  const [error, setError] = useState<Error | undefined>();

  useEffect(() => {
    if (_proposalsCache) {
      setData({ proposals: { items: _proposalsCache } });
      setLoading(false);
      return;
    }
    const url = getSubgraphUrl();
    if (!url) {
      setError(new Error('No subgraph URL'));
      setLoading(false);
      return;
    }
    fetchAllProposals(url)
      .then(items => {
        setData({ proposals: { items } });
        setLoading(false);
      })
      .catch(e => {
        setError(e);
        setLoading(false);
      });
  }, []);

  const isDaoGteV3 = useIsDaoGteV3();
  const { data: blockNumber } = useBlockNumber();
  const timestamp = useBlockTimestamp(blockNumber);

  // Unwrap Ponder items and adapt flat proposer/signers to expected shape
  const rawProposals = data?.proposals?.items ?? [];
  const adaptedProposals = rawProposals.map(p => ({
    ...p,
    // Adapt flat Ponder fields to match what parsing functions expect
    createdBlock: p.createdAtBlock,
    createdTimestamp: BigInt(p.createdAt ?? 0),
    createdTransactionHash: p.createdAtTransaction ?? '',
    voteSnapshotBlock: p.startBlock,
    signers:
      (p as unknown as { signers?: { items?: { signer: string }[] } }).signers?.items?.map(
        (s: { signer: string }) => ({ id: s.signer }),
      ) ?? [],
  }));

  // Fetch authoritative on-chain state() only for non-terminal proposals.
  // Terminal proposals (CANCELLED, VETOED, EXECUTED) never change state,
  // so Ponder's status is authoritative for those. This reduces multicalls
  // from ~700+ to ~20-30 (only PENDING, ACTIVE, QUEUED proposals).
  const TERMINAL_STATUSES = new Set(['CANCELLED', 'VETOED', 'EXECUTED']);
  const nonTerminalProposals = useMemo(
    () => rawProposals.filter(p => !TERMINAL_STATUSES.has(p.status)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawProposals.length],
  );

  const onChainStateCalls = useMemo(
    () =>
      nonTerminalProposals.map(p => ({
        abi: nounsGovernorAbi,
        address: nounsGovernorAddress[chainId],
        functionName: 'state' as const,
        args: [BigInt(p.id)],
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nonTerminalProposals.length, chainId],
  );

  // Batch-call quorumVotes(proposalId) for non-terminal proposals to get dynamic quorum
  const onChainQuorumCalls = useMemo(
    () =>
      nonTerminalProposals.map(p => ({
        abi: nounsGovernorAbi,
        address: nounsGovernorAddress[chainId],
        functionName: 'quorumVotes' as const,
        args: [BigInt(p.id)],
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nonTerminalProposals.length, chainId],
  );

  const { data: onChainStates } = useReadContracts({
    contracts: onChainStateCalls,
    query: { enabled: onChainStateCalls.length > 0 },
  });

  const { data: onChainQuorums } = useReadContracts({
    contracts: onChainQuorumCalls,
    query: { enabled: onChainQuorumCalls.length > 0 },
  });

  // Map on-chain state int → ProposalState enum (non-terminal only)
  const onChainStateMap = useMemo(() => {
    const stateMap = new Map<string, ProposalState>();
    if (!onChainStates) return stateMap;
    nonTerminalProposals.forEach((p, i) => {
      const result = onChainStates[i];
      if (result?.status === 'success' && result.result != null) {
        stateMap.set(String(p.id), Number(result.result) as ProposalState);
      }
    });
    return stateMap;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChainStates, nonTerminalProposals.length]);

  // Map on-chain dynamic quorum for non-terminal proposals
  const onChainQuorumMap = useMemo(() => {
    const quorumMap = new Map<string, number>();
    if (!onChainQuorums) return quorumMap;
    nonTerminalProposals.forEach((p, i) => {
      const result = onChainQuorums[i];
      if (result?.status === 'success' && result.result != null) {
        quorumMap.set(String(p.id), Number(result.result));
      }
    });
    return quorumMap;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChainQuorums, nonTerminalProposals.length]);

  const proposals = pipe(
    adaptedProposals,
    map(proposal => {
      const parsed = parsePartialSubgraphProposal(
        proposal,
        Number(blockNumber),
        timestamp,
        isDaoGteV3,
      );
      if (!parsed) return undefined;
      // Override status with on-chain state if available (fixes dynamic quorum)
      const onChainState = onChainStateMap.get(String(parsed.id));
      if (onChainState !== undefined) {
        parsed.status = onChainState;
      }
      // Override quorumVotes with on-chain dynamic quorum if available
      const onChainQuorum = onChainQuorumMap.get(String(parsed.id));
      if (onChainQuorum !== undefined) {
        parsed.quorumVotes = onChainQuorum;
      }
      return parsed;
    }),
    filter((x): x is PartialProposal => x !== undefined),
  );

  return {
    loading,
    error,
    data: proposals,
  };
};

export const useAllProposalsViaChain = (skip = false): PartialProposalData => {
  const proposalCount = useProposalCount();
  const govProposalIndexes = useMemo(() => countToIndices(proposalCount), [proposalCount]);
  const chainId = defaultChain.id;

  const proposalCalls = useMemo(
    () =>
      govProposalIndexes.map(idx => ({
        abi: nounsGovernorAbi,
        address: nounsGovernorAddress[chainId],
        functionName: 'proposals',
        args: [idx],
      })),
    [govProposalIndexes],
  );

  const stateCalls = useMemo(
    () =>
      govProposalIndexes.map(idx => ({
        abi: nounsGovernorAbi,
        address: nounsGovernorAddress[chainId],
        functionName: 'state',
        args: [idx],
      })),
    [govProposalIndexes],
  );

  // Batch-call quorumVotes(proposalId) to get dynamic quorum for each proposal
  const quorumCalls = useMemo(
    () =>
      govProposalIndexes.map(idx => ({
        abi: nounsGovernorAbi,
        address: nounsGovernorAddress[chainId],
        functionName: 'quorumVotes' as const,
        args: [idx],
      })),
    [govProposalIndexes],
  );

  const { data: proposalResults, isLoading: loadingProposals } = useReadContracts<
    { result?: ProposalCallResult }[]
  >({
    contracts: proposalCalls,
    query: { enabled: !skip && proposalCalls.length > 0 },
  });
  const proposals = pipe(
    proposalResults ?? [],
    flatMap(item => (isNullish(item.result) ? [] : [item.result])),
  ) as ProposalCallResult[];

  const { data: stateResults, isLoading: loadingStates } = useReadContracts<{ result?: number }[]>({
    contracts: stateCalls,
    query: { enabled: !skip && stateCalls.length > 0 },
  });
  const proposalStates = pipe(
    stateResults ?? [],
    flatMap(item => (isNullish(item.result) ? [] : [item.result])),
  ) as number[];

  const { data: quorumResults } = useReadContracts<{ result?: bigint }[]>({
    contracts: quorumCalls,
    query: { enabled: !skip && quorumCalls.length > 0 },
  });
  const dynamicQuorums = pipe(
    quorumResults ?? [],
    map(item => (item.result != null ? Number(item.result) : undefined)),
  );

  const formattedLogs = useFormattedProposalCreatedLogs(skip);

  // Early return until events are fetched
  return useMemo(() => {
    const logs = formattedLogs ?? [];
    if (!skip && proposals.length > 0 && formattedLogs?.length === 0) {
      return { data: [], loading: true };
    }

    return {
      data: proposals.map((proposal, i) => {
        const description = addMissingSchemes(logs[i]?.description?.replace(/\\n/g, '\n'));
        return {
          id: proposal?.id.toString(),
          title: pipe(description, extractTitle, removeMarkdownStyle) ?? 'Untitled',
          status: proposalStates[i] ?? ProposalState.UNDETERMINED,
          startBlock: BigInt(proposal?.startBlock?.toString() ?? '0'),
          endBlock: BigInt(proposal?.endBlock?.toString() ?? '0'),
          objectionPeriodEndBlock: BigInt(proposal?.objectionPeriodEndBlock?.toString() ?? 0),
          forCount: Number(proposal?.forVotes?.toString() ?? '0'),
          againstCount: Number(proposal?.againstVotes?.toString() ?? '0'),
          abstainCount: Number(proposal?.abstainVotes?.toString() ?? '0'),
          quorumVotes: dynamicQuorums[i] ?? Number(proposal?.quorumVotes?.toString() ?? '0'),
          eta: proposal?.eta ? new Date(Number(proposal?.eta) * 1000) : undefined,
          updatePeriodEndBlock: BigInt(proposal?.updatePeriodEndBlock?.toString() ?? 0),
        };
      }),
      loading: loadingProposals || loadingStates,
    };
  }, [formattedLogs, proposalStates, proposals, dynamicQuorums]);
};

export const useAllProposals = (): PartialProposalData => {
  const subgraph = useAllProposalsViaSubgraph();
  const onchain = useAllProposalsViaChain(!subgraph.error);
  return subgraph?.error ? onchain : subgraph;
};

export const useProposal = (id: string | number, toUpdate?: boolean) => {
  const { data: blockNumber } = useBlockNumber();
  const timestamp = useBlockTimestamp(blockNumber);
  const isDaoGteV3 = useIsDaoGteV3();

  // Fetch from REST endpoint first (bypasses Fastly/GraphQL truncation)
  const subgraphUrl = getSubgraphUrl();
  const restBase = subgraphUrl.replace(/\/graphql\/?$/, '').replace(/\/$/, '');
  const [restData, setRestData] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (id == null || id === '') return;
    fetch(`${restBase}/api/proposals/${id}`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: Record<string, unknown> | null) => {
        if (d != null && d.proposal != null) setRestData(d.proposal as Record<string, unknown>);
      })
      .catch(() => {});
  }, [id, restBase]);

  // Also try GraphQL as fallback
  const { query, variables } = proposalQuery(id);
  const { data } = useQuery<{
    proposal: Maybe<{
      id: string;
      description: string;
      status: string;
      proposalThreshold: bigint | null;
      quorumVotes: bigint | null;
      forVotes: bigint;
      againstVotes: bigint;
      abstainVotes: bigint;
      createdAtTransaction: string;
      createdAtBlock: bigint;
      createdAt: string;
      startBlock: bigint;
      endBlock: bigint;
      updatePeriodEndBlock: bigint | null;
      objectionPeriodEndBlock: bigint;
      executionETA: bigint | null;
      onTimelockV1: boolean | null;
      voteSnapshotBlock: bigint | null;
      proposer: string;
      clientId: number | null;
      signers: { items: { signer: string }[] };
      transactions: {
        items: { target: string; value: string; signature: string; calldata: string }[];
      };
    }>;
  }>(query, { variables });

  // Read the authoritative on-chain proposal state (handles dynamic quorum correctly)
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const { data: onChainState } = useReadNounsGovernorState({
    args: [BigInt(id ?? 0)],
    query: { enabled: Boolean(id) },
  });

  // Read the dynamic quorum from the contract (accounts for against votes)
  const { data: onChainQuorum } = useReadContracts({
    contracts: [
      {
        abi: nounsGovernorAbi,
        address: nounsGovernorAddress[defaultChain.id],
        functionName: 'quorumVotes' as const,
        args: [BigInt(id ?? 0)],
      },
    ],
    query: { enabled: Boolean(id) },
  });

  // Prefer REST data if available, otherwise use GraphQL
  const raw = data?.proposal;
  let proposal: GraphQLProposal | undefined;

  if (restData) {
    // REST shape: flat object with signers[] and transactions[]
    const rd = restData;
    proposal = {
      id: String(rd.id),
      description: (rd.description as string) ?? '',
      status: (rd.status as string) ?? '',
      proposalThreshold: BigInt((rd.proposalThreshold as string) ?? '0'),
      quorumVotes: BigInt((rd.quorumVotes as string) ?? '0'),
      forVotes: BigInt((rd.forVotes as number) ?? 0),
      againstVotes: BigInt((rd.againstVotes as number) ?? 0),
      abstainVotes: BigInt((rd.abstainVotes as number) ?? 0),
      createdBlock: BigInt((rd.createdAtBlock as string) ?? '0'),
      createdAtBlock: BigInt((rd.createdAtBlock as string) ?? '0'),
      createdAt: (rd.createdAt as string) ?? '0',
      createdAtTransaction: (rd.createdAtTransaction as string) ?? '',
      createdTimestamp: BigInt((rd.createdAt as string) ?? '0'),
      createdTransactionHash: (rd.createdAtTransaction as string) ?? '',
      startBlock: BigInt((rd.startBlock as string) ?? '0'),
      endBlock: BigInt((rd.endBlock as string) ?? '0'),
      updatePeriodEndBlock:
        rd.updatePeriodEndBlock != null ? BigInt(rd.updatePeriodEndBlock as string) : null,
      objectionPeriodEndBlock: BigInt((rd.objectionPeriodEndBlock as string) ?? '0'),
      executionETA: rd.executionETA != null ? BigInt(rd.executionETA as string) : null,
      onTimelockV1: (rd.onTimelockV1 as boolean) ?? null,
      voteSnapshotBlock:
        rd.voteSnapshotBlock != null
          ? BigInt(rd.voteSnapshotBlock as string)
          : BigInt((rd.startBlock as string) ?? '0'),
      proposer: (rd.proposer as string) ?? '',
      clientId: (rd.clientId as number) ?? null,
      signers: ((rd.signers as string[]) ?? []).map(s => ({ id: s })),
      targets: ((rd.transactions as { target: string }[]) ?? []).map(t => t.target),
      values: ((rd.transactions as { value: string }[]) ?? []).map(t => String(t.value)),
      signatures: ((rd.transactions as { signature: string }[]) ?? []).map(t => t.signature),
      calldatas: ((rd.transactions as { calldata: string }[]) ?? []).map(t => t.calldata),
    };
  } else if (raw) {
    // GraphQL shape: nested signers.items and transactions.items
    proposal = {
      ...raw,
      createdBlock: raw.createdAtBlock,
      createdTimestamp: BigInt(raw.createdAt ?? 0),
      createdTransactionHash: raw.createdAtTransaction ?? '',
      voteSnapshotBlock: raw.voteSnapshotBlock ?? raw.startBlock,
      signers: raw.signers?.items?.map(s => ({ id: s.signer })) ?? [],
      targets: raw.transactions?.items?.map(t => t.target) ?? [],
      values: raw.transactions?.items?.map(t => t.value) ?? [],
      signatures: raw.transactions?.items?.map(t => t.signature) ?? [],
      calldatas: raw.transactions?.items?.map(t => t.calldata) ?? [],
    };
  }

  const parsed = parseSubgraphProposal(
    proposal,
    Number(blockNumber),
    timestamp,
    toUpdate,
    isDaoGteV3,
  );

  // Override with authoritative on-chain state if available
  // On-chain state() correctly accounts for dynamic quorum
  if (parsed && onChainState != null) {
    parsed.status = Number(onChainState) as ProposalState;
  }

  // Override quorumVotes with on-chain dynamic quorum if available
  if (parsed && onChainQuorum?.[0]?.status === 'success' && onChainQuorum[0].result != null) {
    parsed.quorumVotes = Number(onChainQuorum[0].result);
  }

  return parsed;
};

export const useProposalTitles = (ids: number[]): ProposalTitle[] | undefined => {
  const { query, variables } = proposalTitlesQuery(ids);
  const { data } = useQuery<{
    proposals: { items: Array<{ id: string; description: string }> };
  }>(query, { variables });

  return (
    data?.proposals?.items?.map(proposal => ({
      id: proposal.id,
      title: extractTitle(proposal.description) ?? 'Untitled',
    })) ?? undefined
  );
};

export const useProposalVersions = (id: string | number): ProposalVersion[] | undefined => {
  // Proposal versions not indexed by Ponder — return empty
  const { query, variables } = proposalVersionsQuery(id);
  useQuery(query, { variables, skip: true });
  return [];
};

export function useCancelSignature() {
  const {
    data: hash,
    writeContractAsync: cancelSig,
    isPending: isCancelPending,
    isSuccess: isCancelSuccess,
    error: cancelError,
  } = useWriteNounsGovernorCancelSig();

  let status = 'None';
  if (isCancelPending) status = 'Mining';
  else if (isCancelSuccess) status = 'Success';
  else if (cancelError) status = 'Fail';

  const cancelSigState = {
    status,
    errorMessage: cancelError?.message,
    transaction: { hash },
  };

  return {
    cancelSig,
    cancelSigState,
  };
}

export function useCastRefundableVote() {
  const {
    data: hash,
    writeContractAsync: castRefundableVote,
    isPending: isCastRefundableVotePending,
    isSuccess: isCastRefundableVoteSuccess,
    error: castRefundableVoteError,
  } = useWriteNounsGovernorCastRefundableVote();

  let status = 'None';
  if (isCastRefundableVotePending) status = 'Mining';
  else if (isCastRefundableVoteSuccess) status = 'Success';
  else if (castRefundableVoteError) status = 'Fail';

  const castRefundableVoteState = {
    status,
    errorMessage: castRefundableVoteError?.message,
    transaction: { hash },
  };

  return { castRefundableVote, castRefundableVoteState };
}

export function useCastRefundableVoteWithReason() {
  const {
    data: hash,
    writeContractAsync: castRefundableVoteWithReason,
    isPending: isCastRefundableVoteWithReasonPending,
    isSuccess: isCastRefundableVoteWithReasonSuccess,
    error: castRefundableVoteWithReasonError,
  } = useWriteNounsGovernorCastRefundableVoteWithReason();

  let status = 'None';
  if (isCastRefundableVoteWithReasonPending) status = 'Mining';
  else if (isCastRefundableVoteWithReasonSuccess) status = 'Success';
  else if (castRefundableVoteWithReasonError) status = 'Fail';

  const castRefundableVoteWithReasonState = {
    status,
    errorMessage: castRefundableVoteWithReasonError?.message,
    transaction: { hash },
  };

  return { castRefundableVoteWithReason, castRefundableVoteWithReasonState };
}

export function usePropose() {
  const {
    data: hash,
    writeContractAsync: propose,
    isPending: isProposePending,
    isSuccess: isProposeSuccess,
    error: proposeError,
  } = useWriteNounsGovernorPropose();

  let status = 'None';
  if (isProposePending) status = 'Mining';
  else if (isProposeSuccess) status = 'Success';
  else if (proposeError) status = 'Fail';

  const proposeState = {
    status,
    errorMessage: proposeError?.message,
    transaction: { hash },
  };

  return { propose, proposeState };
}

export function useProposeOnTimelockV1() {
  const {
    data: hash,
    writeContractAsync: proposeOnTimelockV1,
    isPending: isProposeOnTimelockV1Pending,
    isSuccess: isProposeOnTimelockV1Success,
    error: proposeOnTimelockV1Error,
  } = useWriteNounsGovernorProposeOnTimelockV1();

  let status = 'None';
  if (isProposeOnTimelockV1Pending) status = 'Mining';
  else if (isProposeOnTimelockV1Success) status = 'Success';
  else if (proposeOnTimelockV1Error) status = 'Fail';

  const proposeOnTimelockV1State = {
    status,
    errorMessage: proposeOnTimelockV1Error?.message,
    transaction: { hash },
  };

  return { proposeOnTimelockV1, proposeOnTimelockV1State };
}

export function useUpdateProposal() {
  const {
    data: hash,
    writeContractAsync: updateProposal,
    isPending: isUpdateProposalPending,
    isSuccess: isUpdateProposalSuccess,
    error: updateProposalError,
  } = useWriteNounsGovernorUpdateProposal();

  let status = 'None';
  if (isUpdateProposalPending) status = 'Mining';
  else if (isUpdateProposalSuccess) status = 'Success';
  else if (updateProposalError) status = 'Fail';

  const updateProposalState = {
    status,
    errorMessage: updateProposalError?.message,
    transaction: { hash },
  };

  return { updateProposal, updateProposalState };
}

export function useUpdateProposalTransactions() {
  const {
    data: hash,
    writeContractAsync: updateProposalTransactions,
    isPending: isUpdateProposalTransactionsPending,
    isSuccess: isUpdateProposalTransactionsSuccess,
    error: updateProposalTransactionsError,
  } = useWriteNounsGovernorUpdateProposalTransactions();

  let status = 'None';
  if (isUpdateProposalTransactionsPending) status = 'Mining';
  else if (isUpdateProposalTransactionsSuccess) status = 'Success';
  else if (updateProposalTransactionsError) status = 'Fail';

  const updateProposalTransactionsState = {
    status,
    errorMessage: updateProposalTransactionsError?.message,
    transaction: { hash },
  };

  return { updateProposalTransactions, updateProposalTransactionsState };
}

export function useUpdateProposalDescription() {
  const {
    data: hash,
    writeContractAsync: updateProposalDescription,
    isPending: isUpdateProposalDescriptionPending,
    isSuccess: isUpdateProposalDescriptionSuccess,
    error: updateProposalDescriptionError,
  } = useWriteNounsGovernorUpdateProposalDescription();

  let status = 'None';
  if (isUpdateProposalDescriptionPending) status = 'Mining';
  else if (isUpdateProposalDescriptionSuccess) status = 'Success';
  else if (updateProposalDescriptionError) status = 'Fail';

  const updateProposalDescriptionState = {
    status,
    errorMessage: updateProposalDescriptionError?.message,
    transaction: { hash },
  };

  return { updateProposalDescription, updateProposalDescriptionState };
}

export function useQueueProposal() {
  const {
    data: hash,
    writeContractAsync: queueProposal,
    isPending: isQueueProposalPending,
    isSuccess: isQueueProposalSuccess,
    error: queueProposalError,
  } = useWriteNounsGovernorQueue();

  let status = 'None';
  if (isQueueProposalPending) status = 'Mining';
  else if (isQueueProposalSuccess) status = 'Success';
  else if (queueProposalError) status = 'Fail';

  const queueProposalState = {
    status,
    errorMessage: queueProposalError?.message,
    transaction: { hash },
  };

  return { queueProposal, queueProposalState };
}

export function useCancelProposal() {
  const {
    data: hash,
    writeContractAsync: cancelProposal,
    isPending: isCancelProposalPending,
    isSuccess: isCancelProposalSuccess,
    error: cancelProposalError,
  } = useWriteNounsGovernorCancel();

  let status = 'None';
  if (isCancelProposalPending) status = 'Mining';
  else if (isCancelProposalSuccess) status = 'Success';
  else if (cancelProposalError) status = 'Fail';

  const cancelProposalState = {
    status,
    errorMessage: cancelProposalError?.message,
    transaction: { hash },
  };

  return { cancelProposal, cancelProposalState };
}

export function useExecuteProposal() {
  const {
    data: hash,
    writeContractAsync: executeProposal,
    isPending: isExecuteProposalPending,
    isSuccess: isExecuteProposalSuccess,
    error: executeProposalError,
  } = useWriteNounsGovernorExecute();

  let status = 'None';
  if (isExecuteProposalPending) status = 'Mining';
  else if (isExecuteProposalSuccess) status = 'Success';
  else if (executeProposalError) status = 'Fail';

  const executeProposalState = {
    status,
    errorMessage: executeProposalError?.message,
    transaction: { hash },
  };

  return { executeProposal, executeProposalState };
}

export function useEscrowToFork() {
  const {
    data: hash,
    writeContractAsync: escrowToFork,
    isPending: isEscrowToForkPending,
    isSuccess: isEscrowToForkSuccess,
    error: escrowToForkError,
  } = useWriteNounsGovernorEscrowToFork();

  let status = 'None';
  if (isEscrowToForkPending) status = 'Mining';
  else if (isEscrowToForkSuccess) status = 'Success';
  else if (escrowToForkError) status = 'Fail';

  const escrowToForkState = {
    status,
    errorMessage: escrowToForkError?.message,
    transaction: { hash },
  };

  return { escrowToFork, escrowToForkState };
}

export function useWithdrawFromForkEscrow() {
  const {
    data: hash,
    writeContractAsync: withdrawFromForkEscrow,
    isPending: isWithdrawFromForkEscrowPending,
    isSuccess: isWithdrawFromForkEscrowSuccess,
    error: withdrawFromForkEscrowError,
  } = useWriteNounsGovernorWithdrawFromForkEscrow();

  let status = 'None';
  if (isWithdrawFromForkEscrowPending) status = 'Mining';
  else if (isWithdrawFromForkEscrowSuccess) status = 'Success';
  else if (withdrawFromForkEscrowError) status = 'Fail';

  const withdrawFromForkEscrowState = {
    status,
    errorMessage: withdrawFromForkEscrowError?.message,
    transaction: { hash },
  };

  return { withdrawFromForkEscrow, withdrawFromForkEscrowState };
}

export function useJoinFork() {
  const {
    data: hash,
    writeContractAsync: joinFork,
    isPending: isJoinForkPending,
    isSuccess: isJoinForkSuccess,
    error: joinForkError,
  } = useWriteNounsGovernorJoinFork();

  let status = 'None';
  if (isJoinForkPending) status = 'Mining';
  else if (isJoinForkSuccess) status = 'Success';
  else if (joinForkError) status = 'Fail';

  const joinForkState = {
    status,
    errorMessage: joinForkError?.message,
    transaction: { hash },
  };

  return { joinFork, joinForkState };
}

export function useForkThreshold(): number | undefined {
  const { data: threshold } = useReadNounsGovernorForkThreshold();

  return threshold != null ? Number(threshold) : undefined;
}

export function useNumTokensInForkEscrow(): number | undefined {
  const { data: count } = useReadNounsGovernorNumTokensInForkEscrow();

  return count != null ? Number(count) : undefined;
}

export const useEscrowDepositEvents = (pollInterval: number, forkId: string) => {
  // Not indexed by Ponder — return empty
  const { query, variables } = escrowDepositEventsQuery(forkId);
  const { loading, error, refetch } = useQuery(query, {
    pollInterval,
    variables,
    skip: true,
  });
  const escrowDeposits: EscrowDeposit[] = [];
  return { loading, error, data: escrowDeposits, refetch };
};

export const useEscrowWithdrawalEvents = (pollInterval: number, forkId: string) => {
  // Not indexed by Ponder — return empty
  const { query, variables } = escrowWithdrawEventsQuery(forkId);
  const { loading, error, refetch } = useQuery(query, {
    pollInterval,
    variables,
    skip: true,
  });
  const escrowWithdrawals: EscrowWithdrawal[] = [];
  return { loading, error, data: escrowWithdrawals, refetch };
};

// Define a type alias for the events union type
type EscrowEvent = EscrowDeposit | EscrowWithdrawal | ForkCycleEvent;

// helper function to add fork cycle events to escrow events
const eventsWithforkCycleEvents = (events: EscrowEvent[], forkDetails: Fork) => {
  const endTimestamp =
    forkDetails.forkingPeriodEndTimestamp && +forkDetails.forkingPeriodEndTimestamp;
  const executed: ForkCycleEvent = {
    eventType: 'ForkExecuted',
    id: 'fork-executed',
    createdAt: forkDetails.executedAt,
  };
  const forkEnded: ForkCycleEvent = {
    eventType: 'ForkingEnded',
    id: 'fork-ended',
    createdAt: endTimestamp != null ? BigInt(endTimestamp) : null,
  };
  const forkEvents: ForkCycleEvent[] = [executed, forkEnded];

  const sortedEvents = [...events, ...forkEvents].sort((a: EscrowEvent, b: EscrowEvent) => {
    if (a.createdAt == null || b.createdAt == null) return 0;
    return a.createdAt > b.createdAt ? -1 : 1;
  });
  return sortedEvents;
};

export const useForkJoins = (pollInterval: number, forkId: string) => {
  // Not indexed by Ponder — return empty
  const { query, variables } = forkJoinsQuery(forkId);
  const { loading, error, refetch } = useQuery(query, {
    pollInterval,
    variables,
    skip: true,
  });
  const escrowDeposits: EscrowDeposit[] = [];
  return { loading, error, data: escrowDeposits, refetch };
};

export const useEscrowEvents = (pollInterval: number, forkId: string) => {
  const {
    loading: depositsLoading,
    data: depositEvents,
    error: depositsError,
    refetch: refetchEscrowDepositEvents,
  } = useEscrowDepositEvents(pollInterval, forkId);
  const {
    loading: withdrawalsLoading,
    data: withdrawalEvents,
    error: withdrawalsError,
    refetch: refetchEscrowWithdrawalEvents,
  } = useEscrowWithdrawalEvents(pollInterval, forkId);
  const {
    loading: forkDetailsLoading,
    data: forkDetails,
    error: forkDetailsError,
  } = useForkDetails(pollInterval, forkId);
  const {
    loading: forkJoinsLoading,
    data: forkJoins,
    error: forkJoinsError,
    refetch: refetchForkJoins,
  } = useForkJoins(pollInterval, forkId);
  const loading = depositsLoading || withdrawalsLoading || forkDetailsLoading || forkJoinsLoading;
  const error = depositsError ?? withdrawalsError ?? forkDetailsError ?? forkJoinsError;
  const data: (EscrowDeposit | EscrowWithdrawal)[] = [
    ...depositEvents,
    ...withdrawalEvents,
    ...forkJoins,
  ];
  // get fork details to pass to forkCycleEvents
  const events = eventsWithforkCycleEvents(data, forkDetails);

  return {
    loading,
    error,
    data: events,
    refetch: () => {
      refetchEscrowDepositEvents();
      refetchEscrowWithdrawalEvents();
      refetchForkJoins();
    },
  };
};

export const useForkDetails = (pollInterval: number, id: string) => {
  // Not indexed by Ponder — return empty fork
  const { query, variables } = forkDetailsQuery(id.toString());
  const { loading, error, refetch } = useQuery(query, {
    pollInterval,
    variables,
    skip: true,
  });
  const data: Fork = {
    id: id,
    forkID: 0n,
    executed: null,
    executedAt: null,
    forkTreasury: null,
    forkToken: null,
    tokensForkingCount: 0,
    tokensInEscrowCount: 0,
    forkingPeriodEndTimestamp: null,
    addedNouns: [],
  };
  return { loading, data, error, refetch };
};

export const useForks = (pollInterval: number = 0) => {
  // Not indexed by Ponder — return empty
  const { query, variables } = forksQuery();
  const { loading, error, refetch } = useQuery(query, {
    pollInterval,
    variables,
    skip: true,
  });
  const forks: Fork[] = [];
  return { loading, data: forks, error, refetch };
};

export const useIsForkActive = () => {
  // Not indexed by Ponder — always return false
  const timestamp = Number((new Date().getTime() / 1000).toFixed(0));
  const { query, variables } = isForkActiveQuery(timestamp);
  const { loading, error } = useQuery(query, { variables, skip: true });
  return {
    loading,
    data: false,
    error,
  };
};

export function useExecuteFork() {
  const {
    data: hash,
    writeContractAsync: executeFork,
    isPending: isExecuteForkPending,
    isSuccess: isExecuteForkSuccess,
    error: executeForkError,
  } = useWriteNounsGovernorExecuteFork();

  let status = 'None';
  if (isExecuteForkPending) status = 'Mining';
  else if (isExecuteForkSuccess) status = 'Success';
  else if (executeForkError) status = 'Fail';

  const executeForkState = {
    status,
    errorMessage: executeForkError?.message,
    transaction: { hash },
  };

  return { executeFork, executeForkState };
}

export function useAdjustedTotalSupply(): number | undefined {
  const { data } = useReadNounsGovernorAdjustedTotalSupply();

  return data != null ? Number(data) : undefined;
}

export function useForkThresholdBPS(): number | undefined {
  const { data } = useReadNounsGovernorForkThresholdBps();

  return data != null ? Number(data) : undefined;
}

export const useActivePendingUpdatableProposers = (blockNumber: bigint = 0n) => {
  const { query, variables } = activePendingUpdatableProposersQuery(1000, blockNumber);
  const {
    loading,
    data: rawData,
    error,
  } = useQuery<{
    proposals: {
      items: Array<{
        proposer: string;
        signers: { items: Array<{ signer: string }> };
      }>;
    };
  }>(query, { variables });

  const data: string[] = [];
  const proposals = rawData?.proposals?.items ?? [];
  if (proposals.length > 0) {
    forEach(proposals, proposal => {
      data.push(proposal.proposer);
      forEach(proposal.signers?.items ?? [], (signer: { signer: string }) => {
        data.push(signer.signer);
        return signer.signer;
      });
      return proposal.proposer;
    });
  }

  return {
    loading,
    data,
    error,
  };
};

export function useIsDaoGteV3(): boolean {
  return true;
}

export function useUpdatableProposalIds(blockNumber?: bigint) {
  const { query, variables } = updatableProposalsQuery(1000, blockNumber);
  const {
    loading,
    data: rawData,
    error,
  } = useQuery<{
    proposals: { items: Array<{ id: string }> };
  }>(query, { variables });

  const data = rawData?.proposals?.items?.map(proposal => +proposal.id);

  return {
    loading,
    data,
    error,
  };
}
