import type { DraftDao } from './draftDao';

import { useReadContract } from 'wagmi';

import {
  useReadNounsGovernorProposalUpdatablePeriodInBlocks,
  useReadNounsGovernorVotingDelay,
  useReadNounsGovernorVotingPeriod,
} from '@/contracts';
import { LIL_NOUNS_GOVERNOR, LIL_NOUNS_GOVERNOR_ABI } from '@/lib/marketplace/governance';
import { AVERAGE_BLOCK_TIME_IN_SECS } from '@/utils/constants';

export interface GovernorTiming {
  /** Seconds after submission during which the proposer can still edit it (V3). */
  updatableSecs: number;
  /** Seconds from submission until voting opens (updatable period + voting delay). */
  startsInSecs: number;
  /** Length of the voting period in seconds (before any objection period). */
  votingSecs: number;
}

/**
 * Read the proposal timeline from the governor the draft submits to, instead
 * of the hardcoded "5 days then 5 days" copy, which was never right for Lil
 * Nouns and drifts for Nouns whenever the DAO changes its params.
 *
 * Returns undefined until the delay + period reads land. The updatable period
 * only exists on V3 governors; if that read fails it counts as 0.
 */
export function useGovernorTiming(dao: DraftDao): GovernorTiming | undefined {
  const isLil = dao === 'lil-nouns';

  // Nouns reads stay unconditional: passing `query` to these generated hooks
  // trips TS2589 (excessively deep instantiation), and they're cheap + cached.
  const nounsDelay = useReadNounsGovernorVotingDelay();
  const nounsPeriod = useReadNounsGovernorVotingPeriod();
  const nounsUpdatable = useReadNounsGovernorProposalUpdatablePeriodInBlocks();

  const lilDelay = useReadContract({
    address: LIL_NOUNS_GOVERNOR,
    abi: LIL_NOUNS_GOVERNOR_ABI,
    functionName: 'votingDelay',
    query: { enabled: isLil },
  });
  const lilPeriod = useReadContract({
    address: LIL_NOUNS_GOVERNOR,
    abi: LIL_NOUNS_GOVERNOR_ABI,
    functionName: 'votingPeriod',
    query: { enabled: isLil },
  });
  const lilUpdatable = useReadContract({
    address: LIL_NOUNS_GOVERNOR,
    abi: LIL_NOUNS_GOVERNOR_ABI,
    functionName: 'proposalUpdatablePeriodInBlocks',
    query: { enabled: isLil },
  });

  const delay = isLil ? lilDelay.data : nounsDelay.data;
  const period = isLil ? lilPeriod.data : nounsPeriod.data;
  const updatable = (isLil ? lilUpdatable.data : nounsUpdatable.data) ?? 0n;
  if (delay === undefined || period === undefined) return undefined;

  return {
    updatableSecs: Number(updatable) * AVERAGE_BLOCK_TIME_IN_SECS,
    startsInSecs: Number(updatable + delay) * AVERAGE_BLOCK_TIME_IN_SECS,
    votingSecs: Number(period) * AVERAGE_BLOCK_TIME_IN_SECS,
  };
}

/** "~2 days", "~1.5 days", "~18 hours". */
export function formatApproxDuration(secs: number): string {
  const hours = secs / 3600;
  if (hours < 36) return `~${Math.max(1, Math.round(hours))} hours`;
  const days = Math.round((hours / 24) * 2) / 2;
  return `~${days} days`;
}
