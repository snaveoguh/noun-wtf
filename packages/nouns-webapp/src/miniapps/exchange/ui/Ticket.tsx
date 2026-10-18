// The order ticket: buy / sell, limit / market, qty and price, with what it
// will cost and what you hold.

import type { ExchangeSnapshot, GoodId } from '../engine';

import { useEffect, useState } from 'react';

import clsx from 'clsx';

import { GOOD_INFO, GOODS } from '../engine';

export interface TicketOrder {
  side: 'buy' | 'sell';
  kind: 'limit' | 'market';
  qty: number;
  price: number;
}

export function Ticket({
  snap,
  side,
  setSide,
  price,
  setPrice,
  busy,
  onSubmit,
  onGood,
  message,
}: {
  snap: ExchangeSnapshot;
  side: 'buy' | 'sell';
  setSide: (s: 'buy' | 'sell') => void;
  price: number;
  setPrice: (p: number) => void;
  busy: boolean;
  onSubmit: (o: TicketOrder) => void;
  onGood: (g: GoodId) => void;
  message: { ok: boolean; text: string } | null;
}) {
  const [kind, setKind] = useState<'limit' | 'market'>('limit');
  const [qty, setQty] = useState(1);
  const g = snap.good;
  const you = snap.you;
  const have = you?.goods[g] ?? 0;
  const coin = you?.coin ?? 0;
  const tk = snap.tickers.find(t => t.good === g);
  const best = side === 'buy' ? tk?.ask : tk?.bid;

  // Keep the price sensible when the good changes
  useEffect(() => {
    if (price <= 0 && best !== null && best !== undefined) setPrice(best);
  }, [best, price, setPrice]);

  const px = kind === 'market' ? (best ?? 0) : price;
  const total = qty * px;
  const fee = side === 'sell' ? Math.floor((total * snap.feeBps) / 10_000) : 0;
  const maxQty = side === 'buy' ? (px > 0 ? Math.floor(coin / px) : 0) : have;
  const cant =
    qty < 1 ||
    (kind === 'limit' && price < 1) ||
    (side === 'buy' ? total > coin : qty > have) ||
    (kind === 'market' && (best === null || best === undefined));

  return (
    <div className="gx-ticket">
      <div className="gx-seg">
        <button
          type="button"
          className={side === 'buy' ? 'gx-on gx-buy' : ''}
          onClick={() => setSide('buy')}
        >
          BUY
        </button>
        <button
          type="button"
          className={side === 'sell' ? 'gx-on gx-sell' : ''}
          onClick={() => setSide('sell')}
        >
          SELL
        </button>
      </div>
      <div className="gx-seg gx-seg-sm">
        <button
          type="button"
          className={kind === 'limit' ? 'gx-on' : ''}
          onClick={() => setKind('limit')}
        >
          limit
        </button>
        <button
          type="button"
          className={kind === 'market' ? 'gx-on' : ''}
          onClick={() => setKind('market')}
        >
          market
        </button>
      </div>
      <label className="gx-field">
        <span>qty</span>
        <button type="button" onClick={() => setQty(q => Math.max(1, q - 1))} aria-label="less">
          −
        </button>
        <input
          inputMode="numeric"
          value={qty}
          onChange={e =>
            setQty(Math.max(0, Math.min(10_000, Math.floor(Number(e.target.value) || 0))))
          }
          aria-label="quantity"
        />
        <button type="button" onClick={() => setQty(q => q + 1)} aria-label="more">
          +
        </button>
      </label>
      <div className="gx-quick">
        {[1, 5, 10].map(n => (
          <button type="button" key={n} onClick={() => setQty(n)}>
            {n}
          </button>
        ))}
        <button type="button" onClick={() => setQty(Math.max(1, maxQty))}>
          max
        </button>
      </div>
      {kind === 'limit' ? (
        <label className="gx-field">
          <span>price</span>
          <button
            type="button"
            onClick={() => setPrice(Math.max(1, price - 1))}
            aria-label="lower price"
          >
            −
          </button>
          <input
            inputMode="numeric"
            value={price}
            onChange={e => setPrice(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            aria-label="limit price"
          />
          <button type="button" onClick={() => setPrice(price + 1)} aria-label="higher price">
            +
          </button>
        </label>
      ) : (
        <div className="gx-field gx-muted">
          fills at best {side === 'buy' ? 'offers' : 'bids'} now
        </div>
      )}
      <div className="gx-sum">
        <span>
          {side === 'buy' ? 'cost' : 'get'} ≈ {total - fee} COIN
        </span>
        {side === 'sell' && <span className="gx-muted">fee {fee}</span>}
      </div>
      <button
        type="button"
        className={`gx-go ${side === 'buy' ? 'gx-buy' : 'gx-sell'}`}
        disabled={busy || cant}
        onClick={() => onSubmit({ side, kind, qty, price })}
      >
        {side === 'buy' ? 'BUY' : 'SELL'} {qty} {g} {kind === 'limit' ? `@ ${price}` : 'at market'}
      </button>
      {message !== null && (
        <div className={`gx-msg ${message.ok ? 'gx-up' : 'gx-down'}`}>{message.text}</div>
      )}
      <div className="gx-bal">
        <div className="gx-bal-coin">
          <b>{coin}</b> COIN
          {(you?.lockCoin ?? 0) > 0 && <span className="gx-muted"> +{you?.lockCoin} in bids</span>}
        </div>
        <div className="gx-holdings">
          {GOODS.map(k => {
            const n = (you?.goods[k] ?? 0) + (you?.lockGoods[k] ?? 0);
            if (n === 0) return null;
            return (
              <button
                type="button"
                key={k}
                className={clsx('gx-hold', k === g && 'gx-on')}
                onClick={() => onGood(k)}
              >
                {GOOD_INFO[k].icon} {n} {k}
              </button>
            );
          })}
          {you !== null &&
            GOODS.every(k => (you.goods[k] ?? 0) + (you.lockGoods[k] ?? 0) === 0) && (
              <span className="gx-muted">no goods yet</span>
            )}
        </div>
      </div>
    </div>
  );
}
