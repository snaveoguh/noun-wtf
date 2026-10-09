// Native touch layer for Noun World.
//
// Sits above the game and drives it entirely through `game.input.touch`
// (the object the game's Input.poll() reads every frame) and
// `game.input.queueTrick()`. The game's own TouchControls overlay never
// receives pointer events while this layer is mounted (its buttons are
// hidden by CSS in index.css).
//
//   left thumb   tilt on:  tap = push, hold = brake
//                tilt off: virtual stick (move / steer)
//   right thumb  flick stick: pull down then flick up to ollie, diagonals
//                flip, sideways shuvit (the recogniser lives in the game)
//   buttons      PUSH (hold) · OLLIE (tap) · GRAB (hold) · 🛹 / 🎨 (plaza)
//   ⚙            tilt on/off, sensitivity, invert, calibrate, menu

import type { Game } from '@/miniapps/world2/Game';

import { useEffect, useRef, useState } from 'react';

import { type ControlSettings, saveSettings } from './settings';
import { tilt } from './tilt';

const R = 56;
const HOLD_MS = 200;
const PUSH_PULSE_MS = 280;

interface Knob {
  x: number;
  y: number;
  ox: number;
  oy: number;
}

export function TouchLayer({
  game,
  settings,
  onSettings,
  onMenu,
  plazaButtons,
}: {
  game: Game | null;
  settings: ControlSettings;
  onSettings: (s: ControlSettings) => void;
  onMenu: () => void;
  plazaButtons: boolean;
}) {
  const [knobL, setKnobL] = useState<Knob | null>(null);
  const [knobR, setKnobR] = useState<Knob | null>(null);
  const [sheet, setSheet] = useState(false);
  const [braking, setBraking] = useState(false);
  const leftStickActive = useRef(false);

  // Keep the shared tilt instance in sync with the settings + run it.
  useEffect(() => {
    tilt.range = settings.range;
    tilt.invert = settings.invert;
    tilt.offset = settings.offset;
    if (settings.tilt) tilt.start();
    else tilt.stop();
    return () => tilt.stop();
  }, [settings]);

  // Feed tilt into the game every frame.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!game || !settings.tilt || game.showroom || leftStickActive.current) return;
      const t = game.input.touch;
      t.moveX = tilt.value;
      game.input.mode = 'touch';
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      if (game) game.input.touch.moveX = 0;
    };
  }, [game, settings.tilt]);

  if (!game) return null;
  const t = game.input.touch;
  const touchMode = () => {
    game.input.mode = 'touch';
    game.unlockAudio();
  };

  // ── Left zone ──
  const left = (() => {
    let id: number | null = null;
    let ox = 0;
    let oy = 0;
    let t0 = 0;
    let moved = 0;
    let holdTimer = 0;
    let brakeOn = false;
    let pushTimer = 0;
    const stop = () => {
      if (holdTimer) window.clearTimeout(holdTimer);
      holdTimer = 0;
      if (brakeOn) {
        t.brake = false;
        brakeOn = false;
        setBraking(false);
      }
      if (leftStickActive.current) {
        t.moveX = t.moveY = 0;
        leftStickActive.current = false;
      }
      setKnobL(null);
      id = null;
    };
    return {
      onPointerDown: (e: React.PointerEvent) => {
        id = e.pointerId;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        ox = e.clientX;
        oy = e.clientY;
        t0 = performance.now();
        moved = 0;
        touchMode();
        if (settings.tilt) {
          holdTimer = window.setTimeout(() => {
            brakeOn = true;
            t.brake = true;
            setBraking(true);
          }, HOLD_MS);
        } else {
          leftStickActive.current = true;
          setKnobL({ x: 0, y: 0, ox, oy });
        }
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (e.pointerId !== id) return;
        let dx = (e.clientX - ox) / R;
        let dy = -(e.clientY - oy) / R;
        moved = Math.max(moved, Math.hypot(e.clientX - ox, e.clientY - oy));
        if (settings.tilt) return;
        const m = Math.hypot(dx, dy);
        if (m > 1) {
          dx /= m;
          dy /= m;
        }
        t.moveX = dx;
        t.moveY = dy;
        setKnobL({ x: dx, y: dy, ox, oy });
      },
      onPointerUp: (e: React.PointerEvent) => {
        if (e.pointerId !== id) return;
        const tap = settings.tilt && !brakeOn && performance.now() - t0 < HOLD_MS && moved < 24;
        stop();
        if (tap) {
          // Push pulse: the game reads `push` as a held key, so hold it for a beat.
          t.push = true;
          if (pushTimer) window.clearTimeout(pushTimer);
          pushTimer = window.setTimeout(() => {
            t.push = false;
          }, PUSH_PULSE_MS);
        }
      },
      onPointerCancel: (e: React.PointerEvent) => {
        if (e.pointerId === id) stop();
      },
    };
  })();

  // ── Right zone: flick stick ──
  const right = (() => {
    let id: number | null = null;
    let ox = 0;
    let oy = 0;
    const stop = () => {
      t.stickX = t.stickY = 0;
      setKnobR(null);
      id = null;
    };
    return {
      onPointerDown: (e: React.PointerEvent) => {
        id = e.pointerId;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        ox = e.clientX;
        oy = e.clientY;
        touchMode();
        setKnobR({ x: 0, y: 0, ox, oy });
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (e.pointerId !== id) return;
        let dx = (e.clientX - ox) / R;
        let dy = -(e.clientY - oy) / R;
        const m = Math.hypot(dx, dy);
        if (m > 1) {
          dx /= m;
          dy /= m;
        }
        t.stickX = dx;
        t.stickY = dy;
        setKnobR({ x: dx, y: dy, ox, oy });
      },
      onPointerUp: (e: React.PointerEvent) => {
        if (e.pointerId === id) stop();
      },
      onPointerCancel: (e: React.PointerEvent) => {
        if (e.pointerId === id) stop();
      },
    };
  })();

  const hold = (key: 'push' | 'brake' | 'grab' | 'spray') => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      touchMode();
      t[key] = true;
    },
    onPointerUp: () => {
      t[key] = false;
    },
    onPointerLeave: () => {
      t[key] = false;
    },
    onPointerCancel: () => {
      t[key] = false;
    },
  });

  const update = (patch: Partial<ControlSettings>) => {
    const next = { ...settings, ...patch };
    saveSettings(next);
    onSettings(next);
  };

  return (
    <div className="nw-layer">
      {/* Thumb zones: the top ~22% stays free for the game's own HUD buttons */}
      <div className="nw-zone nw-zone-l" {...left} />
      <div className="nw-zone nw-zone-r" {...right} />
      {knobL && <KnobView k={knobL} />}
      {knobR && <KnobView k={knobR} accent />}

      {settings.tilt && braking && <div className="nw-brake">BRAKE</div>}

      <div className="nw-btns">
        {plazaButtons && (
          <>
            <button type="button" className="nw-tbtn" {...hold('spray')}>
              🎨
            </button>
            <button
              type="button"
              className="nw-tbtn"
              onPointerDown={e => {
                e.stopPropagation();
                touchMode();
                t.boardToggle = true;
              }}
            >
              🛹
            </button>
          </>
        )}
        <button type="button" className="nw-tbtn" {...hold('grab')}>
          GRAB
        </button>
        <button
          type="button"
          className="nw-tbtn"
          onPointerDown={e => {
            e.stopPropagation();
            touchMode();
            t.jump = true;
            game.input.queueTrick('ollie');
          }}
        >
          OLLIE
        </button>
        <button type="button" className="nw-tbtn nw-tbtn-main" {...hold('push')}>
          PUSH
        </button>
      </div>

      <button
        type="button"
        className="nw-gear"
        onPointerDown={e => {
          e.stopPropagation();
          setSheet(s => !s);
        }}
      >
        ⚙
      </button>

      {sheet && (
        <div className="nw-sheet" onPointerDown={e => e.stopPropagation()}>
          <div className="nw-sheet-title">controls</div>
          <label className="nw-row">
            <span>tilt to steer</span>
            <input
              type="checkbox"
              checked={settings.tilt}
              onChange={async e => {
                const on = e.target.checked;
                if (on && (await tilt.requestPermission()) !== 'granted') {
                  update({ tilt: false });
                  return;
                }
                update({ tilt: on });
              }}
            />
          </label>
          <label className="nw-row">
            <span>sensitivity</span>
            <input
              type="range"
              min={10}
              max={40}
              step={1}
              value={50 - settings.range}
              onChange={e => update({ range: 50 - Number(e.target.value) })}
            />
          </label>
          <label className="nw-row">
            <span>invert</span>
            <input
              type="checkbox"
              checked={settings.invert}
              onChange={e => update({ invert: e.target.checked })}
            />
          </label>
          <div className="nw-row">
            <span>
              tilt now {tilt.hasData ? `${(tilt.rawDeg - settings.offset).toFixed(0)}°` : '—'}
            </span>
            <button
              type="button"
              className="nw-tbtn nw-tbtn-sm"
              onClick={() => update({ offset: tilt.calibrate() })}
            >
              hold level + calibrate
            </button>
          </div>
          <div className="nw-row">
            <button type="button" className="nw-tbtn nw-tbtn-sm" onClick={() => setSheet(false)}>
              close
            </button>
            <button type="button" className="nw-tbtn nw-tbtn-sm nw-tbtn-main" onClick={onMenu}>
              menu
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function KnobView({ k, accent }: { k: Knob; accent?: boolean }) {
  return (
    <div
      className="pointer-events-none fixed"
      style={{ left: k.ox - R, top: k.oy - R, width: R * 2, height: R * 2 }}
    >
      <div className="absolute inset-0 rounded-full border-2 border-white/30 bg-black/20" />
      <div
        className="absolute h-12 w-12 rounded-full"
        style={{
          left: R - 24 + k.x * R,
          top: R - 24 - k.y * R,
          background: accent === true ? 'rgba(255,212,0,.8)' : 'rgba(255,255,255,.7)',
        }}
      />
    </div>
  );
}
