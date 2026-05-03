/**
 * Proposal-state helpers ported verbatim (with TypeScript) from
 *   apps/nouns-camp/src/utils/proposals.js
 * (obvious-inc/frontend-monorepo, AGPL-3.0). See `imported/` directory
 * convention — files here mirror Camp's source for provenance.
 *
 * Camp models proposal state as a lowercase string ("active", "succeeded", …)
 * while noun-wtf's `ProposalState` is a numeric enum. We translate at the
 * boundary so all the digest-sectioning logic can stay 1:1 with Camp.
 */
import { ProposalState } from '@/wrappers/nounsDao';

export type CampProposalState =
  | 'updatable'
  | 'pending'
  | 'active'
  | 'objection-period'
  | 'succeeded'
  | 'queued'
  | 'executed'
  | 'defeated'
  | 'vetoed'
  | 'canceled'
  | 'expired';

const STATE_LOOKUP: Record<ProposalState, CampProposalState | undefined> = {
  [ProposalState.UNDETERMINED]: undefined,
  [ProposalState.PENDING]: 'pending',
  [ProposalState.ACTIVE]: 'active',
  [ProposalState.CANCELLED]: 'canceled',
  [ProposalState.DEFEATED]: 'defeated',
  [ProposalState.SUCCEEDED]: 'succeeded',
  [ProposalState.QUEUED]: 'queued',
  [ProposalState.EXPIRED]: 'expired',
  [ProposalState.EXECUTED]: 'executed',
  [ProposalState.VETOED]: 'vetoed',
  [ProposalState.OBJECTION_PERIOD]: 'objection-period',
  [ProposalState.UPDATABLE]: 'updatable',
};

export const toCampState = (state: ProposalState): CampProposalState | null =>
  STATE_LOOKUP[state] ?? null;

/** Camp: getStateLabel(state) — returns a user-facing label. */
export const getStateLabel = (state: CampProposalState): string => {
  switch (state) {
    case 'updatable':
      return 'Open for changes';
    case 'pending':
      return 'Upcoming';
    case 'active':
      return 'Ongoing';
    case 'objection-period':
      return 'Objection period';
    case 'queued':
      return 'Succeeded';
    default:
      return state[0].toUpperCase() + state.slice(1);
  }
};

export const isVotableState = (state: CampProposalState | null): boolean =>
  state === 'active' || state === 'objection-period';

export const isFinalState = (state: CampProposalState | null): boolean =>
  state === 'vetoed' ||
  state === 'canceled' ||
  state === 'defeated' ||
  state === 'executed' ||
  state === 'expired';

export const isSucceededState = (state: CampProposalState | null): boolean =>
  state === 'succeeded' || state === 'queued' || state === 'executed';

/** Tone used by `<StatusTag>` to map a proposal state to a CSS color cluster. */
export type StateTone = 'active' | 'warning' | 'success' | 'error' | 'neutral';

export const getStateTone = (state: CampProposalState | null): StateTone => {
  switch (state) {
    case 'active':
      return 'active';
    case 'objection-period':
      return 'warning';
    case 'succeeded':
    case 'queued':
    case 'executed':
      return 'success';
    case 'defeated':
    case 'vetoed':
      return 'error';
    default:
      return 'neutral';
  }
};
