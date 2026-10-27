// ── NOUN PARKOUR: the time-trial runner ──────────────────────────────────
//
//   off ─open()─▶ menu ─start(id)─▶ countdown (3, 2, 1, GO) ─▶ running ─▶ results
//                  ▲                                  R restarts │ fall: last checkpoint
//                  └────────────────── quit() / close() ◀────────┘
//
// While a route runs: its gates and props are in the scene, the rider is on
// foot (the board stays off), your best run plays as a ghost, and every
// checkpoint shows the split against your best. Bests + ghosts are local
// (store.ts). The React HUD (ParkourUi.tsx) reads `view` via subscribe().

import type { InputFrame } from '../../core/Input';
import type { Game } from '../../Game';
import type { ParkourSystem } from '../ParkourSystem';

import * as THREE from 'three';

import { ANIM, type PkEventType } from '../contract';
import {
  GhostRecorder,
  RunClock,
  STARS,
  ghostAt,
  medalFor,
  type GhostFrame,
  type Medal,
  type RunResult,
} from '../sim/route';

import { ROUTES, routeById, type Route } from './routes';
import { loadBest, saveBest, type Best } from './store';
import { CourseProps, Gates, Ghost } from './visuals';

export type CoursePhase = 'off' | 'menu' | 'countdown' | 'running' | 'results';

export interface RouteCard {
  id: string;
  name: string;
  blurb: string;
  color: string;
  gold: number;
  silver: number;
  bronze: number;
  best: number | null;
  stars: number;
  checkpoints: number;
}

export interface CourseView {
  phase: CoursePhase;
  routes: RouteCard[];
  route: RouteCard | null;
  time: number;
  /** Next checkpoint index (of route.checkpoints). */
  next: number;
  hint: string;
  /** Countdown seconds left (3 → 0). */
  count: number;
  /** Last split vs your best (− = ahead), shown for a couple of seconds. */
  split: { i: number; delta: number | null; at: number } | null;
  result: (RunResult & { stars: number }) | null;
  /** Move callouts ("WALL RUN", "TIC-TAC"…), newest last. */
  toasts: { id: number; text: string; at: number }[];
  /** Distance (m) and bearing (rad, relative to the camera) to the next gate. */
  dist: number;
  bearing: number;
  ghost: boolean;
}

const TOAST: Partial<Record<PkEventType, string>> = {
  wallrun: 'WALL RUN',
  walljump: 'WALL JUMP',
  wallup: 'UP THE WALL',
  tictac: 'TIC-TAC',
  grab: 'GRAB',
  leap: 'LEAP',
  pullup: 'PULL UP',
  pole: 'POLE',
  poleLaunch: 'LAUNCH',
  slide: 'SLIDE',
  roll: 'ROLL',
  stumble: 'OOF',
  stick: 'STUCK IT',
  gap: 'GAP JUMP',
  vault: 'VAULT',
};

const COUNTDOWN = 3;

function card(r: Route): RouteCard {
  const best = loadBest(r.id);
  const medal: Medal = best !== null ? medalFor(best.time, r.medals) : null;
  return {
    id: r.id,
    name: r.name,
    blurb: r.blurb,
    color: r.color,
    gold: r.medals.gold,
    silver: r.medals.silver,
    bronze: r.medals.bronze,
    best: best?.time ?? null,
    stars: STARS[medal ?? 'none'],
    checkpoints: r.checkpoints.length,
  };
}

export class ParkourCourse {
  view: CourseView = {
    phase: 'off',
    routes: [],
    route: null,
    time: 0,
    next: 0,
    hint: '',
    count: 0,
    split: null,
    result: null,
    toasts: [],
    dist: 0,
    bearing: 0,
    ghost: false,
  };
  private listeners = new Set<() => void>();
  private route: Route | null = null;
  private clock: RunClock | null = null;
  private best: Best | null = null;
  private rec: GhostRecorder | null = null;
  private gates: Gates | null = null;
  private props: CourseProps | null = null;
  private ghost: Ghost | null = null;
  private ghostFrame: GhostFrame = { x: 0, y: 0, z: 0, yaw: 0, anim: 0, phase: 0 };
  private count = 0;
  private respawns = 0;
  private emitAcc = 0;
  private toastId = 0;
  private lastBeep = -1;

  constructor(
    private game: Game,
    private sys: ParkourSystem,
  ) {}

  get active() {
    return this.view.phase !== 'off';
  }

  /** A route is on (countdown / running / results): the HUD hides skate bits. */
  get racing() {
    const p = this.view.phase;
    return p === 'countdown' || p === 'running' || p === 'results';
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit() {
    this.view = { ...this.view };
    for (const fn of this.listeners) fn();
  }

  /** The route menu (the homepage card's `?play=parkour`, the start sign). */
  open() {
    this.teardown();
    this.view.phase = 'menu';
    this.view.routes = ROUTES.map(card);
    this.view.route = null;
    this.view.result = null;
    this.emit();
  }

  close() {
    this.teardown();
    this.view.phase = 'off';
    this.emit();
  }

  start(id: string) {
    const r = routeById(id);
    if (r === undefined) return;
    this.teardown();
    const g = this.game;
    this.route = r;
    this.best = loadBest(r.id);
    this.clock = new RunClock(r, this.best?.splits ?? []);
    this.gates = new Gates(r);
    g.gfx.scene.add(this.gates.group);
    if (r.props.length > 0) {
      this.props = new CourseProps(r.props, g.world);
      g.gfx.scene.add(this.props.group);
    }
    if (this.best?.ghost != null && g.assets !== null) {
      this.ghost = new Ghost(g.seed, g.assets);
      this.ghost.ch.root.visible = false;
      g.gfx.scene.add(this.ghost.ch.root);
    }
    this.toStart();
    this.count = COUNTDOWN;
    this.lastBeep = -1;
    this.view.phase = 'countdown';
    this.view.route = card(r);
    this.view.time = 0;
    this.view.next = 0;
    this.view.split = null;
    this.view.result = null;
    this.view.toasts = [];
    this.view.ghost = this.ghost !== null;
    this.view.hint = r.checkpoints[0]?.hint ?? '';
    this.emit();
  }

  restart() {
    if (this.route !== null) this.start(this.route.id);
  }

  /** Back to the menu (from a run or the results). */
  quit() {
    this.open();
  }

  /** Put the rider at the route start, on foot, still. */
  private toStart() {
    const r = this.route!;
    this.place(new THREE.Vector3(r.start.x, r.start.y, r.start.z), r.start.yaw);
  }

  private place(pos: THREE.Vector3, yaw: number) {
    const g = this.game;
    const p = g.player;
    if (p.mode === 'board') p.toggleBoard();
    p.spawn(pos, yaw);
    p.mode = 'foot';
    p.footGrounded = true;
    p.vel.set(0, 0, 0);
    this.respawns = p.respawns;
    g.cam.yaw = yaw;
    g.cam.snap(p);
  }

  private teardown() {
    this.gates?.dispose();
    this.props?.dispose();
    this.ghost?.dispose();
    this.gates = null;
    this.props = null;
    this.ghost = null;
    this.clock = null;
    this.rec = null;
    this.route = null;
  }

  update(dt: number, input: InputFrame) {
    const v = this.view;
    if (v.phase === 'off' || v.phase === 'menu') return;
    const g = this.game;
    const p = g.player;
    const r = this.route;
    const clock = this.clock;
    if (r === null || clock === null) return;
    this.gates?.update(dt);
    const now = performance.now();

    if (v.phase === 'countdown') {
      // Held on the start line until GO
      const s = r.start;
      p.pos.set(s.x, p.pos.y, s.z);
      p.vel.x = p.vel.z = 0;
      this.count -= dt;
      const sec = Math.ceil(this.count);
      if (sec !== this.lastBeep && sec > 0) {
        this.lastBeep = sec;
        g.sfx.play('beep');
      }
      v.count = Math.max(0, this.count);
      if (this.count <= 0) {
        v.phase = 'running';
        clock.start();
        this.rec = new GhostRecorder();
        this.respawns = p.respawns;
        g.sfx.play('go');
      }
      this.emit();
      return;
    }

    if (v.phase === 'running') {
      if (input.respawnPressed) {
        this.restart();
        return;
      }
      // On foot only
      if (p.mode === 'board') {
        p.toggleBoard();
        this.toast('ON FOOT ONLY', now);
      }
      // A fall out of the world: back to the last gate you passed
      if (p.respawns !== this.respawns) {
        const i = clock.next - 1;
        const c = i >= 0 ? r.checkpoints[i] : null;
        const n = r.checkpoints[clock.next];
        if (c !== null && n !== undefined)
          this.place(new THREE.Vector3(c.x, c.y - 0.9, c.z), Math.atan2(n.x - c.x, n.z - c.z));
        else this.place(new THREE.Vector3(r.start.x, r.start.y, r.start.z), r.start.yaw);
      }
      const passed = clock.update(dt, p.pos.x, p.pos.y, p.pos.z);
      const a = this.sys.anim;
      this.rec?.add(dt, {
        x: p.pos.x,
        y: p.pos.y,
        z: p.pos.z,
        yaw: p.footYaw,
        anim: ANIM[a.kind] * a.side,
        phase: a.phase,
      });
      if (this.ghost !== null && this.best?.ghost != null)
        this.ghost.show(dt, ghostAt(this.best.ghost, clock.time, this.ghostFrame));
      for (const e of this.sys.events) {
        const t = TOAST[e.type];
        if (t !== undefined) this.toast(t, now);
        if (
          e.type === 'walljump' ||
          e.type === 'tictac' ||
          e.type === 'gap' ||
          e.type === 'poleLaunch'
        )
          g.sfx.play('whoosh', { gain: 0.5 });
      }
      if (passed >= 0) {
        v.split = { i: passed, delta: clock.delta(passed), at: now };
        g.sfx.play('sparkle', { gain: 0.7 });
        this.gates?.setNext(clock.next);
        v.next = clock.next;
        v.hint = r.checkpoints[clock.next]?.hint ?? '';
      }
      v.time = clock.time;
      const n = r.checkpoints[clock.next];
      if (n !== undefined) {
        const dx = n.x - p.pos.x;
        const dz = n.z - p.pos.z;
        v.dist = Math.hypot(dx, dz, n.y - p.pos.y - 0.9);
        v.bearing = Math.atan2(dx, dz) - g.cam.controlYaw;
      }
      if (clock.phase === 'done' && clock.result !== null) this.finish(clock.result);
      // The timer is drawn by the HUD from `time`: ~20 updates a second is plenty
      this.emitAcc += dt;
      if (this.emitAcc > 0.05 || passed >= 0 || clock.phase === 'done') {
        this.emitAcc = 0;
        this.emit();
      }
      return;
    }
  }

  private finish(res: RunResult) {
    const r = this.route!;
    const v = this.view;
    if (res.best && this.rec !== null) {
      saveBest(r.id, {
        time: res.time,
        splits: res.splits,
        ghost: this.rec.pack(),
        at: Date.now(),
      });
    }
    v.phase = 'results';
    v.result = { ...res, stars: STARS[res.medal ?? 'none'] };
    v.routes = ROUTES.map(card);
    v.route = card(r);
    this.game.sfx.play(res.medal !== null ? 'go' : 'beep', { gain: 0.8 });
    this.ghost?.show(0, null);
    this.emit();
  }

  private toast(text: string, now: number) {
    const v = this.view;
    v.toasts = [
      ...v.toasts.filter(t => now - t.at < 1600),
      { id: ++this.toastId, text, at: now },
    ].slice(-3);
  }

  dispose() {
    this.teardown();
    this.listeners.clear();
  }
}
