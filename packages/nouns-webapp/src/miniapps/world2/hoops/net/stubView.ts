// ── StubView: coloured capsules + a DOM score, until hoops/view lands ────
//
// Implements HoopsViewLike (the shape factory.ts expects of the real
// HoopsView): build from HoopsViewOptions, `update(dt, state, events)` every
// frame (it owns the camera while hoops mode runs), `dispose()`.

import type { CharacterAssets } from '../../character/NounCharacter';
import type { GameConfig, SimEvent, SimState } from '../contract';
import type { CourtXform } from './court';
import type { TouchPad } from './input';

import * as THREE from 'three';

export interface HoopsViewOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  /** DOM layer over the canvas for the HUD (pointer-events none; buttons opt in). */
  hudLayer: HTMLElement;
  court: CourtXform;
  config: GameConfig;
  /** Local baller (camera / HUD focus); null = spectator. */
  me: string | null;
  assets: CharacterAssets | null;
  toon: boolean;
  /** The touch overlay writes its stick + buttons here (BallerInputReader merges it). */
  touch: TouchPad;
  audio: AudioContext | null;
  /** For the real HoopsView (hoops/view): the renderer, quality, name-tag layer and the game's audio bus. */
  renderer?: THREE.WebGLRenderer;
  quality?: 'low' | 'medium' | 'high';
  labelLayer?: HTMLElement;
  audioOut?: AudioNode | null;
}

export interface HoopsViewLike {
  /** Draw `state` (interpolated on clients); `events` play once. */
  update(dt: number, state: SimState, events: SimEvent[]): void;
  dispose(): void;
}

const TEAM = [0xd22209, 0x2a6bff];

export class StubView implements HoopsViewLike {
  private group = new THREE.Group();
  private bodies = new Map<string, THREE.Mesh>();
  private ball: THREE.Mesh;
  private ring: THREE.Mesh;
  private dom: HTMLDivElement;
  private score: HTMLDivElement;
  private feed: HTMLDivElement;
  private tags = new Map<string, HTMLDivElement>();
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private first = true;
  private v = new THREE.Vector3();

  constructor(private o: HoopsViewOptions) {
    const cap = new THREE.CapsuleGeometry(0.32, 1.1, 4, 10);
    for (const p of o.config.players) {
      const m = new THREE.Mesh(
        cap,
        new THREE.MeshStandardMaterial({ color: TEAM[p.team], roughness: 0.6 }),
      );
      this.group.add(m);
      this.bodies.set(p.id, m);
    }
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(o.config.court.ballRadius * 1.6, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5 }),
    );
    this.group.add(this.ball);
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.6, 0.05, 6, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd400 }),
    );
    this.ring.rotation.x = Math.PI / 2;
    this.group.add(this.ring);
    // Rims + boards where the sim thinks they are
    const c = o.config.court;
    for (const s of [1, -1]) {
      const z = s * (c.length / 2 - c.rimFromBaseline);
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(c.rimRadius, 0.02, 6, 20),
        new THREE.MeshBasicMaterial({ color: 0xff5a00 }),
      );
      o.court.toWorld(0, c.rimHeight, z, rim.position);
      rim.rotation.x = Math.PI / 2;
      const board = new THREE.Mesh(
        new THREE.PlaneGeometry(c.boardWidth, c.boardHeight),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.7,
        }),
      );
      o.court.toWorld(
        0,
        c.boardBottom + c.boardHeight / 2,
        s * (c.length / 2 - c.boardFromBaseline),
        board.position,
      );
      board.rotation.y = o.court.yawToWorld(0);
      this.group.add(rim, board);
    }
    o.scene.add(this.group);

    this.dom = document.createElement('div');
    this.dom.style.cssText =
      'position:absolute;inset:0;pointer-events:none;font-family:system-ui,sans-serif;color:#fff';
    this.score = document.createElement('div');
    this.score.style.cssText =
      'position:absolute;left:50%;top:14px;transform:translateX(-50%);background:#ffd400;color:#000;padding:6px 16px;font-weight:900;font-style:italic;font-size:20px;box-shadow:5px 5px 0 #d22209;white-space:nowrap';
    this.feed = document.createElement('div');
    this.feed.style.cssText =
      'position:absolute;left:50%;top:62px;transform:translateX(-50%);font-weight:800;font-style:italic;font-size:18px;text-shadow:0 2px 0 #000';
    this.dom.append(this.score, this.feed);
    for (const p of o.config.players) {
      const t = document.createElement('div');
      t.className = 'w2-nametag';
      t.innerHTML = `<span style="font-size:11px">${p.name.replace(/["&<>]/g, '')}</span>`;
      this.dom.appendChild(t);
      this.tags.set(p.id, t);
    }
    o.hudLayer.appendChild(this.dom);
    if (o.me !== null && window.matchMedia?.('(pointer: coarse)').matches === true)
      this.buildTouch();
  }

  /** Stub touch overlay: a drag pad + four buttons writing `touch`. */
  private buildTouch() {
    const t = this.o.touch;
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;inset:auto 0 0 0;height:180px;pointer-events:none';
    const pad = document.createElement('div');
    pad.style.cssText =
      'position:absolute;left:18px;bottom:18px;width:140px;height:140px;border-radius:50%;background:rgba(255,255,255,.12);border:2px solid rgba(255,255,255,.3);pointer-events:auto;touch-action:none';
    const move = (e: PointerEvent) => {
      const r = pad.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 2 - 1;
      const y = -(((e.clientY - r.top) / r.height) * 2 - 1);
      const l = Math.hypot(x, y);
      t.sx = l > 1 ? x / l : x;
      t.sy = l > 1 ? y / l : y;
    };
    pad.addEventListener('pointerdown', e => {
      pad.setPointerCapture(e.pointerId);
      move(e);
    });
    pad.addEventListener('pointermove', e => {
      if (pad.hasPointerCapture(e.pointerId)) move(e);
    });
    const stop = () => {
      t.sx = 0;
      t.sy = 0;
    };
    pad.addEventListener('pointerup', stop);
    pad.addEventListener('pointercancel', stop);
    el.appendChild(pad);
    const btns: [keyof TouchPad, string, string][] = [
      ['shoot', 'SHOOT', 'right:20px;bottom:70px'],
      ['pass', 'PASS', 'right:110px;bottom:24px'],
      ['move', 'MOVE', 'right:110px;bottom:110px'],
      ['sprint', 'TURBO', 'right:20px;bottom:150px'],
    ];
    for (const [k, label, pos] of btns) {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = `position:absolute;${pos};width:76px;height:76px;border-radius:50%;background:rgba(210,34,9,.8);color:#fff;font-weight:900;font-size:13px;pointer-events:auto;touch-action:none;border:2px solid rgba(255,255,255,.5)`;
      const set = (v: boolean) => () => {
        (t as unknown as Record<string, boolean>)[k] = v;
      };
      b.addEventListener('pointerdown', set(true));
      b.addEventListener('pointerup', set(false));
      b.addEventListener('pointercancel', set(false));
      b.addEventListener('pointerleave', set(false));
      el.appendChild(b);
    }
    this.dom.appendChild(el);
  }

  update(dt: number, s: SimState, events: SimEvent[]) {
    const o = this.o;
    const court = o.court;
    let me = null as SimState['players'][number] | null;
    for (const p of s.players) {
      const m = this.bodies.get(p.id);
      if (!m) continue;
      court.toWorld(p.x, p.y + 0.87, p.z, m.position);
      m.rotation.y = court.yawToWorld(p.yaw);
      if (p.id === o.me) me = p;
    }
    court.toWorld(s.ball.x, s.ball.y, s.ball.z, this.ball.position);
    this.ring.visible = me !== null;
    if (me !== null) court.toWorld(me.x, 0.05, me.z, this.ring.position);

    // Camera: behind my baller toward the basket my team attacks (spectators: sideline)
    const cfg = o.config;
    const team = cfg.players.find(p => p.id === o.me)?.team ?? 0;
    const sgn = cfg.halfCourt || team === 0 ? 1 : -1;
    const fx = me?.x ?? s.ball.x;
    const fz = me?.z ?? s.ball.z;
    if (me !== null) {
      court.toWorld(fx * 0.5, 7.5, fz - sgn * 10, this.v);
    } else court.toWorld(-19, 11, fz * 0.6, this.v);
    const k = this.first ? 1 : 1 - Math.exp(-dt * 4);
    this.camPos.lerp(this.v, k);
    court.toWorld(fx * 0.6, 1.2, me !== null ? fz + sgn * 5 : fz * 0.6, this.v);
    this.camLook.lerp(this.v, k);
    this.first = false;
    const cam = o.camera;
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
    if (Math.abs(cam.fov - 55) > 0.01) {
      cam.fov = 55;
      cam.updateProjectionMatrix();
    }

    // HUD
    const names = ['RED', 'BLUE'];
    const clock = cfg.shotClock > 0 ? ` · ⏱ ${Math.max(0, s.shotClock).toFixed(0)}` : '';
    const text = `${names[0]} ${s.score[0]} — ${s.score[1]} ${names[1]}${clock}`;
    if (this.score.textContent !== text) this.score.textContent = text;
    const meter = me?.meter;
    const line =
      meter !== undefined
        ? `SHOT ${'▮'.repeat(Math.round(meter * 10))}${'▯'.repeat(10 - Math.round(meter * 10))}`
        : s.phase !== 'live'
          ? s.phase.toUpperCase()
          : '';
    for (const e of events)
      if (e.type === 'score')
        this.flash(`+${e.points} ${cfg.players.find(p => p.id === e.id)?.name ?? ''}`);
      else if (e.type === 'steal') this.flash('STOLEN!');
    if (performance.now() > this.flashUntil && this.feed.textContent !== line)
      this.feed.textContent = line;
    const w = o.canvas.clientWidth;
    const h = o.canvas.clientHeight;
    for (const [id, t] of this.tags) {
      const m = this.bodies.get(id);
      if (!m) continue;
      this.v.copy(m.position);
      this.v.y += 1.2;
      this.v.project(cam);
      const show = this.v.z < 1 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1;
      t.style.display = show ? 'block' : 'none';
      if (show)
        t.style.transform = `translate(-50%,-100%) translate(${((this.v.x + 1) / 2) * w}px,${((1 - this.v.y) / 2) * h}px)`;
    }
  }

  private flashUntil = 0;
  private flash(text: string) {
    this.feed.textContent = text;
    this.flashUntil = performance.now() + 1200;
  }

  dispose() {
    this.o.scene.remove(this.group);
    this.group.traverse(x => {
      const m = x as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
    this.dom.remove();
  }
}
