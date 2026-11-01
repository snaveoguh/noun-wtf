import type { AgentsDoc } from '../../src/miniapps/agents/contract';
import type { ExchangeState } from '../../src/miniapps/exchange/engine/types';

import { describe, expect, it } from 'vitest';

import { AGENTS } from '../../src/miniapps/agents/roster';
import { checkInvariants, STARTER_COIN } from '../../src/miniapps/exchange/engine';

import { AG_KEY, EX_KEY, runAgentTick, type BlobLike } from './agentsTick';

/** An in-memory blob store with etags, like Netlify Blobs. */
function memStore(): BlobLike & {
  data: Map<string, { v: string; etag: string }>;
  bump(key: string): void;
} {
  const data = new Map<string, { v: string; etag: string }>();
  let n = 0;
  return {
    data,
    bump(key) {
      const cur = data.get(key);
      if (cur) data.set(key, { ...cur, etag: `e${++n}` });
    },
    async getWithMetadata(key) {
      const cur = data.get(key);
      return cur ? { data: JSON.parse(cur.v), etag: cur.etag } : null;
    },
    async setJSON(key, v, o) {
      const cur = data.get(key);
      if (o?.onlyIfNew && cur) return { modified: false };
      if (o?.onlyIfMatch && cur?.etag !== o.onlyIfMatch) return { modified: false };
      data.set(key, { v: JSON.stringify(v), etag: `e${++n}` });
      return { modified: true };
    },
  };
}

const T0 = Date.UTC(2026, 10, 1, 9);
const read = <T>(s: ReturnType<typeof memStore>, k: string) => JSON.parse(s.data.get(k)!.v) as T;

describe('agent tick (server)', () => {
  it('creates both blobs, funds agents once, runs turns, keeps the ledger sound', async () => {
    const ex = memStore();
    const ag = memStore();
    let now = T0;
    const r1 = await runAgentTick({ exchange: ex, agents: ag, now: () => now });
    expect(r1.ok).toBe(true);
    expect(r1.turns.length).toBe(AGENTS.length);
    for (let i = 1; i <= 24; i++) {
      now += 5 * 60_000;
      expect((await runAgentTick({ exchange: ex, agents: ag, now: () => now })).ok).toBe(true);
    }
    const s = read<ExchangeState>(ex, EX_KEY);
    const doc = read<AgentsDoc>(ag, AG_KEY);
    expect(checkInvariants(s)).toEqual([]);
    for (const a of AGENTS) expect(s.accounts[a.id]!.grant).toBe(STARTER_COIN);
    expect(doc.runs).toBe(25);
    expect(Object.keys(s.shops ?? {}).length).toBeGreaterThan(0);
  });

  it('retries when someone else wrote the exchange meanwhile', async () => {
    const ex = memStore();
    const ag = memStore();
    await runAgentTick({ exchange: ex, agents: ag, now: () => T0 });
    let calls = 0;
    const r = await runAgentTick({
      exchange: ex,
      agents: ag,
      now: () => {
        // A player's trade lands between our read and our write, once
        if (calls++ === 0) ex.bump(EX_KEY);
        return T0 + 10 * 60_000;
      },
    });
    expect(r.ok).toBe(true);
  });

  it('uses the LLM for llm agents (guarded), falls back to rules when it fails', async () => {
    const ex = memStore();
    const ag = memStore();
    const prompts: string[] = [];
    const r = await runAgentTick({
      exchange: ex,
      agents: ag,
      now: () => T0,
      llm: async p => {
        prompts.push(p);
        if (prompts.length === 2) throw new Error('down');
        return '{"actions":[{"t":"place","good":"PIZZA","side":"buy","qty":2,"price":1}],"say":"testing","note":"llm turn"}';
      },
    });
    expect(r.ok).toBe(true);
    const llmAgents = AGENTS.filter(a => a.llm).map(a => a.id);
    expect(prompts.length).toBe(Math.min(2, llmAgents.length));
    const used = r.turns.filter(t => t.policy === 'llm').map(t => t.id);
    expect(used).toHaveLength(1);
    expect(r.turns.filter(t => t.policy === 'rules').length).toBe(AGENTS.length - 1);
    expect(checkInvariants(read<ExchangeState>(ex, EX_KEY))).toEqual([]);
    // Within the hour it isn't asked again
    prompts.length = 0;
    await runAgentTick({
      exchange: ex,
      agents: ag,
      now: () => T0 + 20 * 60_000,
      llm: async p => (prompts.push(p), null),
      force: true,
    });
    expect(prompts.length).toBe(1); // only the one whose call failed
  });
});
