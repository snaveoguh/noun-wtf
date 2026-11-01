// ── The agent economy's server tick (shared by world-agents-tick.ts and
// world-agents.ts's admin "run"). Stores are injected so tests can run it
// against in-memory blobs.
//
// One run: load the exchange (Blobs `noun-world-exchange`, `state`) and the
// agent records (`noun-world-agents`, `agents`), tick the exchange's bots to
// now, run the agents' turns (agents/run.ts), refuse to save if the ledger
// check fails, then write the exchange with etag optimistic concurrency
// (retrying from a fresh read, as world-exchange does) and the records.

import type { AgentDecision, AgentsDoc } from '../../src/miniapps/agents/contract';
import type { ExchangeState } from '../../src/miniapps/exchange/engine/types';

import { llmDue, llmPrompt, parseDecision } from '../../src/miniapps/agents/llm';
import { AGENTS } from '../../src/miniapps/agents/roster';
import {
  emptyDoc,
  ensureAgents,
  obsFor,
  runAgents,
  type TurnReport,
} from '../../src/miniapps/agents/run';
import { checkInvariants, genesis, tick } from '../../src/miniapps/exchange/engine';
import { maskOwner } from '../../src/miniapps/exchange3d/sim/feed';

export interface BlobLike {
  getWithMetadata(
    key: string,
    o: { type: 'json' },
  ): Promise<{ data: unknown; etag?: string } | null>;
  setJSON(
    key: string,
    v: unknown,
    o?: { onlyIfMatch?: string; onlyIfNew?: boolean },
  ): Promise<{ modified?: boolean } | void>;
}

export const EX_KEY = 'state';
export const AG_KEY = 'agents';
const ATTEMPTS = 6;

export const tagOf = (o: string) => maskOwner(o, null);

export async function loadExchange(store: BlobLike, now: number) {
  const cur = await store.getWithMetadata(EX_KEY, { type: 'json' });
  if (cur?.data) return { s: cur.data as ExchangeState, etag: cur.etag };
  return { s: genesis((now ^ 0x5eed) >>> 0, now), etag: undefined };
}

export async function loadDoc(store: BlobLike, now: number) {
  const cur = await store.getWithMetadata(AG_KEY, { type: 'json' });
  if (cur?.data) return { doc: cur.data as AgentsDoc, etag: cur.etag };
  return { doc: emptyDoc(now), etag: undefined };
}

async function save(store: BlobLike, key: string, v: unknown, etag: string | undefined) {
  const res = etag
    ? await store.setJSON(key, v, { onlyIfMatch: etag })
    : await store.setJSON(key, v, { onlyIfNew: true });
  return !(res && res.modified === false);
}

export interface TickDeps {
  exchange: BlobLike;
  agents: BlobLike;
  now: () => number;
  /** The LLM call (prompt → reply text), when the LLM policy is on. */
  llm?: (prompt: string) => Promise<string | null>;
  force?: boolean;
  log?: (msg: string, data?: unknown) => void;
}

export interface TickResult {
  ok: boolean;
  error?: string;
  turns: TurnReport[];
  llm: string[];
}

export async function runAgentTick(d: TickDeps): Promise<TickResult> {
  const log = d.log ?? (() => {});
  let decisions: Record<string, AgentDecision> = {};
  let llmIds: string[] = [];
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const now = d.now();
    const { s, etag } = await loadExchange(d.exchange, now);
    const { doc, etag: docEtag } = await loadDoc(d.agents, now);
    tick(s, now);
    ensureAgents(s, doc, now);
    // LLM turns are asked for once (first attempt) and reused on a retry:
    // they still go through guard + the engine against the fresh state
    if (attempt === 0 && d.llm) {
      const due = llmDue(
        AGENTS.map(def => {
          const r = doc.agents[def.id]!;
          return {
            id: def.id,
            llm: def.llm,
            llmAt: r.mem.llmAt,
            due: r.paused !== true && (d.force === true || now >= r.mem.next),
          };
        }),
        now,
      );
      for (const id of due) {
        const def = AGENTS.find(a => a.id === id)!;
        try {
          const text = await d.llm(llmPrompt(obsFor(s, def, doc.agents[id]!, now)));
          const dec = text === null ? null : parseDecision(text);
          if (dec !== null) decisions[id] = dec;
        } catch (e) {
          log('agent llm failed', { id, error: String(e) });
        }
      }
      llmIds = Object.keys(decisions);
    }
    const turns = runAgents(s, doc, now, {
      tagOf,
      force: d.force,
      decide: def => decisions[def.id] ?? null,
    });
    for (const t of turns) if (t.policy === 'llm') doc.agents[t.id]!.mem.llmAt = now;
    const errs = checkInvariants(s);
    if (errs.length > 0) {
      log('agent tick: invariant broken, nothing saved', errs.slice(0, 5));
      return { ok: false, error: 'ledger check failed', turns, llm: llmIds };
    }
    if (!(await save(d.exchange, EX_KEY, s, etag))) continue;
    if (!(await save(d.agents, AG_KEY, doc, docEtag))) {
      // Someone (an admin pause) wrote the records meanwhile: keep their
      // paused flags, write ours
      const fresh = await loadDoc(d.agents, now);
      for (const [id, r] of Object.entries(fresh.doc.agents))
        if (doc.agents[id]) doc.agents[id]!.paused = r.paused;
      await d.agents.setJSON(AG_KEY, doc);
    }
    decisions = {};
    return { ok: true, turns, llm: llmIds };
  }
  return { ok: false, error: 'busy', turns: [], llm: llmIds };
}
