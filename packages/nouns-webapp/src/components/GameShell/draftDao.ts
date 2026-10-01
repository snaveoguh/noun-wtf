/**
 * Which governor a proposal draft submits to. Kept in its own module so both
 * `openProposalDraft` and `ProposalDraftPanel` can import it without a cycle.
 */
export type DraftDao = 'nouns' | 'lil-nouns';

/**
 * Normalise the loose DAO spellings used across the terminal/agent wire format
 * (`lil`, `lilnouns`, `lil-nouns`, ...) to a `DraftDao`. Anything unrecognised
 * falls back to Nouns, matching the pre-existing behaviour.
 */
export function normalizeDraftDao(value: unknown): DraftDao {
  if (typeof value !== 'string') return 'nouns';
  const v = value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  return v === 'lil' || v === 'lilnouns' || v === 'lil-nouns' || v === 'lil-nouns-dao'
    ? 'lil-nouns'
    : 'nouns';
}

export const DRAFT_DAO_LABEL: Record<DraftDao, string> = {
  nouns: 'Nouns DAO',
  'lil-nouns': 'Lil Nouns DAO',
};
