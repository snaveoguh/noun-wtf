// ── Interiors HUD: the door prompt, and the menu inside ──────────────────
//
// Outside: "ENTER <place> — E / tap" when you're at a door. Inside: the
// place's name, your COIN, and what you can do right now (visit.ts menu),
// as big buttons: a column on the right on desktop (with 1–9 keys), a
// scrolling row along the bottom on a phone. Gifts open an amount picker
// (1 / 5 / 25), Buy opens the shop list. The first spawn (woken upstairs
// in a plaza home) adds a banner and puts its two ways out, the roof and
// downstairs, first in the menu. Mounted once by World2Page.

import type { Game } from '../Game';
import type { InteriorSystem, InteriorsView, UiAction } from './InteriorSystem';

import { useSyncExternalStore, type ReactNode } from 'react';

import { HudSlot } from '../hud/slots';
function useInteriors(sys: InteriorSystem): InteriorsView {
  return useSyncExternalStore(sys.subscribe, sys.getView);
}

const BTN =
  'pointer-events-auto flex items-center gap-2 border-2 border-black bg-white px-3 py-2 text-left font-black text-black shadow-[4px_4px_0_#d22209] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_#d22209]';

export function InteriorsUi({ game, touch }: { game: Game; touch: boolean }) {
  const sys = game.interiors;
  const v = useInteriors(sys);
  const act = (a: UiAction) => sys.act(a);

  return (
    <div className="pointer-events-none absolute inset-0 z-30 select-none" data-interiors="hud">
      {v.prompt !== null && (
        <HudSlot name="toasts">
          <button
            type="button"
            data-interiors="prompt"
            className="pointer-events-auto absolute left-1/2 top-[30%] -translate-x-1/2 bg-[#ffd400] px-5 py-3 text-center text-lg font-black italic text-black shadow-[6px_6px_0_#d22209]"
            onClick={() => act({ a: v.prompt!.kind })}
          >
            {v.prompt.text} — {touch ? 'TAP' : 'E'}
            {v.prompt.sub !== undefined && (
              <span className="block text-xs font-bold not-italic">{v.prompt.sub}</span>
            )}
          </button>
        </HudSlot>
      )}

      {v.inside !== null && (
        <div
          className={
            touch
              ? 'absolute bottom-[262px] left-1/2 flex -translate-x-1/2 items-center gap-2 bg-black/75 px-3 py-1 text-white'
              : 'absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-2 bg-black/75 px-3 py-1 text-white'
          }
          data-interiors="title"
        >
          <span className="text-lg">{v.inside.icon}</span>
          <b className="max-w-[52vw] truncate text-sm uppercase">{v.inside.name}</b>
          <span className="text-[10px] font-bold text-[#ffd400]">{v.inside.label}</span>
          {v.coin !== null && <span className="ml-1 text-xs font-bold">🪙 {v.coin}</span>}
        </div>
      )}

      {v.note !== null && (
        <HudSlot name="toasts">
          <div
            key={v.note.at}
            className="absolute left-1/2 top-[18%] -translate-x-1/2 bg-[#ffd400] px-4 py-2 text-sm font-black italic text-black shadow-[4px_4px_0_#d22209]"
            data-interiors="note"
          >
            {v.note.text}
          </div>
        </HudSlot>
      )}

      {v.eating !== null && (
        <div
          className="absolute left-1/2 top-[24%] -translate-x-1/2 animate-pulse text-2xl"
          data-interiors="eating"
        >
          {v.eating.icon}{' '}
          <span className="text-sm font-black text-white drop-shadow">nom nom…</span>
        </div>
      )}

      {v.wake !== null && (
        <div
          data-interiors="wake"
          className={
            touch
              ? 'absolute left-1/2 top-[16%] -translate-x-1/2 bg-[#ffd400] px-4 py-2 text-center font-black italic text-black shadow-[4px_4px_0_#d22209]'
              : 'absolute left-1/2 top-[22%] -translate-x-1/2 bg-[#ffd400] px-5 py-2 text-center font-black italic text-black shadow-[6px_6px_0_#d22209]'
          }
        >
          <span className="block whitespace-nowrap text-base">{v.wake.text}</span>
          <span className="block text-xs font-bold not-italic">
            {v.wake.sub}{' '}
            {touch
              ? 'Tap below.'
              : v.actions.filter(a => a.a === 'wake').length > 1
                ? 'Press 1 or 2.'
                : 'Press 1.'}
          </span>
        </div>
      )}

      {v.inside !== null && v.actions.length > 0 && v.shop === null && v.gift === null && (
        <div
          data-interiors="menu"
          className={
            touch
              ? 'absolute inset-x-0 bottom-[208px] flex gap-2 overflow-x-auto px-3 pb-1'
              : 'absolute bottom-20 left-1/2 flex w-[min(720px,56vw)] -translate-x-1/2 flex-wrap justify-center gap-2'
          }
        >
          {v.actions.map((a, i) => (
            <button
              key={`${a.a}:${a.label}`}
              type="button"
              data-action={a.a}
              className={`${BTN} ${touch ? 'shrink-0 text-sm' : 'text-sm'} ${a.a === 'accept' || a.a === 'thank' || a.a === 'wake' ? 'bg-[#ffd400]' : ''} ${a.a === 'steal' ? 'bg-[#2b2b2b] text-white' : ''}`}
              onClick={() => act({ a: 'menu', index: i })}
            >
              {!touch && i < 9 && <kbd className="text-[10px] font-bold opacity-60">{i + 1}</kbd>}
              <span className="text-lg leading-none">{a.icon}</span>
              <span className="leading-tight">{a.label}</span>
            </button>
          ))}
        </div>
      )}

      {v.gift !== null && (
        <Sheet
          title={`🎁 GIFT ${v.gift.name.toUpperCase()}`}
          onClose={() => act({ a: 'close' })}
          touch={touch}
        >
          <div className="flex gap-2">
            {v.gift.amounts.map((n, i) => (
              <button
                key={n}
                type="button"
                data-gift={n}
                className={`${BTN} flex-1 justify-center bg-[#ffd400] text-lg`}
                disabled={v.coin !== null && v.coin < n}
                onClick={() => act({ a: 'gift', coin: n })}
              >
                {!touch && <kbd className="text-[10px] opacity-60">{i + 1}</kbd>}🪙 {n}
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {v.exhibit !== null && (
        <Sheet title={`📜 PROP ${v.exhibit.id}`} onClose={() => act({ a: 'close' })} touch={touch}>
          <div data-interiors="exhibit" className="flex flex-col gap-2 text-black">
            <span
              className="self-start px-2 py-0.5 text-xs font-black text-white"
              style={{ background: v.exhibit.color }}
            >
              {v.exhibit.label}
            </span>
            <b className="text-base leading-snug">{v.exhibit.title}</b>
            <span className="text-sm font-bold">{v.exhibit.ask}</span>
            <span className="text-xs font-semibold opacity-70">{v.exhibit.votes}</span>
            <a
              href={v.exhibit.href}
              target="_blank"
              rel="noreferrer"
              className={`${BTN} justify-center bg-[#ffd400] text-sm`}
            >
              VIEW PROP {v.exhibit.id} ↗
            </a>
          </div>
        </Sheet>
      )}

      {v.shop !== null && (
        <Sheet title={v.shop.title} onClose={() => act({ a: 'close' })} touch={touch}>
          <div className="flex max-h-[36vh] flex-col gap-2 overflow-y-auto">
            {v.shop.rows.map((r, i) => (
              <button
                key={r.id}
                type="button"
                data-buy={r.id}
                className={`${BTN} justify-between`}
                disabled={r.price === null || (v.coin !== null && v.coin < r.price)}
                onClick={() => act({ a: 'buy', id: r.id })}
              >
                <span className="flex items-center gap-2">
                  {!touch && i < 9 && <kbd className="text-[10px] opacity-60">{i + 1}</kbd>}
                  <span className="text-lg">{r.icon}</span>
                  <span>{r.name}</span>
                  <span className="text-[10px] font-bold opacity-60">
                    {r.how === 'van' ? 'TO THE VAN' : r.how === 'eat' ? 'EAT HERE' : ''}
                  </span>
                </span>
                <span className="text-[#d22209]">{r.price === null ? '—' : `🪙 ${r.price}`}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}

function Sheet({
  title,
  onClose,
  touch,
  children,
}: {
  title: string;
  onClose: () => void;
  touch: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-interiors="sheet"
      className={
        touch
          ? 'pointer-events-auto absolute inset-x-3 bottom-[200px] border-4 border-black bg-[#f4f1ea] p-3 shadow-[5px_5px_0_#d22209]'
          : 'pointer-events-auto absolute left-1/2 top-1/2 w-96 -translate-x-1/2 -translate-y-1/2 border-4 border-black bg-[#f4f1ea] p-3 shadow-[6px_6px_0_#d22209]'
      }
    >
      <div className="mb-2 flex items-center justify-between">
        <b className="text-sm font-black italic">{title}</b>
        <button
          type="button"
          className="px-2 text-lg font-black"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      {children}
    </div>
  );
}
