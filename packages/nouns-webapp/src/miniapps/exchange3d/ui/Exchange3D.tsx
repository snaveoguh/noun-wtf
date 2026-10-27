// ── The 3D Grand Exchange (default view at /exchange) ───────────────────
//
// Mounts FloorScene and draws the HUD: feed status and legend, camera
// buttons, the followed trader's card, sound, and the way back to the flat
// order book (as a side panel, or the whole flat view). Walking (the
// default camera): the trade panel for whoever you clicked, your offers
// in / out, and a thumb stick on phones.

import type { MeLook } from '../render/walkMode';
import type { CamMode } from '../sim/cameras';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { nounSvgDataUri } from '@/lib/marketplace/nouns-svg';

import { isMobile, readDevice } from '../../world2/render/deviceTier';
import { FloorScene, type HudState } from '../render/FloorScene';
import { budgetFor } from '../sim/lod';
import { formAction } from '../sim/tradeForm';

import { myLook } from './me';
import { Stick } from './Stick';
import { Offers, TradePanel } from './TradePanel';

import './exchange3d.css';

const CAMS: { m: CamMode; label: string; key: string; hint: string }[] = [
  {
    m: 'walk',
    label: 'WALK',
    key: '6',
    hint: 'You, on foot: WASD / arrows (Shift runs), drag to look, click someone to trade',
  },
  {
    m: 'floor',
    label: 'FLOOR',
    key: '1',
    hint: 'Walk-level orbit round a pit (press again for the next pit)',
  },
  { m: 'wide', label: 'WIDE', key: '2', hint: 'The whole hall' },
  {
    m: 'vast',
    label: 'VAST',
    key: '3',
    hint: 'Pull right out: the floor goes on and on (V toggles it, back to where you were)',
  },
  { m: 'follow', label: 'FOLLOW', key: '4', hint: 'Lock onto a trader (or tap one)' },
  {
    m: 'free',
    label: 'FREE',
    key: '5',
    hint: 'Drag to orbit, right-drag / two fingers to pan, scroll / pinch to zoom',
  },
];

const FEED_TEXT = {
  live: 'LIVE EXCHANGE',
  offline: 'OFFLINE SIM',
  fallback: 'SIMULATED · SERVER AWAY',
} as const;

function num(q: URLSearchParams, k: string): number | undefined {
  const v = q.get(k);
  if (v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export default function Exchange3D({
  onFlat,
  bookOpen,
  onBook,
  children,
  onExit,
  intro,
  me,
}: {
  /** You, as your Noun World rider (default: the saved character select pick). */
  me?: MeLook;
  /** Under the fountain in Noun World: the way back up (button and Esc). */
  onExit?: () => void;
  intro?: 'descent';
  onFlat: () => void;
  bookOpen: boolean;
  onBook: (open: boolean) => void;
  /** The flat order book, when open (a side panel over the floor). */
  children?: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<FloorScene | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [helpOpen, setHelp] = useState(false);
  const phone = useMemo(() => isMobile(readDevice()), []);

  useEffect(() => {
    if (host.current === null || layer.current === null) return;
    const q = new URLSearchParams(window.location.search);
    let scene: FloorScene;
    try {
      scene = new FloorScene(host.current, layer.current, {
        offline: q.get('offline') === '1',
        speed: Math.min(60, Math.max(1, num(q, 'speed') ?? 1)),
        budget: budgetFor(phone, { traders: num(q, 'traders'), rigs: num(q, 'rigs') }),
        phone,
        onHud: setHud,
        intro,
        me: me ?? myLook(),
        // The Exchange's multiplayer room (?offline=1 stays off it unless ?mp=1)
        online: q.get('offline') !== '1' || q.get('mp') === '1',
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'WebGL unavailable');
      return;
    }
    sceneRef.current = scene;
    const cam = q.get('cam');
    if (cam === 'floor' || cam === 'wide' || cam === 'vast' || cam === 'follow' || cam === 'free')
      scene.setMode(cam);
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [phone]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc climbs back out (unless it's stopping a follow or closing a trade first)
  const followingRef = useRef(false);
  followingRef.current = hud?.follow != null || hud?.target != null;
  useEffect(() => {
    if (onExit === undefined) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || followingRef.current) return;
      e.preventDefault();
      onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  const s = sceneRef.current;
  const f = hud?.follow ?? null;
  const avatar = useMemo(() => (f !== null ? nounSvgDataUri(f.seed) : null), [f?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err !== null)
    return (
      <div className="gx3d-root gx3d-err">
        <p>The 3D floor needs WebGL ({err}).</p>
        <button type="button" className="gx3d-btn" onClick={onFlat}>
          OPEN THE ORDER BOOK
        </button>
      </div>
    );

  return (
    <div className={`gx3d-root ${phone ? 'gx3d-phone' : ''} ${bookOpen ? 'gx3d-book-open' : ''}`}>
      <div ref={host} className="gx3d-host" />
      <div ref={layer} className="gx3d-labels" aria-hidden="true" />

      <header className="gx3d-top">
        <div className="gx3d-title">
          <span className="gx3d-noggles">⌐◨-◨</span> GRAND EXCHANGE
        </div>
        <div className="gx3d-status">
          <span className={`gx3d-pill gx3d-${hud?.feed ?? 'live'}`}>
            {hud === null || !hud.connected ? 'CONNECTING…' : FEED_TEXT[hud.feed]}
          </span>
          {hud !== null && (
            <span className="gx3d-stat">
              {hud.traders} traders · {hud.fillsPerMin} fills/min{' '}
              <span className="gx3d-gold">({hud.realPerMin} live)</span>
            </span>
          )}
        </div>
        <div className="gx3d-legend">
          <span className="gx3d-key-real">★ gold = live exchange order / fill</span>
          <span className="gx3d-key-sim">white = simulated crowd</span>
        </div>
      </header>

      <div className="gx3d-tools">
        {onExit !== undefined && (
          <button type="button" className="gx3d-btn gx3d-exit" onClick={onExit}>
            ↑ PLAZA
          </button>
        )}
        <button
          type="button"
          className="gx3d-btn"
          aria-label={hud?.sound === true ? 'mute the floor' : 'turn floor sound on'}
          onClick={() => s?.toggleSound()}
        >
          {hud?.sound === true ? '🔊' : '🔈'}
        </button>
        <button
          type="button"
          className={`gx3d-btn ${bookOpen ? 'gx3d-on' : ''}`}
          onClick={() => onBook(!bookOpen)}
        >
          📈 {phone ? 'BOOK' : 'ORDER BOOK'}
        </button>
        <button type="button" className="gx3d-btn" onClick={onFlat}>
          FLAT
        </button>
        <button
          type="button"
          className="gx3d-btn"
          aria-label="help"
          onClick={() => setHelp(h => !h)}
        >
          ?
        </button>
      </div>

      {hud?.news != null && <div className="gx3d-news">EXCHANGE: {hud.news}</div>}

      {helpOpen && (
        <div className="gx3d-help" onClick={() => setHelp(false)}>
          <b>Cameras</b>
          {CAMS.map(c => (
            <div key={c.m}>
              {!phone && <kbd>{c.key}</kbd>} <b>{c.label}</b> {c.hint}
            </div>
          ))}
          <div>
            {phone
              ? 'WALK: thumb stick to walk (push all the way to run), drag to look, tap anyone to trade. Other cameras: drag to orbit · two fingers to pan · pinch to zoom · tap a Noun to follow it.'
              : 'WALK: WASD / arrows, Shift runs, drag to look, scroll to zoom, click anyone to trade. Other cameras: drag to orbit · right-drag or shift-drag to pan · scroll to zoom · click a Noun to follow it · [ ] change pit · Esc stop following.'}
          </div>
          <div className="gx3d-muted">
            Gold bubbles and ★ names are the real Grand Exchange: its bots (real Nouns) and riders,
            their orders and fills. Everyone else is a simulated crowd trading at the real prices,
            so the floor is never empty. Other players here walk the floor as their riders: click one
            to offer them a trade. In-game COIN only, never real money.
          </div>
        </div>
      )}

      {f !== null && (
        <aside className={`gx3d-card ${f.real ? 'gx3d-card-real' : ''}`}>
          <div className="gx3d-card-head">
            {avatar !== null && <img src={avatar} alt="" width={44} height={44} />}
            <div>
              <div className="gx3d-card-name">
                {f.real ? '★ ' : ''}
                {f.name}
              </div>
              <div className="gx3d-muted">
                {f.kind === 'bot'
                  ? 'exchange bot · real Noun'
                  : f.kind === 'rider'
                    ? 'a rider on the exchange'
                    : f.kind === 'you'
                      ? 'you'
                      : 'simulated trader'}
              </div>
            </div>
            <button
              type="button"
              className="gx3d-x"
              aria-label="stop following"
              onClick={() => s?.follow(null)}
            >
              ×
            </button>
          </div>
          {f.blurb !== null && <div className="gx3d-muted gx3d-card-blurb">{f.blurb}</div>}
          <div className="gx3d-card-now">{f.now !== null ? `“${f.now}”` : '…'}</div>
          {f.kind !== 'you' && (
            <button
              type="button"
              className="gx3d-btn"
              onClick={() => {
                const t = s?.targetOf(f.i) ?? null;
                if (t !== null) s?.setTarget(t);
              }}
            >
              TRADE WITH {f.name}
            </button>
          )}
          {f.recent.length > 0 && (
            <ul>
              {f.recent.map(r => (
                <li key={`${r.ago}|${r.text}`} className={r.real ? 'gx3d-gold' : ''}>
                  {r.text} <span className="gx3d-muted">{r.ago}s</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}

      {hud?.target != null && s !== null && (
        <TradePanel
          target={hud.target}
          tickers={hud.tickers}
          you={hud.you}
          pit={hud.nearPit}
          live={hud.feed === 'live'}
          onSend={f => s.act(formAction(hud.target!, f))}
          onClose={() => s.setTarget(null)}
        />
      )}

      {hud !== null && s !== null && (
        <Offers
          deals={hud.deals}
          now={hud.now}
          nameOf={t => s.nameOf(t)}
          onAnswer={(id, accept) => s.act(accept ? { t: 'accept', deal: id } : { t: 'decline', deal: id })}
        />
      )}

      {hud?.walking === true && phone && <Stick onMove={(x, y) => s?.setStick(x, y)} />}
      {hud?.walking === true && !phone && hud.target === null && hud.follow === null && (
        <div className="gx3d-walkhint">
          WASD walk · Shift run · drag to look · click someone to trade · V vast
          {hud.peers > 0 ? ` · ${hud.peers} other player${hud.peers === 1 ? '' : 's'} here` : ''}
        </div>
      )}

      <nav className="gx3d-cams" aria-label="cameras">
        {CAMS.map(c => (
          <button
            key={c.m}
            type="button"
            title={c.hint}
            className={`gx3d-cam ${hud?.mode === c.m ? 'gx3d-on' : ''} ${c.m === 'vast' ? 'gx3d-cam-vast' : ''} ${c.m === 'walk' ? 'gx3d-cam-walk' : ''}`}
            onClick={() => s?.setMode(c.m)}
          >
            {!phone && <kbd>{c.key}</kbd>}
            {c.m === 'floor' && hud?.mode === 'floor' ? hud.pit : c.label}
          </button>
        ))}
      </nav>

      {children}

      {hud !== null && (
        <div className="gx3d-perf" aria-hidden="true">
          {hud.fps} fps · {hud.frameMs} ms · {hud.rigs} rigs · {hud.bubbles} bubbles
          {hud.online ? ` · online (${hud.peers})` : ''}
          {hud.vastHalls > 0 ? ` · ${hud.vastHalls + 1} halls` : ''}
        </div>
      )}
    </div>
  );
}
