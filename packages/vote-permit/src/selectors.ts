import type { GovernorKind } from './types.js';

import { toFunctionSelector, type Hex } from 'viem';

/** Human-readable signatures of the vote functions each governor kind exposes. */
export const VOTE_FUNCTION_SIGNATURES: Record<GovernorKind, readonly string[]> = {
  nouns: [
    'castRefundableVote(uint256,uint8,uint32)',
    'castRefundableVoteWithReason(uint256,uint8,string,uint32)',
  ],
  lil: ['castRefundableVote(uint256,uint8)', 'castRefundableVoteWithReason(uint256,uint8,string)'],
};

function selectorsFor(kind: GovernorKind): Hex[] {
  return VOTE_FUNCTION_SIGNATURES[kind].map(sig => toFunctionSelector(sig));
}

/** 4-byte selectors per governor kind. Computed, not hard-coded, so they cannot drift from the signature text. */
export const VOTE_SELECTORS: Record<GovernorKind, readonly Hex[]> = {
  nouns: selectorsFor('nouns'),
  lil: selectorsFor('lil'),
};

/** Reverse lookup: selector → signature, across all known governor kinds. */
export const SELECTOR_TO_SIGNATURE: Record<string, string> = Object.fromEntries(
  (Object.keys(VOTE_FUNCTION_SIGNATURES) as GovernorKind[]).flatMap(kind =>
    VOTE_FUNCTION_SIGNATURES[kind].map(sig => [toFunctionSelector(sig).toLowerCase(), sig]),
  ),
);

export function voteSelectorsFor(kind: GovernorKind): Hex[] {
  return [...VOTE_SELECTORS[kind]];
}

export function isVoteSelector(kind: GovernorKind, selector: Hex): boolean {
  const s = selector.toLowerCase();
  return VOTE_SELECTORS[kind].some(v => v.toLowerCase() === s);
}
