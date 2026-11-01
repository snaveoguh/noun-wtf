// ── An agent behind a room's counter: the HUD chip and their shop ───────
//
// Mounted by interiors/InteriorsUi when the room's owner is an agent
// (agents/rooms.ts). Loads the agents' boards (world-agents, or the local
// sim under ?offline=1 / when the server's away) and trades through the
// Grand Exchange at the agent's posted price.

import type { GoodId, Side } from '../../exchange/engine/types';
import type { AgentsView } from '../client';

import { useEffect, useRef, useState } from 'react';

import { AgentsClient } from '../client';

import { AgentShop } from './AgentShop';
import { AgentTag } from './AgentTag';

let shared: AgentsClient | null = null;
function client(): AgentsClient {
  if (shared === null) {
    let offline = false;
    try {
      offline = new URLSearchParams(window.location.search).get('offline') === '1';
    } catch {
      // no window (tests)
    }
    shared = new AgentsClient(offline);
  }
  return shared;
}

export function RoomAgent({
  agentId,
  name,
  touch,
}: {
  agentId: string;
  name: string;
  touch: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<AgentsView | null>(null);
  const alive = useRef(true);

  const refresh = async () => {
    const v = await client().load();
    if (alive.current) setView(v);
  };

  useEffect(() => {
    alive.current = true;
    if (!open) return;
    void refresh();
    const t = window.setInterval(() => void refresh(), 10_000);
    return () => {
      alive.current = false;
      window.clearInterval(t);
    };
  }, [open, agentId]);

  const agent = view?.agents.find(a => a.id === agentId) ?? null;
  const trade = async (side: Side, good: GoodId, qty: number, price: number) => {
    const r = await client().trade(agentId, side, good, qty, price);
    await refresh();
    return r;
  };

  return (
    <div
      className={
        touch
          ? 'pointer-events-none absolute left-1/2 top-[86px] flex -translate-x-1/2 flex-col items-center gap-2'
          : 'pointer-events-none absolute right-3 top-[176px] flex flex-col items-end gap-2'
      }
      data-room-agent={agentId}
    >
      <button
        type="button"
        className="pointer-events-auto border-2 border-black bg-white px-3 py-1 text-sm font-black italic text-black shadow-[4px_4px_0_#d22209]"
        onClick={() => setOpen(o => !o)}
      >
        {name.toUpperCase()}’S SHOP <AgentTag />
      </button>
      {open &&
        (agent !== null ? (
          <AgentShop
            agent={agent}
            you={view?.you ?? null}
            onTrade={trade}
            onClose={() => setOpen(false)}
          />
        ) : (
          <div className="pointer-events-auto border-2 border-black bg-white px-3 py-2 text-xs font-bold text-black">
            {view === null ? 'Loading their prices…' : 'They’re not trading right now.'}
          </div>
        ))}
    </div>
  );
}
