// The Claude call behind the agent economy's optional LLM policy
// (src/miniapps/agents/llm.ts). world-agents-tick.ts loads this only when
// AGENT_LLM=1 and ANTHROPIC_API_KEY is set. Returns the reply text, or null
// on a refusal; throws on API errors (the agent falls back to its rules).

import Anthropic from '@anthropic-ai/sdk';

import { LLM_SYSTEM } from '../../src/miniapps/agents/llm';

export async function agentTurn(
  prompt: string,
  apiKey: string,
  model?: string,
): Promise<string | null> {
  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  const res = await client.messages.create({
    model: model || 'claude-opus-5-5',
    max_tokens: 4000,
    system: LLM_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });
  if (res.stop_reason === 'refusal') return null;
  return res.content.map(b => (b.type === 'text' ? b.text : '')).join('');
}
