// ── Noun Rush: snowboard → drive → run → fly → dance ───────────────────
//
// Mounted by NounOS on /rush. Designed from a notebook page:
// fighting, snowboarding, racing (run fast), dancing on the floor, cars,
// motorbikes, tractors, helicopters, planes, airports, Fanta + oranges.
//
// course.ts    pure race rules (zones, rides, obstacles, AI) — tested
// models.ts    racers + rides built from primitives, real Noun heads
// RushGame.ts  three.js world, camera, input, post stack
// RushAudio.ts synth sound + the dance-floor beat

import type { NounSeed } from '@/miniapps/world2/character/NounAppearance';

import { useEffect, useMemo, useRef, useState, type PointerEvent as RPE } from 'react';

import { randomSeed } from '@/miniapps/world2/character/NounAppearance';
import { loadSavedCharacter } from '@/miniapps/world2/ui/CharacterSelect';

import {
  RushGame,
  isTouchDevice,
  ordinal,
  type Contestant,
  type HudState,
  type TouchState,
} from './RushGame';

const RIVALS: { name: string; color: string; skill: number; seed: NounSeed }[] = [
  {
    name: 'SPEEDY',
    color: '#2a7de1',
    skill: 1.02,
    seed: { background: 0, body: 2, accessory: 12, head: 141, glasses: 7 },
  },
  {
    name: 'CAPPY',
    color: '#e8372c',
    skill: 0.98,
    seed: { background: 1, body: 19, accessory: 40, head: 37, glasses: 1 },
  },
  {
    name: 'BONES',
    color: '#f2f2f2',
    skill: 0.95,
    seed: { background: 0, body: 27, accessory: 88, head: 199, glasses: 13 },
  },
  {
    name: 'SURSE',
    color: '#9b59d0',
    skill: 0.92,
    seed: { background: 1, body: 8, accessory: 61, head: 88, glasses: 18 },
  },
];

const fmt = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};

const CSS = `
.rush-root{position:absolute;inset:0;overflow:hidden;background:#9cc3e0;font-family:"Londrina Solid",system-ui,sans-serif;color:#fff;user-select:none;-webkit-user-select:none;touch-action:none}
.rush-root canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.rush-shadow{text-shadow:0 2px 0 rgba(0,0,0,.45),0 0 12px rgba(0,0,0,.35)}
.rush-top{position:absolute;left:16px;right:16px;top:14px;display:flex;justify-content:space-between;align-items:flex-start;pointer-events:none;gap:12px}
.rush-place{font-size:64px;line-height:.9}
.rush-place small{font-size:24px;margin-left:2px}
.rush-chip{background:rgba(0,0,0,.45);border-radius:10px;padding:6px 12px;font-size:18px;letter-spacing:.5px;backdrop-filter:blur(4px)}
.rush-stack{display:flex;flex-direction:column;gap:6px;align-items:flex-end}
.rush-bar{position:absolute;left:50%;transform:translateX(-50%);top:16px;width:min(46vw,520px);height:10px;border-radius:6px;background:rgba(0,0,0,.35);pointer-events:none}
.rush-bar i{position:absolute;top:-5px;width:20px;height:20px;border-radius:50%;margin-left:-10px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)}
.rush-bar i.me{width:26px;height:26px;top:-8px;margin-left:-13px;border-color:#ffd84d;z-index:2}
.rush-speed{position:absolute;right:16px;bottom:16px;text-align:right;pointer-events:none}
.rush-speed b{font-size:56px;line-height:1}
.rush-boost{height:8px;border-radius:4px;background:linear-gradient(90deg,#ff8a00,#ffd84d);margin-top:6px;transition:width .1s}
.rush-toasts{position:absolute;left:0;right:0;top:28%;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none}
.rush-toast{font-size:30px;animation:rush-pop .25s ease-out}
.rush-toast.big{font-size:min(14vw,84px);letter-spacing:2px}
@keyframes rush-pop{from{transform:scale(1.5);opacity:0}to{transform:scale(1);opacity:1}}
.rush-count{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:min(40vw,220px);pointer-events:none}
.rush-card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,calc(100vw - 32px));max-height:calc(100% - 32px);overflow:auto;background:rgba(12,14,20,.78);backdrop-filter:blur(10px);border-radius:18px;padding:22px 22px 18px;box-shadow:0 20px 60px rgba(0,0,0,.4)}
.rush-card h1{font-size:min(15vw,72px);line-height:.9;margin:0;color:#ffd84d}
.rush-card h2{font-size:22px;margin:4px 0 14px;opacity:.85;font-weight:400}
.rush-legs{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin:10px 0 14px;font-size:14px;text-align:center}
.rush-legs div{background:rgba(255,255,255,.08);border-radius:10px;padding:8px 4px}
.rush-legs span{display:block;font-size:24px}
.rush-keys{font-family:system-ui,sans-serif;font-size:13px;opacity:.8;line-height:1.6;margin-bottom:14px}
.rush-keys kbd{background:rgba(255,255,255,.15);border-radius:4px;padding:1px 6px;font-family:inherit}
.rush-go{width:100%;border:0;border-radius:12px;padding:14px;font:inherit;font-size:28px;background:#ffd84d;color:#111;cursor:pointer}
.rush-go:active{transform:scale(.98)}
.rush-rows{display:flex;flex-direction:column;gap:6px;margin:6px 0 16px}
.rush-row{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.07);border-radius:10px;padding:8px 12px;font-size:20px}
.rush-row.me{background:rgba(255,216,77,.22)}
.rush-row .dot{width:14px;height:14px;border-radius:50%}
.rush-row .grow{flex:1}
.rush-row .dim{opacity:.7;font-size:16px;font-family:system-ui,sans-serif}
.rush-touch{position:absolute;left:0;right:0;bottom:0;padding:16px;display:flex;justify-content:space-between;align-items:flex-end;pointer-events:none}
.rush-touch .grp{display:flex;gap:10px;pointer-events:auto}
.rush-touch button{width:66px;height:66px;border-radius:50%;border:2px solid rgba(255,255,255,.6);background:rgba(0,0,0,.35);color:#fff;font:inherit;font-size:22px;touch-action:none}
.rush-touch button.on{background:rgba(255,216,77,.6)}
.rush-touch .col{display:flex;flex-direction:column;gap:10px}
.rush-err{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;text-align:center;font-size:22px;background:#1b2330}
@media (max-width:640px){.rush-place{font-size:46px}.rush-speed b{font-size:40px}.rush-legs{grid-template-columns:repeat(3,1fr)}.rush-bar{top:auto;bottom:100px;width:calc(100vw - 32px)}}
`;

export interface RushPageProps {
  paused?: boolean;
}

export default function RushPage({ paused = false }: RushPageProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [game, setGame] = useState<RushGame | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const touch = useMemo(() => isTouchDevice(), []);
  const [pressed, setPressed] = useState<TouchState>({
    left: false,
    right: false,
    up: false,
    down: false,
    jump: false,
    punch: false,
  });

  const me = useMemo(() => {
    const saved = loadSavedCharacter();
    const name = (saved?.name ?? '').trim();
    return {
      name: name !== '' ? name.toUpperCase().slice(0, 10) : 'YOU',
      seed: saved?.seed ?? randomSeed(),
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement('canvas');
    host.prepend(canvas);
    let g: RushGame;
    try {
      g = new RushGame(canvas);
    } catch (e) {
      setError((e as Error).message || 'WebGL unavailable');
      canvas.remove();
      return;
    }
    const cast: Contestant[] = [
      { name: me.name, seed: me.seed, color: '#ffd84d', skill: 1, human: true },
      ...RIVALS.map(r => ({ ...r, human: false })),
    ];
    // Player starts in the middle of the pack
    cast.splice(0, 1);
    cast.splice(2, 0, { name: me.name, seed: me.seed, color: '#ffd84d', skill: 1, human: true });
    g.onHud = setHud;
    g.setContestants(cast);
    const resize = () => g.resize(canvas.clientWidth, canvas.clientHeight);
    resize();
    window.addEventListener('resize', resize);
    g.start();
    setGame(g);
    if (import.meta.env.DEV) (window as unknown as { __rush?: RushGame }).__rush = g;
    return () => {
      window.removeEventListener('resize', resize);
      g.dispose();
      canvas.remove();
      if (import.meta.env.DEV) delete (window as unknown as { __rush?: RushGame }).__rush;
    };
  }, [me]);

  useEffect(() => {
    game?.setPaused(paused);
  }, [game, paused]);

  const hold = (k: keyof TouchState) => ({
    onPointerDown: (e: RPE) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      if (game) {
        game.touch = { ...game.touch, [k]: true };
        if (k === 'punch') game.punch();
      }
      setPressed(p => ({ ...p, [k]: true }));
    },
    onPointerUp: () => {
      if (game) game.touch = { ...game.touch, [k]: false };
      setPressed(p => ({ ...p, [k]: false }));
    },
    onPointerCancel: () => {
      if (game) game.touch = { ...game.touch, [k]: false };
      setPressed(p => ({ ...p, [k]: false }));
    },
  });

  if (error !== null)
    return (
      <div className="rush-root">
        <style>{CSS}</style>
        <div className="rush-err">Noun Rush needs WebGL: {error}</div>
      </div>
    );

  const h = hud;
  const racing = h?.phase === 'race';
  const showTitle = h?.phase === 'ready';
  const done = h?.phase === 'done';
  const meRow = h?.rows.find(r => r.human);

  return (
    <div className="rush-root" ref={hostRef}>
      <style>{CSS}</style>

      {h !== null && (racing || done) && (
        <>
          <div className="rush-top rush-shadow">
            <div className="rush-place">
              {h.place}
              <small>
                {ordinal(h.place)}/{h.total}
              </small>
            </div>
            <div className="rush-stack">
              <div className="rush-chip">{h.zone}</div>
              <div className="rush-chip">{h.ride}</div>
              <div className="rush-chip">🍊 {h.oranges}</div>
              <div className="rush-chip">{fmt(h.time)}</div>
            </div>
          </div>
          <div className="rush-bar">
            {h.rows.map(r => (
              <i
                key={r.name}
                className={r.human ? 'me' : undefined}
                style={{ left: `${r.progress * 100}%`, background: r.color }}
                title={r.name}
              />
            ))}
          </div>
          <div className="rush-speed rush-shadow" style={touch ? { bottom: 170 } : undefined}>
            <b>{h.kmh}</b> km/h
            <div
              className="rush-boost"
              style={{ width: `${Math.min(1, h.boost / 2.6) * 140}px` }}
            />
          </div>
        </>
      )}

      {h !== null && (
        <div className="rush-toasts rush-shadow">
          {h.toasts.map(t => (
            <div key={t.id} className={t.big ? 'rush-toast big' : 'rush-toast'}>
              {t.text}
            </div>
          ))}
        </div>
      )}

      {h?.phase === 'countdown' && h.countdown > 0 && (
        <div className="rush-count rush-shadow" key={h.countdown}>
          <span className="rush-toast big" style={{ fontSize: 'inherit' }}>
            {h.countdown}
          </span>
        </div>
      )}

      {showTitle && (
        <div className="rush-card" onPointerDown={e => e.stopPropagation()}>
          <h1>NOUN RUSH</h1>
          <h2>snowboard, drive, run, fly, then dance. first to the floor wins</h2>
          <div className="rush-legs">
            <div>
              <span>🏂</span>snow
            </div>
            <div>
              <span>🚗</span>town
            </div>
            <div>
              <span>🏃</span>grass
            </div>
            <div>
              <span>✈️</span>sky
            </div>
            <div>
              <span>🪩</span>dance
            </div>
          </div>
          <div className="rush-keys">
            {touch ? (
              <>
                ◀ ▶ steer · ▲ ▼ sprint/brake (climb/dive when flying) · JUMP · POW punches
                whoever&apos;s next to you
              </>
            ) : (
              <>
                <kbd>←</kbd>
                <kbd>→</kbd> / <kbd>A</kbd>
                <kbd>D</kbd> steer · <kbd>↑</kbd>
                <kbd>↓</kbd> sprint/brake, climb/dive when flying · <kbd>Space</kbd> jump ·{' '}
                <kbd>F</kbd> punch
                <br />
                Fanta = boost · oranges = points · pick your ride by driving under its lane
              </>
            )}
          </div>
          <div className="rush-keys">
            racing {RIVALS.map(r => r.name).join(', ')}
            {h?.best != null && <> · best {fmt(h.best)}</>}
          </div>
          <button type="button" className="rush-go" onClick={() => game?.go()}>
            RACE ▸
          </button>
        </div>
      )}

      {done && h !== null && meRow?.finished === true && (
        <div
          className="rush-card"
          style={{ top: 'auto', bottom: 16, transform: 'translateX(-50%)' }}
          onPointerDown={e => e.stopPropagation()}
        >
          <h1 style={{ fontSize: 48 }}>
            {meRow.place}
            {ordinal(meRow.place)} PLACE
          </h1>
          <h2>
            {fmt(meRow.time)} · 🍊 {meRow.oranges}
            {h.newBest ? ' · NEW BEST!' : h.best != null ? ` · best ${fmt(h.best)}` : ''}
          </h2>
          <div className="rush-rows">
            {h.rows.map(r => (
              <div key={r.name} className={r.human ? 'rush-row me' : 'rush-row'}>
                <span>{r.place}</span>
                <span className="dot" style={{ background: r.color }} />
                <span className="grow">{r.name}</span>
                <span className="dim">{r.finished ? fmt(r.time) : 'dancing soon'}</span>
              </div>
            ))}
          </div>
          <button type="button" className="rush-go" onClick={() => game?.go()}>
            RACE AGAIN ▸
          </button>
        </div>
      )}

      {touch && racing && (
        <div className="rush-touch">
          <div className="grp">
            <button type="button" className={pressed.left ? 'on' : undefined} {...hold('left')}>
              ◀
            </button>
            <button type="button" className={pressed.right ? 'on' : undefined} {...hold('right')}>
              ▶
            </button>
          </div>
          <div className="grp">
            <div className="col">
              <button type="button" className={pressed.up ? 'on' : undefined} {...hold('up')}>
                ▲
              </button>
              <button type="button" className={pressed.down ? 'on' : undefined} {...hold('down')}>
                ▼
              </button>
            </div>
            <div className="col">
              <button type="button" className={pressed.punch ? 'on' : undefined} {...hold('punch')}>
                POW
              </button>
              <button type="button" className={pressed.jump ? 'on' : undefined} {...hold('jump')}>
                JUMP
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
