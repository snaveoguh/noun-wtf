// ── Dev harness: the battle view on the mock battle, inside a running Game ──
//
//   const d = await window.__w2.breakDev()            // mounts in front of the skater
//   d.live()                                           // play it in real time (arrows + J/K)
//   d.seek(30); d.render()                             // or scrub + draw a frame (tests)
//   d.hold('windmill'); d.play(0.4); d.render()        // pin a move for a screenshot
//   d.dispose()
//
// Not shipped anywhere (Game.breakDev imports it on demand in dev builds).

import type { Game } from '../../Game';
import type { BreakKey, CrewSize, MoveId, SimEvent } from '../contract';

import { createElement } from 'react';

import { createRoot, type Root } from 'react-dom/client';
import * as THREE from 'three';

import { BreakHud } from './BreakHud';
import { createMockBattle } from './mock';

import { createBattleView } from './index';

export interface BreakDevOptions {
  crewSize?: CrewSize;
  /** Play as the human dancer 'me' (prompts are yours to hit). */
  human?: boolean;
  touch?: boolean;
  /** Mount spot; defaults to 7 m in front of the skater. */
  at?: { x: number; y: number; z: number; yaw: number };
  rounds?: number;
  bpm?: number;
}

const KEYS: Record<string, BreakKey> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
  KeyJ: 'a',
  KeyZ: 'a',
  KeyK: 'b',
  KeyX: 'b',
};

/**
 * A flat, clear patch of floor near the skater for the cypher (~14 m
 * across with the crowd), the judges' side toward the skater.
 */
export function clearSpot(g: Game): { x: number; y: number; z: number; yaw: number } {
  const p = g.player.pos;
  const f = g.player.fwd;
  const down = new THREE.Vector3(0, -1, 0);
  const o = new THREE.Vector3();
  const probe = (x: number, z: number) => g.world.raycast(o.set(x, p.y + 8, z), down, 40);
  const base = Math.atan2(f.x, f.z);
  for (const d of [8, 12, 16, 20, 26, 32, 40])
    for (let k = 0; k < 12; k++) {
      const a = base + (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6);
      const cx = p.x + Math.sin(a) * d;
      const cz = p.z + Math.cos(a) * d;
      const c = probe(cx, cz);
      if (c === null || c.normal.y < 0.97) continue;
      const y = c.point.y;
      let ok = true;
      for (const r of [1.5, 3.2, 5, 7])
        for (let j = 0; j < 14 && ok; j++) {
          const b = (j / 14) * Math.PI * 2;
          const h = probe(cx + Math.sin(b) * r, cz + Math.cos(b) * r);
          if (h === null || Math.abs(h.point.y - y) > 0.12 || h.normal.y < 0.97) ok = false;
        }
      if (ok) return { x: cx, y, z: cz, yaw: Math.atan2(p.x - cx, p.z - cz) + Math.PI };
    }
  return { x: p.x + f.x * 7, y: p.y, z: p.z + f.z * 7, yaw: Math.atan2(f.x, f.z) };
}

export async function breakDemo(g: Game, opts: BreakDevOptions = {}) {
  const human = opts.human === true;
  const mock = createMockBattle({
    crewSize: opts.crewSize ?? 1,
    human: human ? 'me' : null,
    rounds: opts.rounds,
    bpm: opts.bpm,
  });
  const view = createBattleView(g);
  const at = opts.at ?? clearSpot(g);
  view.mount(mock.config, at);
  view.setLocal(human ? 'me' : null);
  const meWasVisible = g.me?.root.visible ?? true;
  if (g.me !== null) g.me.root.visible = false;

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:9000;pointer-events:none';
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  let battleT = 0;
  const press = (k: BreakKey) => mock.input({ id: 'me', key: k, t: battleT });
  root.render(
    createElement(BreakHud, {
      hud: view.hud,
      onKey: human ? press : undefined,
      touch: opts.touch,
      onGesture: () => view.startAudio(),
    }),
  );

  let raf = 0;
  let tookOver = false;
  let lastEvents: SimEvent[] = [];
  const centre = new THREE.Vector3(at.x, at.y, at.z);
  const tick = (dt: number) => {
    lastEvents = mock.step(dt);
    battleT += dt;
    view.update(dt, mock.state(), lastEvents);
  };
  const onKey = (e: KeyboardEvent) => {
    const k = KEYS[e.code];
    if (k === undefined || e.repeat) return;
    e.preventDefault();
    view.startAudio();
    press(k);
  };
  const g2 = g as unknown as { running: boolean; raf: number; frame: (n: number) => void };
  const api = {
    view,
    mock,
    at,
    get t() {
      return battleT;
    },
    get events() {
      return lastEvents;
    },
    /** Advance `secs` of battle time in `fps` steps (no rendering). */
    play(secs: number, fps = 30) {
      const n = Math.max(1, Math.round(secs * fps));
      for (let i = 0; i < n; i++) tick(1 / fps);
    },
    /** Run to battle time `to` (s). */
    seek(to: number, fps = 20) {
      while (battleT < to) tick(Math.min(1 / fps, to - battleT + 1e-6));
    },
    /** Pin the dancer up on one move (null: back to the script). */
    hold(m: MoveId | null) {
      mock.hold(m);
    },
    render() {
      g.gfx.followShadow(centre);
      g.gfx.render(1 / 60);
    },
    /** Take over the frame: real-time battle with keyboard input (arrows/WASD + J/K). */
    live() {
      tookOver = g2.running;
      g2.running = false;
      cancelAnimationFrame(g2.raf);
      window.addEventListener('keydown', onKey);
      let last = performance.now();
      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        tick(dt);
        api.render();
      };
      raf = requestAnimationFrame(loop);
    },
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      root.unmount();
      host.remove();
      view.unmount();
      if (g.me !== null) g.me.root.visible = meWasVisible;
      if (tookOver) {
        g2.running = true;
        g2.raf = requestAnimationFrame(g2.frame);
      }
    },
  };
  return api;
}
