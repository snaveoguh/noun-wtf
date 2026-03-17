/**
 * useFeedbackFromLogs — fetches proposal and candidate feedback
 * directly from NounsData contract event logs via chunked getLogs with retry.
 *
 * Uses the same robust fetching pattern as useCandidatesFromLogs.
 *
 * Events:
 *   FeedbackSent(address msgSender, uint256 proposalId, uint8 support, string reason)
 *   CandidateFeedbackSent(address msgSender, address proposer, string slug, uint8 support, string reason)
 */
import { useMemo, useRef } from 'react';

import { useQuery as useReactQuery } from '@tanstack/react-query';
import { type Log, decodeEventLog } from 'viem';
import { useBlockNumber, usePublicClient } from 'wagmi';

import { nounsDataAbi } from '@/contracts';
import type { Address } from '@/utils/types';
import type { VoteSignalDetail } from '@/wrappers/nounsData';

// NounsData contract address on mainnet
const NOUNS_DATA_ADDRESS = '0xf790A5f59678dd733fb3De93493A91f472ca1365' as Address;

// NounsData deploy block on mainnet
const NOUNS_DATA_DEPLOY_BLOCK = 17_812_145n;
const BLOCK_CHUNK = 40_000n; // publicnode RPC has 50k hard limit
const MAX_PARALLEL = 3;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;
const BATCH_DELAY_MS = 300;

// Pre-computed keccak256 event signature hashes for filtering
const FEEDBACK_TOPICS: `0x${string}`[] = [
  '0x66777d398af2d3ad91be043f4ee15e0058fd64a2badd9977e29334dc608bbfa6', // FeedbackSent
  '0x1e071c52ea06b433aac74cdba4ed70ff3e6635d5a6b344d654c04b4c762f054e', // CandidateFeedbackSent
];

// Timestamp estimation
const ANCHOR_BLOCK = 17_812_145n;
const ANCHOR_TIMESTAMP = 1691049600;
const AVG_BLOCK_TIME = 12;

function estimateTimestamp(blockNumber: bigint): number {
  return ANCHOR_TIMESTAMP + Number(blockNumber - ANCHOR_BLOCK) * AVG_BLOCK_TIME;
}

// ---- localStorage cache for feedback ----
const FEEDBACK_CACHE_KEY = 'feedback-v1';

interface FeedbackCache {
  lastBlock: string;
  proposal: Record<string, SerializedFeedback[]>; // keyed by proposalId
  candidate: Record<string, SerializedFeedback[]>; // keyed by candidateId
}

interface SerializedFeedback {
  supportDetailed: number;
  reason: string;
  votes: number;
  createdTimestamp: number;
  voterId: string;
}

function loadFeedbackCache(): FeedbackCache | null {
  try {
    const raw = localStorage.getItem(FEEDBACK_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as FeedbackCache;
  } catch {
    return null;
  }
}

function saveFeedbackCache(data: FeedbackCache): void {
  try {
    localStorage.setItem(FEEDBACK_CACHE_KEY, JSON.stringify(data));
  } catch {
    // localStorage full — silently fail
  }
}

// ---- Single chunk fetcher with retry ----
async function fetchChunkWithRetry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  address: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<Log[]> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const logs = await client.getLogs({ address, topics: [FEEDBACK_TOPICS], fromBlock, toBlock });
      return logs as Log[];
    } catch (err) {
      const delay = RETRY_BASE_MS * Math.pow(2, attempt);
      if (attempt < MAX_RETRIES - 1) {
        console.warn(
          `[feedback] Chunk ${fromBlock}-${toBlock} failed (attempt ${attempt + 1}), retrying in ${delay}ms`,
          err instanceof Error ? err.message : err,
        );
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  return [];
}

// ---- Parallel chunked log fetcher with retry ----
async function fetchAllLogs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  address: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<Log[]> {
  const chunks: Array<{ from: bigint; to: bigint }> = [];
  for (let start = fromBlock; start <= toBlock; start += BLOCK_CHUNK) {
    const end = start + BLOCK_CHUNK - 1n > toBlock ? toBlock : start + BLOCK_CHUNK - 1n;
    chunks.push({ from: start, to: end });
  }

  if (chunks.length === 0) return [];

  const allLogs: Log[] = [];

  for (let i = 0; i < chunks.length; i += MAX_PARALLEL) {
    const batch = chunks.slice(i, i + MAX_PARALLEL);
    const results = await Promise.all(
      batch.map(chunk => fetchChunkWithRetry(client, address, chunk.from, chunk.to)),
    );
    for (const logs of results) {
      allLogs.push(...logs);
    }

    // Delay between batches to avoid rate limiting
    if (i + MAX_PARALLEL < chunks.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  return allLogs;
}

// ---- Decode feedback events from raw logs ----
interface DecodedFeedback {
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
}

function decodeFeedbackLogs(logs: Log[]): DecodedFeedback[] {
  const feedback: DecodedFeedback[] = [];

  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: nounsDataAbi,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName === 'FeedbackSent' || decoded.eventName === 'CandidateFeedbackSent') {
        feedback.push({
          eventName: decoded.eventName,
          args: decoded.args as Record<string, unknown>,
          blockNumber: log.blockNumber ?? 0n,
        });
      }
    } catch {
      // Skip undecodable logs
    }
  }

  return feedback;
}

// ---- Transform to VoteSignalDetail ----
function toVoteSignalDetail(entry: DecodedFeedback): VoteSignalDetail {
  const a = entry.args;
  return {
    supportDetailed: Number(a.support ?? 0),
    reason: (a.reason as string) ?? '',
    votes: Number(a.votes ?? 0),
    createdTimestamp: estimateTimestamp(entry.blockNumber),
    voter: {
      id: ((a.msgSender as string) ?? '0x0').toLowerCase() as Address,
    },
  };
}

// ---- All-feedback fetcher (shared between hooks) ----
// Fetches ALL feedback once and caches. Individual hooks filter by proposal/candidate ID.
function useAllFeedback(enabled = true) {
  const publicClient = usePublicClient();
  const { data: currentBlock } = useBlockNumber();
  const fetchingRef = useRef(false);

  return useReactQuery({
    queryKey: ['allFeedbackFromChain'],
    queryFn: async () => {
      if (!publicClient || !currentBlock) return { proposal: {}, candidate: {} } as {
        proposal: Record<string, VoteSignalDetail[]>;
        candidate: Record<string, VoteSignalDetail[]>;
      };
      if (fetchingRef.current) return { proposal: {}, candidate: {} };
      fetchingRef.current = true;

      try {
        // Load cache
        const cache = loadFeedbackCache();
        let fromBlock = NOUNS_DATA_DEPLOY_BLOCK;
        const proposalFeedback: Record<string, VoteSignalDetail[]> = {};
        const candidateFeedback: Record<string, VoteSignalDetail[]> = {};

        if (cache) {
          const lastBlock = BigInt(cache.lastBlock);
          if (lastBlock >= NOUNS_DATA_DEPLOY_BLOCK) {
            fromBlock = lastBlock + 1n;
            // Restore cached feedback
            for (const [pid, entries] of Object.entries(cache.proposal)) {
              proposalFeedback[pid] = entries.map(e => ({
                supportDetailed: e.supportDetailed,
                reason: e.reason,
                votes: e.votes,
                createdTimestamp: e.createdTimestamp,
                voter: { id: e.voterId as Address },
              }));
            }
            for (const [cid, entries] of Object.entries(cache.candidate)) {
              candidateFeedback[cid] = entries.map(e => ({
                supportDetailed: e.supportDetailed,
                reason: e.reason,
                votes: e.votes,
                createdTimestamp: e.createdTimestamp,
                voter: { id: e.voterId as Address },
              }));
            }
          }
        }

        // If caught up, return cached
        if (fromBlock > currentBlock && Object.keys(proposalFeedback).length > 0) {
          return { proposal: proposalFeedback, candidate: candidateFeedback };
        }

        // Fetch new logs
        const rawLogs = await fetchAllLogs(publicClient, NOUNS_DATA_ADDRESS, fromBlock, currentBlock);
        const decoded = decodeFeedbackLogs(rawLogs);

        // Sort into proposal and candidate feedback
        for (const entry of decoded) {
          const detail = toVoteSignalDetail(entry);
          if (entry.eventName === 'FeedbackSent') {
            const pid = String(entry.args.proposalId ?? '');
            if (!proposalFeedback[pid]) proposalFeedback[pid] = [];
            proposalFeedback[pid].push(detail);
          } else if (entry.eventName === 'CandidateFeedbackSent') {
            const proposer = ((entry.args.proposer as string) ?? '').toLowerCase();
            const slug = (entry.args.slug as string) ?? '';
            const cid = `${proposer}-${slug}`;
            if (!candidateFeedback[cid]) candidateFeedback[cid] = [];
            candidateFeedback[cid].push(detail);
          }
        }

        // Save cache
        const serializedProposal: Record<string, SerializedFeedback[]> = {};
        for (const [pid, entries] of Object.entries(proposalFeedback)) {
          serializedProposal[pid] = entries.map(e => ({
            supportDetailed: e.supportDetailed,
            reason: e.reason,
            votes: e.votes,
            createdTimestamp: e.createdTimestamp,
            voterId: e.voter.id,
          }));
        }
        const serializedCandidate: Record<string, SerializedFeedback[]> = {};
        for (const [cid, entries] of Object.entries(candidateFeedback)) {
          serializedCandidate[cid] = entries.map(e => ({
            supportDetailed: e.supportDetailed,
            reason: e.reason,
            votes: e.votes,
            createdTimestamp: e.createdTimestamp,
            voterId: e.voter.id,
          }));
        }

        saveFeedbackCache({
          lastBlock: currentBlock.toString(),
          proposal: serializedProposal,
          candidate: serializedCandidate,
        });

        return { proposal: proposalFeedback, candidate: candidateFeedback };
      } finally {
        fetchingRef.current = false;
      }
    },
    enabled: enabled && !!publicClient && !!currentBlock,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchInterval: 5 * 60_000,
    retry: 3,
    retryDelay: attemptIndex => Math.min(2000 * Math.pow(2, attemptIndex), 15000),
  });
}

/**
 * Hook to fetch proposal feedback (FeedbackSent events) for a given proposal ID.
 */
export function useProposalFeedbackFromLogs(proposalId: string, _pollInterval = 0, enabled = true) {
  const { data: allFeedback, isLoading, error, refetch } = useAllFeedback(enabled);

  const feedbackForProposal = useMemo(() => {
    if (!allFeedback?.proposal || !proposalId) return [];
    return allFeedback.proposal[proposalId] ?? [];
  }, [allFeedback, proposalId]);

  return {
    loading: isLoading,
    data: feedbackForProposal,
    error: error ?? undefined,
    refetch,
  };
}

/**
 * Hook to fetch candidate feedback (CandidateFeedbackSent events) for a given candidate.
 * The candidateId is in format `${proposer}-${slug}`.
 */
export function useCandidateFeedbackFromLogs(candidateId: string, _pollInterval = 0, enabled = true) {
  const { data: allFeedback, isLoading, error, refetch } = useAllFeedback(enabled);

  const feedbackForCandidate = useMemo(() => {
    if (!allFeedback?.candidate || !candidateId) return [];
    return allFeedback.candidate[candidateId] ?? allFeedback.candidate[candidateId.toLowerCase()] ?? [];
  }, [allFeedback, candidateId]);

  return {
    loading: isLoading,
    data: feedbackForCandidate,
    error: error ?? undefined,
    refetch,
  };
}
