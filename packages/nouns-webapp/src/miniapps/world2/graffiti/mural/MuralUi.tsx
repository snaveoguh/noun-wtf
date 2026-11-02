// ── Mural mode overlay: a drawing app over the wall ─────────────────────
//
// Pointers → GestureClassifier (gestures.ts): the pen paints (pressure →
// width through the pen feel, tilt widens, coalesced samples, stabiliser),
// fingers pan / pinch, two-finger tap undo, three-finger redo. Without a
// pen, fingers paint or move (the ✋ toggle).
//
// Chrome (all ≥ 44 px, inside the safe areas):
//   left edge   SIZE slider + its press pad, the colour button, OPACITY
//               slider + its flow pad. A pad grows (top half) or shrinks
//               (bottom half) while held: press harder (pen pressure or a
//               fatter fingertip), or hold longer, and it changes faster.
//   top         zoom (tap = fit) − +, grid, fingers, pen feel, undo, redo, DONE
//   bottom      brush presets
// Keyboard: Esc / ` leave, ⌘/Ctrl+Z undo, ⇧⌘/Ctrl+Z redo, [ ] size, 0 fit,
// wheel / trackpad pinch zoom, right- or middle-drag pans.

import type { Game } from '../../Game';
import type { SprayTools } from '../Graffiti';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { MAX_RADIUS_MM, MIN_RADIUS_MM } from '../strokes';

import { ColourPicker } from './ColourPicker';
import { gridLines, halfSize, MAX_ZOOM, MIN_ZOOM, type MuralView, screenOf } from './framing';
import { GestureClassifier, type GestureSample, type PointerKind } from './gestures';
import { BRUSHES, muralSettings } from './presets';
import {
  curvePressure,
  holdPressure,
  penRadius,
  PressureFilter,
  samplePressure,
  Stabiliser,
  tiltOf,
  touchPressure,
} from './pressure';

const NOOP = () => () => undefined;
const SIZE_MAX = 240;

/** Slider position 0..1 ↔ radius (log scale, 2 mm … 24 cm). */
export const sizeToT = (r: number) =>
  Math.log(Math.max(MIN_RADIUS_MM, r) / MIN_RADIUS_MM) / Math.log(SIZE_MAX / MIN_RADIUS_MM);
export const tToSize = (t: number) =>
  MIN_RADIUS_MM * Math.pow(SIZE_MAX / MIN_RADIUS_MM, Math.max(0, Math.min(1, t)));

function sizeLabel(r: number) {
  const d = r * 2;
  return d < 10 ? `${d.toFixed(0)} mm` : `${(d / 10).toFixed(d < 100 ? 1 : 0)} cm`;
}

function useTools(game: Game): SprayTools | null {
  const g = game.graffiti;
  return useSyncExternalStore(g?.subscribeTools ?? NOOP, () => g?.getTools() ?? null);
}

/** Vertical slider (top = max). */
function VSlider({
  t,
  onT,
  label,
  readout,
  fill,
}: {
  t: number;
  onT: (t: number) => void;
  label: string;
  readout: string;
  fill?: string;
}) {
  const el = useRef<HTMLDivElement | null>(null);
  const at = (e: React.PointerEvent) => {
    const r = el.current!.getBoundingClientRect();
    onT(Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)));
  };
  return (
    <div className="mu-vs-wrap">
      <div
        ref={el}
        className="mu-vs"
        role="slider"
        aria-label={label}
        aria-valuenow={Math.round(t * 100)}
        data-mural={`slider-${label.toLowerCase()}`}
        onPointerDown={e => {
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          at(e);
        }}
        onPointerMove={e => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) at(e);
        }}
      >
        <div className="mu-vs-fill" style={{ height: `${t * 100}%`, background: fill }} />
        <div className="mu-vs-knob" style={{ bottom: `calc(${t * 100}% - 3px)` }} />
      </div>
      <div className="mu-vs-read">{readout}</div>
    </div>
  );
}

/**
 * A press-sensitive pad: hold the top half to grow, the bottom to shrink.
 * Speed follows how hard you press: pen pressure, the finger's contact size,
 * or (no data) how long you've held it.
 */
function PressPad({
  label,
  onRate,
  testId,
}: {
  label: string;
  /** Called every frame while held: signed amount 0..1 and seconds. */
  onRate: (amt: number, dt: number) => void;
  testId: string;
}) {
  const [glow, setGlow] = useState<{ dir: number; p: number } | null>(null);
  const st = useRef<{
    id: number;
    t0: number;
    p: number | null;
    dir: number;
    raf: number;
    last: number;
  } | null>(null);
  useEffect(
    () => () => {
      if (st.current !== null) cancelAnimationFrame(st.current.raf);
    },
    [],
  );
  const read = (e: React.PointerEvent, el: HTMLElement) => {
    const s = st.current!;
    const r = el.getBoundingClientRect();
    s.dir = e.clientY < r.top + r.height / 2 ? 1 : -1;
    s.p =
      e.pointerType === 'pen'
        ? e.pressure
        : e.pointerType === 'touch'
          ? touchPressure(e.width, e.height)
          : null;
  };
  const loop = (now: number) => {
    const s = st.current;
    if (s === null) return;
    const dt = Math.min(0.1, (now - s.last) / 1000);
    s.last = now;
    // Whichever is stronger: how hard, or how long
    const p = Math.max(s.p ?? 0, holdPressure(now - s.t0));
    onRate(s.dir * (0.15 + 0.85 * p), dt);
    setGlow({ dir: s.dir, p });
    s.raf = requestAnimationFrame(loop);
  };
  return (
    <div
      className={`mu-pad ${glow !== null ? 'mu-pad-on' : ''}`}
      data-mural={testId}
      aria-label={`${label}: hold top to grow, bottom to shrink; press harder for faster`}
      onPointerDown={e => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        const now = performance.now();
        st.current = { id: e.pointerId, t0: now, p: null, dir: 1, raf: 0, last: now };
        read(e, e.currentTarget);
        st.current.raf = requestAnimationFrame(loop);
      }}
      onPointerMove={e => {
        if (st.current?.id === e.pointerId) read(e, e.currentTarget);
      }}
      onPointerUp={() => {
        if (st.current !== null) cancelAnimationFrame(st.current.raf);
        st.current = null;
        setGlow(null);
      }}
      onPointerCancel={() => {
        if (st.current !== null) cancelAnimationFrame(st.current.raf);
        st.current = null;
        setGlow(null);
      }}
    >
      <span
        className="mu-pad-half"
        style={glow?.dir === 1 ? { background: `rgba(255,193,16,${0.3 + glow.p * 0.6})` } : {}}
      >
        +
      </span>
      <span className="mu-pad-label">{label}</span>
      <span
        className="mu-pad-half"
        style={glow?.dir === -1 ? { background: `rgba(255,193,16,${0.3 + glow.p * 0.6})` } : {}}
      >
        −
      </span>
    </div>
  );
}

function Grid({ view, fitH, cu, cv }: { view: MuralView; fitH: number; cu: number; cv: number }) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const { hw, hh } = halfSize(view, w / h, fitH);
  // Half-metre lines once zoomed in, metres otherwise; cell seams (6 × 3 m) bold
  const step = hh < 1.5 ? 0.25 : hh < 3 ? 0.5 : 1;
  const us = gridLines(cu + view.panU - hw, cu + view.panU + hw, step);
  const vs = gridLines(cv + view.panV - hh, cv + view.panV + hh, step);
  return (
    <svg className="mu-grid" width={w} height={h} data-mural="grid">
      {us.map(u => {
        const x = screenOf(view, u - cu, 0, w, h, fitH).x;
        const seam = Math.abs(u / 6 - Math.round(u / 6)) < 1e-6;
        return <line key={`u${u}`} x1={x} x2={x} y1={0} y2={h} className={seam ? 'mu-seam' : ''} />;
      })}
      {vs.map(v => {
        const y = screenOf(view, 0, v - cv, w, h, fitH).y;
        const seam = Math.abs(v / 3 - Math.round(v / 3)) < 1e-6;
        return <line key={`v${v}`} x1={0} x2={w} y1={y} y2={y} className={seam ? 'mu-seam' : ''} />;
      })}
    </svg>
  );
}

function CurvePreview({ curve }: { curve: number }) {
  const d = useMemo(() => {
    let s = '';
    for (let i = 0; i <= 24; i++) {
      const p = i / 24;
      s += `${i === 0 ? 'M' : 'L'}${(p * 100).toFixed(1)},${(100 - curvePressure(p, curve) * 100).toFixed(1)}`;
    }
    return s;
  }, [curve]);
  return (
    <svg viewBox="0 0 100 100" className="mu-curve" aria-hidden>
      <path d="M0,100 L100,0" className="mu-curve-ref" />
      <path d={d} />
    </svg>
  );
}

function FeelPanel({ onClose }: { onClose: () => void }) {
  const s = useSyncExternalStore(muralSettings.subscribe, muralSettings.get);
  const f = s.feel;
  const row = (
    label: string,
    v: number,
    lo: number,
    hi: number,
    set: (x: number) => void,
    show: string,
  ) => (
    <label className="mu-feel-row">
      <span>{label}</span>
      <input
        type="range"
        min={lo}
        max={hi}
        step={(hi - lo) / 100}
        value={v}
        onChange={e => set(Number(e.target.value))}
      />
      <b>{show}</b>
    </label>
  );
  return (
    <div className="mu-pop mu-feel" data-mural="feel" onPointerDown={e => e.stopPropagation()}>
      <div className="mu-pop-head">
        <span>PEN FEEL</span>
        <button type="button" className="mu-x" onClick={onClose} aria-label="close pen settings">
          ✕
        </button>
      </div>
      <div className="mu-row">
        <CurvePreview curve={f.curve} />
        <small className="mu-feel-note">
          pressure → width. Soft: a light touch is already wide. Firm: press hard for width.
        </small>
      </div>
      {row(
        'CURVE',
        f.curve,
        -1,
        1,
        x => muralSettings.setFeel({ curve: x }),
        f.curve < -0.15 ? 'soft' : f.curve > 0.15 ? 'firm' : 'even',
      )}
      {row(
        'LIGHTEST',
        f.minSize,
        0.05,
        1,
        x => muralSettings.setFeel({ minSize: x }),
        `${Math.round(f.minSize * 100)}%`,
      )}
      {row(
        'TILT',
        f.tilt,
        0,
        1,
        x => muralSettings.setFeel({ tilt: x }),
        `${Math.round(f.tilt * 100)}%`,
      )}
      {row(
        'SMOOTH',
        f.smoothing,
        0,
        1,
        x => muralSettings.setFeel({ smoothing: x }),
        `${Math.round(f.smoothing * 100)}%`,
      )}
      <label className="mu-feel-row">
        <span>FINGER</span>
        <button
          type="button"
          className={`mu-btn ${f.fingerPressure ? 'mu-on' : ''}`}
          onClick={() => muralSettings.setFeel({ fingerPressure: !f.fingerPressure })}
        >
          {f.fingerPressure ? 'contact size = pressure' : 'steady width'}
        </button>
      </label>
    </div>
  );
}

export function MuralUi({ game }: { game: Game }) {
  const m = game.mural;
  const ms = useSyncExternalStore(m.subscribe, m.getState);
  const t = useTools(game);
  const settings = useSyncExternalStore(muralSettings.subscribe, muralSettings.get);
  const [pop, setPop] = useState<'colour' | 'feel' | null>(null);
  const [penSeen, setPenSeen] = useState(false);
  const flowAcc = useRef(0);
  const root = useRef<HTMLDivElement | null>(null);

  // Keys: ` toggles anywhere in the game; the rest only while painting
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        el !== null &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      )
        return;
      if (e.code === 'Backquote' && !e.repeat) {
        e.preventDefault();
        game.mural.toggle();
        return;
      }
      if (!game.mural.active) return;
      const g = game.graffiti;
      const mod = e.ctrlKey || e.metaKey;
      // Everything else the game listens for waits until you leave
      e.stopImmediatePropagation();
      if (e.code === 'Escape') game.mural.exit();
      else if (mod && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) g?.redo();
        else g?.undo();
      } else if (mod && e.code === 'KeyY') {
        e.preventDefault();
        g?.redo();
      } else if (e.code === 'BracketRight') g?.setRadius((g.tools.radius ?? 20) * 1.25);
      else if (e.code === 'BracketLeft') g?.setRadius((g.tools.radius ?? 20) / 1.25);
      else if (e.code === 'Digit0' || e.code === 'KeyF') game.mural.fit();
      else if (e.code === 'Equal') game.mural.setZoom(game.mural.state.view.zoom * 1.5);
      else if (e.code === 'Minus') game.mural.setZoom(game.mural.state.view.zoom / 1.5);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [game]);

  useEffect(() => () => game.mural.exit(), [game]);

  // Pointers → gestures → paint / navigate (native listeners: coalesced
  // events, and preventDefault on touch so iPadOS never scrolls or zooms)
  useEffect(() => {
    const el = root.current;
    if (el === null || !ms.active) return;
    const stab = new Stabiliser();
    const pf = new PressureFilter();
    let paintKind: PointerKind = 'mouse';
    let r = 20;
    let tilt = 0;
    let raw = { x: 0, y: 0 };
    const radiusFor = (s: GestureSample, ev: PointerEvent) => {
      const tl = game.graffiti?.tools;
      const base = tl?.radius ?? 20;
      const set = muralSettings.get();
      const brush = BRUSHES.find(b => b.id === set.brush);
      const feel = brush !== undefined ? { ...set.feel, minSize: brush.minSize } : set.feel;
      const p = pf.push(samplePressure(s.type, s.pressure, s.w, s.h, feel), s.t);
      if (s.type === 'pen') tilt = tiltOf(ev);
      if (s.type === 'mouse') return base;
      return penRadius(base, p, tilt, feel);
    };
    let lastEv: PointerEvent | null = null;
    const cls = new GestureClassifier({
      paintStart: s => {
        paintKind = s.type;
        pf.reset(samplePressure(s.type, s.pressure, s.w, s.h, muralSettings.get().feel), s.t);
        r = radiusFor(s, lastEv!);
        stab.reset(s.x, s.y, s.type === 'mouse' ? 0 : muralSettings.get().feel.smoothing);
        raw = { x: s.x, y: s.y };
        game.mural.paintStart(s.x, s.y, r);
      },
      paintMove: s => {
        r = radiusFor(s, lastEv!);
        raw = { x: s.x, y: s.y };
        if (stab.push(s.x, s.y)) game.mural.paintMove(stab.x, stab.y, r);
      },
      paintEnd: () => {
        // The brush catches up with the pen on lift
        if (paintKind !== 'mouse') game.mural.paintMove(raw.x, raw.y, r);
        game.mural.paintEnd();
      },
      paintCancel: () => game.mural.paintCancel(),
      pan: (dx, dy) => game.mural.pan(dx, dy),
      zoom: (f, cx, cy) => game.mural.zoom(f, cx, cy),
      undo: () => game.graffiti?.undo(),
      redo: () => game.graffiti?.redo(),
    });
    cls.fingerMode = muralSettings.get().fingers;
    const unsub = muralSettings.subscribe(() => (cls.fingerMode = muralSettings.get().fingers));
    const sample: GestureSample = {
      id: 0,
      type: 'mouse',
      x: 0,
      y: 0,
      t: 0,
      pressure: 0,
      w: 0,
      h: 0,
      button: 0,
    };
    const fill = (e: PointerEvent) => {
      sample.id = e.pointerId;
      sample.type = (
        e.pointerType === 'pen' || e.pointerType === 'touch' ? e.pointerType : 'mouse'
      ) as PointerKind;
      sample.x = e.clientX;
      sample.y = e.clientY;
      sample.t = e.timeStamp;
      sample.pressure = e.pressure;
      sample.w = e.width;
      sample.h = e.height;
      sample.button = e.button;
      lastEv = e;
      return sample;
    };
    const down = (e: PointerEvent) => {
      // Only the wall itself: the chrome's own handlers run after this one
      if (e.target !== el) return;
      e.preventDefault();
      game.unlockAudio();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // synthetic pointers can't be captured
      }
      if (e.pointerType === 'pen') setPenSeen(true);
      setPop(null);
      // Armed eyedropper: this press picks instead of painting
      if (game.graffiti?.tools.picking === true && (e.pointerType !== 'touch' || !cls.penOnly)) {
        game.mural.pick(e.clientX, e.clientY);
        return;
      }
      cls.down(fill(e));
    };
    const move = (e: PointerEvent) => {
      const evs = e.getCoalescedEvents?.() ?? [];
      if (evs.length > 1 && cls.painting) for (const c of evs) cls.move(fill(c));
      else cls.move(fill(e));
      // Pen hover / mouse: the nozzle cursor follows (painting moves it itself)
      if (!cls.painting && e.buttons === 0 && e.pointerType !== 'touch')
        game.mural.hover(e.clientX, e.clientY);
    };
    const up = (e: PointerEvent) => cls.up(fill(e), false);
    const cancel = (e: PointerEvent) => cls.up(fill(e), true);
    const leave = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' && !cls.painting) game.mural.hover(null, null);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      // Trackpad pinch arrives as ctrl+wheel with small deltas
      const k = e.ctrlKey ? 0.01 : 0.0018;
      game.mural.zoom(Math.exp(-e.deltaY * k), e.clientX, e.clientY);
    };
    const noMenu = (e: Event) => e.preventDefault();
    // Only on the wall itself: on a button it would swallow the tap's click
    const noTouch = (e: Event) => {
      if (e.target === el) e.preventDefault();
    };
    const blur = () => cls.reset();
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('contextmenu', noMenu);
    // iPadOS: no magnifier / selection / scroll from a held touch
    el.addEventListener('touchstart', noTouch, { passive: false });
    window.addEventListener('blur', blur);
    return () => {
      cls.reset();
      unsub();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('contextmenu', noMenu);
      el.removeEventListener('touchstart', noTouch);
      window.removeEventListener('blur', blur);
    };
  }, [game, ms.active]);

  // Notes fade (tools' "picked #…", mural's "face a wall…")
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick(x => x + 1), 600);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (ms.note === null) return;
    const id = setTimeout(() => game.mural.clearNote(), 2200);
    return () => clearTimeout(id);
  }, [ms.note, game]);

  const g = game.graffiti;
  const toolNote =
    t?.note !== null && t?.note !== undefined && performance.now() - t.note.at < 1800
      ? t.note.text
      : null;

  if (!ms.active)
    return (
      <>
        <style>{CSS}</style>
        {ms.canEnter && g !== null && (
          <button
            type="button"
            className="mu-enter"
            data-mural="enter"
            tabIndex={-1}
            onMouseDown={e => e.preventDefault()}
            onPointerDown={e => e.stopPropagation()}
            onClick={() => game.mural.enter()}
            title="Paint a mural on this wall (`)"
          >
            🖌 MURAL
          </button>
        )}
        {ms.note !== null && <div className="mu-toast">{ms.note}</div>}
      </>
    );

  const zoomPct = Math.round(ms.view.zoom * 100);
  const fingers = settings.fingers;
  return (
    <div ref={root} className={`mu-root ${ms.ready ? '' : 'mu-arriving'}`} data-mural="root">
      <style>{CSS}</style>
      {settings.grid && <Grid view={ms.view} fitH={ms.fitH} cu={ms.centreU} cv={ms.centreV} />}

      {/* Top bar */}
      <div className="mu-top" onPointerDown={e => e.stopPropagation()}>
        <div className="mu-group">
          <button
            type="button"
            className="mu-btn mu-zoom"
            data-mural="fit"
            onClick={() => game.mural.fit()}
            title="Fit the wall (0)"
          >
            {zoomPct}% · FIT
          </button>
          <button
            type="button"
            className="mu-btn mu-ico"
            aria-label="zoom out"
            disabled={ms.view.zoom <= MIN_ZOOM + 1e-3}
            onClick={() => game.mural.setZoom(ms.view.zoom / 1.6)}
          >
            −
          </button>
          <button
            type="button"
            className="mu-btn mu-ico"
            aria-label="zoom in"
            disabled={ms.view.zoom >= MAX_ZOOM - 1e-3}
            onClick={() => game.mural.setZoom(ms.view.zoom * 1.6)}
          >
            +
          </button>
          <button
            type="button"
            className={`mu-btn mu-ico ${settings.grid ? 'mu-on' : ''}`}
            aria-label="grid"
            data-mural="grid-toggle"
            onClick={() => muralSettings.set({ grid: !settings.grid })}
          >
            #
          </button>
          <button
            type="button"
            className={`mu-btn ${penSeen ? '' : fingers === 'paint' ? 'mu-on' : ''}`}
            data-mural="fingers"
            onClick={() => muralSettings.set({ fingers: fingers === 'paint' ? 'move' : 'paint' })}
            title={
              penSeen
                ? 'Pencil paints, fingers move the wall'
                : 'What one finger does: paint, or move the wall'
            }
          >
            {penSeen ? '✎ PENCIL' : fingers === 'paint' ? '☝ PAINT' : '✋ MOVE'}
          </button>
          <button
            type="button"
            className={`mu-btn ${pop === 'feel' ? 'mu-on' : ''}`}
            data-mural="feel-toggle"
            onClick={() => setPop(pop === 'feel' ? null : 'feel')}
          >
            PEN
          </button>
        </div>
        <div className="mu-group">
          <button
            type="button"
            className="mu-btn mu-ico"
            aria-label="undo"
            data-mural="undo"
            disabled={t?.canUndo !== true}
            onClick={() => g?.undo()}
          >
            ↶
          </button>
          <button
            type="button"
            className="mu-btn mu-ico"
            aria-label="redo"
            data-mural="redo"
            disabled={t?.canRedo !== true}
            onClick={() => g?.redo()}
          >
            ↷
          </button>
          <button
            type="button"
            className="mu-btn mu-done"
            data-mural="exit"
            onClick={() => game.mural.exit()}
          >
            DONE
          </button>
        </div>
      </div>

      {/* Left sidebar: size, colour, opacity */}
      {t !== null && g !== null && (
        <div className="mu-side" onPointerDown={e => e.stopPropagation()}>
          <VSlider
            label="SIZE"
            t={sizeToT(t.radius)}
            onT={x => g.setRadius(tToSize(x))}
            readout={sizeLabel(t.radius)}
          />
          <PressPad
            label="SIZE"
            testId="pad-size"
            onRate={(a, dt) => {
              const cur = g.tools.radius;
              g.setRadius(
                Math.max(MIN_RADIUS_MM, Math.min(MAX_RADIUS_MM, cur * Math.exp(a * 1.4 * dt))),
              );
            }}
          />
          <button
            type="button"
            className="mu-colour"
            data-mural="colour"
            style={{ background: t.hex }}
            aria-label="colour"
            onClick={() => setPop(pop === 'colour' ? null : 'colour')}
          />
          <VSlider
            label="OPACITY"
            t={(t.opacity - 1) / 15}
            onT={x => g.setOpacity(1 + x * 15)}
            readout={`${Math.round((t.opacity / 16) * 100)}%`}
            fill={t.hex}
          />
          <PressPad
            label="FLOW"
            testId="pad-flow"
            onRate={(a, dt) => {
              flowAcc.current += a * 9 * dt;
              const step = Math.trunc(flowAcc.current);
              if (step !== 0) {
                flowAcc.current -= step;
                g.setOpacity(g.tools.opacity + step);
              }
            }}
          />
          <button
            type="button"
            className={`mu-btn mu-cap ${t.hard ? 'mu-on' : ''}`}
            data-mural="cap"
            onClick={() => g.setHard(!t.hard)}
          >
            {t.hard ? 'HARD' : 'SOFT'}
          </button>
        </div>
      )}

      {pop === 'colour' && t !== null && g !== null && (
        <ColourPicker g={g} t={t} onClose={() => setPop(null)} />
      )}
      {pop === 'feel' && <FeelPanel onClose={() => setPop(null)} />}

      {/* Brushes */}
      {t !== null && g !== null && (
        <div className="mu-brushes" onPointerDown={e => e.stopPropagation()}>
          {BRUSHES.map(b => (
            <button
              key={b.id}
              type="button"
              className={`mu-btn mu-brush ${settings.brush === b.id ? 'mu-on' : ''}`}
              data-mural={`brush-${b.id}`}
              onClick={() => {
                g.setRadius(b.radius);
                g.setHard(b.hard);
                g.setOpacity(b.opacity);
                muralSettings.set({ brush: b.id });
              }}
            >
              <i
                style={{
                  width: Math.max(4, Math.min(26, b.radius / 3)),
                  height: Math.max(4, Math.min(26, b.radius / 3)),
                  background: t.hex,
                  opacity: b.opacity / 16,
                  filter: b.hard ? 'none' : 'blur(2px)',
                }}
              />
              {b.label}
            </button>
          ))}
        </div>
      )}

      {(toolNote !== null || ms.note !== null || t?.picking === true || !ms.ready) && (
        <div className="mu-toast">
          {!ms.ready
            ? 'squaring up to the wall…'
            : t?.picking === true
              ? 'tap the wall to pick its colour'
              : (toolNote ?? ms.note)}
        </div>
      )}
      {ms.ready && !penSeen && (
        <div className="mu-hint">
          {fingers === 'paint'
            ? 'one finger paints · two fingers move & pinch · two-finger tap undo · three redo'
            : 'drag to move · pinch to zoom · two-finger tap undo'}
        </div>
      )}
    </div>
  );
}

const CSS = `
body[data-mural] [data-hud], body[data-mural] [data-w2hud], body[data-mural] .w2-tside,
body[data-mural] .w2-tpad, body[data-mural] .w2-thint, body[data-mural] .w2-tbtn,
body[data-mural] [data-spray], body[data-mural] .nos-tray, body[data-mural] [data-w2labels] { visibility: hidden !important; }
.mu-root { position: absolute; inset: 0; z-index: 60; touch-action: none; user-select: none;
  -webkit-user-select: none; -webkit-touch-callout: none; overscroll-behavior: none;
  font: 600 12px/1.1 ui-monospace, Menlo, monospace; color: #fff; cursor: crosshair; }
.mu-root button { font: inherit; }
.mu-arriving { pointer-events: none; }
.mu-btn { min-height: 44px; min-width: 44px; padding: 0 12px; border-radius: 12px; border: 0;
  background: rgba(20,20,26,.82); color: #fff; letter-spacing: .04em; cursor: pointer;
  box-shadow: 0 1px 0 rgba(255,255,255,.08) inset, 0 2px 10px rgba(0,0,0,.35); }
.mu-btn:disabled { opacity: .35; cursor: default; }
.mu-btn.mu-on { background: #ffc110; color: #111; }
.mu-ico { font-size: 20px; padding: 0; }
.mu-done { background: #f3322c; }
.mu-top { position: absolute; left: 0; right: 0; top: 0; display: flex; justify-content: space-between;
  gap: 8px; padding: calc(env(safe-area-inset-top) + 10px) calc(env(safe-area-inset-right) + 10px) 0
  calc(env(safe-area-inset-left) + 10px); pointer-events: none; }
.mu-group { display: flex; gap: 6px; flex-wrap: wrap; pointer-events: auto; }
.mu-side { position: absolute; top: 50%; transform: translateY(-50%);
  left: calc(env(safe-area-inset-left) + 10px); display: flex; flex-direction: column;
  align-items: center; gap: 8px; padding: 10px 6px; border-radius: 18px;
  background: rgba(20,20,26,.72); box-shadow: 0 4px 18px rgba(0,0,0,.4); }
.mu-vs-wrap { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.mu-vs { position: relative; width: 44px; height: min(22vh, 190px); border-radius: 22px;
  background: rgba(255,255,255,.12); overflow: hidden; touch-action: none; cursor: ns-resize; }
.mu-vs-fill { position: absolute; left: 0; right: 0; bottom: 0; background: rgba(255,255,255,.55); }
.mu-vs-knob { position: absolute; left: 4px; right: 4px; height: 6px; border-radius: 3px; background: #fff;
  box-shadow: 0 0 0 1px rgba(0,0,0,.4); }
.mu-vs-read { font-size: 10px; min-height: 12px; }
.mu-pad { width: 52px; height: 64px; border-radius: 16px; display: flex; flex-direction: column;
  overflow: hidden; background: rgba(255,255,255,.1); touch-action: none; cursor: pointer;
  border: 1px solid rgba(255,255,255,.18); }
.mu-pad-on { border-color: #ffc110; }
.mu-pad-half { flex: 1; display: grid; place-items: center; font-size: 18px; }
.mu-pad-label { font-size: 8px; text-align: center; opacity: .7; letter-spacing: .1em; }
.mu-colour { width: 46px; height: 46px; border-radius: 50%; border: 3px solid #fff;
  box-shadow: 0 0 0 2px rgba(0,0,0,.5); cursor: pointer; }
.mu-cap { min-width: 52px; padding: 0 6px; font-size: 10px; }
.mu-brushes { position: absolute; left: 50%; transform: translateX(-50%);
  bottom: calc(env(safe-area-inset-bottom) + 10px); display: flex; gap: 6px; flex-wrap: wrap;
  justify-content: center; width: max-content; max-width: calc(100vw - 150px); }
.mu-brush { display: flex; align-items: center; gap: 6px; font-size: 11px; }
.mu-brush i { display: inline-block; border-radius: 50%; }
.mu-toast { position: absolute; left: 50%; top: calc(env(safe-area-inset-top) + 112px);
  transform: translateX(-50%); background: rgba(20,20,26,.85); color: #fff; padding: 8px 14px;
  border-radius: 12px; font: 600 12px ui-monospace, Menlo, monospace; pointer-events: none; z-index: 61;
  white-space: nowrap; }
.mu-hint { position: absolute; left: 50%; transform: translateX(-50%);
  top: calc(env(safe-area-inset-top) + 66px); font-size: 11px; opacity: .8;
  background: rgba(0,0,0,.45); padding: 6px 10px; border-radius: 10px; pointer-events: none;
  text-align: center; max-width: calc(100vw - 160px); }
.mu-enter { position: absolute; left: 50%; transform: translateX(-50%); z-index: 40;
  top: calc(env(safe-area-inset-top) + 64px); min-height: 44px; padding: 0 16px; border-radius: 22px;
  border: 0; background: #ffc110; color: #111; font: 700 13px ui-monospace, Menlo, monospace;
  letter-spacing: .05em; box-shadow: 0 3px 14px rgba(0,0,0,.4); cursor: pointer; }
body[data-w2select] .mu-enter, body[data-camp-intro] .mu-enter { display: none; }
/* Narrow portrait screens (phones): the top centre is the respect meter's,
   so the chip goes to the left edge, between the top-left buttons and the
   record / map / spray column. Landscape phones keep the top centre: their
   chip row ends above it, and the left edge is their icon column */
@media (max-width: 600px) {
  .mu-enter { left: calc(var(--w2-safe-left, env(safe-area-inset-left)) + 10px); transform: none;
    top: 38%; }
}
.mu-pop { position: absolute; z-index: 62; left: calc(env(safe-area-inset-left) + 86px); top: 50%;
  transform: translateY(-50%); width: min(300px, calc(100vw - 110px)); max-height: calc(100vh - 120px);
  overflow: auto; background: rgba(20,20,26,.94); border-radius: 18px; padding: 12px;
  box-shadow: 0 8px 30px rgba(0,0,0,.5); display: flex; flex-direction: column; gap: 10px; }
.mu-pop-head { display: flex; align-items: center; gap: 8px; letter-spacing: .08em; }
.mu-pop-head > span:first-child { flex: 1; }
.mu-x { width: 44px; height: 44px; border: 0; border-radius: 12px; background: rgba(255,255,255,.1); color: #fff; }
.mu-now { width: 28px; height: 28px; border-radius: 50%; border: 2px solid #fff; }
.mu-sv { position: relative; height: 180px; border-radius: 12px; touch-action: none; cursor: crosshair; }
.mu-sv-w { position: absolute; inset: 0; border-radius: 12px; background: linear-gradient(to right, #fff, rgba(255,255,255,0)); }
.mu-sv-b { position: absolute; inset: 0; border-radius: 12px; background: linear-gradient(to top, #000, rgba(0,0,0,0)); }
.mu-knob { position: absolute; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%;
  border: 3px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.6); pointer-events: none; }
.mu-hue { position: relative; height: 32px; border-radius: 16px; touch-action: none; cursor: ew-resize;
  background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); }
.mu-knob-h { top: 50%; background: transparent; }
.mu-row { display: flex; gap: 8px; align-items: center; }
.mu-hex { flex: 1; min-width: 0; min-height: 44px; border-radius: 12px; border: 1px solid rgba(255,255,255,.2);
  background: rgba(0,0,0,.4); color: #fff; padding: 0 10px; font: 600 15px ui-monospace, Menlo, monospace;
  text-transform: uppercase; }
.mu-sw-row { display: flex; gap: 6px; flex-wrap: wrap; }
.mu-sw-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
.mu-sw { aspect-ratio: 1; min-width: 36px; min-height: 36px; border-radius: 10px; border: 2px solid rgba(255,255,255,.15); cursor: pointer; }
.mu-sw-row .mu-sw { width: 36px; }
.mu-sw-on { border-color: #fff; box-shadow: 0 0 0 2px #ffc110; }
.mu-feel-row { display: grid; grid-template-columns: 70px 1fr 48px; align-items: center; gap: 8px; min-height: 44px; }
.mu-feel-row input[type=range] { width: 100%; height: 32px; }
.mu-feel-row b { font-weight: 600; font-size: 11px; text-align: right; }
.mu-feel-row .mu-btn { grid-column: span 2; font-size: 11px; }
.mu-curve { width: 72px; height: 72px; flex: none; background: rgba(0,0,0,.35); border-radius: 10px; }
.mu-curve path { fill: none; stroke: #ffc110; stroke-width: 4; }
.mu-curve .mu-curve-ref { stroke: rgba(255,255,255,.2); stroke-width: 2; }
.mu-feel-note { font-size: 10px; opacity: .75; line-height: 1.35; }
.mu-grid { position: absolute; inset: 0; pointer-events: none; }
.mu-grid line { stroke: rgba(255,255,255,.28); stroke-width: 1; }
.mu-grid line.mu-seam { stroke: rgba(255,193,16,.7); stroke-width: 1.5; stroke-dasharray: 6 4; }
@media (max-height: 520px) {
  .mu-pad { display: none; }
  .mu-vs { height: 24vh; }
  .mu-hint { display: none; }
}
@media (max-width: 600px) {
  .mu-brushes { max-width: calc(100vw - 90px); left: auto; right: calc(env(safe-area-inset-right) + 8px); transform: none; }
  .mu-brush { font-size: 0; padding: 0 10px; }
  .mu-brush i { margin: 0; }
}
`;
