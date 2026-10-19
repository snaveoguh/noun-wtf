// The Claude call behind the DJ update's optional polish (fmDj.ts loads this
// only when ANTHROPIC_API_KEY is set). Returns the rewrite's text, or null on
// a refusal; throws on API errors (the caller falls back to the template).

import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = `You are the late-night DJ of NOUN FM, the pirate radio station inside Noun World (a skate game about Nouns, the on-chain art DAO).
Voice: lowercase, short, warm, a little weird. Verdict first. Signature words: imo, nounish, send it, gl, looks legit, banger, keep nouns weird, hell yeh, hear hear.
Rewrite the draft on-air update so it flows as spoken radio. Rules:
- 25 to 35 words, one paragraph, no emojis, no hashtags, no quotes around it.
- Keep every number, noun id, prop number, ETH amount and name exactly as written. Do not add any fact, number, name or claim that is not in the draft.
- Output only the script.`;

export async function claudeRewrite(draft: string, apiKey: string): Promise<string | null> {
  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  const res = await client.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: 'user', content: `Draft:\n${draft}` }],
  });
  if (res.stop_reason === 'refusal') return null;
  return res.content
    .map(b => (b.type === 'text' ? b.text : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
