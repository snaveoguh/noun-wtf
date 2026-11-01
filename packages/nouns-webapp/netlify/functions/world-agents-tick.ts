import { getStore } from '@netlify/blobs';

import { runAgentTick } from '../lib/agentsTick';

// The agent economy's heartbeat (docs/agent-economy.md): every 5 minutes,
// whether or not anyone's online, tick the Grand Exchange's bots to now and
// let the agents (src/miniapps/agents) take their turns. Logic:
// netlify/lib/agentsTick.ts.
//
// The LLM policy is off unless AGENT_LLM=1 and ANTHROPIC_API_KEY are set
// (AGENT_LLM_MODEL picks the model, default claude-opus-5-5).

export default async (): Promise<Response> => {
  const env = process.env;
  const key = env.ANTHROPIC_API_KEY;
  const llmOn = env.AGENT_LLM === '1' && typeof key === 'string' && key.length > 0;
  const llm = llmOn
    ? async (prompt: string) => {
        const { agentTurn } = await import('../lib/agentLlm');
        return agentTurn(prompt, key!, env.AGENT_LLM_MODEL);
      }
    : undefined;
  const r = await runAgentTick({
    exchange: getStore('noun-world-exchange'),
    agents: getStore('noun-world-agents'),
    now: () => Date.now(),
    llm,
    log: (m, d) => console.warn('[agents]', m, JSON.stringify(d ?? {})),
  });
  console.log(
    '[agents] tick',
    JSON.stringify({
      ok: r.ok,
      error: r.error,
      llm: r.llm,
      turns: r.turns.map(t => [t.id, t.policy, t.actions, t.fills]),
    }),
  );
  return new Response(r.ok ? 'ok' : (r.error ?? 'failed'), { status: r.ok ? 200 : 500 });
};

export const config = { schedule: '*/5 * * * *' };
