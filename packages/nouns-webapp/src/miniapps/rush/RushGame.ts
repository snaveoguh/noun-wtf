// ── Noun Rush engine: three.js world, race loop, camera, input, sound ──

import type { NounSeed } from '@/miniapps/world2/character/NounAppearance';

import { N8AOPostPass } from 'n8ao';
import {
  BrightnessContrastEffect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

import { ClampEffect } from '@/miniapps/world2/render/Toon';

import {
  COURSE_END,
  CRUISE_Y,
  FINISH_LINE,
  HALF_W,
  HANGAR_GATE,
  PARK_GATE,
  RIDES,
  SEA_Y,
  SKY_LANES,
  TOWN_LANES,
  TRACK_W,
  VEHICLE_GATE,
  ZONES,
  aiControls,
  buildCourse,
  groundY,
  laneCentre,
  mulberry32,
  newRacer,
  slopeAt,
  standings,
  stepRace,
  terrainY,
  zoneAt,
  zoneLabel,
  type Controls,
  type Course,
  type Obstacle,
  type RaceEvent,
  type Racer,
  type Ride,
} from './course';
import { SEAT, buildRacer, fantaCan, orange, signBoard, type RacerRig } from './models';
import { RushAudio } from './RushAudio';

export type Phase = 'ready' | 'countdown' | 'race' | 'done';

export interface Toast {
  id: number;
  text: string;
  big: boolean;
}

export interface HudRow {
  name: string;
  human: boolean;
  color: string;
  progress: number;
  place: number;
  finished: boolean;
  time: number;
  oranges: number;
}

export interface HudState {
  phase: Phase;
  countdown: number;
  place: number;
  total: number;
  zone: string;
  ride: string;
  kmh: number;
  oranges: number;
  boost: number;
  time: number;
  flying: boolean;
  rows: HudRow[];
  toasts: Toast[];
  best: number | null;
  newBest: boolean;
}

export interface Contestant {
  name: string;
  seed: NounSeed;
  color: string;
  skill: number;
  human: boolean;
}

export interface TouchState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  jump: boolean;
  punch: boolean;
}

const BEST_KEY = 'noun-rush-best';
const SUN_DIR = new THREE.Vector3(-0.45, 0.75, 0.35).normalize();

function loadBest(): number | null {
  try {
    const v = Number(localStorage.getItem(BEST_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function isTouchDevice() {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
}

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

interface Flying {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

export class RushGame {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2400);
  readonly audio = new RushAudio();

  onHud: ((h: HudState) => void) | null = null;
  touch: TouchState = {
    left: false,
    right: false,
    up: false,
    down: false,
    jump: false,
    punch: false,
  };

  private sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  private course: Course = buildCourse();
  private racers: Racer[] = [];
  private rigs = new Map<number, RacerRig>();
  private colors = new Map<number, string>();
  private contestants: Contestant[] = [];
  private keys = new Set<string>();
  private punchQueued = false;
  private phase: Phase = 'ready';
  private countdown = 0;
  private clock = 0;
  private paused = false;
  private raf = 0;
  private last = 0;
  private rnd = mulberry32(Date.now() & 0xffffffff);
  private toasts: Toast[] = [];
  private toastSeq = 0;
  private toastTimes = new Map<number, number>();
  private hudT = 0;
  private best = loadBest();
  private newBest = false;
  private lastZone = '';
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private obstacleObjs = new Map<Obstacle, THREE.Object3D>();
  private flying: Flying[] = [];
  private fantaObjs: { p: Course['pickups'][number]; obj: THREE.Object3D }[] = [];
  private orangeIdx: Course['pickups'][number][] = [];
  private orangeBody: THREE.InstancedMesh | null = null;
  private orangeLeaf: THREE.InstancedMesh | null = null;
  private ringObjs: THREE.Mesh[] = [];
  private floor: THREE.InstancedMesh | null = null;
  private floorN = 0;
  private discoBall: THREE.Object3D | null = null;
  private spinnersStatic: { obj: THREE.Object3D; axis: 'x' | 'y' | 'z'; rate: number }[] = [];
  private walkPhase = new Map<number, number>();
  private disposed = false;
  private low = false;
  private composer: EffectComposer | null = null;
  private texLoader = new THREE.TextureLoader();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouchDevice() ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.low = isTouchDevice();

    this.buildWorld();
    // ?fx=0 skips the post stack (perf triage / software GL)
    if (new URLSearchParams(window.location.search).get('fx') !== '0') this.buildPost();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  // ── lifecycle ─────────────────────────────────────────────────────

  setContestants(list: Contestant[]) {
    this.contestants = list;
    this.resetRace();
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.fov = this.camera.aspect < 0.8 ? 74 : 62;
    this.camera.updateProjectionMatrix();
  }

  start() {
    this.last = performance.now();
    const loop = (t: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (t - this.last) / 1000);
      this.last = t;
      if (!this.paused) this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  setPaused(p: boolean) {
    this.paused = p;
    if (p) {
      this.keys.clear();
      this.audio.setEngine(0, 'foot');
    }
    this.audio.setMuted(p);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.audio.dispose();
    this.composer?.dispose();
    this.scene.traverse(o => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
    });
    this.renderer.dispose();
  }

  /** Line everyone up at the top of the mountain. */
  resetRace() {
    for (const rig of this.rigs.values()) this.scene.remove(rig.root);
    this.rigs.clear();
    this.colors.clear();
    this.course = buildCourse();
    this.rebuildCourseObjects();
    this.racers = this.contestants.map((c, i) => {
      const x = (i - (this.contestants.length - 1) / 2) * 3.2;
      const r = newRacer(i, c.name, c.human, x, c.skill);
      const rig = buildRacer(c.seed, c.name, c.color, !c.human);
      this.rigs.set(i, rig);
      this.colors.set(i, c.color);
      this.scene.add(rig.root);
      return r;
    });
    this.phase = 'ready';
    this.clock = 0;
    this.toasts = [];
    this.newBest = false;
    this.lastZone = '';
    this.flying = [];
    this.placeRigs(0);
    const me = this.me();
    if (me !== undefined) {
      this.camPos.set(me.x, me.y + 6, -me.s + 12);
      this.camLook.set(me.x, me.y, -me.s - 10);
    }
    this.pushHud(true);
  }

  go() {
    if (this.phase === 'countdown' || this.phase === 'race') return;
    if (this.phase === 'done') this.resetRace();
    this.audio.unlock();
    this.phase = 'countdown';
    this.countdown = 3.2;
    this.audio.beep(false);
  }

  // ── input ─────────────────────────────────────────────────────────

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.paused) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    const k = e.code;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(k))
      e.preventDefault();
    if ((k === 'Enter' || k === 'Space') && (this.phase === 'ready' || this.phase === 'done')) {
      this.go();
      return;
    }
    if ((k === 'KeyF' || k === 'KeyK' || k === 'ShiftLeft' || k === 'ShiftRight') && !e.repeat)
      this.punchQueued = true;
    this.keys.add(k);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onBlur = () => this.keys.clear();

  punch() {
    this.punchQueued = true;
  }

  private humanControls(flying: boolean): Controls {
    const k = this.keys;
    const t = this.touch;
    const left = k.has('ArrowLeft') || k.has('KeyA') || t.left;
    const right = k.has('ArrowRight') || k.has('KeyD') || t.right;
    const up = k.has('ArrowUp') || k.has('KeyW') || t.up;
    const down = k.has('ArrowDown') || k.has('KeyS') || t.down;
    const vert = (up ? 1 : 0) - (down ? 1 : 0);
    const c: Controls = {
      steer: (right ? 1 : 0) - (left ? 1 : 0),
      throttle: flying ? 0 : vert,
      climb: flying ? vert : 0,
      jump: k.has('Space') || t.jump,
      punch: this.punchQueued,
    };
    this.punchQueued = false;
    return c;
  }

  // ── frame ─────────────────────────────────────────────────────────

  private me(): Racer | undefined {
    return this.racers.find(r => r.human);
  }

  private frame(dt: number) {
    if (this.phase === 'countdown') {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown);
      if (after !== before && after > 0) this.audio.beep(false);
      if (this.countdown <= 0) {
        this.phase = 'race';
        this.audio.beep(true);
        this.toast('GO!', true);
      }
    }

    if (this.phase === 'race' || this.phase === 'done') {
      this.clock += this.phase === 'race' ? dt : 0;
      const controls = new Map<number, Controls>();
      for (const r of this.racers) {
        controls.set(
          r.id,
          r.human
            ? this.phase === 'race'
              ? this.humanControls(RIDES[r.ride].flies)
              : { steer: 0, throttle: 0, climb: 0, jump: false, punch: false }
            : aiControls(r, this.racers, this.course, this.clock, this.rnd),
        );
      }
      // Fixed-ish substeps keep the jumps honest at low frame rates
      const n = Math.max(1, Math.ceil(dt / (1 / 90)));
      for (let i = 0; i < n; i++) {
        const ev = stepRace(this.racers, this.course, controls, dt / n, this.clock);
        this.handleEvents(ev);
        // one punch per frame, not per substep
        for (const c of controls.values()) c.punch = false;
      }
    }

    this.placeRigs(dt);
    this.animateWorld(dt);
    this.updateCamera(dt);
    this.updateSun();

    const me = this.me();
    if (me !== undefined) {
      const spec = RIDES[me.ride];
      this.audio.setEngine(this.phase === 'race' ? me.speed / spec.speed : 0, me.ride);
      this.audio.setDance(me.finished ? 1 : 0);
    }

    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.1;
      this.pushHud(false);
    }
    if (this.composer !== null) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  private handleEvents(ev: RaceEvent[]) {
    for (const e of ev) {
      const mine = e.racer.human;
      const onMe = e.other?.human === true;
      switch (e.kind) {
        case 'pickup':
          if (mine) {
            if (e.text === 'fanta') {
              this.toast('FANTA BOOST!');
              this.audio.fizz();
            } else this.audio.blip();
          }
          break;
        case 'crash':
          if (mine) {
            this.toast(e.text === 'hurdle' ? 'TRIPPED!' : 'WIPEOUT!');
            this.audio.crash();
          }
          break;
        case 'smash': {
          if (mine) this.audio.crash();
          break;
        }
        case 'punch':
          if (mine) {
            this.toast(`POW! ${e.other?.name ?? ''}`);
            this.audio.punch();
          } else if (onMe) {
            this.toast(`OUCH! ${e.racer.name} GOT YOU`);
            this.audio.punch();
          }
          break;
        case 'ring':
          if (mine) {
            this.toast('RING BOOST!');
            this.audio.ring();
          }
          break;
        case 'kicker':
          if (mine) this.toast('AIR!');
          break;
        case 'ride':
          if (mine) {
            const t = e.text ?? '';
            if (t === 'RUNNING') this.toast('RUN!');
            else this.toast(`${/^[AEIOU]/.test(t) ? 'AN' : 'A'} ${t}!`);
            this.audio.blip();
          }
          break;
        case 'zone':
          if (mine && e.text && e.text !== this.lastZone) {
            this.lastZone = e.text;
            this.toast(e.text, true);
          }
          break;
        case 'finish':
          if (mine) {
            const p = e.racer.place;
            this.toast(`${p}${ordinal(p)} PLACE!`, true);
            this.audio.fanfare(p === 1);
            if (this.best === null || e.racer.finishTime < this.best) {
              this.best = e.racer.finishTime;
              this.newBest = true;
              try {
                localStorage.setItem(BEST_KEY, String(this.best));
              } catch {
                // fine
              }
            }
            this.phase = 'done';
          }
          break;
      }
      if (e.kind === 'smash') this.smash(e.racer);
    }
  }

  private toast(text: string, big = false) {
    const id = ++this.toastSeq;
    this.toasts = [...this.toasts.filter(t => !t.big || !big), { id, text, big }].slice(-4);
    this.toastTimes.set(id, performance.now() + (big ? 2200 : 1300));
  }

  private pushHud(force: boolean) {
    const now = performance.now();
    const before = this.toasts.length;
    this.toasts = this.toasts.filter(t => (this.toastTimes.get(t.id) ?? 0) > now);
    if (this.onHud === null) return;
    const me = this.me();
    const order = standings(this.racers);
    const rows: HudRow[] = order.map((r, i) => ({
      name: r.name,
      human: r.human,
      color: this.colors.get(r.id) ?? '#fff',
      progress: Math.min(1, Math.max(0, r.s / FINISH_LINE)),
      place: i + 1,
      finished: r.finished,
      time: r.finishTime,
      oranges: r.oranges,
    }));
    if (!force && before === this.toasts.length && this.phase === 'ready') return;
    this.onHud({
      phase: this.phase,
      countdown: Math.ceil(this.countdown),
      place: me === undefined ? 0 : order.indexOf(me) + 1,
      total: this.racers.length,
      zone: me === undefined ? '' : zoneLabel(zoneAt(me.s)),
      ride: me === undefined ? '' : RIDES[me.ride].label,
      kmh: me === undefined ? 0 : Math.round(me.speed * 3.6),
      oranges: me?.oranges ?? 0,
      boost: me?.boost ?? 0,
      time: me?.finished === true ? me.finishTime : this.clock,
      flying: me !== undefined && RIDES[me.ride].flies,
      rows,
      toasts: this.toasts,
      best: this.best,
      newBest: this.newBest,
    });
  }

  // ── racers on screen ──────────────────────────────────────────────

  private placeRigs(dt: number) {
    const t = performance.now() / 1000;
    for (const r of this.racers) {
      const rig = this.rigs.get(r.id);
      if (rig === undefined) continue;
      const spec = RIDES[r.ride];
      rig.root.position.set(r.x, r.y, -r.s);

      for (const [k, obj] of Object.entries(rig.rides)) obj.visible = k === r.ride;
      for (const sp of rig.spinners)
        sp.obj.rotation[sp.axis] +=
          sp.rate * dt * (r.ride === 'heli' || r.ride === 'plane' ? 1 : r.speed * 0.6);

      // Heading + lean
      const yaw = -r.vx * (spec.flies ? 0.02 : 0.035);
      rig.root.rotation.set(0, yaw, 0);
      const bank = spec.flies ? -r.vx * 0.05 : r.ride === 'moto' ? -r.vx * 0.04 : 0;
      let pitch = 0;
      if (!spec.flies && r.grounded) pitch = -Math.atan(slopeAt(r.s)) * 0.9;
      if (spec.flies) pitch = r.s < 1110 && r.s > 1050 ? 0.18 : r.s > 1370 ? -0.08 : 0;
      rig.root.rotation.x = pitch;
      rig.root.rotation.z = bank;

      // Stars when stunned
      rig.stars.visible = r.stun > 0;
      if (rig.stars.visible) rig.stars.rotation.y += dt * 6;

      this.poseBody(r, rig, dt, t);
    }
  }

  private poseBody(r: Racer, rig: RacerRig, dt: number, t: number) {
    const seat = SEAT[r.ride];
    const { body, hips, armL, armR, legL, legR, head } = rig;
    body.rotation.set(0, 0, 0);
    body.position.set(0, 0, seat.z);
    hips.position.y = seat.sit ? seat.y + 0.12 : 0.92 + seat.y;
    hips.rotation.set(0, 0, 0);
    head.rotation.set(0, 0, 0);
    for (const l of [armL, armR, legL, legR]) l.rotation.set(0, 0, 0);

    const phase = (this.walkPhase.get(r.id) ?? 0) + dt * Math.max(2, r.speed) * 0.55;
    this.walkPhase.set(r.id, phase);

    if (r.finished && Math.abs(r.danceS - r.s) < 3) {
      // Dance! Each Noun has its own move
      const b = t * Math.PI * 2 * (128 / 60) * 0.5; // half-time groove
      const move = r.id % 4;
      hips.position.y = 0.92 + Math.abs(Math.sin(b)) * 0.12;
      if (move === 0) {
        armL.rotation.z = -2.6 + Math.sin(b) * 0.4;
        armR.rotation.z = 2.6 - Math.sin(b) * 0.4;
        hips.rotation.z = Math.sin(b) * 0.15;
      } else if (move === 1) {
        // the dab
        const dab = Math.sin(b * 0.5) > 0;
        armL.rotation.z = dab ? -1.6 : -0.4;
        armR.rotation.set(dab ? 1.3 : 0, 0, dab ? 0.6 : 0.4);
        head.rotation.x = dab ? 0.45 : 0;
        head.rotation.y = dab ? 0.4 : 0;
      } else if (move === 2) {
        body.rotation.y = t * 3;
        armL.rotation.z = -1.4;
        armR.rotation.z = 1.4;
      } else {
        legL.rotation.x = Math.max(0, Math.sin(b)) * 1.2;
        legR.rotation.x = Math.max(0, -Math.sin(b)) * 1.2;
        armL.rotation.x = Math.sin(b) * 1.1;
        armR.rotation.x = -Math.sin(b) * 1.1;
      }
      body.rotation.y += Math.PI; // face the camera on the floor
      return;
    }

    if (r.stun > 0) {
      body.rotation.y = r.stun * 10;
      armL.rotation.z = -1.2;
      armR.rotation.z = 1.2;
      head.rotation.z = Math.sin(t * 9) * 0.25;
    } else if (r.ride === 'foot') {
      const sw = Math.sin(phase);
      if (r.grounded) {
        legL.rotation.x = sw * 0.95;
        legR.rotation.x = -sw * 0.95;
        armL.rotation.x = -sw * 1.0;
        armR.rotation.x = sw * 1.0;
        hips.position.y += Math.abs(Math.cos(phase)) * 0.08;
        hips.rotation.x = 0.18;
      } else {
        legL.rotation.x = 1.0;
        legR.rotation.x = -0.4;
        armL.rotation.z = -1.0;
        armR.rotation.z = 1.0;
      }
    } else if (r.ride === 'board') {
      // Knees bent, arms out, body sideways-ish on the board
      body.rotation.y = 0.9;
      head.rotation.y = -0.85;
      hips.position.y -= 0.18;
      legL.rotation.x = 0.5;
      legR.rotation.x = -0.25;
      legL.rotation.z = -0.15;
      legR.rotation.z = 0.15;
      armL.rotation.z = -1.1 - r.vx * 0.03;
      armR.rotation.z = 1.1 - r.vx * 0.03;
      hips.rotation.z = -r.vx * 0.02;
      if (!r.grounded) {
        // grab!
        armR.rotation.set(-0.3, 0, 0.3);
        legL.rotation.x = 0.9;
        legR.rotation.x = 0.4;
      }
    } else {
      // Seated: legs forward, hands on the controls
      legL.rotation.x = 1.45;
      legR.rotation.x = 1.45;
      armL.rotation.x = 1.15;
      armR.rotation.x = 1.15;
      armL.rotation.z = 0.15;
      armR.rotation.z = -0.15;
      if (r.ride === 'moto') hips.rotation.x = 0.35;
      head.rotation.y = -r.vx * 0.03;
    }

    // Jab
    if (r.punchT < 0.3) {
      const k = Math.sin((r.punchT / 0.3) * Math.PI);
      armR.rotation.set(1.6 * k + armR.rotation.x * (1 - k), 0, -0.2 * k);
      body.rotation.y += 0.25 * k;
    }
  }

  // ── camera + light ────────────────────────────────────────────────

  private updateCamera(dt: number) {
    const me = this.me();
    if (me === undefined) return;
    const spec = RIDES[me.ride];
    const t = performance.now() / 1000;
    if (this.phase === 'done' && me.finished && Math.abs(me.danceS - me.s) < 6) {
      // Slow orbit round the dance floor
      const cx = 0;
      const cz = -(FINISH_LINE + 32);
      const a = t * 0.18;
      _v.set(cx + Math.sin(a) * 22, 9, cz - Math.cos(a) * 22);
      this.camPos.lerp(_v, Math.min(1, dt * 1.5));
      this.camLook.lerp(_s.set(0, 1.5, cz), Math.min(1, dt * 2));
    } else if (this.phase === 'ready' || this.phase === 'countdown') {
      _v.set(me.x * 0.3, me.y + 3.4, -me.s + 7.5);
      this.camPos.lerp(_v, Math.min(1, dt * 3));
      this.camLook.lerp(_s.set(me.x * 0.3, me.y + 1.6, -me.s - 6), Math.min(1, dt * 3));
    } else {
      const back = spec.flies ? 16 : me.ride === 'tractor' ? 10.5 : me.ride === 'car' ? 10 : 8.5;
      const up = spec.flies ? 5.5 : 3.6;
      // Follow the slope so the snow run stays framed
      const gAhead = spec.flies ? me.y : groundY(me.s + 10, me.x);
      const gBehind = spec.flies ? me.y : groundY(me.s - back, me.x);
      const baseY = Math.max(me.y, gBehind) + up;
      _v.set(me.x * 0.75, baseY, -me.s + back);
      this.camPos.lerp(_v, Math.min(1, dt * 5));
      if (this.camPos.y < gBehind + 1.5) this.camPos.y = gBehind + 1.5;
      _s.set(me.x, (spec.flies ? me.y : Math.min(me.y, gAhead + 1)) + 1.6, -me.s - 12);
      this.camLook.lerp(_s, Math.min(1, dt * 6));
      // a little shake at speed / when hit
      if (me.stun > 0.6) this.camPos.x += (Math.random() - 0.5) * 0.2;
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    // Speed lines through FOV
    const base = this.camera.aspect < 0.8 ? 74 : 62;
    const fov = base + (me.boost > 0 ? 9 : 0) + Math.min(8, me.speed * 0.12);
    this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 3);
    this.camera.updateProjectionMatrix();
  }

  private updateSun() {
    const me = this.me();
    const p = me === undefined ? _v.set(0, 0, 0) : _v.set(me.x, me.y, -me.s - 15);
    this.sun.target.position.copy(p);
    this.sun.position.copy(p).addScaledVector(SUN_DIR, 120);
    this.sun.target.updateMatrixWorld();
  }

  // ── world ─────────────────────────────────────────────────────────

  /** Realism stack: AO in the creases, filmic tone curve, a light grade (no bloom: the snow blooms over everything). */
  private buildPost() {
    const composer = new EffectComposer(this.renderer, {
      frameBufferType: this.low ? THREE.UnsignedByteType : THREE.HalfFloatType,
      multisampling: 0,
    });
    composer.addPass(new RenderPass(this.scene, this.camera));
    const fx = new URLSearchParams(window.location.search).get('fx');
    if (!this.low && fx !== 'noao') {
      const ao = new N8AOPostPass(this.scene, this.camera, 1, 1);
      const c = ao.configuration;
      c.aoRadius = 2.2;
      c.distanceFalloff = 0.8;
      c.intensity = 2.4;
      c.aoSamples = 12;
      c.denoiseSamples = 6;
      c.halfRes = true;
      c.depthAwareUpsampling = true;
      c.gammaCorrection = false;
      composer.addPass(ao);
    }
    // Clamp first: Apple GPUs can leave negative values that the tone curve
    // blows out to white (same fix as world2's Graphics)
    composer.addPass(
      new EffectPass(
        this.camera,
        new ClampEffect(),
        new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
        new BrightnessContrastEffect({ contrast: 0.08 }),
        new HueSaturationEffect({ saturation: 0.12 }),
        new VignetteEffect({ offset: 0.3, darkness: 0.38 }),
        new ClampEffect(),
      ),
    );
    if (!this.low)
      composer.addPass(new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.MEDIUM })));
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.composer = composer;
  }

  /** Photo-scanned ground (Poly Haven, CC0), tiled in world metres. */
  private groundMaterial(
    name: 'snow' | 'asphalt' | 'grass' | 'sand',
    metres: number,
    roughness: number,
  ) {
    const load = (f: string, srgb: boolean) => {
      const tex = this.texLoader.load(`/rush/tex/${name}_${f}.webp`);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };
    const mat = new THREE.MeshStandardMaterial({
      map: load('diff', true),
      normalMap: load('nor_gl', false),
      normalScale: new THREE.Vector2(1.2, 1.2),
      roughness,
      vertexColors: true,
    });
    mat.userData.metres = metres;
    return mat;
  }

  private buildWorld() {
    const scene = this.scene;
    scene.background = new THREE.Color(0xbcd8ee);
    scene.fog = new THREE.Fog(0xcfe0ee, 120, 700);

    const sky = new Sky();
    sky.scale.setScalar(4000);
    const u = sky.material.uniforms;
    u.turbidity!.value = 4;
    u.rayleigh!.value = 1.4;
    u.mieCoefficient!.value = 0.004;
    u.mieDirectionalG!.value = 0.8;
    u.sunPosition!.value.copy(SUN_DIR).multiplyScalar(1000);
    scene.add(sky);
    // Reflections + ambient light baked from the same sky
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    // (a plain gradient dome: the Sky shader's sun disc bakes NaNs into the
    // PMREM on some GPUs, which bloom then smears over the whole frame)
    const envScene = new THREE.Scene();
    const dome = new THREE.SphereGeometry(100, 32, 16);
    const dc = new Float32Array(dome.attributes.position!.count * 3);
    const zen = new THREE.Color(0x4f86c6);
    const hor = new THREE.Color(0xdfeaf2);
    const gnd = new THREE.Color(0x8d8a80);
    for (let i = 0; i < dome.attributes.position!.count; i++) {
      const y = dome.attributes.position!.getY(i) / 100;
      if (y >= 0) _c.copy(hor).lerp(zen, Math.pow(y, 0.6));
      else _c.copy(hor).lerp(gnd, Math.min(1, -y * 3));
      dc[i * 3] = _c.r;
      dc[i * 3 + 1] = _c.g;
      dc[i * 3 + 2] = _c.b;
    }
    dome.setAttribute('color', new THREE.BufferAttribute(dc, 3));
    envScene.add(
      new THREE.Mesh(
        dome,
        new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }),
      ),
    );
    const sunBlob = new THREE.Mesh(
      new THREE.SphereGeometry(6, 12, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 7.4, 6.4) }),
    );
    sunBlob.position.copy(SUN_DIR).multiplyScalar(90);
    envScene.add(sunBlob);
    scene.environment = pmrem.fromScene(envScene, 0, 0.1, 500).texture;
    scene.environmentIntensity = 0.55;
    pmrem.dispose();
    // Sky follows the camera so the dome never clips
    sky.onBeforeRender = () => sky.position.copy(this.camera.position);

    scene.add(new THREE.HemisphereLight(0xdfeeff, 0x5a6b4a, 0.45));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -50;
    sc.right = 50;
    sc.top = 50;
    sc.bottom = -50;
    sc.near = 1;
    sc.far = 320;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);

    this.buildTerrain();
    this.buildWater();
    this.buildScenery();
    this.buildGates();
    this.buildFinish();
  }

  private buildTerrain() {
    const xsAll: number[] = [];
    for (let x = -200; x <= 200; x += x < -40 || x >= 40 ? 10 : 2) xsAll.push(x);
    const snow = this.groundMaterial('snow', 6, 0.75);
    const asphalt = this.groundMaterial('asphalt', 5, 0.85);
    const grass = this.groundMaterial('grass', 4, 0.95);
    const sand = this.groundMaterial('sand', 5, 0.9);
    const T = HALF_W + 1;
    const patch = (s0: number, s1: number, mat: THREE.Material, x0 = -200, x1 = 200) => {
      const xs = [...new Set([x0, ...xsAll.filter(x => x > x0 && x < x1), x1])];
      this.scene.add(terrainPatch(s0, s1, xs, mat));
    };
    patch(-80, 400, snow);
    patch(400, 760, asphalt);
    patch(760, 1000, grass);
    patch(1000, 1110, grass, -200, -T);
    patch(1000, 1110, asphalt, -T, T);
    patch(1000, 1110, grass, T, 200);
    patch(1110, COURSE_END + 160, sand);

    // Road + runway markings
    const dash = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.25, 0.04, 3),
      new THREE.MeshStandardMaterial({ color: 0xf5f5f0, roughness: 0.6 }),
      400,
    );
    let n = 0;
    const put = (x: number, s: number, sx = 1, sz = 1) => {
      _m.compose(_s.set(x, 0.03, -s), _q.identity(), _v.set(sx, 1, sz));
      dash.setMatrixAt(n++, _m);
    };
    for (let s = 410; s < 755; s += 8) {
      put(-TRACK_W / 6, s);
      put(TRACK_W / 6, s);
    }
    for (let s = 1005; s < 1105; s += 10) put(0, s, 2, 1.6);
    for (const x of [-HALF_W + 0.6, HALF_W - 0.6])
      for (let s = 1000; s < 1108; s += 4) put(x, s, 1, 1.2);
    dash.count = n;
    dash.receiveShadow = true;
    this.scene.add(dash);
  }

  private buildWater() {
    const geo = new THREE.PlaneGeometry(3000, 1400, 1, 1).rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: 0x1b6fa3,
        roughness: 0.12,
        metalness: 0.15,
        transparent: true,
        opacity: 0.92,
      }),
    );
    water.position.set(0, SEA_Y + 0.6, -(1100 + 700));
    water.receiveShadow = true;
    this.scene.add(water);
  }

  private buildScenery() {
    const rnd = mulberry32(77);
    // Pines: snow mountain (scenery + course obstacles) and around the grass
    const pines: { x: number; y: number; s: number; k: number }[] = [];
    for (const o of this.course.obstacles)
      if (o.kind === 'pine') pines.push({ x: o.x, y: groundY(o.s, o.x), s: o.s, k: 1 });
    for (let i = 0; i < 700; i++) {
      const s = -60 + rnd() * 470;
      const side = rnd() < 0.5 ? -1 : 1;
      const x = side * (HALF_W + 3 + rnd() * rnd() * 140);
      pines.push({ x, y: terrainY(s, x), s, k: 0.8 + rnd() * 0.9 });
    }
    for (let i = 0; i < 260; i++) {
      const s = 760 + rnd() * 250;
      const side = rnd() < 0.5 ? -1 : 1;
      const x = side * (HALF_W + 4 + rnd() * 120);
      pines.push({ x, y: terrainY(s, x), s, k: 0.7 + rnd() * 0.6 });
    }
    const coneGeo = new THREE.ConeGeometry(1.6, 5.4, 9);
    coneGeo.translate(0, 4.2, 0);
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 1.8, 7);
    trunkGeo.translate(0, 0.9, 0);
    const capGeo = new THREE.ConeGeometry(0.95, 2.2, 9);
    capGeo.translate(0, 6.6, 0);
    const pineMesh = new THREE.InstancedMesh(
      coneGeo,
      new THREE.MeshStandardMaterial({ color: 0x23472c, roughness: 0.9 }),
      pines.length,
    );
    const trunkMesh = new THREE.InstancedMesh(
      trunkGeo,
      new THREE.MeshStandardMaterial({ color: 0x5a3d26, roughness: 0.95 }),
      pines.length,
    );
    const capMesh = new THREE.InstancedMesh(
      capGeo,
      new THREE.MeshStandardMaterial({ color: 0xf4f8fb, roughness: 0.8 }),
      pines.length,
    );
    let capN = 0;
    pines.forEach((p, i) => {
      _m.compose(
        _v.set(p.x, p.y - 0.2, -p.s),
        _q.setFromEuler(_e.set(0, p.s * 7.3, 0)),
        _s.setScalar(p.k),
      );
      pineMesh.setMatrixAt(i, _m);
      trunkMesh.setMatrixAt(i, _m);
      if (p.s < 420) capMesh.setMatrixAt(capN++, _m);
    });
    capMesh.count = capN;
    for (const m of [pineMesh, trunkMesh, capMesh]) {
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
    }

    // Rocks on the course
    const rocks = this.course.obstacles.filter(o => o.kind === 'rock');
    const rockMesh = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(1.1, 0),
      new THREE.MeshStandardMaterial({ color: 0x7c7f86, roughness: 0.95, flatShading: true }),
      rocks.length,
    );
    rocks.forEach((o, i) => {
      _m.compose(
        _v.set(o.x, groundY(o.s, o.x) + 0.3, -o.s),
        _q.setFromEuler(_e.set(o.s, o.x, 0)),
        _s.set(1, 0.75, 1),
      );
      rockMesh.setMatrixAt(i, _m);
    });
    rockMesh.castShadow = true;
    this.scene.add(rockMesh);

    // Kickers: snow ramps
    for (const k of this.course.kickers) {
      const g = new THREE.BoxGeometry(k.w, 1.6, 6);
      g.translate(0, -0.8, 0);
      const ramp = new THREE.Mesh(
        g,
        new THREE.MeshStandardMaterial({ color: 0xe9f1f8, roughness: 0.8 }),
      );
      ramp.position.set(k.x, groundY(k.s, k.x) + 0.5, -k.s + 2.8);
      ramp.rotation.x = 0.22 - Math.atan(slopeAt(k.s));
      ramp.castShadow = true;
      ramp.receiveShadow = true;
      this.scene.add(ramp);
      const flag = signBoard('JUMP', '', '#e8372c', '#fff', 2, 0.7);
      flag.position.set(k.x, groundY(k.s, k.x) + 3, -k.s + 5);
      this.scene.add(flag);
    }

    // Town: blocks of flats and shops on both sides
    const winTex = windowTexture();
    const bldMat = new THREE.MeshStandardMaterial({ map: winTex, roughness: 0.7 });
    const blocks: { x: number; s: number; w: number; d: number; h: number; c: THREE.Color }[] = [];
    const palette = [0xd9c7a8, 0xb85c4a, 0x8aa1b5, 0xe8e2d4, 0x6f7f6a, 0xc98d55, 0x9a8fb0];
    for (const side of [-1, 1])
      for (let s = 395; s < 765; ) {
        const d = 10 + rnd() * 14;
        const w = 10 + rnd() * 12;
        blocks.push({
          x: side * (HALF_W + 4 + w / 2 + rnd() * 3),
          s: s + d / 2,
          w,
          d,
          h: 8 + rnd() * rnd() * 40,
          c: new THREE.Color(palette[Math.floor(rnd() * palette.length)]!),
        });
        s += d + 2 + rnd() * 4;
      }
    const bld = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      bldMat,
      blocks.length,
    );
    blocks.forEach((b, i) => {
      _m.compose(_v.set(b.x, 0, -b.s), _q.identity(), _s.set(b.w, b.h, b.d));
      bld.setMatrixAt(i, _m);
      bld.setColorAt(i, b.c);
    });
    bld.castShadow = true;
    bld.receiveShadow = true;
    this.scene.add(bld);

    // Grass: round trees and a few hay bales
    const crowns = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(2.2, 1).translate(0, 4.2, 0),
      new THREE.MeshStandardMaterial({ color: 0x3f7d33, roughness: 0.9, flatShading: true }),
      120,
    );
    const trunks2 = new THREE.InstancedMesh(
      trunkGeo.clone().scale(1, 1.6, 1),
      new THREE.MeshStandardMaterial({ color: 0x6b4a2e }),
      120,
    );
    for (let i = 0; i < 120; i++) {
      const s = 1000 + rnd() * 110;
      const side = rnd() < 0.5 ? -1 : 1;
      const x = side * (HALF_W + 26 + rnd() * 120);
      _m.compose(_v.set(x, terrainY(s, x), -s), _q.identity(), _s.setScalar(0.8 + rnd() * 0.6));
      crowns.setMatrixAt(i, _m);
      trunks2.setMatrixAt(i, _m);
    }
    crowns.castShadow = trunks2.castShadow = true;
    this.scene.add(crowns, trunks2);

    // Airport: terminal, tower, parked jets
    const terminal = new THREE.Mesh(
      new THREE.BoxGeometry(60, 12, 18),
      new THREE.MeshStandardMaterial({ color: 0xdfe4ea, roughness: 0.3, metalness: 0.2 }),
    );
    terminal.position.set(-HALF_W - 40, 6, -1050);
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(58, 6, 18.2),
      new THREE.MeshStandardMaterial({ color: 0x5f89aa, roughness: 0.05, metalness: 0.6 }),
    );
    glass.position.set(-HALF_W - 40, 6.5, -1050);
    const tower = new THREE.Mesh(
      new THREE.CylinderGeometry(2.4, 3.2, 34, 14),
      new THREE.MeshStandardMaterial({ color: 0xe6e6e6 }),
    );
    tower.position.set(HALF_W + 30, 17, -1060);
    const cab = new THREE.Mesh(
      new THREE.CylinderGeometry(6, 4.5, 5, 14),
      new THREE.MeshStandardMaterial({ color: 0x334c63, roughness: 0.05, metalness: 0.7 }),
    );
    cab.position.set(HALF_W + 30, 36, -1060);
    for (const o of [terminal, glass, tower, cab]) {
      o.castShadow = o.receiveShadow = true;
      this.scene.add(o);
    }
    const termSign = signBoard('NOUN AIRPORT', '⌐◨-◨  DEPARTURES', '#0f2a44', '#ffd84d', 22, 4);
    termSign.position.set(-HALF_W - 40, 15, -1040.9);
    this.scene.add(termSign);
    // Windsock-ish runway lights
    const lights = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.18, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8 }),
      80,
    );
    let ln = 0;
    for (let s = 1002; s < 1108; s += 5)
      for (const x of [-HALF_W - 0.6, HALF_W + 0.6]) {
        _m.compose(_v.set(x, 0.2, -s), _q.identity(), _s.setScalar(1));
        lights.setMatrixAt(ln++, _m);
      }
    lights.count = ln;
    this.scene.add(lights);

    // Clouds over the sea
    const puffs = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 2),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 1,
        transparent: true,
        opacity: 0.92,
      }),
      260,
    );
    let pn = 0;
    for (let c = 0; c < 46; c++) {
      const s = 1080 + rnd() * 380;
      const side = rnd() < 0.5 ? -1 : 1;
      const x = rnd() < 0.25 ? (rnd() - 0.5) * 60 : side * (HALF_W + 10 + rnd() * 140);
      const y = rnd() < 0.3 ? CRUISE_Y - 18 - rnd() * 6 : CRUISE_Y + (rnd() - 0.3) * 30;
      const n = 4 + Math.floor(rnd() * 3);
      for (let k = 0; k < n && pn < 260; k++) {
        const r = 3 + rnd() * 4;
        _m.compose(
          _v.set(x + (rnd() - 0.5) * 12, y + rnd() * 2, -(s + (rnd() - 0.5) * 8)),
          _q.identity(),
          _s.set(r * 1.4, r * 0.8, r),
        );
        puffs.setMatrixAt(pn++, _m);
      }
    }
    puffs.count = pn;
    this.scene.add(puffs);

    // Start banner
    const start = signBoard('NOUN RUSH', 'NOUN.WTF · 2026', '#e8372c', '#ffffff', 14, 3.4);
    start.position.set(0, groundY(0, 0) + 9, 4);
    this.scene.add(start);
    for (const x of [-7.4, 7.4]) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 11, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x222222 }),
      );
      post.position.set(x, groundY(0, x) + 5, 4);
      this.scene.add(post);
    }
  }

  /** Gantries over the stalls: the lane you're in picks the ride. */
  private buildGates() {
    const gantry = (s: number, lanes: Ride[], title: string, sub: string) => {
      const y = groundY(s, 0);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x2b2b2b,
        roughness: 0.5,
        metalness: 0.4,
      });
      for (const x of [-HALF_W - 0.6, HALF_W + 0.6]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 9, 0.6), mat);
        post.position.set(x, y + 4.5, -s);
        post.castShadow = true;
        this.scene.add(post);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(TRACK_W + 2, 0.7, 0.7), mat);
      beam.position.set(0, y + 8.6, -s);
      this.scene.add(beam);
      const head = signBoard(title, sub, '#ffd84d', '#111', 12, 2.2);
      head.position.set(0, y + 11, -s + 0.3);
      this.scene.add(head);
      lanes.forEach((ride, i) => {
        const x = laneCentre(lanes, i);
        const w = TRACK_W / lanes.length - 0.6;
        const colors: Record<string, string> = {
          car: '#2a7de1',
          moto: '#e8372c',
          tractor: '#2e8b3a',
          heli: '#ff8a00',
          plane: '#6b3fd6',
        };
        const sign = signBoard(
          RIDES[ride].label,
          '▼ THIS LANE ▼',
          colors[ride] ?? '#333',
          '#fff',
          w,
          2.4,
        );
        sign.position.set(x, y + 7, -s + 0.4);
        this.scene.add(sign);
        // Lane stripe painted on the ground in the ride's colour
        const stripe = new THREE.Mesh(
          new THREE.PlaneGeometry(w, 24).rotateX(-Math.PI / 2),
          new THREE.MeshStandardMaterial({
            color: colors[ride] ?? '#333',
            roughness: 0.8,
            transparent: true,
            opacity: 0.55,
          }),
        );
        stripe.position.set(x, y + 0.04, -(s - 12));
        stripe.receiveShadow = true;
        this.scene.add(stripe);
        // A display model on top of the gantry
        const disp = buildRacer(
          { background: 0, body: 0, accessory: 0, head: 0, glasses: 0 },
          '',
          colors[ride] ?? '#fff',
          false,
        );
        disp.body.visible = false;
        for (const [k, o] of Object.entries(disp.rides)) o.visible = k === ride;
        disp.root.scale.setScalar(ride === 'plane' || ride === 'heli' ? 0.45 : 0.75);
        disp.root.position.set(x, y + 9, -s);
        disp.root.rotation.y = Math.PI * 0.85;
        this.spinnersStatic.push(
          { obj: disp.root, axis: 'y', rate: 0.8 },
          ...disp.spinners.map(sp => ({ ...sp, rate: sp.rate * 6 })),
        );
        this.scene.add(disp.root);
      });
    };
    gantry(VEHICLE_GATE, TOWN_LANES, 'PICK A RIDE', 'drive under your lane');
    gantry(HANGAR_GATE, SKY_LANES, 'PICK A FLIGHT', 'run under your lane');

    // Park gate: rides stop here, everyone runs
    const y = 0;
    const sign = signBoard('PARK IT!', 'rides stop here · RUN', '#1f9d4c', '#fff', 14, 3);
    sign.position.set(0, y + 8, -PARK_GATE + 0.5);
    this.scene.add(sign);
    for (const x of [-7.5, 7.5]) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 8, 0.5),
        new THREE.MeshStandardMaterial({ color: 0xffffff }),
      );
      post.position.set(x, 4, -PARK_GATE);
      this.scene.add(post);
    }
  }

  private buildFinish() {
    const s0 = FINISH_LINE;
    // Finish arch
    const arch = signBoard('FINISH', 'then DANCE', '#111111', '#ffffff', 16, 3.2);
    arch.position.set(0, 10, -s0);
    this.scene.add(arch);
    const check = checkerTexture();
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(TRACK_W + 4, 2).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: check }),
    );
    line.position.set(0, 0.05, -s0);
    this.scene.add(line);
    for (const x of [-8.5, 8.5]) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 12, 0.6),
        new THREE.MeshStandardMaterial({ color: 0xffffff }),
      );
      post.position.set(x, 6, -s0);
      this.scene.add(post);
    }

    // Dance floor tiles
    const nx = 12;
    const nz = 8;
    const tile = 3;
    this.floorN = nx * nz;
    this.floor = new THREE.InstancedMesh(
      new THREE.BoxGeometry(tile - 0.08, 0.2, tile - 0.08),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.25,
        metalness: 0.1,
        emissive: 0xffffff,
        emissiveIntensity: 0.25,
      }),
      this.floorN,
    );
    let n = 0;
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < nz; j++) {
        _m.makeTranslation((i - (nx - 1) / 2) * tile, 0.1, -(s0 + 20 + j * tile));
        this.floor.setMatrixAt(n, _m);
        this.floor.setColorAt(n, _c.setHSL(((i + j) % 6) / 6, 0.7, 0.55));
        n++;
      }
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    // Disco ball + speakers
    const ball = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.4, 2),
      new THREE.MeshStandardMaterial({
        color: 0xdddddd,
        metalness: 1,
        roughness: 0.15,
        flatShading: true,
      }),
    );
    ball.position.set(0, 13, -(s0 + 30));
    this.discoBall = ball;
    const wire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 8),
      new THREE.MeshBasicMaterial({ color: 0x111111 }),
    );
    wire.position.set(0, 18, -(s0 + 30));
    this.scene.add(ball, wire);
    for (const x of [-20, 20]) {
      const spk = new THREE.Mesh(
        new THREE.BoxGeometry(3, 6, 3),
        new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 }),
      );
      spk.position.set(x, 3, -(s0 + 30));
      spk.castShadow = true;
      this.scene.add(spk);
      for (const yy of [1.6, 4.2]) {
        const cone = new THREE.Mesh(
          new THREE.CircleGeometry(0.9, 20),
          new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.4 }),
        );
        cone.position.set(x, yy, -(s0 + 30) + 1.51);
        this.scene.add(cone);
      }
    }
    const party = new THREE.PointLight(0xff66cc, 30, 40, 1.6);
    party.position.set(0, 9, -(s0 + 30));
    this.scene.add(party);

    // Palm trees on the island
    for (const [x, s] of [
      [-28, s0 + 5],
      [27, s0 + 12],
      [-26, s0 + 45],
      [30, s0 + 50],
    ] as const) {
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.5, 9, 8),
        new THREE.MeshStandardMaterial({ color: 0x8a6a45 }),
      );
      trunk.position.set(x, 4.5, -s);
      trunk.rotation.z = 0.15;
      const leaves = new THREE.Mesh(
        new THREE.ConeGeometry(4, 1.6, 7),
        new THREE.MeshStandardMaterial({ color: 0x2f8f3a, flatShading: true }),
      );
      leaves.position.set(x + 0.7, 9.3, -s);
      trunk.castShadow = leaves.castShadow = true;
      this.scene.add(trunk, leaves);
    }
  }

  /** Cones, bins, hurdles, balloons, pickups and rings for this race. */
  private courseRoot: THREE.Group | null = null;
  private rebuildCourseObjects() {
    if (this.courseRoot !== null) this.scene.remove(this.courseRoot);
    const root = new THREE.Group();
    this.courseRoot = root;
    this.obstacleObjs.clear();
    this.fantaObjs = [];
    this.ringObjs = [];

    const coneMat = new THREE.MeshStandardMaterial({ color: 0xff5a1f, roughness: 0.5 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    const binMat = new THREE.MeshStandardMaterial({
      color: 0x3b6e3f,
      roughness: 0.6,
      metalness: 0.3,
    });
    const hurdleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    const hurdleRed = new THREE.MeshStandardMaterial({ color: 0xe8372c, roughness: 0.5 });
    const balloonCols = [0xe8372c, 0xffd84d, 0x2a7de1, 0x2e8b3a, 0xff8a00, 0x9b59d0];

    for (const o of this.course.obstacles) {
      let obj: THREE.Object3D | null = null;
      const y = groundY(o.s, o.x);
      if (o.kind === 'cone') {
        const g = new THREE.Group();
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.85, 14), coneMat);
        c.position.y = 0.45;
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.27, 0.15, 14), whiteMat);
        band.position.y = 0.5;
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.06, 0.75), coneMat);
        g.add(c, band, base);
        obj = g;
      } else if (o.kind === 'bin') {
        const g = new THREE.Group();
        const b = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.1), binMat);
        b.position.y = 0.6;
        const lid = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.12, 1.15), binMat);
        lid.position.y = 1.25;
        g.add(b, lid);
        obj = g;
      } else if (o.kind === 'hurdle') {
        const g = new THREE.Group();
        const bar = new THREE.Mesh(new THREE.BoxGeometry(o.r * 2 - 0.4, 0.22, 0.12), hurdleMat);
        bar.position.y = 0.95;
        const bar2 = new THREE.Mesh(new THREE.BoxGeometry(o.r * 2 - 0.4, 0.12, 0.13), hurdleRed);
        bar2.position.y = 0.95;
        bar2.scale.x = 0.33;
        g.add(bar, bar2);
        for (const sx of [-1, 1]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1, 0.08), hurdleMat);
          leg.position.set(sx * (o.r - 0.3), 0.5, 0);
          const foot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.7), hurdleMat);
          foot.position.set(sx * (o.r - 0.3), 0.03, 0.25);
          g.add(leg, foot);
        }
        obj = g;
      } else if (o.kind === 'balloon') {
        const g = new THREE.Group();
        const col = balloonCols[Math.floor(o.s) % balloonCols.length]!;
        const env = new THREE.Mesh(
          new THREE.SphereGeometry(2.6, 20, 16),
          new THREE.MeshStandardMaterial({ color: col, roughness: 0.6 }),
        );
        env.scale.y = 1.15;
        env.position.y = 4.2;
        const basket = new THREE.Mesh(
          new THREE.BoxGeometry(1, 0.8, 1),
          new THREE.MeshStandardMaterial({ color: 0x8a5a2b }),
        );
        basket.position.y = 0.4;
        g.add(env, basket);
        for (const [dx, dz] of [
          [-0.45, -0.45],
          [0.45, -0.45],
          [-0.45, 0.45],
          [0.45, 0.45],
        ] as const) {
          const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.4), whiteMat);
          rope.position.set(dx * 1.6, 1.9, dz * 1.6);
          g.add(rope);
        }
        g.position.set(o.x, o.y, -o.s);
        obj = g;
      }
      if (obj === null) continue;
      if (o.kind !== 'balloon') obj.position.set(o.x, y, -o.s);
      obj.traverse(m => {
        m.castShadow = true;
        m.receiveShadow = true;
      });
      root.add(obj);
      this.obstacleObjs.set(o, obj);
    }

    // Pickups
    const oranges = this.course.pickups.filter(p => p.kind === 'orange');
    this.orangeIdx = oranges;
    // Instances ignore the child transforms, so bake them into the geometry
    const proto = orange();
    const [bodyM, leafM] = (proto.children as THREE.Mesh[]).map(m => {
      m.updateMatrix();
      return { geo: m.geometry.clone().applyMatrix4(m.matrix), mat: m.material as THREE.Material };
    });
    this.orangeBody = new THREE.InstancedMesh(bodyM!.geo, bodyM!.mat, oranges.length);
    this.orangeLeaf = new THREE.InstancedMesh(leafM!.geo, leafM!.mat, oranges.length);
    this.orangeBody.castShadow = true;
    this.orangeBody.frustumCulled = false;
    this.orangeLeaf.frustumCulled = false;
    root.add(this.orangeBody, this.orangeLeaf);
    for (const p of this.course.pickups) {
      if (p.kind !== 'fanta') continue;
      const can = fantaCan();
      root.add(can);
      this.fantaObjs.push({ p, obj: can });
    }

    // Rings
    const ringGeo = new THREE.TorusGeometry(4, 0.35, 10, 36);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xffd84d,
      emissive: 0xffb300,
      emissiveIntensity: 0.6,
      metalness: 0.5,
      roughness: 0.3,
    });
    for (const g of this.course.rings) {
      const m = new THREE.Mesh(ringGeo, ringMat);
      m.position.set(g.x, g.y, -g.s);
      root.add(m);
      this.ringObjs.push(m);
    }

    this.scene.add(root);
  }

  private smash(r: Racer) {
    // Find the nearest freshly smashed obstacle and send it flying
    for (const [o, obj] of this.obstacleObjs) {
      if (!o.smashed || obj.userData.flying === true) continue;
      if (Math.abs(o.s - r.s) > 3) continue;
      obj.userData.flying = true;
      this.flying.push({
        obj,
        vel: new THREE.Vector3(
          (o.x - r.x) * 3 + (Math.random() - 0.5) * 4,
          8 + Math.random() * 4,
          -r.speed * 0.9,
        ),
        spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10),
        life: 1.6,
      });
    }
  }

  private animateWorld(dt: number) {
    const t = performance.now() / 1000;
    // Flying debris
    this.flying = this.flying.filter(f => {
      f.life -= dt;
      f.vel.y -= 26 * dt;
      f.obj.position.addScaledVector(f.vel, dt);
      f.obj.rotation.x += f.spin.x * dt;
      f.obj.rotation.y += f.spin.y * dt;
      f.obj.rotation.z += f.spin.z * dt;
      if (f.life <= 0) f.obj.visible = false;
      return f.life > 0;
    });

    // Oranges spin + bob (hidden while respawning)
    if (this.orangeBody !== null && this.orangeLeaf !== null) {
      this.orangeIdx.forEach((p, i) => {
        const y = p.y > 3 ? p.y : groundY(p.s, p.x) + p.y;
        const k = p.gone > 0 ? 0 : 1;
        _m.compose(
          _v.set(p.x, y + Math.sin(t * 2.4 + p.s) * 0.15, -p.s),
          _q.setFromEuler(_e.set(0, t * 2 + p.s, 0)),
          _s.setScalar(k),
        );
        this.orangeBody!.setMatrixAt(i, _m);
        this.orangeLeaf!.setMatrixAt(i, _m);
      });
      this.orangeBody.instanceMatrix.needsUpdate = true;
      this.orangeLeaf.instanceMatrix.needsUpdate = true;
    }
    for (const { p, obj } of this.fantaObjs) {
      obj.visible = p.gone <= 0;
      const y = p.y > 3 ? p.y : groundY(p.s, p.x) + p.y;
      obj.position.set(p.x, y + Math.sin(t * 2 + p.s) * 0.2, -p.s);
      obj.rotation.y = t * 2.5 + p.s;
      obj.rotation.z = 0.25;
    }
    for (const r of this.ringObjs) r.rotation.z = t * 0.6;

    // Dance floor: slow, soft colour drift (no strobing)
    if (this.floor !== null) {
      for (let i = 0; i < this.floorN; i++) {
        const h = (i * 0.083 + t * 0.06) % 1;
        const l = 0.45 + 0.12 * Math.sin(t * 1.2 + i * 0.7);
        this.floor.setColorAt(i, _c.setHSL(h, 0.7, l));
      }
      if (this.floor.instanceColor !== null) this.floor.instanceColor.needsUpdate = true;
    }
    if (this.discoBall !== null) this.discoBall.rotation.y = t * 0.6;
    for (const sp of this.spinnersStatic) sp.obj.rotation[sp.axis] += sp.rate * dt;
  }
}

// ── helpers ───────────────────────────────────────────────────────

export function ordinal(n: number) {
  const s = n % 100;
  if (s >= 11 && s <= 13) return 'TH';
  return ['TH', 'ST', 'ND', 'RD'][n % 10] ?? 'TH';
}

/** Tint multiplied over the photo texture of each zone. */
function groundColour(s: number, x: number, y: number, out: THREE.Color) {
  const ax = Math.abs(x);
  const on = ax <= HALF_W;
  const n = (Math.sin(s * 0.07 + x * 0.13) + Math.sin(s * 0.013 - x * 0.04)) * 0.04;
  if (s < 400) {
    const rock = !on && ax > HALF_W + 30 && Math.sin(s * 0.05 + x * 0.07) > 0.55;
    if (rock) return out.setRGB(0.45 + n, 0.45 + n, 0.48 + n);
    return out.setRGB(0.84 + n, 0.87 + n, 0.92 + n);
  }
  if (s < 760) {
    if (on) return out.setRGB(0.75 + n, 0.75 + n, 0.77 + n);
    return out.setRGB(1, 0.98, 0.95);
  }
  if (s < 1000) {
    const stripe = Math.floor(s / 8) % 2 === 0 ? 0.1 : 0;
    if (on) return out.setRGB(0.62 + stripe, 0.95, 0.42 + stripe);
    return out.setRGB(0.58 + n, 0.85 + n, 0.4 + n);
  }
  if (s < 1110 && y > SEA_Y + 1) {
    if (ax <= HALF_W + 1) return out.setRGB(0.92 + n, 0.92 + n, 0.92 + n);
    return out.setRGB(0.6 + n, 0.88 + n, 0.42 + n);
  }
  return out.setRGB(0.95 + n, 0.95 + n, 0.92 + n);
}

function terrainPatch(s0: number, s1: number, xs: number[], mat: THREE.Material) {
  const ds = 3;
  const metres = (mat.userData.metres as number | undefined) ?? 5;
  const rows = Math.ceil((s1 - s0) / ds) + 1;
  const cols = xs.length;
  const pos = new Float32Array(rows * cols * 3);
  const col = new Float32Array(rows * cols * 3);
  const uv = new Float32Array(rows * cols * 2);
  for (let i = 0; i < rows; i++) {
    const s = Math.min(s1, s0 + i * ds);
    for (let j = 0; j < cols; j++) {
      const x = xs[j]!;
      const y = terrainY(s, x);
      const k = i * cols + j;
      pos[k * 3] = x;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = -s;
      groundColour(s, x, y, _c);
      col[k * 3] = _c.r;
      col[k * 3 + 1] = _c.g;
      col[k * 3 + 2] = _c.b;
      uv[k * 2] = x / metres;
      uv[k * 2 + 1] = s / metres;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < rows - 1; i++)
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

function windowTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 64, 128);
  for (let y = 6; y < 128; y += 16)
    for (let x = 6; x < 64; x += 16) {
      ctx.fillStyle = Math.random() < 0.2 ? '#f6e7a6' : '#56708a';
      ctx.fillRect(x, y, 9, 10);
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 4);
  return t;
}

function checkerTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  for (let i = 0; i < 16; i++)
    for (let j = 0; j < 2; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#111' : '#fff';
      ctx.fillRect(i * 16, j * 16, 16, 16);
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

export { ZONES, HANGAR_GATE };
