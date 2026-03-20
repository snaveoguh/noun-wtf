/**
 * useCandidatesFromLogs — fetches proposal candidate data directly from
 * the NounsData contract via eth_getLogs (raw dogging the chain).
 *
 * Uses sequential chunked fetching with retry + localStorage cache:
 * - First load: ~10-15s (sequential with retries on public RPC)
 * - Subsequent loads: <1s (only fetches new blocks since last cache)
 *
 * Events indexed:
 *   ProposalCandidateCreated → builds candidate objects
 *   ProposalCandidateUpdated → updates content, increments version
 *   ProposalCandidateCanceled → marks canceled
 *   SignatureAdded → attaches sponsor signatures
 */
import type { Address, Hash, Hex } from '@/utils/types';
import type {
  CandidateSignature,
  ProposalCandidate,
  ProposalCandidateInfo,
} from '@/wrappers/nounsData';

import { useMemo, useRef } from 'react';

import { useQuery as useReactQuery } from '@tanstack/react-query';
import { type Log, decodeEventLog } from 'viem';
import { useBlockNumber, usePublicClient } from 'wagmi';

import { nounsDataAbi } from '@/contracts';
import { formatProposalTransactionDetails } from '@/wrappers/nounsDao';

// NounsData contract address on mainnet
const NOUNS_DATA_ADDRESS = '0xf790A5f59678dd733fb3De93493A91f472ca1365' as Address;

// NounsData was deployed at this block on mainnet
const NOUNS_DATA_DEPLOY_BLOCK = 17_812_145n;
const BLOCK_CHUNK = 40_000n; // 40k blocks per chunk (publicnode RPC has 50k hard limit)
const MAX_PARALLEL = 3; // conservative for free public RPCs
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000; // exponential backoff: 1s, 2s, 4s
const BATCH_DELAY_MS = 300; // delay between parallel batches to avoid rate limiting

// Pre-computed keccak256 event signature hashes — filter getLogs to only these events
// Using topic0 OR-filter: topics: [[hash1, hash2, ...]] means "match any of these"
const CANDIDATE_TOPICS: `0x${string}`[] = [
  '0x092e72bcc568a2ad800b1d7bbd7cc3f305e4a7b596092c69d10da00e38d705e6', // ProposalCandidateCreated
  '0x918063625a303d021375548c338d007d2857e576643789b387992dcfe04449cc', // ProposalCandidateUpdated
  '0x535f3f195da71b37d09a686916267ef7ad39d15bef95c61e85224d35f8b8fbad', // ProposalCandidateCanceled
  '0x049e3f4ea065d6c7f5c163f55c25cff7a2e7a6f7da1379f9e2a0173618d1db68', // SignatureAdded
];

// Timestamp anchor for estimation
const ANCHOR_BLOCK = 17_812_145n;
const ANCHOR_TIMESTAMP = 1691049600;
const AVG_BLOCK_TIME = 12;

function estimateTimestamp(blockNumber: bigint): number {
  return ANCHOR_TIMESTAMP + Number(blockNumber - ANCHOR_BLOCK) * AVG_BLOCK_TIME;
}

// ---- localStorage cache ----
const CACHE_KEY = 'candidates-v4'; // v4: added version history snapshots

interface CachedData {
  lastBlock: string;
  candidateCount: number; // track count to detect empty caches
  candidates: SerializedCandidate[];
}

interface SerializedVersion {
  versionNumber: number;
  blockNumber: string;
  timestamp: number;
  description: string;
  title: string;
  targets: string[];
  values: string[];
  signatures: string[];
  calldatas: string[];
  updateMessage: string;
}

interface SerializedCandidate {
  id: string;
  slug: string;
  proposer: string;
  canceled: boolean;
  versionsCount: number;
  createdTxHash: string;
  lastBlockNumber: string;
  description: string;
  targets: string[];
  values: string[];
  signatures: string[];
  calldatas: string[];
  proposalIdToUpdate: number;
  encodedProposalHash: string;
  contentSignatures: Array<{
    signer: string;
    reason: string;
    expirationTimestamp: number;
    sig: string;
  }>;
  versions?: SerializedVersion[];
}

function loadCache(): CachedData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as CachedData;
    // Don't trust caches with 0 candidates — they're from failed fetches
    if (!data.candidateCount || data.candidateCount === 0) {
      console.warn('[candidates] Ignoring empty cache (likely from failed fetch)');
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function saveCache(data: CachedData): void {
  // Never save empty results — they indicate a failed fetch
  if (data.candidateCount === 0) {
    console.warn('[candidates] Refusing to cache 0 candidates');
    return;
  }
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
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
  topics?: (`0x${string}` | `0x${string}`[] | null)[],
): Promise<{ logs: Log[]; failed: boolean }> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const logs = await client.getLogs({
        address,
        topics: topics ?? [CANDIDATE_TOPICS],
        fromBlock,
        toBlock,
      });
      return { logs: logs as Log[], failed: false };
    } catch (err) {
      const delay = RETRY_BASE_MS * Math.pow(2, attempt);
      if (attempt < MAX_RETRIES - 1) {
        console.warn(
          `[candidates] Chunk ${fromBlock}-${toBlock} failed (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay}ms...`,
          err instanceof Error ? err.message : err,
        );
        await new Promise(r => setTimeout(r, delay));
      } else {
        console.error(
          `[candidates] Chunk ${fromBlock}-${toBlock} failed after ${MAX_RETRIES} retries`,
          err instanceof Error ? err.message : err,
        );
        return { logs: [], failed: true };
      }
    }
  }
  return { logs: [], failed: true };
}

// ---- Parallel chunked log fetcher with retry ----
async function fetchAllLogs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  address: Address,
  fromBlock: bigint,
  toBlock: bigint,
  topics?: (`0x${string}` | `0x${string}`[] | null)[],
): Promise<Log[]> {
  // Build chunk ranges
  const chunks: Array<{ from: bigint; to: bigint }> = [];
  for (let start = fromBlock; start <= toBlock; start += BLOCK_CHUNK) {
    const end = start + BLOCK_CHUNK - 1n > toBlock ? toBlock : start + BLOCK_CHUNK - 1n;
    chunks.push({ from: start, to: end });
  }

  if (chunks.length === 0) return [];

  console.log(
    `[candidates] Fetching ${chunks.length} chunks (${fromBlock} → ${toBlock}), parallelism=${MAX_PARALLEL}`,
  );

  // Execute chunks in parallel batches with retry
  const allLogs: Log[] = [];
  let failedChunks = 0;

  for (let i = 0; i < chunks.length; i += MAX_PARALLEL) {
    const batch = chunks.slice(i, i + MAX_PARALLEL);
    const results = await Promise.all(
      batch.map(chunk => fetchChunkWithRetry(client, address, chunk.from, chunk.to, topics)),
    );

    for (const result of results) {
      if (result.failed) {
        failedChunks++;
      } else {
        allLogs.push(...result.logs);
      }
    }

    // Log progress
    const done = Math.min(i + MAX_PARALLEL, chunks.length);
    console.log(
      `[candidates] Progress: ${done}/${chunks.length} chunks (${failedChunks} failed, ${allLogs.length} logs so far)`,
    );

    // Delay between batches to avoid rate limiting
    if (i + MAX_PARALLEL < chunks.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  // If more than half the chunks failed, something is seriously wrong
  // Throw so react-query can retry at the top level
  if (failedChunks > chunks.length / 2) {
    throw new Error(
      `Too many failed chunks: ${failedChunks}/${chunks.length}. RPC may be rate-limiting. ` +
        `Got ${allLogs.length} logs from successful chunks.`,
    );
  }

  if (failedChunks > 0) {
    console.warn(
      `[candidates] Completed with ${failedChunks}/${chunks.length} failed chunks. Results may be incomplete.`,
    );
  }

  console.log(`[candidates] Fetched ${allLogs.length} total logs`);
  return allLogs;
}

// ---- Decode and sort logs by event type ----
interface DecodedEvents {
  created: Array<{ args: Record<string, unknown>; blockNumber: bigint; txHash: string }>;
  updated: Array<{ args: Record<string, unknown>; blockNumber: bigint }>;
  canceled: Array<{ args: Record<string, unknown>; blockNumber: bigint }>;
  signatures: Array<{ args: Record<string, unknown>; blockNumber: bigint }>;
}

function decodeLogs(logs: Log[]): DecodedEvents {
  const events: DecodedEvents = { created: [], updated: [], canceled: [], signatures: [] };

  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: nounsDataAbi,
        data: log.data,
        topics: log.topics,
      });

      const entry = {
        args: decoded.args as Record<string, unknown>,
        blockNumber: log.blockNumber ?? 0n,
        txHash: log.transactionHash ?? '0x',
      };

      switch (decoded.eventName) {
        case 'ProposalCandidateCreated':
          events.created.push(entry);
          break;
        case 'ProposalCandidateUpdated':
          events.updated.push(entry);
          break;
        case 'ProposalCandidateCanceled':
          events.canceled.push(entry);
          break;
        case 'SignatureAdded':
          events.signatures.push(entry);
          break;
        // Ignore other events (FeedbackSent, etc.)
      }
    } catch {
      // Skip undecodable logs
    }
  }

  console.log(
    `[candidates] Decoded events: ${events.created.length} created, ` +
      `${events.updated.length} updated, ${events.canceled.length} canceled, ` +
      `${events.signatures.length} signatures`,
  );

  return events;
}

// ---- Version snapshot (one per Created/Updated event) ----
export interface CandidateVersionSnapshot {
  versionNumber: number;
  blockNumber: bigint;
  timestamp: number;
  description: string;
  title: string;
  targets: Address[];
  values: bigint[];
  signatures: string[];
  calldatas: Hex[];
  updateMessage: string; // empty for v1
}

// ---- Build candidate state from events ----
interface CandidateState {
  id: string;
  slug: string;
  proposer: Address;
  canceled: boolean;
  versionsCount: number;
  createdTxHash: string;
  lastBlockNumber: bigint;
  description: string;
  targets: Address[];
  values: bigint[];
  signatures: string[];
  calldatas: Hex[];
  proposalIdToUpdate: number;
  encodedProposalHash: string;
  contentSignatures: CandidateSignature[];
  versions: CandidateVersionSnapshot[];
}

function candidateId(proposer: string, slug: string): string {
  return `${proposer.toLowerCase()}-${slug}`;
}

function extractTitle(description: string): string {
  const firstLine = description.split('\n')[0] ?? '';
  return firstLine.replace(/^#+\s*/, '').trim() || 'Untitled';
}

function buildFromEvents(events: DecodedEvents): Map<string, CandidateState> {
  const map = new Map<string, CandidateState>();

  // Created
  for (const e of events.created) {
    const a = e.args;
    const proposer = ((a.msgSender as string) ?? '').toLowerCase() as Address;
    const slug = (a.slug as string) ?? '';
    const id = candidateId(proposer, slug);
    const description = (a.description as string) ?? '';
    const targets = ((a.targets as string[]) ?? []).map(t => t as Address);
    const values = ((a.values as bigint[]) ?? []).map(v => BigInt(v));
    const signatures = (a.signatures as string[]) ?? [];
    const calldatas = ((a.calldatas as string[]) ?? []).map(c => c as Hex);

    const v1: CandidateVersionSnapshot = {
      versionNumber: 1,
      blockNumber: e.blockNumber,
      timestamp: estimateTimestamp(e.blockNumber),
      description,
      title: extractTitle(description),
      targets,
      values,
      signatures,
      calldatas,
      updateMessage: '',
    };

    map.set(id, {
      id,
      slug,
      proposer,
      canceled: false,
      versionsCount: 1,
      createdTxHash: e.txHash,
      lastBlockNumber: e.blockNumber,
      description,
      targets,
      values,
      signatures,
      calldatas,
      proposalIdToUpdate: Number(a.proposalIdToUpdate ?? 0),
      encodedProposalHash: (a.encodedProposalHash as string) ?? '',
      contentSignatures: [],
      versions: [v1],
    });
  }

  // Updated
  for (const e of events.updated) {
    const a = e.args;
    const proposer = ((a.msgSender as string) ?? '').toLowerCase() as Address;
    const slug = (a.slug as string) ?? '';
    const id = candidateId(proposer, slug);
    const existing = map.get(id);
    if (existing) {
      existing.versionsCount += 1;
      existing.lastBlockNumber = e.blockNumber;
      const description = (a.description as string) ?? existing.description;
      const targets = ((a.targets as string[]) ?? existing.targets).map(t => t as Address);
      const values = ((a.values as bigint[]) ?? existing.values).map(v => BigInt(v));
      const signatures = (a.signatures as string[]) ?? existing.signatures;
      const calldatas = ((a.calldatas as string[]) ?? existing.calldatas).map(c => c as Hex);

      existing.description = description;
      existing.targets = targets;
      existing.values = values;
      existing.signatures = signatures;
      existing.calldatas = calldatas;
      existing.encodedProposalHash =
        (a.encodedProposalHash as string) ?? existing.encodedProposalHash;
      existing.contentSignatures = []; // Clear on update

      existing.versions.push({
        versionNumber: existing.versionsCount,
        blockNumber: e.blockNumber,
        timestamp: estimateTimestamp(e.blockNumber),
        description,
        title: extractTitle(description),
        targets,
        values,
        signatures,
        calldatas,
        updateMessage: (a.reason as string) ?? '',
      });
    }
  }

  // Canceled
  for (const e of events.canceled) {
    const a = e.args;
    const proposer = ((a.msgSender as string) ?? '').toLowerCase();
    const slug = (a.slug as string) ?? '';
    const id = candidateId(proposer, slug);
    const existing = map.get(id);
    if (existing) existing.canceled = true;
  }

  // Signatures
  for (const e of events.signatures) {
    const a = e.args;
    const proposer = ((a.proposer as string) ?? '').toLowerCase();
    const slug = (a.slug as string) ?? '';
    const id = candidateId(proposer, slug);
    const existing = map.get(id);
    if (existing) {
      const sigHash = (a.encodedPropHash as string) ?? '';
      if (!existing.encodedProposalHash || sigHash === existing.encodedProposalHash) {
        existing.contentSignatures.push({
          reason: (a.reason as string) ?? '',
          expirationTimestamp: Number(a.expirationTimestamp ?? 0),
          sig: (a.sig as string) ?? '',
          canceled: false,
          signer: {
            id: ((a.signer as string) ?? '').toLowerCase() as Address,
            proposals: [],
          },
        });
      }
    }
  }

  return map;
}

// ---- Serialize/deserialize for cache ----
function serializeCandidate(c: CandidateState): SerializedCandidate {
  return {
    id: c.id,
    slug: c.slug,
    proposer: c.proposer,
    canceled: c.canceled,
    versionsCount: c.versionsCount,
    createdTxHash: c.createdTxHash,
    lastBlockNumber: c.lastBlockNumber.toString(),
    description: c.description,
    targets: c.targets,
    values: c.values.map(v => v.toString()),
    signatures: c.signatures,
    calldatas: c.calldatas,
    proposalIdToUpdate: c.proposalIdToUpdate,
    encodedProposalHash: c.encodedProposalHash,
    contentSignatures: c.contentSignatures.map(s => ({
      signer: s.signer.id,
      reason: s.reason,
      expirationTimestamp: s.expirationTimestamp,
      sig: s.sig,
    })),
    versions: c.versions.map(v => ({
      versionNumber: v.versionNumber,
      blockNumber: v.blockNumber.toString(),
      timestamp: v.timestamp,
      description: v.description,
      title: v.title,
      targets: v.targets as string[],
      values: v.values.map(val => val.toString()),
      signatures: v.signatures,
      calldatas: v.calldatas as string[],
      updateMessage: v.updateMessage,
    })),
  };
}

function deserializeCandidate(s: SerializedCandidate): CandidateState {
  return {
    id: s.id,
    slug: s.slug,
    proposer: s.proposer as Address,
    canceled: s.canceled,
    versionsCount: s.versionsCount,
    createdTxHash: s.createdTxHash,
    lastBlockNumber: BigInt(s.lastBlockNumber),
    description: s.description,
    targets: s.targets as Address[],
    values: s.values.map(v => BigInt(v)),
    signatures: s.signatures,
    calldatas: s.calldatas as Hex[],
    proposalIdToUpdate: s.proposalIdToUpdate,
    encodedProposalHash: s.encodedProposalHash,
    contentSignatures: s.contentSignatures.map(cs => ({
      reason: cs.reason,
      expirationTimestamp: cs.expirationTimestamp,
      sig: cs.sig,
      canceled: false,
      signer: { id: cs.signer as Address, proposals: [] },
    })),
    versions: (s.versions ?? []).map(v => ({
      versionNumber: v.versionNumber,
      blockNumber: BigInt(v.blockNumber),
      timestamp: v.timestamp,
      description: v.description,
      title: v.title,
      targets: v.targets as Address[],
      values: v.values.map(val => BigInt(val)),
      signatures: v.signatures,
      calldatas: v.calldatas as Hex[],
      updateMessage: v.updateMessage,
    })),
  };
}

// ---- Transform to ProposalCandidate (with version history) ----
function toProposalCandidate(
  state: CandidateState,
): ProposalCandidate & { versions: CandidateVersionSnapshot[] } {
  // Extract title from description (# Title on first line)
  const firstLine = state.description.split('\n')[0] ?? '';
  const title = firstLine.replace(/^#+\s*/, '').trim() || 'Untitled Candidate';

  const details = formatProposalTransactionDetails({
    targets: state.targets,
    signatures: state.signatures,
    values: state.values,
    calldatas: state.calldatas,
  });

  const timestamp = estimateTimestamp(state.lastBlockNumber);

  const info: ProposalCandidateInfo = {
    id: state.id,
    slug: state.slug,
    proposer: state.proposer,
    lastUpdatedTimestamp: BigInt(timestamp),
    canceled: state.canceled,
    versionsCount: state.versionsCount,
    createdTransactionHash: state.createdTxHash as Hash,
    isProposal: false,
    requiredVotes: 0,
    proposalIdToUpdate: state.proposalIdToUpdate > 0 ? state.proposalIdToUpdate : undefined,
    proposerVotes: 0,
    neededVotes: undefined,
    voteCount: state.contentSignatures.length,
    matchingProposalIds: undefined,
  };

  return {
    ...info,
    version: {
      content: {
        title,
        description: state.description,
        details,
        targets: state.targets,
        values: state.values,
        signatures: state.signatures,
        calldatas: state.calldatas,
        contentSignatures: state.contentSignatures,
        transactionHash: state.createdTxHash as Hash,
      },
    },
    versions: state.versions,
  };
}

// ---- Main hook ----
export function useCandidatesFromLogs(enabled = true) {
  const publicClient = usePublicClient();
  const { data: currentBlock } = useBlockNumber();
  const fetchingRef = useRef(false);

  return useReactQuery({
    // Stable query key — don't include currentBlock (it changes every 12s!)
    // Instead, rely on staleTime + refetchInterval for updates
    queryKey: ['candidatesFromChain'],
    queryFn: async (): Promise<ProposalCandidate[]> => {
      if (publicClient == null || currentBlock == null) return [];
      if (fetchingRef.current) return []; // Prevent double-fetch
      fetchingRef.current = true;

      try {
        // Load cache
        const cache = loadCache();
        let fromBlock = NOUNS_DATA_DEPLOY_BLOCK;
        let existingCandidates = new Map<string, CandidateState>();

        if (cache != null) {
          const lastBlock = BigInt(cache.lastBlock);
          if (lastBlock >= NOUNS_DATA_DEPLOY_BLOCK) {
            fromBlock = lastBlock + 1n;
            // Rebuild state from cached candidates
            for (const sc of cache.candidates) {
              const state = deserializeCandidate(sc);
              existingCandidates.set(state.id, state);
            }
            console.log(
              `[candidates] Loaded ${existingCandidates.size} candidates from cache (last block: ${lastBlock})`,
            );
          }
        }

        // If we're caught up, return cached directly
        if (fromBlock > currentBlock && existingCandidates.size > 0) {
          console.log(
            `[candidates] Cache is current, returning ${existingCandidates.size} cached candidates`,
          );
          return Array.from(existingCandidates.values())
            .filter(c => !c.canceled)
            .map(toProposalCandidate);
        }

        const blocksToFetch = currentBlock - fromBlock;
        console.log(
          `[candidates] Fetching from block ${fromBlock} to ${currentBlock} (${blocksToFetch} blocks)`,
        );

        // Fetch new logs (parallel chunked with retry)
        const newLogs = await fetchAllLogs(
          publicClient,
          NOUNS_DATA_ADDRESS,
          fromBlock,
          currentBlock,
        );

        // Decode events
        const events = decodeLogs(newLogs);

        // If we have cache, merge new events into existing state
        if (existingCandidates.size > 0) {
          // Apply new events to existing state
          const newState = buildFromEvents(events);
          for (const [id, candidate] of newState) {
            const existing = existingCandidates.get(id);
            if (existing) {
              // Merge: update fields from new events
              Object.assign(existing, candidate);
            } else {
              existingCandidates.set(id, candidate);
            }
          }
          // Also process cancellations and signatures on existing candidates
          for (const e of events.canceled) {
            const proposer = ((e.args.msgSender as string) ?? '').toLowerCase();
            const slug = (e.args.slug as string) ?? '';
            const id = candidateId(proposer, slug);
            const existing = existingCandidates.get(id);
            if (existing) existing.canceled = true;
          }
        } else {
          // First load — build from scratch
          existingCandidates = buildFromEvents(events);
        }

        const totalCandidates = existingCandidates.size;
        const activeCandidates = Array.from(existingCandidates.values()).filter(
          c => !c.canceled,
        ).length;
        console.log(
          `[candidates] Total: ${totalCandidates}, Active (non-canceled): ${activeCandidates}`,
        );

        // Save to cache (only if we have candidates)
        saveCache({
          lastBlock: currentBlock.toString(),
          candidateCount: totalCandidates,
          candidates: Array.from(existingCandidates.values()).map(serializeCandidate),
        });

        return Array.from(existingCandidates.values())
          .filter(c => !c.canceled)
          .map(toProposalCandidate);
      } finally {
        fetchingRef.current = false;
      }
    },
    enabled: enabled && publicClient != null && currentBlock != null && currentBlock > 0,
    staleTime: 5 * 60_000, // 5 minutes before considered stale
    gcTime: 30 * 60_000, // Keep in memory for 30 minutes
    refetchInterval: 5 * 60_000, // Refetch every 5 minutes
    retry: 3, // Retry the whole query 3 times on failure
    retryDelay: attemptIndex => Math.min(2000 * Math.pow(2, attemptIndex), 15000),
  });
}

// ---- Single candidate by ID ----
export function useCandidateFromLogs(id: string, enabled = true) {
  const { data: allCandidates, isLoading, error, refetch } = useCandidatesFromLogs(enabled);

  const candidate = useMemo(() => {
    if (!allCandidates || !id) return undefined;
    return allCandidates.find(c => c.id === id || c.id === id.toLowerCase());
  }, [allCandidates, id]);

  return { data: candidate, isLoading, error, refetch };
}

// ---- Version history for a single candidate ----
// Piggybacks on the general useCandidatesFromLogs fetch (proven reliable).
// First load ~10-15s, then cached.

export function useCandidateVersionsFromLogs(candidateId: string): {
  versions: CandidateVersionSnapshot[] | undefined;
  loading: boolean;
} {
  const { data: allCandidates, isLoading } = useCandidatesFromLogs(!!candidateId);

  const versions = useMemo(() => {
    if (!allCandidates || !candidateId) return undefined;
    const candidate = allCandidates.find(
      c => c.id === candidateId || c.id === candidateId.toLowerCase(),
    );
    if (!candidate) return undefined;
    // versions is added by toProposalCandidate but not in the ProposalCandidate type
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (candidate as any).versions as CandidateVersionSnapshot[] | undefined;
    if (!v || v.length <= 1) return undefined;
    return v;
  }, [allCandidates, candidateId]);

  return { versions, loading: isLoading };
}
