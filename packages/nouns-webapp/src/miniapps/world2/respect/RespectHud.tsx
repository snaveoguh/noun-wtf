// ── Respect on the HUD ──────────────────────────────────────────────────
//
//   RespectMeter   the compact chip in the top-left column (tier + bar),
//                  with the ticker under it ("+4 RESPECT, gave Nadia 5
//                  COIN"); tap it for the details panel (score, tier, what
//                  moves it, recent history)
//   RespectBanner  the tier-up / tier-down moment (a banner + a sound)

import type { RespectEntry, RespectSystem } from './RespectSystem';
import type { RespectTier } from '../interiors/contract';

import type { ReactNode } from 'react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { createPortal } from 'react-dom';

import { NOGGLES_SRC } from './effects';
import { RESPECT_CSS, TIER_COLOR } from './hudStyle';
import { nextTier, TIER_NAME, tickerText, TIERS } from './rules';

const RAISES = [
  'Gifts (bigger is better; less each time to the same person)',
  'Eating what you are offered, and saying thanks',
  'Buying local, sitting a while, helping people',
  'Big clean combos (5,000+ points)',
  'A real piece on a plain wall',
  'Serving customers, especially for good tips',
  'Winning at hoops and in breakdance battles',
];
const LOWERS = [
  'Stealing (a lot)',
  "Tagging someone's home (a lot)",
  'Bailing into people',
  'Overstaying, turning down food',
  'Losing a battle (a little)',
];

type SfxLike = { play(id: 'mission-complete' | 'ui-cancel', o?: { gain?: number }): unknown };

function useRespect(r: RespectSystem) {
  return useSyncExternalStore(
    cb => r.subscribe(cb),
    () => r.state(),
  );
}

/** Re-render every `ms` while `on`. */
function useClock(on: boolean, ms = 500) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [on, ms]);
  return now;
}

function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

function Line({ e }: { e: RespectEntry }) {
  const c = e.delta > 0 ? '#3ddc84' : e.delta < 0 ? '#ff6b5e' : '#ffd400';
  return (
    <div className="w2-respect-tick" style={{ borderLeftColor: c }}>
      {e.delta !== 0 ? (
        <>
          <b style={{ color: c }}>{tickerText(e.delta, '').replace(/, $/, '')}</b> {e.label}
        </>
      ) : (
        e.label
      )}
    </div>
  );
}

export function RespectMeter({ respect }: { respect: RespectSystem }) {
  const s = useRespect(respect);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // The ticker: changes since the last render are in s.recent / notes
  const ticking = respect.ticker().length > 0;
  const now = useClock(ticking || open);
  const lines = respect.ticker(now);
  const color = TIER_COLOR[s.tier];
  return (
    <div ref={ref} className="relative flex flex-col items-end" data-w2hud="respect">
      <button
        type="button"
        className="w2-chip w2-respect pointer-events-auto"
        onClick={() => setOpen(o => !o)}
        title="Respect: tap for details"
        aria-expanded={open}
      >
        {s.tier === 'legend' && (
          <img src={NOGGLES_SRC} alt="" width={18} height={7} className="w2-respect-nog" />
        )}
        <span className="w2-respect-label">RESPECT</span>
        <span className="w2-respect-tier" style={{ color }}>
          {TIER_NAME[s.tier]}
        </span>
        <span className="w2-respect-bar" aria-hidden="true">
          <i style={{ width: `${Math.round(s.progress * 100)}%`, background: color }} />
        </span>
        <span className="w2-respect-score opacity-60">{Math.round(s.score)}</span>
      </button>
      {/* The ticker flies out to the meter's left, over the scene, so nothing reflows */}
      {!open && lines.length > 0 && (
        <div className="w2-respect-ticker">
          {lines.map(e => (
            <Line key={`${e.at}-${e.label}`} e={e} />
          ))}
        </div>
      )}
      {open && (
        <PanelLayer anchor={ref.current}>
          <RespectPanel respect={respect} now={now} onClose={() => setOpen(false)} />
        </PanelLayer>
      )}
    </div>
  );
}

/**
 * The panel is lifted out of the HUD column (a draggable block is its own
 * stacking context, so later HUD pieces would paint over it) into the HUD
 * root, placed under the meter.
 */
function PanelLayer({ anchor, children }: { anchor: HTMLElement | null; children: ReactNode }) {
  // The draggable block (it sets `translate`) and the HUD root above it
  let block: HTMLElement | null = anchor;
  while (block !== null && block.style.translate === '') block = block.parentElement;
  const root = block?.parentElement ?? null;
  if (anchor === null || root === null) return <>{children}</>;
  const a = anchor.getBoundingClientRect();
  const r = root.getBoundingClientRect();
  return createPortal(
    <div
      className="w2-respect-layer"
      style={{ top: a.bottom - r.top + 6, right: Math.max(8, r.right - a.right) }}
    >
      {children}
    </div>,
    root,
  );
}

function RespectPanel({
  respect,
  now,
  onClose,
}: {
  respect: RespectSystem;
  now: number;
  onClose: () => void;
}) {
  const s = respect.state();
  const nx = nextTier(s.tier);
  const color = TIER_COLOR[s.tier];
  return (
    <div className="w2-respect-panel pointer-events-auto" role="dialog" aria-label="Respect">
      <div className="flex items-center justify-between">
        <b className="text-[11px] tracking-[.14em] opacity-70">RESPECT</b>
        <button type="button" className="w2-respect-x" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-black italic" style={{ color }}>
          {TIER_NAME[s.tier]}
        </span>
        <span className="text-sm opacity-70">{Math.round(s.score)} pts</span>
      </div>
      <div className="w2-respect-ladder">
        {TIERS.map(t => (
          <span key={t} style={t === s.tier ? { color: TIER_COLOR[t], opacity: 1 } : undefined}>
            {TIER_NAME[t]}
          </span>
        ))}
      </div>
      <span className="w2-respect-bar w2-respect-bar-lg" aria-hidden="true">
        <i style={{ width: `${Math.round(s.progress * 100)}%`, background: color }} />
      </span>
      <div className="mt-1 text-[11px] opacity-70">
        {nx !== null
          ? `${Math.max(0, Math.ceil(nx.at - s.score))} to ${TIER_NAME[nx.tier]}`
          : 'the top: everyone knows you'}
        {respect.queued > 0 ? `, ${respect.queued} saving…` : ''}
      </div>
      <div className="w2-respect-cols">
        <div>
          <h4 style={{ color: '#3ddc84' }}>RAISES IT</h4>
          <ul>
            {RAISES.map(r => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
        <div>
          <h4 style={{ color: '#ff6b5e' }}>LOWERS IT</h4>
          <ul>
            {LOWERS.map(r => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mt-1 text-[10px] opacity-60">
        Away a while, your progress inside a tier slowly fades (never the tier). Below zero, you are
        slowly forgiven.
      </p>
      <h4 className="mt-2">RECENT</h4>
      {s.recent.length === 0 ? (
        <p className="text-[11px] opacity-60">Nothing yet. Go be somebody.</p>
      ) : (
        <ul className="w2-respect-hist">
          {s.recent.map(e => (
            <li key={`${e.at}-${e.label}`}>
              <b style={{ color: e.delta > 0 ? '#3ddc84' : '#ff6b5e' }}>
                {e.delta > 0 ? '+' : '−'}
                {Math.abs(e.delta)}
              </b>
              <span>{e.label}</span>
              <i>{ago(e.at, now)}</i>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Tier up / down: a banner for a few seconds, and a sound. */
export function RespectBanner({ respect, sfx }: { respect: RespectSystem; sfx?: SfxLike }) {
  const [shown, setShown] = useState<{ to: RespectTier; up: boolean; at: number } | null>(null);
  useEffect(
    () =>
      respect.onTier((to, from) => {
        const up = TIERS.indexOf(to) > TIERS.indexOf(from);
        setShown({ to, up, at: Date.now() });
        sfx?.play(up ? 'mission-complete' : 'ui-cancel', { gain: up ? 0.7 : 0.5 });
      }),
    [respect, sfx],
  );
  useEffect(() => {
    if (shown === null) return;
    const t = setTimeout(() => setShown(null), 3400);
    return () => clearTimeout(t);
  }, [shown]);
  // (The respect CSS rides here: the banner is always mounted.)
  if (shown === null) return <style>{RESPECT_CSS}</style>;
  return (
    <>
      <style>{RESPECT_CSS}</style>
      <div
        key={shown.at}
        data-w2hud="respect-banner"
        className={`w2-respect-banner ${shown.up ? '' : 'w2-respect-down'}`}
        role="status"
      >
        <span>{shown.up ? 'RESPECT UP' : 'RESPECT DOWN'}</span>
        <b style={shown.up ? undefined : { color: TIER_COLOR[shown.to] }}>
          {shown.to === 'legend' && <img src={NOGGLES_SRC} alt="" width={32} height={12} />}
          {TIER_NAME[shown.to]}
        </b>
      </div>
    </>
  );
}
