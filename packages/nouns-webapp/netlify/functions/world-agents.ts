import { connectLambda, getStore } from '@netlify/blobs';

import { AGENT_BY_ID } from '../../src/miniapps/agents/roster';
import { agentsPublic, ledgerView } from '../../src/miniapps/agents/run';
import { loadDoc, loadExchange, runAgentTick, AG_KEY } from '../lib/agentsTick';
import { adminCheck } from '../lib/appeals';

// The agent economy, read side (docs/agent-economy.md). Agents themselves
// run in world-agents-tick.ts (scheduled); players trade with them through
// world-exchange.ts (an `offer` to an agent's id at its posted price).
//
// GET  [?agent=agent:mochi][&rider=<id>]
//      → { now, agents: AgentPublic[], ledger: LedgerEntry[], you }
//        ledger is newest first, tags only (never a raw rider id); `you` is
//        the rider's exchange balances (null if they have no account; a GET
//        never opens one).
// POST { action: 'pause' | 'resume', agent }  (X-World-Admin)
//      { action: 'run' }                      (X-World-Admin) a tick now, every agent

interface HandlerEvent {
  body: string | null;
  blobs?: string;
  headers?: Record<string, string>;
  httpMethod: string;
  queryStringParameters?: Record<string, string | undefined> | null;
}

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-World-Admin',
  'Cache-Control': 'no-store',
};
const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers,
  body: JSON.stringify(body),
});

const cleanRider = (v: unknown) =>
  String(v ?? '')
    .slice(0, 64)
    .replace(/[^\dA-Za-z-]/g, '');

export async function handler(event: HandlerEvent) {
  const method = event.httpMethod || 'GET';
  if (method === 'OPTIONS') return json(204, {});
  connectLambda({ blobs: event.blobs ?? '', headers: event.headers ?? {} });
  const exStore = getStore('noun-world-exchange');
  const agStore = getStore('noun-world-agents');
  const now = Date.now();

  if (method === 'GET') {
    const q = event.queryStringParameters ?? {};
    const agent = q.agent && AGENT_BY_ID[q.agent] ? q.agent : undefined;
    const rider = cleanRider(q.rider);
    const [{ s }, { doc }] = await Promise.all([loadExchange(exStore, now), loadDoc(agStore, now)]);
    const a = rider.length >= 8 ? s.accounts[rider] : undefined;
    return json(200, {
      now,
      agents: agentsPublic(s, doc, now),
      ledger: ledgerView(doc, 60, agent),
      you: a ? { coin: a.coin, goods: { ...a.goods } } : null,
    });
  }
  if (method !== 'POST') return json(405, { error: 'Method not allowed' });
  const auth = adminCheck(event.headers);
  if (!auth.ok) return json(auth.status, { error: auth.error });
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Bad JSON' });
  }
  if (input.action === 'run') {
    const r = await runAgentTick({
      exchange: exStore,
      agents: agStore,
      now: () => Date.now(),
      force: true,
    });
    return json(r.ok ? 200 : 500, r);
  }
  if (input.action === 'pause' || input.action === 'resume') {
    const id = String(input.agent ?? '');
    if (!AGENT_BY_ID[id]) return json(400, { error: 'No such agent' });
    const { doc } = await loadDoc(agStore, now);
    const r = doc.agents[id];
    if (!r) return json(404, { error: 'That agent has not run yet' });
    r.paused = input.action === 'pause';
    await agStore.setJSON(AG_KEY, doc);
    return json(200, { ok: true, agent: id, paused: r.paused });
  }
  return json(400, { error: 'Bad action' });
}
