// ── Spray-can HUD: colour, nozzle, cap, opacity, undo, eyedropper ───────
//
// Desktop: a panel bottom-right while on foot (it steps left of the NOUN FM
// deck screen when that's up). Phones: a colour button in the touch column
// opens a compact strip under the site tray: swatches, nozzles, undo, pick.
// It stays open while you spray and is sized to end above the steering
// stick's area and the deck screen (which sits on the left on phones).

import type { Game } from '../Game';
import type { Graffiti, SprayTools } from './Graffiti';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { useFm } from '../radio/FmPanel';

import { NOZZLES, SPRAY_PALETTE } from './Graffiti';
import { intToHex } from './strokes';

const NOOP_TOOLS = () => () => undefined;

function useTools(g: Graffiti | null): SprayTools | null {
  return useSyncExternalStore(g?.subscribeTools ?? NOOP_TOOLS, () => g?.getTools() ?? null);
}

function useHudSpray(game: Game) {
  return useSyncExternalStore(
    cb => game.subscribe(cb),
    () => game.hud,
  );
}

/** Buttons that never take focus (Space would "click" them mid-jump). */
const noFocus = { tabIndex: -1, onMouseDown: (e: React.MouseEvent) => e.preventDefault() };

function Swatch({
  hex,
  on,
  label,
  onPick,
  size,
}: {
  hex: string;
  on: boolean;
  label?: string;
  onPick: () => void;
  size: number;
}) {
  return (
    <button
      type="button"
      {...noFocus}
      className={`sp-sw ${on ? 'sp-on' : ''}`}
      style={{ background: hex, width: size, height: size }}
      title={hex.toUpperCase()}
      onClick={onPick}
    >
      {label !== undefined && <span>{label}</span>}
    </button>
  );
}

function CustomColour({ g, t, big }: { g: Graffiti; t: SprayTools; big: number }) {
  return (
    <label
      className="sp-now"
      style={{ width: big, height: big, background: t.hex }}
      title="custom colour"
    >
      <input
        type="color"
        value={t.hex}
        onChange={e => g.setColor(e.target.value)}
        onBlur={e => e.currentTarget.blur()}
        onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <span className="sp-plus">+</span>
    </label>
  );
}

function Nozzles({ g, t, dot, gap }: { g: Graffiti; t: SprayTools; dot: number; gap?: number }) {
  // Trackpads send a stream of small deltas: one step per notch's worth
  const acc = useRef(0);
  return (
    <div
      className="sp-row"
      style={gap !== undefined ? { gap } : undefined}
      onWheel={e => {
        acc.current += e.deltaY;
        if (Math.abs(acc.current) < 60) return;
        g.stepSize(acc.current < 0 ? 1 : -1);
        acc.current = 0;
      }}
      title="nozzle: [ / ] or wheel while spraying"
    >
      {NOZZLES.map((n, i) => (
        <button
          key={n.label}
          type="button"
          {...noFocus}
          className={`sp-nz ${t.size === i ? 'sp-on' : ''}`}
          style={{ width: dot, height: dot }}
          onClick={() => g.setSize(i)}
          title={`${n.label} · ${(n.r * 2) / 10} cm`}
        >
          <i
            style={{
              width: 3 + i * ((dot - 12) / (NOZZLES.length - 1)),
              height: 3 + i * ((dot - 12) / (NOZZLES.length - 1)),
              background: t.hex,
              filter: t.hard ? 'none' : 'blur(0.6px)',
            }}
          />
        </button>
      ))}
    </div>
  );
}

function CapAndOpacity({ g, t }: { g: Graffiti; t: SprayTools }) {
  return (
    <div className="sp-row">
      <button type="button" {...noFocus} className="sp-chip" onClick={() => g.setHard(!t.hard)}>
        {t.hard ? 'HARD CAP' : 'SOFT CAP'}
      </button>
      <input
        className="sp-range"
        type="range"
        min={1}
        max={16}
        value={t.opacity}
        tabIndex={-1}
        onChange={e => g.setOpacity(Number(e.target.value))}
        onPointerUp={e => e.currentTarget.blur()}
        aria-label="opacity"
      />
      <span className="sp-pct">{Math.round((t.opacity / 16) * 100)}%</span>
    </div>
  );
}

function Recent({ g, t, size }: { g: Graffiti; t: SprayTools; size: number }) {
  if (t.recent.length === 0) return null;
  return (
    <div className="sp-row sp-recent">
      <small>RECENT</small>
      {t.recent.map(c => (
        <Swatch
          key={c}
          hex={intToHex(c)}
          on={c === t.color}
          size={size}
          onPick={() => g.setColor(c)}
        />
      ))}
    </div>
  );
}

function Note({ t }: { t: SprayTools }) {
  const [, tick] = useState(0);
  const fresh = t.note !== null && performance.now() - t.note.at < 2200;
  useEffect(() => {
    if (!fresh) return;
    const id = window.setTimeout(() => tick(x => x + 1), 2300);
    return () => window.clearTimeout(id);
  }, [fresh, t.note]);
  return fresh ? <div className="sp-note">{t.note!.text}</div> : null;
}

/** Desktop spray panel (bottom-right, on foot). */
export function SprayPanel({ game }: { game: Game }) {
  const hud = useHudSpray(game);
  const g = game.graffiti;
  const t = useTools(g);
  // The NOUN FM deck screen owns bottom-right on desktop: sit left of it
  const fmScreen = useFm(game.fm).screen;
  if (g === null || t === null) return null;
  if (hud.mode !== 'foot' && !hud.spray.active) return null;
  return (
    <div
      className="sp-panel pointer-events-auto absolute bottom-24"
      style={{ right: fmScreen ? 264 : 16 }}
      data-spray="panel"
    >
      <style>{CSS}</style>
      <div className="sp-head">
        <CustomColour g={g} t={t} big={46} />
        <div className="sp-meta">
          <b>{t.hex.toUpperCase()}</b>
          <small>
            {NOZZLES[t.size].label} {(NOZZLES[t.size].r * 2) / 10} cm · {t.hard ? 'hard' : 'soft'} ·{' '}
            {Math.round((t.opacity / 16) * 100)}%
          </small>
        </div>
      </div>
      <div className="sp-grid">
        {SPRAY_PALETTE.map((hex, i) => (
          <Swatch
            key={hex}
            hex={hex}
            size={18}
            on={intToHex(t.color) === hex}
            label={i < 10 ? String((i + 1) % 10) : undefined}
            onPick={() => g.pickSwatch(i)}
          />
        ))}
      </div>
      <Recent g={g} t={t} size={16} />
      <Nozzles g={g} t={t} dot={30} />
      <CapAndOpacity g={g} t={t} />
      <div className="sp-row">
        <button
          type="button"
          {...noFocus}
          className="sp-chip"
          disabled={!t.canUndo}
          onClick={() => g.undo()}
          title="Ctrl/Cmd+Z"
        >
          ↶ UNDO
        </button>
        <button
          type="button"
          {...noFocus}
          className={`sp-chip ${t.picking ? 'sp-chip-on' : ''}`}
          onClick={() => g.setPicking(!t.picking)}
          title="Alt+click a wall"
        >
          ⌖ PICK
        </button>
      </div>
      <Note t={t} />
      <div className="sp-hint">
        {t.picking
          ? 'click painted wall to pick its colour'
          : hud.spray.aiming
            ? 'drag to spray · 1–0 swatch · T/⇧T cycle · [ ] or wheel nozzle · ⇧click line · ⌘/Ctrl+Z undo · Alt+click pick'
            : 'point at a wall to tag it, right-drag to look'}
      </div>
    </div>
  );
}

/** Phone: colour button for the touch column + the strip it opens. */
export function SprayTouch({ game }: { game: Game }) {
  const hud = useHudSpray(game);
  const g = game.graffiti;
  const t = useTools(g);
  const fmScreen = useFm(game.fm).screen;
  const [open, setOpen] = useState(false);
  const [room, setRoom] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const foot = hud.mode === 'foot';

  // Room below the strip's top before the stick's area (bottom 55% of the
  // screen) or the deck screen, whichever comes first: the opacity row only
  // shows when it fits
  useEffect(() => {
    if (!open || !foot) return;
    const measure = () => {
      const el = ref.current;
      if (el === null) return;
      const top = el.getBoundingClientRect().top;
      let limit = window.innerHeight * 0.45;
      const fm = document.querySelector('[data-fm="screen"]')?.getBoundingClientRect();
      if (fm !== undefined && fm.height > 0) limit = Math.min(limit, fm.top);
      setRoom(Math.floor(limit - top - 6));
    };
    measure();
    const id = window.setInterval(measure, 800);
    window.addEventListener('resize', measure);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('resize', measure);
    };
  }, [open, foot, fmScreen]);

  if (g === null || t === null || !foot) return null;
  const tap = (fn: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      fn();
    },
  });
  const recent = t.recent.filter(c => !SPRAY_PALETTE.some(h => h === intToHex(c)));
  const roomy = room >= 124;
  return (
    <>
      <style>{CSS}</style>
      <button
        type="button"
        className={`w2-tbtn sp-tcan ${open ? 'sp-tcan-on' : ''}`}
        aria-label="spray colour and nozzle"
        data-spray="can"
        {...tap(() => setOpen(o => !o))}
      >
        <i style={{ background: t.hex, width: 10 + t.size * 4, height: 10 + t.size * 4 }} />
      </button>
      {open && (
        <div
          ref={ref}
          className="sp-panel sp-sheet pointer-events-auto"
          data-spray="sheet"
          onPointerDown={e => e.stopPropagation()}
        >
          <div className="sp-row">
            <CustomColour g={g} t={t} big={32} />
            <div className="sp-strip">
              {recent.map(c => (
                <Swatch
                  key={`r${c}`}
                  hex={intToHex(c)}
                  size={30}
                  on={c === t.color}
                  onPick={() => g.setColor(c)}
                />
              ))}
              {recent.length > 0 && <span className="sp-sep" />}
              {SPRAY_PALETTE.map((hex, i) => (
                <Swatch
                  key={hex}
                  hex={hex}
                  size={30}
                  on={intToHex(t.color) === hex}
                  onPick={() => g.pickSwatch(i)}
                />
              ))}
            </div>
            <button
              type="button"
              className="sp-chip sp-ico"
              aria-label="close spray tools"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>
          <div className="sp-row">
            <Nozzles g={g} t={t} dot={34} gap={4} />
            <button
              type="button"
              className="sp-chip sp-ico"
              aria-label="undo"
              disabled={!t.canUndo}
              onClick={() => g.undo()}
            >
              ↶
            </button>
            <button
              type="button"
              className={`sp-chip sp-ico ${t.picking ? 'sp-chip-on' : ''}`}
              aria-label="pick a colour off the wall"
              onClick={() => g.setPicking(!t.picking)}
            >
              ⌖
            </button>
            <button
              type="button"
              className={`sp-chip sp-ico ${t.hard ? 'sp-chip-on' : ''}`}
              aria-label={t.hard ? 'hard cap' : 'soft cap'}
              onClick={() => g.setHard(!t.hard)}
            >
              {t.hard ? '●' : '◌'}
            </button>
          </div>
          {roomy && (
            <div className="sp-row">
              <small className="sp-meta-line">
                {t.hex.toUpperCase()} · {NOZZLES[t.size].label} {(NOZZLES[t.size].r * 2) / 10} cm
              </small>
              <input
                className="sp-range"
                type="range"
                min={1}
                max={16}
                value={t.opacity}
                onChange={e => g.setOpacity(Number(e.target.value))}
                aria-label="opacity"
              />
              <span className="sp-pct">{Math.round((t.opacity / 16) * 100)}%</span>
            </div>
          )}
          {t.picking ? (
            <div className="sp-note">aim at paint, hold 🎨 to pick</div>
          ) : (
            <Note t={t} />
          )}
        </div>
      )}
    </>
  );
}

const CSS = `
.sp-panel{width:262px;padding:10px;border-radius:16px;background:rgba(10,12,20,.62);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.14);font-family:system-ui,sans-serif;color:#fff;display:flex;flex-direction:column;gap:8px;font-size:11px}
.sp-head{display:flex;align-items:center;gap:10px}
.sp-meta{display:flex;flex-direction:column;min-width:0;flex:1}
.sp-meta b{font-size:16px;letter-spacing:.04em;font-variant-numeric:tabular-nums}
.sp-meta small{opacity:.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sp-now{position:relative;flex:none;border-radius:12px;border:2px solid rgba(255,255,255,.85);box-shadow:0 0 0 2px rgba(0,0,0,.45),inset 0 -6px 10px rgba(0,0,0,.18);cursor:pointer;overflow:hidden}
.sp-now input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;border:0;padding:0}
.sp-plus{position:absolute;right:2px;bottom:0;font-size:12px;font-weight:900;color:#fff;text-shadow:0 0 3px #000;pointer-events:none}
.sp-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:3px}
.sp-grid-touch{grid-template-columns:repeat(8,1fr);gap:6px;justify-items:center}
.sp-sw{position:relative;border-radius:5px;border:1px solid rgba(255,255,255,.28);padding:0;cursor:pointer;flex:none}
.sp-sw span{position:absolute;left:1px;top:-1px;font-size:8px;font-weight:800;color:#fff;text-shadow:0 0 2px #000,0 0 2px #000;pointer-events:none}
.sp-sw.sp-on{outline:2px solid #ffd400;outline-offset:1px;border-color:#000}
.sp-row{display:flex;align-items:center;gap:6px}
.sp-recent small{opacity:.6;font-size:9px;letter-spacing:.08em;margin-right:2px}
.sp-nz{display:flex;align-items:center;justify-content:center;border-radius:999px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.06);padding:0;cursor:pointer;flex:none}
.sp-nz i{display:block;border-radius:999px;box-shadow:0 0 0 1px rgba(0,0,0,.4)}
.sp-nz.sp-on{border-color:#ffd400;background:rgba(255,212,0,.18)}
.sp-chip{border-radius:999px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff;font-weight:800;font-size:10px;letter-spacing:.06em;padding:4px 9px;cursor:pointer;white-space:nowrap}
.sp-chip:disabled{opacity:.35;cursor:default}
.sp-chip-on{background:#ffd400;color:#111;border-color:#ffd400}
.sp-range{flex:1;min-width:0;accent-color:#ffd400}
.sp-pct{width:30px;text-align:right;font-variant-numeric:tabular-nums;opacity:.8}
.sp-note{color:#ffd400;font-weight:700}
.sp-hint{opacity:.72;line-height:1.35}
.sp-tcan{display:flex;align-items:center;justify-content:center}
.sp-tcan i{display:block;border-radius:999px;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.5)}
.sp-tcan-on{border-color:#ffd400}
.sp-sheet{position:fixed;left:50%;transform:translateX(-50%);top:calc(50px + env(safe-area-inset-top));width:min(380px,calc(100vw - 20px));padding:6px;gap:6px;border-radius:14px;font-size:12px;z-index:30}
.sp-sheet .sp-now{border-radius:9px}
.sp-strip{flex:1;min-width:0;display:flex;gap:4px;overflow-x:auto;overscroll-behavior:contain;touch-action:pan-x;scrollbar-width:none;padding:2px 3px}
.sp-strip::-webkit-scrollbar{display:none}
.sp-sep{flex:none;width:1px;align-self:stretch;background:rgba(255,255,255,.35);margin:0 2px}
.sp-ico{width:34px;height:34px;padding:0;font-size:16px;flex:none;display:flex;align-items:center;justify-content:center}
.sp-sheet .sp-range{height:24px}
.sp-sheet .sp-note{position:absolute;left:8px;top:100%;margin-top:4px;padding:2px 8px;border-radius:8px;background:rgba(10,12,20,.7);font-size:11px}
.sp-meta-line{opacity:.75;white-space:nowrap;font-variant-numeric:tabular-nums}
`;
