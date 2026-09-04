// ─── Autopilot preferences (shared by the wallet API + the relayer sweep) ───
//
// The prefs schema + validation + the persisted record shape live here so the
// relayer (`autopilotRelayer.ts`, no Ponder imports) and the wallet routes
// (`api/walletProfile.ts`) read exactly the same thing. Storage is the agent
// memory store: scope `wallet:<lowercase addr>`, key `autopilot`.
//
// Signed-message scheme (unchanged from the original Autopilot ship):
//   noun.wtf autopilot\naddress: <lowercase addr>\nnonce: <unix ms>\nprefs: <sha256 hex>
// where `prefs:` is sha256(JSON.stringify(<the thing being authorised>)).

import { isAddress } from 'viem';

import { recall } from './memory.js';

export type Stance = -2 | -1 | 0 | 1 | 2;
export const STANCE_KEYS = [
  'art',
  'infrastructure',
  'events',
  'media',
  'grants',
  'protocolChanges',
  'treasuryOps',
] as const;
export type StanceKey = (typeof STANCE_KEYS)[number];

/** DAO identifiers as used in prefs, delegation rows and vote rows. */
export type AutopilotDao = 'nouns' | 'lil-nouns';
export const AUTOPILOT_DAOS: readonly AutopilotDao[] = ['nouns', 'lil-nouns'] as const;
export const isAutopilotDao = (x: unknown): x is AutopilotDao => x === 'nouns' || x === 'lil-nouns';

export interface AutopilotPrefs {
  philosophy: string;
  stances: Record<StanceKey, Stance>;
  maxAskEth: number | null;
  blockedProposers: string[];
  trustedProposers: string[];
  defaultWhenUnsure: 'abstain' | 'skip' | 'against';
  voteReasonStyle: 'none' | 'short' | 'full';
  /** 'draft' = recommendations only (user confirms); 'auto' = relayer casts via delegation. */
  mode: 'draft' | 'auto';
  daos: AutopilotDao[];
  /** Relayer only casts when the recommendation's confidence ≥ this (0..1). */
  minConfidence: number;
  /** Wait this long after voting opens before casting, unless the window would be missed (0..72). */
  autoVoteDelayHours: number;
  /** Refuse to cast a vote whose recommendation carries no reason text. */
  autoVoteOnlyWithReason: boolean;
}

export interface AutopilotRecord {
  enabled: boolean;
  prefs: AutopilotPrefs;
  prefsHash: string;
  updatedAt: number;
  lastNonce: number;
}

export const PREFS_DEFAULTS = {
  mode: 'draft',
  daos: ['nouns'],
  minConfidence: 0.6,
  autoVoteDelayHours: 24,
  autoVoteOnlyWithReason: false,
} as const;

const isStance = (x: unknown): x is Stance =>
  Number.isInteger(x) && (x as number) >= -2 && (x as number) <= 2;

/** Validate + normalise prefs. Returns an error string on failure. */
export function parsePrefs(raw: unknown): { prefs: AutopilotPrefs } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'prefs must be an object' };
  const r = raw as Record<string, unknown>;
  const philosophy = typeof r.philosophy === 'string' ? r.philosophy.trim() : '';
  if (philosophy.length > 1000) return { error: 'philosophy must be ≤ 1000 chars' };
  const stancesRaw = (r.stances ?? {}) as Record<string, unknown>;
  if (typeof stancesRaw !== 'object') return { error: 'stances must be an object' };
  const stances = {} as Record<StanceKey, Stance>;
  for (const k of STANCE_KEYS) {
    const v = stancesRaw[k] ?? 0;
    if (!isStance(v)) return { error: `stances.${k} must be an integer in -2..2` };
    stances[k] = v;
  }
  let maxAskEth: number | null = null;
  if (r.maxAskEth != null) {
    const n = Number(r.maxAskEth);
    if (!Number.isFinite(n) || n < 0)
      return { error: 'maxAskEth must be a non-negative number or null' };
    maxAskEth = n;
  }
  const addrList = (key: string): string[] | string => {
    const v = r[key] ?? [];
    if (!Array.isArray(v) || v.length > 200) return `${key} must be an array of ≤ 200 addresses`;
    const out: string[] = [];
    for (const a of v) {
      if (typeof a !== 'string' || !isAddress(a)) return `${key} contains a non-address`;
      out.push(a.toLowerCase());
    }
    return [...new Set(out)];
  };
  const blocked = addrList('blockedProposers');
  if (typeof blocked === 'string') return { error: blocked };
  const trusted = addrList('trustedProposers');
  if (typeof trusted === 'string') return { error: trusted };
  const dwu = r.defaultWhenUnsure ?? 'abstain';
  if (dwu !== 'abstain' && dwu !== 'skip' && dwu !== 'against') {
    return { error: "defaultWhenUnsure must be 'abstain' | 'skip' | 'against'" };
  }
  const style = r.voteReasonStyle ?? 'short';
  if (style !== 'none' && style !== 'short' && style !== 'full') {
    return { error: "voteReasonStyle must be 'none' | 'short' | 'full'" };
  }

  // ── Auto-vote additions ─────────────────────────────────────────────────
  const mode = r.mode ?? PREFS_DEFAULTS.mode;
  if (mode !== 'draft' && mode !== 'auto') return { error: "mode must be 'draft' | 'auto'" };
  const daosRaw = r.daos ?? PREFS_DEFAULTS.daos;
  if (!Array.isArray(daosRaw) || daosRaw.length === 0 || daosRaw.length > AUTOPILOT_DAOS.length) {
    return { error: "daos must be a non-empty array of 'nouns' | 'lil-nouns'" };
  }
  const daos: AutopilotDao[] = [];
  for (const d of daosRaw) {
    if (!isAutopilotDao(d)) return { error: "daos may only contain 'nouns' | 'lil-nouns'" };
    if (!daos.includes(d)) daos.push(d);
  }
  const minConfidence =
    r.minConfidence == null ? PREFS_DEFAULTS.minConfidence : Number(r.minConfidence);
  if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) {
    return { error: 'minConfidence must be a number in 0..1' };
  }
  const autoVoteDelayHours =
    r.autoVoteDelayHours == null ? PREFS_DEFAULTS.autoVoteDelayHours : Number(r.autoVoteDelayHours);
  if (!Number.isFinite(autoVoteDelayHours) || autoVoteDelayHours < 0 || autoVoteDelayHours > 72) {
    return { error: 'autoVoteDelayHours must be a number in 0..72' };
  }
  const autoVoteOnlyWithReason = r.autoVoteOnlyWithReason ?? PREFS_DEFAULTS.autoVoteOnlyWithReason;
  if (typeof autoVoteOnlyWithReason !== 'boolean') {
    return { error: 'autoVoteOnlyWithReason must be a boolean' };
  }

  return {
    prefs: {
      philosophy,
      stances,
      maxAskEth,
      blockedProposers: blocked,
      trustedProposers: trusted,
      defaultWhenUnsure: dwu,
      voteReasonStyle: style,
      mode,
      daos,
      minConfidence: Math.round(minConfidence * 100) / 100,
      autoVoteDelayHours: Math.round(autoVoteDelayHours * 100) / 100,
      autoVoteOnlyWithReason,
    },
  };
}

export const scopeFor = (address: string) => `wallet:${address.toLowerCase()}`;

/**
 * Read the persisted record and re-run `parsePrefs` so records written before
 * the auto-vote fields existed pick up the defaults (mode 'draft' etc.).
 * Returns null when nothing is stored or the record is malformed.
 */
export async function readAutopilotRecord(address: string): Promise<AutopilotRecord | null> {
  const rows = await recall(scopeFor(address), 'autopilot');
  const raw = rows[0]?.content;
  if (!raw) return null;
  let r: AutopilotRecord;
  try {
    r = JSON.parse(raw) as AutopilotRecord;
  } catch {
    return null;
  }
  if (!r || !r.prefs || typeof r.enabled !== 'boolean') return null;
  const parsed = parsePrefs(r.prefs);
  if ('error' in parsed) return null;
  return { ...r, prefs: parsed.prefs };
}
