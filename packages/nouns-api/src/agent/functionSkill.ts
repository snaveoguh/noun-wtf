// ─── Agent NounIRL — "function" Skill ─────────────────────────────────────────
//
// Purpose: teach NounIRL to recognise when a chat message is obviously a
// Nouns DAO onchain action ("bid 0.01eth on noun 1901", "vote yes on prop
// 567", "sponsor the public goods candidate", ...) and make the agent's
// FIRST response be a prepared function call — not freeform chat.
//
// Design:
// - A registry of the DAO functions NounIRL knows about (name, description,
//   params, canonical command template). Useful for prompts + docs.
// - A pure intent-detection function `detectFunction(message)` that returns
//   either a canonical command string (that the existing `parseCommand()`
//   already handles) or null. This is deliberately NL-loose: strips filler
//   like "please ...", "i want to ...", "can you ...", handles "yes/no" for
//   support, normalises "0.01eth" → "0.01 eth", etc.
// - No DB access, no LLM calls, no side effects. Pure function → pure string.
//
// Wiring: `parseCommand()` first runs its existing strict regexes (fast path).
// If nothing matches, it calls `detectFunction()`. If the skill returns a
// canonical command, `parseCommand()` is invoked again with that canonical
// form — so the existing DB lookups + action preparation kick in and the
// SAME GovernanceAction contract is produced.
//
// Execution is NOT performed here. All governance actions are returned to
// the frontend as `{ type, ... }` objects for the user to sign in their
// wallet (see packages/nouns-webapp/.../useGovernanceAction.ts).

export interface DaoFunctionSpec {
  /** Canonical function name as understood by this skill. */
  name: string;
  /** One-line description used in prompts + docs. */
  description: string;
  /** Parameter names (for docs; validation lives in the canonical command parsers). */
  params: readonly string[];
  /** Example natural-language phrasings that should map to this function. */
  examples: readonly string[];
  /** Action `type` emitted to the frontend (see GovernanceActionConfirm.tsx). */
  actionType: string;
}

// ─── Registry ────────────────────────────────────────────────────────────────

export const DAO_FUNCTIONS: readonly DaoFunctionSpec[] = [
  {
    name: 'bid',
    description: 'Place a bid on the current Nouns auction (client ID 37).',
    params: ['amountEth', 'nounId?'],
    examples: ['bid 0.01 eth on noun 1901', 'bid 0.5', 'i want to bid 0.25 eth'],
    actionType: 'BID',
  },
  {
    name: 'vote',
    description: 'Cast an onchain vote on a Nouns DAO proposal (refundable, client ID 37).',
    params: ['proposalId', 'support', 'reason?'],
    examples: [
      'vote for prop 567',
      'vote yes on proposal 789 because it funds public goods',
      'i want to vote against 456',
    ],
    actionType: 'VOTE',
  },
  {
    name: 'proposalFeedback',
    description: 'Signal (non-binding) on a proposal via NounsData.sendFeedback.',
    params: ['proposalId', 'support', 'reason?'],
    examples: [
      'feedback for prop 567',
      'signal against proposal 789',
      'leave feedback on prop 567 "strong support"',
    ],
    actionType: 'PROPOSAL_FEEDBACK',
  },
  {
    name: 'candidateFeedback',
    description: 'Signal (non-binding) on a candidate via NounsData.sendCandidateFeedback.',
    params: ['candidateKeyword', 'support', 'reason?'],
    examples: [
      'feedback for candidate public-goods',
      'signal against candidate treasury-diversification',
    ],
    actionType: 'CANDIDATE_FEEDBACK',
  },
  {
    name: 'createCandidate',
    description: 'Create a new proposal candidate that can then collect sponsor signatures.',
    params: ['title', 'description', 'transactions?'],
    examples: [
      'create candidate: Fund Nouns Movie - 10 ETH to nouns.movie',
      'propose: Client rewards refactor - Simplify the reward math',
    ],
    actionType: 'CREATE_CANDIDATE',
  },
  {
    name: 'sponsor',
    description: 'Sponsor (sign) an existing candidate via NounsData.addSignature (EIP-712).',
    params: ['candidateKeyword'],
    examples: ['sponsor candidate public-goods', 'sponsor the treasury diversification candidate'],
    actionType: 'SPONSOR',
  },
  {
    name: 'promote',
    description:
      'Promote a candidate to a full onchain proposal via proposeBySigs (uses collected sponsor signatures, client ID 37).',
    params: ['candidateKeyword'],
    examples: ['promote candidate public-goods', 'promote the public goods candidate to a prop'],
    actionType: 'PROMOTE',
  },
  {
    name: 'executeProposal',
    description: 'Execute a queued proposal whose timelock has expired.',
    params: ['proposalId'],
    examples: ['execute prop 567', 'execute proposal 789'],
    actionType: 'EXECUTE_PROPOSAL',
  },
  {
    // Docs/prompt only — NOT wired into detectFunction(). The LLM invokes the
    // propose_trait tool directly; there is no canonical-command fast path.
    name: 'proposeTrait',
    description:
      'Prepare a governance proposal adding a NEW art trait (head/body/accessory/glasses) to main Nouns or NounV2 — from raw RLE, a saved Dream (dream_id), or a 32x32 PNG whose colours already exist in the on-chain palette. Returns a signable action plus a /api/trait-preview URL of sample nouns wearing the trait.',
    params: [
      'category',
      'trait_name',
      'title',
      'description',
      'dao?',
      'rle?',
      'dream_id?',
      'png_data_url?',
      'derive_from?',
    ],
    examples: [
      'propose my dream 42 as a new head on nouns',
      'add this png as a v2 glasses trait',
      'make the joker head an official NounV2 trait',
    ],
    actionType: 'PROPOSE_TRAIT',
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripLeadingFiller(msg: string): string {
  // Peel off conversational prefaces that otherwise break the strict regexes.
  const fillers: RegExp[] = [
    /^(?:hey|hi|hello|yo|ok|okay)[\s!,.]+/i,
    /^(?:please|pls|plz)\s+/i,
    /^(?:can|could|would|will)\s+(?:you|u)\s+(?:please\s+)?/i,
    /^(?:i'?d\s+like\s+to|i\s+want\s+to|i\s+wanna|lemme|let\s+me|help\s+me)\s+/i,
    /^(?:try\s+to|try\s+and|go\s+ahead\s+and|just)\s+/i,
    /^nounirl[\s,.:]+/i,
  ];
  let out = msg.trim();
  for (let i = 0; i < 3; i += 1) {
    const before = out;
    for (const re of fillers) {
      out = out.replace(re, '');
    }
    if (out === before) break;
  }
  return out.trim();
}

function normaliseAmount(msg: string): string {
  // "0.01eth" → "0.01 eth"; "0,5" → "0.5"; "Ξ0.5" → "0.5"
  let out = msg.replace(/ξ\s*/gi, '');
  out = out.replace(/(\d),(\d)/g, '$1.$2');
  out = out.replace(/(\d+(?:\.\d+)?)\s*(eth|ether|ethereum)\b/gi, '$1 eth');
  return out;
}

function normaliseSupport(msg: string): string {
  // Accept natural yes/no/abstain phrasing. Leave the string intact except
  // for the token we intend to translate.
  let out = msg;
  out = out.replace(/\byeah\b|\byep\b|\byes\b|\baye\b|\bsupport\b|\bapprove\b/gi, 'for');
  out = out.replace(/\bnope\b|\bno\b|\bnay\b|\boppose\b|\breject\b/gi, 'against');
  out = out.replace(/\babstaining\b/gi, 'abstain');
  return out;
}

function normaliseProposalWord(msg: string): string {
  // "proposal" / "prop" / "#567" / "567" are all fine — standardise to "prop <n>"
  let out = msg.replace(/\bproposals?\b/gi, 'prop');
  out = out.replace(/\bprops?\b\s*#?\s*(\d+)/gi, 'prop $1');
  // Bare "#567" after a command word
  out = out.replace(/#(\d+)/g, '$1');
  return out;
}

function normaliseBidPhrase(msg: string): string {
  // "bid 0.5 on 1901" is fine for the existing regex. "bid 0.5 on noun 1901" too.
  // "place a bid of 0.5 eth" → "bid 0.5 eth"
  let out = msg.replace(/^place\s+(?:a\s+)?bid\s+(?:of\s+)?/i, 'bid ');
  // "make a 0.5 eth bid" → "bid 0.5 eth"
  out = out.replace(/^make\s+(?:a\s+)?([\d.]+)\s*eth\s+bid\b/i, 'bid $1 eth');
  return out;
}

// ─── Main entry: NL → canonical command ──────────────────────────────────────

export interface DetectResult {
  /**
   * The canonical command string. Feed this back into `parseCommand()` to get
   * a GovernanceAction + human-readable response.
   */
  canonical: string;
  /** Which function spec we matched. */
  function: DaoFunctionSpec;
}

/**
 * Pure NL intent detection. Returns a canonical command string that the
 * existing `parseCommand()` already handles, so action preparation stays
 * in one place.
 *
 * Returns null if no DAO function is obvious.
 */
export function detectFunction(rawMessage: string): DetectResult | null {
  if (!rawMessage || typeof rawMessage !== 'string') return null;
  const trimmed = rawMessage.trim();
  if (trimmed.length === 0 || trimmed.length > 2000) return null;

  // Strip conversational filler + normalise common variants.
  let msg = stripLeadingFiller(trimmed);
  msg = normaliseAmount(msg);
  msg = normaliseSupport(msg);
  msg = normaliseProposalWord(msg);
  msg = normaliseBidPhrase(msg);
  msg = msg.replace(/\s+/g, ' ').trim();

  const lower = msg.toLowerCase();

  // ─── bid ────────────────────────────────────────────────────────────────
  // Now accepts forms like "bid 0.5 eth on noun 1901" or "bid 0.5" after
  // filler stripping + amount normalisation.
  const bidMatch = lower.match(/\bbid\s+([\d.]+)\s*(?:eth)?\s*(?:on\s+(?:noun\s+)?(\d+))?\b/);
  if (bidMatch) {
    const amount = bidMatch[1];
    const nounId = bidMatch[2];
    const canonical = nounId ? `bid ${amount} eth on noun ${nounId}` : `bid ${amount} eth`;
    return {
      canonical,
      function: byName('bid'),
    };
  }

  // ─── vote on proposal ───────────────────────────────────────────────────
  // "vote for prop 567", "vote against 789", "vote for prop 567 because ..."
  // Also "vote yes on prop 567 because ..." (after yes/no → for/against
  // normalisation) — allow an optional connective "on" between the support
  // token and the proposal word.
  const voteMatch = lower.match(
    /\bvote\s+(for|against|abstain)\s+(?:on\s+)?(?:prop\s*)?(\d+)(?:\s+(?:because\s+|reason:?\s*)?(.+))?$/,
  );
  if (voteMatch) {
    const support = voteMatch[1];
    const id = voteMatch[2];
    const reason = voteMatch[3];
    const canonical = reason
      ? `vote ${support} prop ${id} ${reason.trim()}`
      : `vote ${support} prop ${id}`;
    return {
      canonical,
      function: byName('vote'),
    };
  }

  // ─── execute proposal ───────────────────────────────────────────────────
  const execMatch = lower.match(/\bexecute\s+(?:prop\s*)?(\d+)\b/);
  if (execMatch) {
    return {
      canonical: `execute prop ${execMatch[1]}`,
      function: byName('executeProposal'),
    };
  }

  // ─── feedback on proposal ───────────────────────────────────────────────
  // "feedback for prop 567 strong support"
  // "signal against proposal 789" (signal = feedback alias)
  const feedbackPropMatch = lower.match(
    /\b(?:feedback|signal)\s+(for|against)\s+(?:prop\s*)?(\d+)(?:\s+(.+))?$/,
  );
  if (feedbackPropMatch) {
    const support = feedbackPropMatch[1];
    const id = feedbackPropMatch[2];
    const reason = feedbackPropMatch[3];
    const canonical = reason
      ? `feedback ${support} prop ${id} ${reason.trim()}`
      : `feedback ${support} prop ${id}`;
    return {
      canonical,
      function: byName('proposalFeedback'),
    };
  }

  // "leave feedback on prop 567 <reason>"
  const leaveFeedbackMatch = lower.match(
    /\bleave\s+feedback\s+(?:on\s+)?(?:prop\s*)?(\d+)\s+(.+)$/,
  );
  if (leaveFeedbackMatch) {
    const id = leaveFeedbackMatch[1];
    const reason = leaveFeedbackMatch[2];
    return {
      canonical: `leave feedback on prop ${id} ${reason.trim()}`,
      function: byName('proposalFeedback'),
    };
  }

  // ─── feedback / signal on candidate ─────────────────────────────────────
  // "feedback for candidate <keyword>", "signal against candidate <keyword>"
  const feedbackCandMatch = lower.match(
    /\b(?:feedback|signal)\s+(for|against)\s+(?:on\s+)?candidate\s+(.+)$/,
  );
  if (feedbackCandMatch) {
    const support = feedbackCandMatch[1];
    const keyword = feedbackCandMatch[2];
    return {
      canonical: `feedback ${support} candidate ${keyword.trim()}`,
      function: byName('candidateFeedback'),
    };
  }

  // ─── sponsor candidate ──────────────────────────────────────────────────
  // "sponsor the public-goods candidate", "sponsor candidate xyz"
  const sponsorMatch = lower.match(
    /\bsponsor\s+(?:the\s+)?(?:candidate\s+)?(.+?)(?:\s+candidate)?$/,
  );
  if (sponsorMatch && /\bsponsor\b/.test(lower)) {
    const keyword = sponsorMatch[1]
      .replace(/\bcandidate\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (keyword.length > 0 && keyword.length < 120) {
      return {
        canonical: `sponsor candidate ${keyword}`,
        function: byName('sponsor'),
      };
    }
  }

  // ─── promote candidate ──────────────────────────────────────────────────
  const promoteMatch = lower.match(
    /\bpromote\s+(?:the\s+)?(?:candidate\s+)?(.+?)(?:\s+candidate)?(?:\s+to\s+(?:a\s+)?prop)?$/,
  );
  if (promoteMatch && /\bpromote\b/.test(lower)) {
    const keyword = promoteMatch[1]
      .replace(/\bcandidate\b/g, '')
      .replace(/\bto a prop\b|\bto prop\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (keyword.length > 0 && keyword.length < 120) {
      return {
        canonical: `promote candidate ${keyword}`,
        function: byName('promote'),
      };
    }
  }

  // ─── create candidate / propose ─────────────────────────────────────────
  // Case-sensitive matching against the ORIGINAL message so titles/
  // descriptions keep their capitalisation.
  const origCreate = trimmed.match(
    /^(?:create\s+(?:candidate|proposal)|propose)\s*:\s*(.+?)\s*-\s*(.+)$/i,
  );
  if (origCreate) {
    const title = origCreate[1].trim();
    const desc = origCreate[2].trim();
    return {
      canonical: `create candidate: ${title} - ${desc}`,
      function: byName('createCandidate'),
    };
  }

  // ─── No match ───────────────────────────────────────────────────────────
  return null;
}

/** Lookup helper for the registry. Throws if the function is missing. */
function byName(name: string): DaoFunctionSpec {
  const spec = DAO_FUNCTIONS.find(f => f.name === name);
  if (!spec) throw new Error(`[functionSkill] unknown function: ${name}`);
  return spec;
}

/**
 * Short prompt snippet describing this skill to the agent. Append to the
 * NounIRL system prompt so the LLM knows the skill exists and doesn't try
 * to reinvent it in freeform text.
 */
export function buildFunctionSkillPromptSnippet(): string {
  const lines: string[] = [];
  lines.push('\nFUNCTION SKILL — you recognise Nouns DAO actions directly from natural language:');
  for (const f of DAO_FUNCTIONS) {
    lines.push(`- ${f.name}(${f.params.join(', ')}) — ${f.description}`);
  }
  lines.push(
    '\nThese are detected BEFORE you see the message. If the skill fires, the user gets a prepared GovernanceAction (confirm in wallet) as the first response. If it does not fire, you handle the message conversationally. Do NOT describe the action as freeform text — the skill has already done that.',
  );
  return lines.join('\n');
}
