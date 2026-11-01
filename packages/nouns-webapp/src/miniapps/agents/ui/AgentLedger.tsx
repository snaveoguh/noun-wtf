// ── The agent ledger: what the city's agents have been trading ───────────

import type { AgentPublic, LedgerEntry } from '../contract';

import { GOOD_INFO } from '../../exchange/engine/goods';

import { AgentTag } from './AgentTag';

const ago = (now: number, at: number) => {
  const s = Math.max(0, Math.round((now - at) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
};

export function AgentLedger({
  agents,
  ledger,
  now,
  nameOf,
  onClose,
}: {
  agents: readonly AgentPublic[];
  ledger: readonly LedgerEntry[];
  now: number;
  /** A public tag → a display name ('you', a bot's or agent's name, a rider tag). */
  nameOf?: (tag: string) => string;
  onClose: () => void;
}) {
  const byId = new Map(agents.map(a => [a.id, a]));
  const name = (t: string | undefined) =>
    t === undefined ? '?' : (byId.get(t)?.name ?? nameOf?.(t) ?? t);
  return (
    <aside
      className="pointer-events-auto flex max-h-[70vh] w-[min(94vw,380px)] flex-col border-2 border-black bg-white text-black shadow-[6px_6px_0_#d22209]"
      role="dialog"
      aria-label="agent ledger"
      data-agent-ledger
    >
      <div className="flex items-center justify-between bg-black px-3 py-1 text-white">
        <b className="text-sm italic">
          AGENT LEDGER <AgentTag />
        </b>
        <button type="button" aria-label="close" className="text-lg font-black" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="flex flex-wrap gap-1 border-b-2 border-black p-2 text-[10px]">
        {agents.map(a => (
          <span key={a.id} className="border border-black px-1 font-bold" title={a.goal}>
            {a.name} · {a.coin}c · eq {a.equity}
            {a.paused ? ' · paused' : ''}
          </span>
        ))}
      </div>
      <ol className="flex-1 overflow-y-auto p-2 text-xs" data-agent-ledger-rows>
        {ledger.length === 0 && <li className="text-gray-600">No agent trades yet.</li>}
        {ledger.map((e, i) => (
          <li key={`${e.at}-${i}`} className="border-b border-black/10 py-0.5">
            <span className="text-gray-500">{ago(now, e.at)} </span>
            <b>{name(e.agent)}</b>{' '}
            {e.kind === 'fill' ? (
              <>
                {e.side === 'buy' ? 'bought' : 'sold'} {e.qty}{' '}
                {e.good ? GOOD_INFO[e.good].icon : ''} {e.good} @ {e.price}{' '}
                <span className="text-gray-600">
                  {e.side === 'buy' ? 'from' : 'to'} {name(e.with)}
                  {e.via === 'book' ? ' · book' : ''}
                </span>
              </>
            ) : (
              <i className="text-gray-700">{e.text}</i>
            )}
          </li>
        ))}
      </ol>
    </aside>
  );
}
