// ── Noun Trade HUD: coin/cargo chip, the market panel, the garage ────────
//
// Mounted once by World2Page. A 4 Hz tracker works out which town you're in
// (`game.towns` when the towns part is there; else the city square, Noun
// Jersey's core, or a `?town=` dev override) and tells `game.trade`. In a
// town the chip grows a MARKET button; at a town's market stall E opens it
// too. While the panel is open the game takes no keys; Esc closes.

import type { Game } from '../Game';
import type { GoodId, TownId, TradeState } from './contract';
import type { TradeClient } from './TradeClient';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { HudIcon } from '../hud/icons';
import { HudSlot } from '../hud/slots';

import { GOOD_ICON, GOOD_IDS, GOODS } from './goods';
import { maxBuy, RULES, usedSlots } from './ledger';
import { locate } from './locate';
import { CashOutPanel } from './onchain/CashOutPanel';
import { TRADE_GOODS_ADDRESS, TRADE_ONCHAIN_ENABLED } from './onchain/flags';
import { isTown, TOWN_IDS, TOWN_SPECS } from './towns';
import { UPGRADE_IDS, UPGRADES } from './upgrades';

function useTrade(trade: TradeClient) {
  useSyncExternalStore(trade.subscribe, trade.getVersion);
  return trade;
}

/** Market tabs (BASE only when the on-chain layer is configured for this build). */
const TABS = [
  'market',
  'garage',
  ...(TRADE_ONCHAIN_ENABLED && TRADE_GOODS_ADDRESS !== null ? (['base'] as const) : []),
] as const;

/** Tracker ticks (250 ms) out of town before you count as gone. */
const LEAVE_TICKS = 4;

const ago = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

export function TradeUi({ game, touch }: { game: Game; touch: boolean }) {
  const trade = useTrade(game.trade);
  const [want, setOpen] = useState<null | 'market' | 'garage' | 'base'>(null);
  const [stall, setStall] = useState(false);

  // Dev override: ?town=cowboy
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('town');
    if (isTown(t)) trade.devTown = t;
  }, [trade]);

  // Town tracker. Leaving needs LEAVE_TICKS misses in a row: a one-tick
  // flicker at the edge of town used to close the market (and reset it).
  useEffect(() => {
    let misses = 0;
    const id = setInterval(() => {
      const at = locate(game, trade);
      misses = at.town === null ? misses + 1 : 0;
      if (at.town !== null || misses >= LEAVE_TICKS) trade.setTown(at.town);
      setStall(at.stall);
      if (at.town === null && misses >= LEAVE_TICKS) setOpen(null);
    }, 250);
    return () => clearInterval(id);
  }, [game, trade]);

  const town = trade.town;
  // Leaving town closes the panel
  const open = town === null ? null : want;

  // Game keys off while the panel is up
  useEffect(() => {
    if (open === null) return;
    game.input.setEnabled(false);
    return () => game.input.setEnabled(true);
  }, [game, open]);

  // Keys: E at the stall opens, Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || game.showroom) return;
      if (open !== null && (e.code === 'Escape' || e.code === 'KeyE')) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(null);
      } else if (open === null && e.code === 'KeyE' && stall && trade.town !== null) {
        e.preventDefault();
        e.stopPropagation();
        setOpen('market');
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [game, open, stall, trade]);

  const st = trade.state;
  const notice = trade.notice !== null && Date.now() - trade.notice.at < 3500 ? trade.notice : null;
  useTickWhile(notice !== null, 500);

  return (
    <>
      <div
        data-w2hud="trade"
        data-trade="chip"
        className={`pointer-events-none absolute flex flex-wrap items-center gap-1.5 ${touch ? 'left-[86px] top-12 max-w-[38vw]' : 'left-[96px] top-3 max-w-[40vw]'}`}
      >
        {/* The van cargo is a badge on the ring HUD's rim; notices join the toasts */}
        {st !== null && (
          <HudSlot name="rim">
            <CargoChip st={st} town={town} short={touch} onMarket={() => setOpen('market')} />
          </HudSlot>
        )}
        {notice !== null && (
          <HudSlot name="toasts">
            <div
              className={`w2-chip text-xs ${notice.ok ? 'w2-on' : ''}`}
              style={notice.ok ? undefined : { borderColor: '#ff4d3d' }}
            >
              {notice.ok ? '✓' : '✗'} {notice.text}
            </div>
          </HudSlot>
        )}
      </div>
      {stall && open === null && town !== null && (
        <HudSlot name="toasts">
          <button
            type="button"
            className="w2-prompt w2-prompt-at"
            data-trade="stall"
            onClick={() => setOpen('market')}
          >
            <kbd>{touch ? 'TAP' : 'E'}</kbd>
            <HudIcon name="shop" size={18} />
            {TOWN_SPECS[town].name.toUpperCase()} MARKET
          </button>
        </HudSlot>
      )}
      {open !== null && town !== null && st !== null && (
        <MarketPanel
          trade={trade}
          town={town}
          st={st}
          tab={open}
          onTab={setOpen}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

function useTickWhile(on: boolean, ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => set(n => n + 1), ms);
    return () => clearInterval(id);
  }, [on, ms]);
}

function CargoChip({
  st,
  town,
  short,
  onMarket,
}: {
  st: TradeState;
  town: TownId | null;
  /** Phones: no town name (the touch buttons sit right of it). */
  short: boolean;
  onMarket: () => void;
}) {
  const used = usedSlots(st.cargo);
  return (
    <div className="pointer-events-auto flex items-center gap-1.5">
      <div
        className="w2-chip flex items-center gap-1 !px-2 text-xs"
        title={`Van cargo ${used}/${st.capacity}, ${st.coin.toLocaleString()} COIN${town !== null ? `, in ${TOWN_SPECS[town].name}` : ''}`}
      >
        <HudIcon name="cargo" size={15} />
        <b>
          {used}/{st.capacity}
        </b>
        {town !== null && !short && <span className="opacity-60"> · {TOWN_SPECS[town].name}</span>}
      </div>
      {town !== null && (
        <button
          type="button"
          data-trade="open"
          className="bg-[#ffd400] px-2.5 py-1 text-xs font-black italic text-black shadow-[3px_3px_0_#d22209]"
          onClick={onMarket}
        >
          MARKET
        </button>
      )}
    </div>
  );
}

/** Best price you've seen elsewhere for selling a good (last-seen, not live). */
function bestElsewhere(trade: TradeClient, here: TownId, good: GoodId) {
  let best: { town: TownId; bid: number; at: number } | null = null;
  for (const t of TOWN_IDS) {
    if (t === here) continue;
    const s = trade.seen[t];
    const q = s?.quotes[good];
    if (s === undefined || q === undefined || q.bid <= 0) continue;
    if (best === null || q.bid > best.bid) best = { town: t, bid: q.bid, at: s.at };
  }
  return best;
}

function MarketPanel({
  trade,
  town,
  st,
  tab,
  onTab,
  onClose,
}: {
  trade: TradeClient;
  town: TownId;
  st: TradeState;
  tab: 'market' | 'garage' | 'base';
  onTab: (t: 'market' | 'garage' | 'base') => void;
  onClose: () => void;
}) {
  const spec = TOWN_SPECS[town];
  const used = usedSlots(st.cargo);
  const reload = useCallback(() => void trade.load(), [trade]);
  return (
    <div
      className="pointer-events-auto absolute inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 px-2 pb-4 pt-14"
      onPointerDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-trade="panel"
        className="w2-panel flex w-[600px] max-w-full flex-col gap-2 text-sm"
        onPointerDown={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-[.2em] opacity-60">
              {spec.style} · market
            </div>
            <div className="text-xl font-black italic leading-none">{spec.name}</div>
          </div>
          <div className="text-right text-xs leading-tight">
            <div>
              <b className="text-base text-[#ffd400]">{st.coin.toLocaleString()}</b> COIN
            </div>
            <div className="opacity-70">
              cargo {used}/{st.capacity}
              {trade.pending > 0 ? ' · syncing…' : ''}
            </div>
          </div>
          <button
            type="button"
            aria-label="Close market"
            className="ml-1 h-8 w-8 rounded-full bg-white/10 text-lg leading-none"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="flex gap-1 text-xs font-bold">
          {TABS.map(t => (
            <button
              key={t}
              type="button"
              data-trade-tab={t}
              className={`flex-1 rounded-lg px-3 py-1.5 uppercase tracking-wider ${tab === t ? 'bg-[#ffd400] text-black' : 'bg-white/10'}`}
              onClick={() => onTab(t)}
            >
              {t === 'market' ? 'Market' : t === 'garage' ? 'Garage · upgrades' : 'Base ⛓'}
            </button>
          ))}
        </div>
        {tab === 'market' ? (
          <MarketRows trade={trade} town={town} st={st} />
        ) : tab === 'garage' ? (
          <Garage trade={trade} town={town} st={st} />
        ) : (
          <div className="flex justify-center">
            <CashOutPanel rider={trade.rider} balance={st} onLedgerChange={reload} />
          </div>
        )}
        {trade.notice !== null && Date.now() - trade.notice.at < 6000 && (
          <div
            data-trade="notice"
            className={`rounded-lg px-3 py-1.5 text-xs ${trade.notice.ok ? 'bg-[#3ddc84]/20' : 'bg-[#ff4d3d]/25'}`}
          >
            {trade.notice.ok ? '✓' : '✗'} {trade.notice.text}
          </div>
        )}
        <div className="text-[10px] leading-snug opacity-50">
          You buy at ASK, sell at BID. Prices move with what gets traded here and drift back over
          about an hour. Ice cream melts on the road. Hints use prices you last saw in person.
        </div>
      </div>
    </div>
  );
}

function MarketRows({ trade, town, st }: { trade: TradeClient; town: TownId; st: TradeState }) {
  const [qty, setQty] = useState<Partial<Record<GoodId, number>>>({});
  const now = Date.now();
  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 px-1 text-[10px] uppercase tracking-wider opacity-50">
        <span>good · you have</span>
        <span className="w-9 text-right">bid</span>
        <span className="w-9 text-right">ask</span>
        <span className="w-[150px] text-center sm:w-[170px]">trade</span>
      </div>
      {GOOD_IDS.map(g => {
        const q = trade.quote(town, g);
        const have = st.cargo[g] ?? 0;
        const n = qty[g] ?? 1;
        const best = bestElsewhere(trade, town, g);
        const margin = best !== null && q !== null && q.ask > 0 ? best.bid - q.ask : null;
        const set = (v: number) =>
          setQty(o => ({ ...o, [g]: Math.max(1, Math.min(RULES.MAX_QTY, v)) }));
        const canBuy =
          q !== null ? maxBuy(town, g, q.stock, st.coin, st.capacity - usedSlots(st.cargo)) : 0;
        return (
          <div
            key={g}
            data-trade-good={g}
            className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-2 rounded-lg bg-white/5 px-1.5 py-1"
          >
            <div className="min-w-0">
              <div className="flex items-baseline gap-1.5">
                <span className="shrink-0 whitespace-nowrap text-xs">{GOOD_ICON[g]}</span>
                <b className="truncate">{GOODS[g].name}</b>
              </div>
              <div className="truncate text-[10px] opacity-70">
                have <b>{have}</b> · {q !== null ? `stock ${q.stock}` : 'no quote yet'}
                {GOODS[g].spoil > 0 ? ' · melts' : ''}
              </div>
              {margin !== null && best !== null && (
                <div
                  data-trade-hint={g}
                  className={`text-[10px] leading-tight ${margin > 0 ? 'text-[#3ddc84]' : 'text-[#ff8a7a]'}`}
                >
                  {TOWN_SPECS[best.town].name} bid {best.bid} ({margin > 0 ? '+' : ''}
                  {margin}/u, {ago(now - best.at)})
                </div>
              )}
              <div className="mt-0.5 flex gap-1 text-[10px] font-bold">
                {[1, 5].map(k => (
                  <button
                    key={k}
                    type="button"
                    data-trade-preset={`${g}:${k}`}
                    className={`rounded px-1.5 py-px ${n === k ? 'bg-white/30' : 'bg-white/10'}`}
                    onClick={() => set(k)}
                  >
                    ×{k}
                  </button>
                ))}
                <button
                  type="button"
                  data-trade-preset={`${g}:max`}
                  title="as many as you can afford and carry (or sell everything you have)"
                  disabled={Math.max(canBuy, have) < 1}
                  className="rounded bg-white/10 px-1.5 py-px disabled:opacity-30"
                  onClick={() => set(Math.max(canBuy, have))}
                >
                  MAX
                </button>
              </div>
            </div>
            <b className="w-9 text-right tabular-nums text-[#3ddc84]">
              {q !== null && q.bid > 0 ? q.bid : '–'}
            </b>
            <b className="w-9 text-right tabular-nums text-[#ffd400]">
              {q !== null && q.ask > 0 ? q.ask : '–'}
            </b>
            <div className="flex w-[150px] items-center justify-end gap-1 sm:w-[170px]">
              <button
                type="button"
                aria-label={`fewer ${g}`}
                className="h-7 w-6 rounded bg-white/10"
                onClick={() => set(n - (n > 10 ? 5 : 1))}
              >
                −
              </button>
              <span className="w-6 text-center tabular-nums" data-trade-qty={g}>
                {n}
              </span>
              <button
                type="button"
                aria-label={`more ${g}`}
                className="h-7 w-6 rounded bg-white/10"
                onClick={() => set(n + (n >= 10 ? 5 : 1))}
              >
                +
              </button>
              <button
                type="button"
                data-trade-buy={g}
                disabled={q === null || q.ask <= 0}
                className="h-7 rounded bg-[#ffd400] px-1.5 text-xs font-black text-black disabled:opacity-30"
                onClick={() => void trade.act({ t: 'buy', town, good: g, qty: n })}
              >
                BUY
              </button>
              <button
                type="button"
                data-trade-sell={g}
                disabled={have < 1 || q === null || q.bid <= 0}
                className="h-7 rounded bg-[#3ddc84] px-1.5 text-xs font-black text-black disabled:opacity-30"
                onClick={() => void trade.act({ t: 'sell', town, good: g, qty: Math.min(n, have) })}
              >
                SELL
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Garage({ trade, town, st }: { trade: TradeClient; town: TownId; st: TradeState }) {
  return (
    <div className="flex flex-col gap-1">
      {UPGRADE_IDS.map(id => {
        const u = UPGRADES[id];
        const owned = st.upgrades.includes(id);
        return (
          <div
            key={id}
            data-trade-up={id}
            className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1.5"
          >
            <div className="min-w-0 flex-1">
              <b>{u.name}</b>
              <div className="text-[11px] opacity-60">{u.blurb}</div>
            </div>
            {owned ? (
              <span className="text-xs font-bold text-[#3ddc84]">FITTED</span>
            ) : (
              <button
                type="button"
                data-trade-buyup={id}
                disabled={st.coin < u.cost}
                className="rounded bg-[#ffd400] px-2 py-1 text-xs font-black text-black disabled:opacity-30"
                onClick={() => void trade.act({ t: 'upgrade', town, up: id })}
              >
                {u.cost} COIN
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
