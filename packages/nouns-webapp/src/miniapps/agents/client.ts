// ── Agents in the browser: the live server, or a sim in this tab ─────────
//
// live  — GET world-agents (agents, their shop boards, the ledger, your
//         balances); trades are ordinary exchange deals posted to
//         world-exchange (an `offer` to the agent's id at its price).
// local — `?offline=1`, or the server didn't answer: the exchange engine,
//         its bots and the agents all run here (LocalExchange + runAgents).

import type { AgentPublic, AgentsDoc, LedgerEntry } from './contract';
import type { GoodId, Side } from '../exchange/engine/types';

import { HttpExchange, LocalExchange, riderId, type ClientAction } from '../exchange/client';
import { tick } from '../exchange/engine';
import { maskOwner } from '../exchange3d/sim/feed';

import { agentsPublic, emptyDoc, ledgerView, runAgents } from './run';

export interface AgentsView {
  mode: 'live' | 'local';
  now: number;
  agents: AgentPublic[];
  ledger: LedgerEntry[];
  you: { coin: number; goods: Partial<Record<GoodId, number>> } | null;
}

export interface TradeReply {
  ok: boolean;
  reason?: string;
}

const tagOf = (o: string) => maskOwner(o, null);

/** The agents running against a LocalExchange (offline / fallback). */
export class LocalAgents {
  readonly doc: AgentsDoc;
  constructor(readonly ex: LocalExchange) {
    this.doc = emptyDoc(ex.now());
  }

  /** Tick the exchange and let due agents take their turns. */
  step(): number {
    const now = this.ex.now();
    tick(this.ex.state, now, { maxSteps: 400 });
    runAgents(this.ex.state, this.doc, now, { tagOf });
    return now;
  }

  view(): AgentsView {
    const now = this.step();
    const a = this.ex.state.accounts[this.ex.owner];
    return {
      mode: 'local',
      now,
      agents: agentsPublic(this.ex.state, this.doc, now),
      ledger: ledgerView(this.doc, 60),
      you: a !== undefined ? { coin: a.coin, goods: { ...a.goods } } : null,
    };
  }
}

const URL_ = '/.netlify/functions/world-agents';

export class AgentsClient {
  private local: LocalAgents | null = null;
  private http: HttpExchange | null = null;
  mode: 'live' | 'local';
  readonly rider: string;

  constructor(offline: boolean) {
    this.mode = offline ? 'local' : 'live';
    this.rider = offline ? 'you-offline' : riderId();
  }

  private loc(): LocalAgents {
    this.local ??= new LocalAgents(new LocalExchange(7));
    return this.local;
  }

  async load(): Promise<AgentsView> {
    if (this.mode === 'live') {
      try {
        const r = await fetch(`${URL_}?rider=${encodeURIComponent(this.rider)}`, {
          cache: 'no-store',
        });
        if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json'))
          throw new Error(String(r.status));
        const v = (await r.json()) as Omit<AgentsView, 'mode'>;
        if (!Array.isArray(v.agents)) throw new Error('not agents');
        return { ...v, mode: 'live' };
      } catch {
        this.mode = 'local';
      }
    }
    return this.loc().view();
  }

  /** Buy from (side 'buy') or sell to an agent's shop at its posted price. */
  async trade(
    agent: string,
    side: Side,
    good: GoodId,
    qty: number,
    price: number,
  ): Promise<TradeReply> {
    const a: ClientAction = { t: 'offer', to: agent, side, good, qty, price };
    try {
      if (this.mode === 'live') {
        this.http ??= new HttpExchange(this.rider);
        await this.http.act({ t: 'join' }, good, 'm');
        const r = await this.http.act(a, good, 'm');
        return { ok: r.ok, reason: r.reason };
      }
      const L = this.loc();
      L.step();
      const r = await L.ex.act(a, good, 'm');
      return { ok: r.ok, reason: r.reason };
    } catch {
      return { ok: false, reason: "couldn't reach the exchange" };
    }
  }
}
