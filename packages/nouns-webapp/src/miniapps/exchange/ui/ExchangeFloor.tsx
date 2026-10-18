// ── The Grand Exchange trading floor (standalone page) ───────────────────
//
// Polls the exchange (server, or the engine in this tab with ?offline=1)
// every few seconds and renders the floor: ticker, chart, ladder, tape,
// the bots' thoughts, your ticket, balances and open orders.

import type { ExchangeSnapshot, GoodId } from '../engine';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import clsx from 'clsx';

import { HttpExchange, LocalExchange, type ClientAction, type ExchangeClient } from '../client';
import { GOOD_INFO, isGood } from '../engine';

import { Chart } from './Chart';
import { FloorFeed, Ladder, MyOrders, Roster, Tape } from './Panels';
import { Ticket, type TicketOrder } from './Ticket';

import './exchange.css';

const POLL_MS = 3_000;
const OFFLINE_POLL_MS = 1_000;

function makeClient(): ExchangeClient {
  const q = new URLSearchParams(window.location.search);
  if (q.get('offline') === '1') {
    const seed = Number(q.get('seed') ?? 7) || 7;
    const speed = Math.min(60, Math.max(1, Number(q.get('speed') ?? 1) || 1));
    return new LocalExchange(seed, speed);
  }
  return new HttpExchange();
}

export default function ExchangeFloor() {
  const client = useMemo(makeClient, []);
  const [good, setGoodState] = useState<GoodId>(() => {
    const g = new URLSearchParams(window.location.search).get('good');
    return isGood(g) ? g : 'ICECREAM';
  });
  const [tf, setTf] = useState<'m' | 'h'>('m');
  const [snap, setSnap] = useState<ExchangeSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [price, setPrice] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const joined = useRef(false);
  const want = useRef({ good, tf });
  want.current = { good, tf };

  const accept = useCallback((s: ExchangeSnapshot) => {
    // Drop answers for a good / timeframe we've since left
    if (s.good !== want.current.good || s.tf !== want.current.tf) return;
    setSnap(s);
    setErr(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const s = await client.load(want.current.good, want.current.tf);
      accept(s);
      if (s.you === null && !joined.current) {
        joined.current = true;
        const r = await client.act({ t: 'join' }, want.current.good, want.current.tf);
        accept(r.snapshot);
        setMsg({
          ok: true,
          text: `welcome to the floor: ${r.snapshot.you?.coin ?? 0} COIN to start (in-game only)`,
        });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'offline');
    }
  }, [accept, client]);

  useEffect(() => {
    void refresh();
    const every = client.offline ? OFFLINE_POLL_MS : POLL_MS;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, every);
    return () => window.clearInterval(id);
  }, [client, refresh, good, tf]);

  // Dev handle for browser tests
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __gx?: unknown }).__gx = { client, refresh };
  }, [client, refresh]);

  const setGood = useCallback((g: GoodId) => {
    setGoodState(g);
    setPrice(0);
    setMsg(null);
  }, []);

  const act = useCallback(
    async (a: ClientAction) => {
      setBusy(true);
      try {
        const r = await client.act(a, want.current.good, want.current.tf);
        accept(r.snapshot);
        return r;
      } finally {
        setBusy(false);
      }
    },
    [accept, client],
  );

  const submit = useCallback(
    async (o: TicketOrder) => {
      const r = await act({
        t: 'order',
        side: o.side,
        good: want.current.good,
        qty: o.qty,
        price: o.price,
        kind: o.kind,
      });
      const q = r.fills.reduce((x, f) => x + f.qty, 0);
      if (!r.ok && q === 0) {
        setMsg({ ok: false, text: `refused: ${r.reason ?? 'no'}` });
        return;
      }
      const avg = q > 0 ? r.fills.reduce((x, f) => x + f.qty * f.price, 0) / q : 0;
      const resting = o.kind === 'limit' ? o.qty - q : 0;
      setMsg({
        ok: true,
        text:
          q > 0
            ? `filled ${q} @ ${Math.round(avg * 10) / 10}${resting > 0 ? `, ${resting} resting` : ''}`
            : o.kind === 'limit'
              ? `order resting: ${o.side} ${o.qty} @ ${o.price}`
              : 'nothing filled',
      });
    },
    [act],
  );

  const cancel = useCallback(
    async (id: string) => {
      const r = await act({ t: 'cancel', order: id });
      setMsg(
        r.ok
          ? { ok: true, text: 'order cancelled, escrow returned' }
          : { ok: false, text: r.reason ?? 'no' },
      );
    },
    [act],
  );

  const tk = snap?.tickers.find(t => t.good === good);
  const me = client.owner;

  return (
    <div className="gx-root">
      <header className="gx-head">
        <div className="gx-title">
          <span className="gx-logo">⌐◨-◨</span> GRAND EXCHANGE
          <span className={`gx-mode ${client.offline ? 'gx-mode-off' : ''}`}>
            {client.offline ? 'OFFLINE SIM' : err !== null ? 'RECONNECTING' : 'LIVE'}
          </span>
        </div>
        <div className="gx-sub">
          Noun Trade&apos;s order book. Bots and riders trade in-game COIN. No wallets, no real
          money.
          {snap !== null && (
            <span className="gx-muted"> treasury {snap.treasury} COIN in fees</span>
          )}
        </div>
      </header>

      <nav className="gx-tickers" aria-label="goods">
        {(snap?.tickers ?? []).map(t => (
          <button
            type="button"
            key={t.good}
            className={clsx('gx-tk', t.good === good && 'gx-on')}
            onClick={() => setGood(t.good)}
          >
            <span className="gx-tk-i">{GOOD_INFO[t.good].icon}</span>
            <span className="gx-tk-g">{t.good}</span>
            <span className="gx-tk-p">{t.last ?? '–'}</span>
            <span className={`gx-tk-c ${(t.chg ?? 0) >= 0 ? 'gx-up' : 'gx-down'}`}>
              {t.chg === null ? '' : `${t.chg >= 0 ? '+' : ''}${(t.chg * 100).toFixed(1)}%`}
            </span>
          </button>
        ))}
        {snap === null && <span className="gx-muted">opening the floor…</span>}
      </nav>

      {snap !== null && (
        <div className="gx-grid">
          <section className="gx-panel gx-a-chart">
            <div className="gx-ph">
              <span>
                {GOOD_INFO[good].icon} {good}{' '}
                <span className="gx-muted">{GOOD_INFO[good].name}</span>
              </span>
              <span className="gx-ph-stats">
                bid <b className="gx-up">{tk?.bid ?? '–'}</b> ask{' '}
                <b className="gx-down">{tk?.ask ?? '–'}</b> vol {tk?.vol ?? 0}/h
              </span>
              <span className="gx-seg gx-seg-sm gx-tf">
                <button
                  type="button"
                  className={tf === 'm' ? 'gx-on' : ''}
                  onClick={() => setTf('m')}
                >
                  1m
                </button>
                <button
                  type="button"
                  className={tf === 'h' ? 'gx-on' : ''}
                  onClick={() => setTf('h')}
                >
                  1h
                </button>
              </span>
            </div>
            <Chart
              candles={snap.candles}
              tf={snap.tf}
              fair={tk?.fair ?? 0}
              last={tk?.last ?? null}
            />
          </section>

          <section className="gx-panel gx-a-ticket">
            <div className="gx-ph">your ticket</div>
            <Ticket
              snap={snap}
              side={side}
              setSide={s => {
                setSide(s);
                const best = s === 'buy' ? tk?.ask : tk?.bid;
                if (best !== null && best !== undefined) setPrice(best);
              }}
              price={price}
              setPrice={setPrice}
              busy={busy}
              onSubmit={o => void submit(o)}
              onGood={setGood}
              message={msg}
            />
          </section>

          <section className="gx-panel gx-a-book">
            <div className="gx-ph">order book</div>
            <Ladder
              depth={snap.depth}
              last={tk?.last ?? null}
              onPick={(p, s) => {
                setSide(s);
                setPrice(p);
              }}
            />
          </section>

          <section className="gx-panel gx-a-orders">
            <div className="gx-ph">your open orders</div>
            <MyOrders
              orders={snap.you?.orders ?? []}
              onCancel={id => void cancel(id)}
              busy={busy}
            />
          </section>

          <section className="gx-panel gx-a-floor">
            <div className="gx-ph">the floor</div>
            <FloorFeed floor={snap.floor} now={snap.now} me={me} onGood={setGood} />
          </section>

          <section className="gx-panel gx-a-tape">
            <div className="gx-ph">{good} tape</div>
            <Tape tape={snap.tape} now={snap.now} me={me} />
          </section>

          <section className="gx-panel gx-a-bots">
            <div className="gx-ph">the regulars</div>
            <Roster bots={snap.bots} />
          </section>
        </div>
      )}
      {err !== null && snap === null && (
        <div className="gx-msg gx-down">can&apos;t reach the exchange: {err}</div>
      )}
    </div>
  );
}
