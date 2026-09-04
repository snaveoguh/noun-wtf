/**
 * Thin seam over `@nouns/vote-permit` (packages/vote-permit) for the wallet
 * profile. Everything autopilot-related imports from here so the package can
 * be swapped/mocked in one place; `loadVotePermit()` is kept async so a lazy
 * chunk can be substituted later without touching the panel.
 */
import * as votePermit from '@nouns/vote-permit';

export * from '@nouns/vote-permit';

export type VotePermitModule = typeof votePermit;

export type BuildVoteDelegationResult = ReturnType<typeof votePermit.buildVoteDelegation>;

export function loadVotePermit(): Promise<VotePermitModule> {
  return Promise.resolve(votePermit);
}
