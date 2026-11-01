// ── An agent's shop: who they are, their board, buy / sell at their price ─
//
// Used in rooms (an agent behind the counter) and on the Exchange floor
// (click an agent). Trades are ordinary exchange deals at the posted price
// (engine/shops.ts); the agent's stock and your COIN are checked there.

import type { GoodId, Side } from '../../exchange/engine/types';
import type { TradeReply } from '../client';
import type { AgentPublic } from '../contract';

import { useMemo, useState } from 'react';

import { nounSvgDataUri } from '@/lib/marketplace/nouns-svg';

import { GOOD_INFO } from '../../exchange/engine/goods';

import { AgentTag } from './AgentTag';

const ROLE: Record<AgentPublic['role'], string> = {
  shopkeeper: 'SHOPKEEPER',
  maker: 'MARKET MAKER',
  collector: 'COLLECTOR',
};

export function agentFace(a: Pick<AgentPublic, 'seed'>): string {
  const [background, body, accessory, head, glasses] = a.seed;
  return nounSvgDataUri({ background, body, accessory, head, glasses });
}

export function AgentShop({
  agent,
  you,
  onTrade,
  onClose,
}: {
  agent: AgentPublic;
  you: { coin: number; goods: Partial<Record<GoodId, number>> } | null;
  onTrade: (side: Side, good: GoodId, qty: number, price: number) => Promise<TradeReply>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const face = useMemo(() => agentFace(agent), [agent.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const lines = agent.lines ?? {};
  const goods = agent.goods.filter(g => lines[g] !== undefined);

  const go = async (side: Side, g: GoodId, price: number) => {
    const key = `${side}:${g}`;
    setBusy(key);
    const r = await onTrade(side, g, 1, price);
    setBusy(null);
    setMsg(
      r.ok
        ? {
            ok: true,
            text: `${side === 'buy' ? 'Bought' : 'Sold'} 1 ${GOOD_INFO[g].name.toLowerCase()} for ${price} COIN`,
          }
        : { ok: false, text: r.reason ?? 'refused' },
    );
  };

  return (
    <aside
      className="pointer-events-auto w-[min(92vw,340px)] border-2 border-black bg-white p-3 text-black shadow-[6px_6px_0_#d22209]"
      role="dialog"
      aria-label={`${agent.name}'s shop`}
      data-agent-shop={agent.id}
    >
      <div className="flex items-start gap-2">
        <img src={face} alt="" className="h-12 w-12 border-2 border-black" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black uppercase italic leading-tight">
            {agent.shop ?? agent.name}
            <AgentTag />
          </div>
          <div className="text-[10px] font-bold uppercase text-[#d22209]">
            {agent.name} · {ROLE[agent.role]}
            {agent.policy === 'llm' ? ' · LLM' : ''}
          </div>
          <div className="text-[11px] leading-snug">{agent.blurb}</div>
        </div>
        <button
          type="button"
          aria-label="close"
          className="px-1 text-lg font-black"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {agent.say !== null && (
        <div className="mt-2 bg-black px-2 py-1 text-[11px] italic text-white">“{agent.say}”</div>
      )}
      {goods.length === 0 ? (
        <div className="mt-2 text-xs font-bold">
          {agent.paused ? 'Closed for now.' : 'Shutters down: they haven’t posted prices yet.'}
        </div>
      ) : (
        <table className="mt-2 w-full text-xs" data-agent-board>
          <thead>
            <tr className="text-left text-[10px] uppercase text-gray-600">
              <th className="font-bold">good</th>
              <th className="font-bold">stock</th>
              <th className="font-bold">they sell</th>
              <th className="font-bold">they buy</th>
            </tr>
          </thead>
          <tbody>
            {goods.map(g => {
              const l = lines[g]!;
              const stock = agent.stock[g] ?? 0;
              const mine = you?.goods[g] ?? 0;
              return (
                <tr key={g} className="border-t border-black/10">
                  <td className="py-1 font-black">
                    {GOOD_INFO[g].icon} {GOOD_INFO[g].name}
                  </td>
                  <td>{stock}</td>
                  <td>
                    {l.ask !== null && stock > 0 ? (
                      <button
                        type="button"
                        className="border-2 border-black bg-[#ffd400] px-1 font-black disabled:opacity-40"
                        disabled={busy !== null || (you !== null && you.coin < l.ask)}
                        onClick={() => void go('buy', g, l.ask!)}
                      >
                        BUY {l.ask}
                      </button>
                    ) : (
                      <span className="text-gray-400">–</span>
                    )}
                  </td>
                  <td>
                    {l.bid !== null ? (
                      <button
                        type="button"
                        className="border-2 border-black bg-white px-1 font-black disabled:opacity-40"
                        disabled={busy !== null || mine < 1}
                        title={mine < 1 ? `you have no ${g}` : undefined}
                        onClick={() => void go('sell', g, l.bid!)}
                      >
                        SELL {l.bid}
                      </button>
                    ) : (
                      <span className="text-gray-400">–</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="mt-2 text-[10px] text-gray-600">
        In-game COIN only{you !== null ? ` · you have ${you.coin} COIN` : ''} · the seller pays the
        1% fee
      </div>
      {msg !== null && (
        <div
          className={`mt-1 text-xs font-black ${msg.ok ? 'text-green-700' : 'text-[#d22209]'}`}
          data-agent-msg
        >
          {msg.text}
        </div>
      )}
    </aside>
  );
}
