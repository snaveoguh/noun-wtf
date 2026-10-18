// The floor's read-only panels: order book ladder, trade tape, the bots'
// thoughts, the roster, your open orders.

import type {
  BotPublic,
  ExchangeSnapshot,
  FloorEvent,
  GeFill,
  GeOrder,
  GoodId,
  Level,
} from '../engine';

import clsx from 'clsx';

import { BOT_BY_ID, GOOD_INFO, isBot } from '../engine';

import { avatarFor } from './avatars';

const nameOf = (who: string, me: string) =>
  who === me
    ? 'you'
    : isBot(who)
      ? (BOT_BY_ID[who]?.name ?? who)
      : who === 'gx'
        ? 'EXCHANGE'
        : 'a rider';

const ago = (now: number, at: number) => {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
};

export function Ladder({
  depth,
  last,
  onPick,
}: {
  depth: ExchangeSnapshot['depth'];
  last: number | null;
  onPick: (price: number, side: 'buy' | 'sell') => void;
}) {
  const rows = 9;
  const asks = depth.asks.slice(0, rows);
  const bids = depth.bids.slice(0, rows);
  const cum = (ls: Level[]) => {
    let c = 0;
    return ls.map(l => (c += l.qty));
  };
  const ca = cum(asks);
  const cb = cum(bids);
  const maxC = Math.max(1, ca[ca.length - 1] ?? 0, cb[cb.length - 1] ?? 0);
  const spread = asks.length > 0 && bids.length > 0 ? asks[0].price - bids[0].price : null;
  const row = (l: Level, c: number, side: 'ask' | 'bid') => (
    <button
      type="button"
      key={`${side}${l.price}`}
      className={clsx('gx-lv', `gx-lv-${side}`, l.mine !== undefined && 'gx-lv-mine')}
      // Clicking an ask fills a buy ticket at that price, and vice versa
      onClick={() => onPick(l.price, side === 'ask' ? 'buy' : 'sell')}
      title={`${l.n} order${l.n === 1 ? '' : 's'}${l.mine !== undefined ? `, ${l.mine} yours` : ''}`}
    >
      <span className="gx-lv-bar" style={{ width: `${(c / maxC) * 100}%` }} />
      <span className="gx-lv-px">{l.price}</span>
      <span className="gx-lv-q">{l.qty}</span>
      <span className="gx-lv-m">{l.mine !== undefined ? `●${l.mine}` : ''}</span>
    </button>
  );
  return (
    <div className="gx-ladder">
      <div className="gx-lv gx-lv-head">
        <span className="gx-lv-px">price</span>
        <span className="gx-lv-q">qty</span>
        <span className="gx-lv-m">you</span>
      </div>
      <div className="gx-ladder-asks">
        {asks.length === 0 && <div className="gx-empty">no offers</div>}
        {asks.map((l, i) => row(l, ca[i], 'ask')).reverse()}
      </div>
      <div className="gx-spread">
        <span>last {last ?? '–'}</span>
        <span>spread {spread ?? '–'}</span>
      </div>
      <div>
        {bids.map((l, i) => row(l, cb[i], 'bid'))}
        {bids.length === 0 && <div className="gx-empty">no bids</div>}
      </div>
    </div>
  );
}

/** Keys that survive new items arriving at the front: content + duplicate count. */
function stableKeys<T>(xs: T[], key: (x: T) => string): string[] {
  const seen = new Map<string, number>();
  const out = new Array<string>(xs.length);
  for (let i = xs.length - 1; i >= 0; i--) {
    const k = key(xs[i]);
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    out[i] = `${k}#${n}`;
  }
  return out;
}

export function Tape({ tape, now, me }: { tape: GeFill[]; now: number; me: string }) {
  const keys = stableKeys(tape, f => `${f.at}-${f.buyer}-${f.seller}-${f.qty}-${f.price}`);
  return (
    <div className="gx-tape">
      {tape.length === 0 && <div className="gx-empty">quiet tape</div>}
      {tape.map((f, i) => {
        const prev = tape[i + 1] as GeFill | undefined;
        const dir =
          prev === undefined || f.price === prev.price ? '' : f.price > prev.price ? 'up' : 'down';
        const mine = f.buyer === me || f.seller === me;
        return (
          <div
            key={keys[i]}
            className={clsx('gx-tp', dir !== '' && `gx-tp-${dir}`, mine && 'gx-tp-mine')}
          >
            <span className="gx-tp-t">{ago(now, f.at)}</span>
            <span className="gx-tp-px">{f.price}</span>
            <span className="gx-tp-q">×{f.qty}</span>
            <span className="gx-tp-who">
              {nameOf(f.buyer, me)} ← {nameOf(f.seller, me)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function FloorFeed({
  floor,
  now,
  me,
  onGood,
}: {
  floor: FloorEvent[];
  now: number;
  me: string;
  onGood: (g: GoodId) => void;
}) {
  const keys = stableKeys(floor, e => `${e.at}-${e.who}-${e.text}`);
  return (
    <div className="gx-floor" aria-live="polite">
      {floor.map((e, i) => (
        <div key={keys[i]} className={clsx('gx-fl', e.who === me && 'gx-fl-me')}>
          {e.who === 'gx' ? (
            <span className="gx-fl-av gx-fl-gx">GX</span>
          ) : (
            <img className="gx-fl-av" src={avatarFor(e.who)} alt="" width={28} height={28} />
          )}
          <div className="gx-fl-body">
            <div className="gx-fl-top">
              <b>{nameOf(e.who, me)}</b>
              {e.good !== undefined && (
                <button type="button" className="gx-chip" onClick={() => onGood(e.good!)}>
                  {e.good}
                </button>
              )}
              <span className="gx-fl-t">{ago(now, e.at)}</span>
            </div>
            <div className="gx-fl-text">{e.text}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Roster({ bots }: { bots: BotPublic[] }) {
  return (
    <div className="gx-roster">
      {bots.map(b => (
        <div key={b.id} className="gx-bot" title={b.blurb}>
          <img src={avatarFor(b.id)} alt="" width={36} height={36} />
          <div className="gx-bot-body">
            <div>
              <b>{b.name}</b> <span className="gx-muted">noun {b.noun}</span>
            </div>
            <div className="gx-muted gx-bot-style">{b.style}</div>
          </div>
          <div className={`gx-bot-pnl ${b.pnl >= 0 ? 'gx-up' : 'gx-down'}`}>
            {b.pnl >= 0 ? '+' : ''}
            {b.pnl}
          </div>
        </div>
      ))}
    </div>
  );
}

export function MyOrders({
  orders,
  onCancel,
  busy,
}: {
  orders: GeOrder[];
  onCancel: (id: string) => void;
  busy: boolean;
}) {
  if (orders.length === 0) return <div className="gx-empty">no open orders</div>;
  return (
    <div className="gx-orders">
      {orders.map(o => (
        <div key={o.id} className={`gx-or gx-or-${o.side}`}>
          <span className="gx-or-side">{o.side === 'buy' ? 'BID' : 'ASK'}</span>
          <span>
            {GOOD_INFO[o.good].icon} {o.good}
          </span>
          <span>
            {o.filled}/{o.qty} @ {o.price}
          </span>
          <button
            type="button"
            className="gx-x"
            disabled={busy}
            onClick={() => onCancel(o.id)}
            aria-label={`cancel order ${o.id}`}
          >
            cancel
          </button>
        </div>
      ))}
    </div>
  );
}
