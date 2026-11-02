// ── Pet names (pure) ─────────────────────────────────────────────────────
//
// Same characters as a rider's name (ui/riderName.ts: A–Z 0–9 space . _ -),
// shorter, and run through the site's moderation filter
// (utils/moderation/containsBlockedText: bad-words + our regexes). Names
// from other players are checked again on the way in: a blocked one shows
// no name at all.

import { containsBlockedText } from '@/utils/moderation/containsBlockedText';

import { PET } from './contract';

export const DEFAULT_PET_NAME = 'MOCHI';

/** Uppercase, allowed characters only, single spaces, at most PET.nameMax. */
export function cleanPetName(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^\d .A-Z_-]/g, '')
    .replace(/ {2,}/g, ' ')
    .slice(0, PET.nameMax);
}

export type NameCheck = { ok: true; name: string } | { ok: false; why: 'empty' | 'blocked' };

const verdicts = new Map<string, boolean>();

/** Is this (cleaned) name allowed? Cached: remote names arrive many times a second. */
export function blockedName(name: string): boolean {
  let v = verdicts.get(name);
  if (v === undefined) {
    // the filter matches whole words: also try it with the separators gone
    const squashed = name.replace(/[ ._-]/g, '');
    v =
      containsBlockedText(name.toLowerCase(), 'en') ||
      (squashed !== name && containsBlockedText(squashed.toLowerCase(), 'en'));
    if (verdicts.size > 500) verdicts.clear();
    verdicts.set(name, v);
  }
  return v;
}

export function checkPetName(raw: string): NameCheck {
  const name = cleanPetName(raw).trim();
  if (name === '') return { ok: false, why: 'empty' };
  if (blockedName(name)) return { ok: false, why: 'blocked' };
  return { ok: true, name };
}
