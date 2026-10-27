// ── The trade panel: offer / ask someone on the floor in COIN ───────────
//
// Opens when you click (tap) a player or a trader. The logic (defaults,
// checks, which exchange action) is sim/tradeForm.ts; this only draws it.
// Incoming offers (someone offered YOU a trade) are the Offers list below.
// Mount it with key={target.key}: a new target starts a fresh form.

import type { DealsView, PublicDeal, Ticker, YouView } from '../../exchange/engine/types';

import { useMemo, useState } from 'react';

import { GOOD_INFO, GOODS } from '../../exchange/engine/goods';
import {
  defaultPrice,
  formNote,
  formProblem,
  formSummary,
  openForm,
  type TradeForm,
  type TradeTarget,
} from '../sim/tradeForm';

export function TradePanel({
  target,
  tickers,
  you,
  pit,
  live,
  onSend,
  onClose,
}: {
  target: TradeTarget;
  tickers: readonly Ticker[];
  you: YouView | null;
  /** The good of the pit you're standing nearest. */
  pit: TradeForm['good'];
  /** Is the real exchange answering (needed for player-to-player deals)? */
  live: boolean;
  onSend: (f: TradeForm) => Promise<{ ok: boolean; reason?: string }>;
  onClose: () => void;
}) {
  const [f, setF] = useState<TradeForm>(() => openForm(target, tickers, you, pit));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const problem = formProblem(f, you);
  const needsLive = (target.kind === 'peer' || target.kind === 'rider') && !live;
  const reprice = (side: TradeForm['side'], good: TradeForm['good']) =>
    setF(x => ({
      ...x,
      side,
      good,
      price: defaultPrice(
        side,
        tickers.find(t => t.good === good),
        good,
      ),
    }));
  const ticker = useMemo(() => tickers.find(t => t.good === f.good), [tickers, f.good]);

  const send = async () => {
    if (problem !== null || busy || needsLive) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await onSend(f);
      setMsg({
        ok: r.ok,
        text: r.ok
          ? target.kind === 'peer' || target.kind === 'rider'
            ? 'Offer sent. Waiting for them…'
            : target.kind === 'bot'
              ? `${target.name} took it. Done.`
              : 'On the book.'
          : (r.reason ?? 'refused'),
      });
    } catch {
      setMsg({ ok: false, text: "couldn't reach the exchange" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="gx3d-trade" role="dialog" aria-label={`trade with ${target.name}`}>
      <div className="gx3d-trade-head">
        <b>
          TRADE WITH {target.name}
          {(target.kind === 'peer' || target.kind === 'rider') && (
            <span className="gx3d-muted gx3d-trade-tag"> {target.tag}</span>
          )}
        </b>
        <button type="button" className="gx3d-x" aria-label="close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="gx3d-trade-row">
        {(['buy', 'sell'] as const).map(s => (
          <button
            key={s}
            type="button"
            className={`gx3d-btn ${f.side === s ? 'gx3d-on' : ''}`}
            onClick={() => reprice(s, f.good)}
          >
            {s === 'buy' ? 'BUY FROM THEM' : 'SELL TO THEM'}
          </button>
        ))}
      </div>
      <label className="gx3d-trade-row">
        <span>GOOD</span>
        <select value={f.good} onChange={e => reprice(f.side, e.target.value as TradeForm['good'])}>
          {GOODS.map(g => (
            <option key={g} value={g}>
              {GOOD_INFO[g].icon} {g}
              {you !== null && (you.goods[g] ?? 0) > 0 ? ` (you have ${you.goods[g]})` : ''}
            </option>
          ))}
        </select>
      </label>
      <div className="gx3d-trade-row">
        <label>
          <span>QTY</span>
          <input
            type="number"
            min={1}
            step={1}
            value={f.qty}
            onChange={e => setF(x => ({ ...x, qty: Math.floor(Number(e.target.value)) }))}
          />
        </label>
        <label>
          <span>PRICE (COIN)</span>
          <input
            type="number"
            min={1}
            step={1}
            value={f.price}
            onChange={e => setF(x => ({ ...x, price: Math.floor(Number(e.target.value)) }))}
          />
        </label>
      </div>
      <div className="gx3d-muted gx3d-trade-quote">
        {ticker !== undefined
          ? `bid ${ticker.bid ?? '–'} · ask ${ticker.ask ?? '–'} · last ${ticker.last ?? '–'}`
          : ''}
        {you !== null ? ` · you: ${you.coin} COIN` : ''}
      </div>
      <div className="gx3d-muted">{formNote(target)}</div>
      <button
        type="button"
        className="gx3d-btn gx3d-trade-send"
        disabled={problem !== null || busy || needsLive}
        onClick={() => void send()}
      >
        {busy ? '…' : formSummary(f)}
      </button>
      {needsLive && (
        <div className="gx3d-trade-msg gx3d-bad">Offers to players need the live exchange.</div>
      )}
      {problem !== null && !needsLive && <div className="gx3d-trade-msg gx3d-bad">{problem}</div>}
      {msg !== null && (
        <div className={`gx3d-trade-msg ${msg.ok ? 'gx3d-good' : 'gx3d-bad'}`}>{msg.text}</div>
      )}
    </aside>
  );
}

const dealText = (d: PublicDeal, incoming: boolean) => {
  // `side` is what the proposer does
  const theyBuy = d.side === 'buy';
  const verb = incoming
    ? theyBuy
      ? 'wants to BUY'
      : 'offers to SELL you'
    : theyBuy
      ? 'you BUY'
      : 'you SELL';
  return `${verb} ${d.qty} ${d.good} @ ${d.price}`;
};

/** Offers to and from you (direct deals), with accept / decline. */
export function Offers({
  deals,
  nameOf,
  now,
  onAnswer,
}: {
  deals: DealsView;
  nameOf: (tag: string) => string;
  now: number;
  onAnswer: (id: string, accept: boolean) => Promise<{ ok: boolean; reason?: string }>;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  if (deals.incoming.length === 0 && deals.outgoing.length === 0 && msg === null) return null;
  const answer = async (id: string, accept: boolean) => {
    const r = await onAnswer(id, accept).catch(() => ({
      ok: false,
      reason: "couldn't reach the exchange",
    }));
    setMsg(r.ok ? (accept ? 'Deal done.' : 'Declined.') : (r.reason ?? 'refused'));
    window.setTimeout(() => setMsg(null), 4000);
  };
  return (
    <div className="gx3d-offers" aria-live="polite">
      {deals.incoming.map(d => (
        <div key={d.id} className="gx3d-offer gx3d-offer-in">
          <div>
            <b>{nameOf(d.who)}</b> {dealText(d, true)}
            <span className="gx3d-muted"> · {Math.max(0, Math.round((d.exp - now) / 1000))}s</span>
          </div>
          <div className="gx3d-trade-row">
            <button
              type="button"
              className="gx3d-btn gx3d-on"
              onClick={() => void answer(d.id, true)}
            >
              ACCEPT
            </button>
            <button type="button" className="gx3d-btn" onClick={() => void answer(d.id, false)}>
              DECLINE
            </button>
          </div>
        </div>
      ))}
      {deals.outgoing.map(d => (
        <div key={d.id} className="gx3d-offer">
          <span className="gx3d-muted">to {nameOf(d.who)}:</span> {dealText(d, false)}{' '}
          <button
            type="button"
            className="gx3d-x"
            aria-label="withdraw"
            onClick={() => void answer(d.id, false)}
          >
            ×
          </button>
        </div>
      ))}
      {msg !== null && <div className="gx3d-trade-msg">{msg}</div>}
    </div>
  );
}
