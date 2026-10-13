// ── Noun Hoops: the view (everything you see and hear) ──────────────────
//
// Reads SimState (hoops/contract.ts) and draws it on the Noun Jersey court:
// live hoops (wobbling boards, shaking rims, verlet nets), the ball, Noun
// ballers posed procedurally on top of the rig's clips, flames when a
// baller is on fire, broadcast / chase cameras with a slow-mo hero zoom and
// shake, procedural audio, and the HUD store HoopsHud renders.
//
// Timing: states are buffered by tick and drawn at a view clock that
// trails the newest one by the arrival interval (smooth at 60 Hz local
// sims and 20 Hz snapshots alike), or exactly at `alpha` between the last
// two when the host gives it. Slow-mo just lets the view clock fall behind
// (and catch up after), so it works the same for every client. Events are
// played when the view clock reaches the state they arrived with.

import type { CharacterAssets } from '../../character/NounCharacter';
import type { Quality } from '../../render/Graphics';

import * as THREE from 'three';

import { inkExcluded, toonify } from '../../render/Toon';
import { njHoopTops } from '../../world/mountain/NounJerseyPark';
import {
  JERSEY_COURT,
  SHOT_SWEET,
  SIM_DT,
  type BallerState,
  type CourtSpec,
  type GameConfig,
  type SimEvent,
  type SimState,
  type TeamId,
} from '../contract';

import { HoopsAudio, type AudioBus } from './audio';
import { BallView } from './ball';
import { BallerView } from './baller';
import { HoopsCamera, type HoopsCameraMode } from './camera';
import { courtMatrix, type CourtToWorld } from './frame';
import { HoopsFx } from './fx';
import { HoopRig } from './hoopRig';
import {
  HudStore,
  type BoxRow,
  type Callout,
  type CalloutTone,
  type HoopsHudState,
} from './hudStore';

export { HoopsHud } from './HoopsHud';
export { jerseyCourtToWorld, courtMatrix, type CourtToWorld } from './frame';
export { createMockStream, type MockStream } from './mock';
export type { HoopsCameraMode } from './camera';
export type { HoopsHudState, HoopsHudLive, BoxRow, Callout } from './hudStore';

export const TEAM_COLORS: [string, string] = ['#d22209', '#2f8bff'];
export const TEAM_NAMES: [string, string] = ['RED NOGS', 'BLUE NOGS'];

export interface HoopsViewOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  assets: CharacterAssets;
  quality: Quality;
  toon: boolean;
  /** DOM layer over the canvas for name tags (World2Page's label layer). */
  labelLayer: HTMLElement;
  /** Court space → world (see frame.ts → jerseyCourtToWorld), or the court's world matrix. */
  courtToWorld: CourtToWorld | THREE.Matrix4;
  /** Game config (names, seed keys, target …); can also be set later with setConfig. */
  config?: GameConfig;
  /** Share the game's AudioContext + bus (SkateAudio: { ctx: audio.ctx, out: audio.master }). */
  audio?: AudioBus | null;
}

interface Queued {
  t: number;
  events: SimEvent[];
}

const DUNK_CALLS = [
  'BOOMSHAKALAKA!',
  'IS IT THE SHOES?!',
  'JAMS IT IN!',
  'RAZZLE DAZZLE!',
  'HE GOT UP THERE!',
];
const BLOCK_CALLS = ['REJECTED!', 'GET THAT OUTTA HERE!', 'NOT IN MY HOUSE!', 'SWATTED!'];
const STEAL_CALLS = ['PICKED HIS POCKET!', 'STOLEN!', 'CLEAN STRIP!'];
const SWISH_CALLS = ['SWISH!', 'NOTHING BUT NET!', 'CASH!'];

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _blendFrom = new THREE.Vector3();
const _m4 = new THREE.Matrix4();

const lerpAngle = (a: number, b: number, k: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};

function cloneState(s: SimState): SimState {
  return {
    ...s,
    score: [s.score[0], s.score[1]],
    players: s.players.map(p => ({ ...p })),
    ball: { ...s.ball },
    events: s.events,
  };
}

function lerpState(a: SimState, b: SimState, k: number, out: SimState): SimState {
  const L = (x: number, y: number) => x + (y - x) * k;
  out.tick = b.tick;
  out.time = L(a.time, b.time);
  out.phase = b.phase;
  out.phaseT = b.phaseT;
  out.score = b.score;
  out.offense = b.offense;
  out.shotClock = L(a.shotClock, b.shotClock);
  out.events = [];
  out.players = b.players.map(pb => {
    const pa = a.players.find(q => q.id === pb.id) ?? pb;
    return {
      ...pb,
      x: L(pa.x, pb.x),
      y: L(pa.y, pb.y),
      z: L(pa.z, pb.z),
      vx: L(pa.vx, pb.vx),
      vz: L(pa.vz, pb.vz),
      yaw: lerpAngle(pa.yaw, pb.yaw, k),
      actionT: pa.action === pb.action ? L(pa.actionT, pb.actionT) : pb.actionT,
      meter: pa.meter !== undefined && pb.meter !== undefined ? L(pa.meter, pb.meter) : pb.meter,
    };
  });
  const ba = a.ball;
  const bb = b.ball;
  out.ball = {
    ...bb,
    x: L(ba.x, bb.x),
    y: L(ba.y, bb.y),
    z: L(ba.z, bb.z),
  };
  return out;
}

export class HoopsView {
  readonly court = new THREE.Group();
  readonly hud: HudStore;
  readonly audio: HoopsAudio;
  readonly cam: HoopsCamera;
  readonly hoops: [HoopRig, HoopRig];
  readonly ball: BallView;
  readonly fx: HoopsFx;
  readonly ballers = new Map<string, BallerView>();
  /** View-clock rate this frame (1 = live, < 1 in slow-mo). Hosts may slow a local sim with it. */
  timeScale = 1;
  config: GameConfig | null = null;
  private o: HoopsViewOptions;
  private spec: CourtSpec;
  private low: boolean;
  private buf: SimState[] = [];
  private viewT = -1;
  private arrivalGap = SIM_DT;
  private alpha: number | undefined;
  private queue: Queued[] = [];
  private autoEvents = true;
  private drawn: SimState | null = null;
  private scratch: SimState | null = null;
  private localId: string | null = null;
  private slowmo = 0;
  private labels = new Map<string, HTMLDivElement>();
  private rings = new Map<string, THREE.Mesh>();
  private ringGeo = new THREE.RingGeometry(0.36, 0.46, 32).rotateX(-Math.PI / 2);
  private box = new Map<string, BoxRow>();
  private lastPass: { from: string; to: string; t: number } | null = null;
  private calloutId = 0;
  private wasHeld = false;
  private ballBlend = new THREE.Vector3();
  private ballHeldAt = new THREE.Vector3();
  private fireAcc = 0;
  private hudAcc = 0;
  private lastScorer: string | null = null;
  private disposed = false;
  private rimsCourt: [THREE.Vector3, THREE.Vector3];
  private time = 0;

  constructor(o: HoopsViewOptions) {
    this.o = o;
    this.spec = o.config?.court ?? JERSEY_COURT;
    this.low = o.quality === 'low';
    this.court.name = 'NounHoops';
    this.court.matrixAutoUpdate = false;
    this.court.matrix.copy(courtMatrix(o.courtToWorld));
    o.scene.add(this.court);
    this.court.updateMatrixWorld(true);

    this.hoops = [new HoopRig(this.spec, -1, this.low), new HoopRig(this.spec, 1, this.low)];
    for (const h of this.hoops) {
      this.court.add(h.group);
      if (o.toon) toonify(h.group);
      for (const x of h.inkless) inkExcluded.add(x);
    }
    this.rimsCourt = [this.hoops[0].rim.clone(), this.hoops[1].rim.clone()];
    this.ball = new BallView(this.spec.ballRadius, this.low);
    this.court.add(this.ball.mesh, this.ball.shadow, this.ball.glow);
    if (o.toon) toonify(this.ball.mesh);
    inkExcluded.add(this.ball.shadow);
    inkExcluded.add(this.ball.glow);
    this.fx = new HoopsFx(this.low);
    this.court.add(this.fx.group);
    inkExcluded.add(this.fx.group);
    this.cam = new HoopsCamera(o.camera, this.spec);
    this.cam.side = this.sunSide();
    this.audio = new HoopsAudio(o.audio ?? null);
    this.hud = new HudStore(this.initialHud());
    if (o.config !== undefined) this.setConfig(o.config);
  }

  /** Sideline on the sun's side (the broadcast camera then sees lit faces). */
  private sunSide(): number {
    let sun: THREE.DirectionalLight | null = null;
    this.o.scene.traverse(x => {
      const l = x as THREE.DirectionalLight;
      if (sun === null && l.isDirectionalLight === true && l.castShadow) sun = l;
    });
    if (sun === null) return -1;
    const l = sun as THREE.DirectionalLight;
    const d = _v.subVectors(l.position, l.target.position);
    // World direction → court space
    d.transformDirection(_m4.copy(this.court.matrixWorld).invert());
    return d.x >= 0 ? 1 : -1;
  }

  private initialHud(): HoopsHudState {
    return {
      phase: 'pregame',
      score: [0, 0],
      offense: 0,
      shotClock: 0,
      shotClockMax: 0,
      target: 21,
      winBy2: false,
      teams: [
        { name: TEAM_NAMES[0], color: TEAM_COLORS[0], players: [] },
        { name: TEAM_NAMES[1], color: TEAM_COLORS[1], players: [] },
      ],
      localId: null,
      callouts: [],
      final: null,
      cameraMode: 'broadcast',
      slowmo: false,
    };
  }

  // ── public API ────────────────────────────────────────────────────────

  setConfig(c: GameConfig) {
    this.config = c;
    this.spec = c.court;
    this.box.clear();
    for (const p of c.players)
      this.box.set(p.id, {
        id: p.id,
        name: p.name,
        team: p.team,
        pts: 0,
        fgm: 0,
        fga: 0,
        tpm: 0,
        tpa: 0,
        reb: 0,
        ast: 0,
        stl: 0,
        blk: 0,
        dnk: 0,
      });
    this.hud.set({
      target: c.target,
      winBy2: c.winBy2,
      shotClockMax: c.shotClock,
      teams: this.teamInfo(null),
    });
  }

  /** Which baller is "you" (camera chase target, meter, YOU tag). */
  setLocal(id: string | null) {
    this.localId = id;
    this.hud.set({ localId: id, teams: this.teamInfo(this.drawn) });
    for (const [bid, r] of this.rings) this.styleRing(r, bid);
  }

  setCameraMode(m: HoopsCameraMode) {
    this.cam.setMode(m);
    this.hud.set({ cameraMode: m });
  }

  /** Unlock / start audio (call from a user gesture when the view owns its context). */
  startAudio() {
    this.audio.start();
  }

  /**
   * Court-space move vector from a screen stick (x right, y up), relative to
   * the current camera: what BallerInput.moveX / moveZ want.
   */
  stickToCourt(sx: number, sy: number): { x: number; z: number } {
    const f = _w.copy(this.cam.look).sub(this.cam.pos).setY(0);
    if (f.lengthSq() < 1e-6) f.set(0, 0, 1);
    f.normalize();
    // Screen right (court space) = forward × up = (−fz, 0, fx)
    const x = f.x * sy - f.z * sx;
    const z = f.z * sy + f.x * sx;
    const m = Math.hypot(x, z);
    const mag = Math.min(1, Math.hypot(sx, sy));
    return m > 1e-6 ? { x: (x / m) * mag, z: (z / m) * mag } : { x: 0, z: 0 };
  }

  /** Queue events to play when the view reaches the latest state (or `atTick`). */
  playEvents(events: SimEvent[], atTick?: number) {
    this.autoEvents = false;
    if (events.length === 0) return;
    const last = this.buf[this.buf.length - 1];
    const t = atTick !== undefined ? atTick * SIM_DT : last !== undefined ? last.tick * SIM_DT : 0;
    this.queue.push({ t, events: [...events] });
  }

  /**
   * Draw the game. `state` = the newest SimState (buffered by tick); `alpha`
   * = how far (0..1) from the previous step to it, when the host runs a
   * fixed-step loop and wants exact interpolation.
   */
  update(dt: number, state: SimState, alpha?: number) {
    if (this.disposed) return;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    this.alpha = alpha;
    this.ingest(state);
    const vdt = this.advanceClock(dt);
    const st = this.sample();
    if (st === null) return;
    this.drawn = st;
    this.releaseEvents();
    this.draw(st, vdt, dt);
  }

  dispose() {
    this.disposed = true;
    for (const o of njHoopTops) o.visible = true;
    for (const b of this.ballers.values()) b.dispose();
    this.ballers.clear();
    for (const l of this.labels.values()) l.remove();
    this.labels.clear();
    for (const h of this.hoops) {
      for (const x of h.inkless) inkExcluded.delete(x);
      h.dispose();
    }
    inkExcluded.delete(this.ball.shadow);
    inkExcluded.delete(this.ball.glow);
    inkExcluded.delete(this.fx.group);
    for (const r of this.rings.values()) {
      inkExcluded.delete(r);
      (r.material as THREE.Material).dispose();
    }
    this.ringGeo.dispose();
    this.ball.dispose();
    this.fx.dispose();
    this.audio.dispose();
    this.court.removeFromParent();
  }

  // ── clock + buffer ────────────────────────────────────────────────────

  private ingest(s: SimState) {
    const last = this.buf[this.buf.length - 1];
    if (last !== undefined && s.tick === last.tick) return;
    if (last !== undefined && s.tick < last.tick) {
      // New game / rewind: start over
      this.buf.length = 0;
      this.queue.length = 0;
      this.viewT = -1;
    }
    if (last !== undefined) {
      const gap = (s.tick - last.tick) * SIM_DT;
      this.arrivalGap += (Math.min(gap, 0.25) - this.arrivalGap) * 0.2;
    }
    this.buf.push(cloneState(s));
    if (this.buf.length > 300) this.buf.splice(0, this.buf.length - 300);
    if (this.autoEvents && s.events.length > 0)
      this.queue.push({ t: s.tick * SIM_DT, events: [...s.events] });
  }

  /** Advance the view clock; returns view seconds elapsed (animation dt). */
  private advanceClock(dt: number) {
    const n = this.buf.length;
    const newest = this.buf[n - 1].tick * SIM_DT;
    let target: number;
    if (this.alpha !== undefined && n >= 2) {
      const prev = this.buf[n - 2].tick * SIM_DT;
      target = prev + (newest - prev) * THREE.MathUtils.clamp(this.alpha, 0, 1);
    } else target = newest - (this.arrivalGap > SIM_DT * 1.5 ? this.arrivalGap * 1.15 : 0);
    const t0 = this.viewT;
    if (this.viewT < 0) this.viewT = target;
    else if (this.slowmo > 0) {
      this.slowmo -= dt;
      this.viewT += dt * (this.low ? 0.4 : 0.3);
    } else {
      const behind = target - this.viewT;
      // Catch up after slow-mo; glide onto the target otherwise
      if (behind > 0.08) this.viewT += dt * (1 + Math.min(1.2, behind * 1.5));
      else this.viewT += dt;
      if (this.viewT > target) this.viewT = target;
      if (target - this.viewT > 3) this.viewT = target - 3;
    }
    this.viewT = Math.max(this.viewT, this.buf[0].tick * SIM_DT);
    const vdt = t0 < 0 ? dt : Math.max(0, this.viewT - t0);
    this.timeScale = dt > 0 ? THREE.MathUtils.clamp(vdt / dt, 0, 3) : 1;
    this.audio.slow = this.slowmo > 0 ? 0.72 : 1;
    return vdt;
  }

  private sample(): SimState | null {
    const b = this.buf;
    if (b.length === 0) return null;
    const t = this.viewT;
    if (b.length === 1 || t <= b[0].tick * SIM_DT) return b[0];
    for (let i = b.length - 1; i > 0; i--) {
      const t0 = b[i - 1].tick * SIM_DT;
      if (t0 <= t) {
        const t1 = b[i].tick * SIM_DT;
        const k = t1 > t0 ? Math.min(1, (t - t0) / (t1 - t0)) : 1;
        this.scratch = lerpState(b[i - 1], b[i], k, this.scratch ?? cloneState(b[i]));
        return this.scratch;
      }
    }
    return b[b.length - 1];
  }

  private releaseEvents() {
    if (this.queue.length === 0) return;
    const keep: Queued[] = [];
    for (const q of this.queue) {
      if (q.t <= this.viewT + 1e-6) for (const e of q.events) this.onEvent(e);
      else keep.push(q);
    }
    this.queue = keep;
  }

  // ── drawing ───────────────────────────────────────────────────────────

  private baller(p: BallerState): BallerView {
    let b = this.ballers.get(p.id);
    if (b !== undefined) return b;
    const cfg = this.config?.players.find(q => q.id === p.id);
    b = new BallerView(p.id, cfg?.seedKey ?? p.id, this.o.assets);
    if (this.o.toon) toonify(b.root);
    b.floodlight(0.2);
    this.court.add(b.root);
    this.ballers.set(p.id, b);
    // Team ring under the feet
    const ring = new THREE.Mesh(
      this.ringGeo,
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.75, depthWrite: false }),
    );
    ring.renderOrder = 2;
    this.court.add(ring);
    inkExcluded.add(ring);
    this.rings.set(p.id, ring);
    this.styleRing(ring, p.id, p.team);
    // Name tag
    const label = document.createElement('div');
    label.className = 'w2-nametag w2-hoops-tag';
    this.o.labelLayer.appendChild(label);
    this.labels.set(p.id, label);
    return b;
  }

  private styleRing(r: THREE.Mesh, id: string, team?: TeamId) {
    const t = team ?? this.drawn?.players.find(p => p.id === id)?.team ?? 0;
    const m = r.material as THREE.MeshBasicMaterial;
    m.color.set(id === this.localId ? '#ffd400' : TEAM_COLORS[t]);
    m.opacity = id === this.localId ? 0.95 : 0.7;
  }

  private draw(st: SimState, vdt: number, dt: number) {
    const ballR = this.spec.ballRadius;
    // Static hoop tops of the park: hidden while we draw live ones
    for (const o of njHoopTops) o.visible = false;
    const seen = new Set<string>();
    const frame = { dt: vdt, time: this.time, rims: this.rimsCourt, ball: st.ball, ballR };
    let holder: BallerView | null = null;
    for (const p of st.players) {
      seen.add(p.id);
      const b = this.baller(p);
      b.update(p, frame);
      if (b.bounced) this.audio.bounce(0.45);
      if (b.squeaked) this.audio.squeak(0.8);
      if (p.hasBall && b.holding && st.ball.holder === p.id) holder = b;
      const ring = this.rings.get(p.id)!;
      ring.position.set(p.x, 0.04, p.z);
      const air = Math.max(0, p.y);
      ring.scale.setScalar(1 + air * 0.25);
      (ring.material as THREE.MeshBasicMaterial).opacity =
        (p.id === this.localId ? 0.95 : 0.7) / (1 + air);
    }
    for (const [id, b] of this.ballers)
      if (!seen.has(id)) {
        b.dispose();
        this.ballers.delete(id);
        this.labels.get(id)?.remove();
        this.labels.delete(id);
        const r = this.rings.get(id);
        if (r !== undefined) {
          r.removeFromParent();
          inkExcluded.delete(r);
          (r.material as THREE.Material).dispose();
          this.rings.delete(id);
        }
      }

    // ── ball ──
    const bs = st.ball;
    const held = holder !== null;
    const target = held ? holder!.ballAt : _v.set(bs.x, Math.max(ballR, bs.y), bs.z);
    if (held !== this.wasHeld) {
      // Hand-off between hand pose and sim position: blend out the jump
      this.ballBlend.copy(this.ball.pos).sub(target);
      if (this.ballBlend.lengthSq() > 4) this.ballBlend.set(0, 0, 0);
      this.wasHeld = held;
    }
    this.ballBlend.multiplyScalar(Math.exp(-14 * Math.max(vdt, 1e-4)));
    _blendFrom.copy(target).add(this.ballBlend);
    if (held) this.ballHeldAt.copy(_blendFrom);
    let spin: { x: number; y: number; z: number } | undefined;
    if (!held) spin = { x: bs.sx, y: bs.sy, z: bs.sz };
    else spin = { x: (holder!.s?.vz ?? 0) * 3, y: 0, z: -(holder!.s?.vx ?? 0) * 3 };
    if (!held && bs.y <= ballR + 0.02 && Math.hypot(bs.vx, bs.vz) > 0.1)
      spin = { x: bs.vz / ballR, y: 0, z: -bs.vx / ballR };
    this.ball.set(_blendFrom, vdt, spin);

    // ── fire ──
    const fireIds = new Set(st.players.filter(p => p.onFire).map(p => p.id));
    const ballHot =
      (bs.holder !== null && fireIds.has(bs.holder)) ||
      (bs.shooter !== null && fireIds.has(bs.shooter));
    this.ball.hot += ((ballHot ? 1 : 0) - this.ball.hot) * (1 - Math.exp(-6 * dt));
    for (const h of this.hoops) h.heat = Math.max(0, h.heat - vdt * 0.4);
    this.fireAcc += vdt * (this.low ? 22 : 70);
    while (this.fireAcc >= 1) {
      this.fireAcc -= 1;
      if (ballHot) {
        const v = this.ball.vel;
        this.fx.flame(this.ball.pos.x, this.ball.pos.y, this.ball.pos.z, 1.1, -v.x, -v.z);
      }
      for (const id of fireIds) {
        const b = this.ballers.get(id);
        if (b === undefined || Math.random() > (this.low ? 0.5 : 0.7)) continue;
        const side = Math.random() < 0.5 ? 'L' : 'R';
        b.handCourt(side, _w);
        this.fx.flame(_w.x, _w.y, _w.z, 0.9);
        if (!this.low && Math.random() < 0.35) {
          // The big head burns too
          const hx = (Math.random() - 0.5) * 1.0;
          const hz = (Math.random() - 0.5) * 0.8;
          b.toCourt(_v.set(hx, b.headTop - 0.05, hz), _w);
          this.fx.flame(_w.x, _w.y, _w.z, 1.3);
        }
        if (!this.low && Math.random() < 0.5) {
          // Feet scorch the floor
          const s = b.s!;
          this.fx.flame(
            s.x + (Math.random() - 0.5) * 0.3,
            s.y + 0.08,
            s.z + (Math.random() - 0.5) * 0.3,
            0.8,
          );
        }
      }
    }
    this.fx.update(vdt);
    const h = this.o.renderer.domElement.clientHeight || 720;
    this.fx.setViewport(h * this.o.renderer.getPixelRatio(), this.o.camera.fov);

    // ── hoops: hang on the rim, nets vs. ball ──
    for (const hr of this.hoops) {
      let hang = 0;
      for (const b of this.ballers.values())
        if (b.hang > 0.01 && b.root.position.distanceTo(hr.rim) < 2.6)
          hang = Math.max(hang, b.hang);
      hr.setHang(hang);
      _w.copy(this.cam.pos);
      hr.update(vdt, this.ball.pos, ballR, _w);
    }

    // ── camera ──
    const me = this.localId !== null ? st.players.find(p => p.id === this.localId) : undefined;
    const rim = this.rimInPlay(st);
    this.cam.update(
      dt,
      {
        ball: this.ball.pos,
        me: me !== undefined ? _w.set(me.x, me.y, me.z) : null,
        meYaw: me?.yaw ?? 0,
        rim,
        halfCourt: this.config?.halfCourt ?? true,
      },
      this.court.matrixWorld,
    );
    this.o.camera.updateMatrixWorld();

    // ── tags, meter, HUD ──
    this.drawLabels(st);
    this.drawMeter(me);
    this.hudAcc += dt;
    const hs = this.hud.state;
    const clock = Math.ceil(st.shotClock);
    if (
      this.hudAcc > 0.25 ||
      hs.phase !== st.phase ||
      hs.score[0] !== st.score[0] ||
      hs.score[1] !== st.score[1] ||
      Math.ceil(hs.shotClock) !== clock
    ) {
      this.hudAcc = 0;
      const now = performance.now();
      this.hud.set({
        phase: st.phase,
        score: [st.score[0], st.score[1]],
        offense: st.offense,
        shotClock: st.shotClock,
        teams: this.teamInfo(st),
        callouts: hs.callouts.filter(c => now - c.at < (c.size === 2 ? 2600 : 2000)),
        slowmo: this.slowmo > 0,
      });
    }
    this.audio.setHype(
      st.phase === 'live' && st.shotClock < 5 && st.shotClock > 0
        ? 0.8
        : st.phase === 'final'
          ? 1
          : 0.3,
    );
  }

  private rimInPlay(st: SimState) {
    const b = st.ball;
    const r = this.rimsCourt;
    if (this.config?.halfCourt !== false) {
      // Half court: the basket the game is played at (nearest the action)
      return Math.abs(b.z - r[0].z) < Math.abs(b.z - r[1].z) ? r[0] : r[1];
    }
    return b.z < 0 ? r[0] : r[1];
  }

  private project(x: number, y: number, z: number, out: THREE.Vector3) {
    out.set(x, y, z).applyMatrix4(this.court.matrixWorld).project(this.o.camera);
    const el = this.o.renderer.domElement;
    const w = el.clientWidth || 1280;
    const h = el.clientHeight || 720;
    const vis = out.z < 1 && out.z > -1 && Math.abs(out.x) < 1.15 && Math.abs(out.y) < 1.15;
    out.set(((out.x + 1) / 2) * w, ((1 - out.y) / 2) * h, vis ? 1 : 0);
    return out;
  }

  private drawLabels(st: SimState) {
    for (const p of st.players) {
      const el = this.labels.get(p.id);
      if (el === undefined) continue;
      const s = this.project(p.x, p.y + 2.35, p.z, _v);
      if (s.z === 0) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = 'block';
      el.style.transform = `translate(-50%, -100%) translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
      const cfg = this.config?.players.find(q => q.id === p.id);
      const name = p.id === this.localId ? 'YOU' : (cfg?.name ?? p.id);
      const key = `${name}|${p.team}|${p.onFire ? 1 : 0}|${p.id === this.localId ? 1 : 0}`;
      if (el.dataset.k !== key) {
        el.dataset.k = key;
        const col = p.id === this.localId ? '#ffd400' : TEAM_COLORS[p.team];
        el.innerHTML = `<span style="border:2px solid ${col};font-weight:800;${p.id === this.localId ? 'color:#ffd400' : ''}">${p.onFire ? '🔥 ' : ''}${escapeHtml(name)}</span>`;
      }
    }
  }

  private drawMeter(me: BallerState | undefined) {
    const m = this.hud.live.meter;
    m.sweet = SHOT_SWEET;
    if (
      me === undefined ||
      me.meter === undefined ||
      !(me.action === 'gather' || me.action === 'jumpshot' || me.action === 'layup')
    ) {
      m.visible = false;
      return;
    }
    const s = this.project(me.x, me.y + 1.3, me.z, _v);
    m.visible = s.z === 1;
    m.x = s.x;
    m.y = s.y;
    m.value = me.meter;
  }

  private teamInfo(st: SimState | null): HoopsHudState['teams'] {
    const players = this.config?.players ?? [];
    const fire = new Set((st?.players ?? []).filter(p => p.onFire).map(p => p.id));
    const mk = (t: TeamId) => ({
      name: TEAM_NAMES[t],
      color: TEAM_COLORS[t],
      players: players
        .filter(p => p.team === t)
        .map(p => ({
          id: p.id,
          name: p.name,
          onFire: fire.has(p.id),
          local: p.id === this.localId,
        })),
    });
    return [mk(0), mk(1)];
  }

  // ── events ────────────────────────────────────────────────────────────

  private callout(text: string, tone: CalloutTone, size: 0 | 1 | 2 = 1, sub?: string) {
    const c: Callout = { id: ++this.calloutId, text, sub, tone, size, at: performance.now() };
    const keep = this.hud.state.callouts.filter(x => c.at - x.at < 1600).slice(-2);
    this.hud.set({ callouts: [...keep, c] });
  }

  private row(id: string): BoxRow | null {
    let r = this.box.get(id);
    if (r === undefined) {
      const p = this.drawn?.players.find(q => q.id === id);
      if (p === undefined) return null;
      r = {
        id,
        name: id,
        team: p.team,
        pts: 0,
        fgm: 0,
        fga: 0,
        tpm: 0,
        tpa: 0,
        reb: 0,
        ast: 0,
        stl: 0,
        blk: 0,
        dnk: 0,
      };
      this.box.set(id, r);
    }
    return r;
  }

  private isLong(value: number) {
    return this.config?.nbaScoring === false ? value >= 2 : value >= 3;
  }

  private nearestHoop(): HoopRig {
    const b = this.ball.pos;
    const [a, c] = this.hoops;
    return b.distanceToSquared(a.rim) < b.distanceToSquared(c.rim) ? a : c;
  }

  private onFire(id: string | null) {
    return id !== null && this.drawn?.players.some(p => p.id === id && p.onFire) === true;
  }

  private nameOf(id: string) {
    if (id === this.localId) return 'YOU';
    return (this.config?.players.find(p => p.id === id)?.name ?? id).toUpperCase();
  }

  private onEvent(e: SimEvent) {
    const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
    switch (e.type) {
      case 'dribble':
        break;
      case 'shot': {
        const r = this.row(e.id);
        if (r !== null) {
          r.fga++;
          if (this.isLong(e.value)) r.tpa++;
        }
        if (e.id === this.localId) {
          this.hud.live.meter.result = e.quality;
          this.hud.live.meter.resultAt = performance.now();
        }
        if (e.kind === 'dunk' || e.kind === 'alleyoop') {
          // Slow-mo + hero zoom on the rim it's going down on
          this.slowmo = this.low ? 0.9 : 1.25;
          const p = this.drawn?.players.find(q => q.id === e.id);
          const rim =
            p !== undefined
              ? Math.abs(p.z - this.rimsCourt[0].z) < Math.abs(p.z - this.rimsCourt[1].z)
                ? this.rimsCourt[0]
                : this.rimsCourt[1]
              : this.rimInPlay(this.drawn!);
          this.cam.heroZoom(_w.copy(rim).add(_v.set(0, -0.4, 0)), 2.6);
          this.audio.setHype(1);
          if (e.kind === 'alleyoop') this.callout('ALLEY-OOP!', 'gold', 1);
        }
        break;
      }
      case 'score': {
        const r = this.row(e.id);
        if (r !== null) {
          r.pts += e.points;
          r.fgm++;
          if (this.isLong(e.points)) r.tpm++;
          if (e.how === 'dunk' || e.how === 'alleyoop') r.dnk++;
        }
        if (
          this.lastPass !== null &&
          this.lastPass.to === e.id &&
          this.time - this.lastPass.t < 5
        ) {
          const a = this.row(this.lastPass.from);
          if (a !== null) a.ast++;
        }
        this.lastPass = null;
        this.lastScorer = e.id;
        const fire = this.onFire(e.id);
        const hoop = this.nearestHoop();
        if (e.how === 'dunk' || e.how === 'alleyoop') {
          hoop.onDunk(1);
          this.cam.shake(1.1);
          this.fx.sparks(hoop.rim.x, hoop.rim.y, hoop.rim.z, 40, 1.2);
          this.audio.rim(1);
          this.audio.board(1);
          this.audio.crowd('roar', 1);
          this.callout(pick(DUNK_CALLS), fire ? 'fire' : 'gold', 2, this.nameOf(e.id));
        } else {
          hoop.onSwish(e.how === 'swish' ? 1 : 0.7, fire);
          this.audio.swish(fire);
          this.audio.crowd(this.isLong(e.points) || fire ? 'roar' : 'cheer', 0.9);
          if (this.isLong(e.points))
            this.callout('FROM DOWNTOWN!', fire ? 'fire' : 'gold', 2, this.nameOf(e.id));
          else if (e.how === 'swish') this.callout(pick(SWISH_CALLS), fire ? 'fire' : 'white', 1);
          else if (e.how === 'bank') this.callout('OFF THE GLASS!', 'white', 1);
          else if (e.how === 'layup') this.callout('KISSED IT IN', 'white', 1);
          else this.callout('BUCKET!', 'white', 1);
        }
        if (fire) {
          hoop.heat = 1;
          this.fx.netBurn(hoop.rim.x, hoop.rim.y - 0.1, hoop.rim.z);
          hoop.net.burn = 1;
        }
        // Game winner: slow it down
        const c = this.config;
        const after = this.drawn?.score;
        if (c !== null && after !== undefined) {
          const t = e.team;
          const lead = after[t] - after[1 - t];
          if (after[t] >= c.target && (!c.winBy2 || lead >= 2)) {
            this.slowmo = Math.max(this.slowmo, this.low ? 0.8 : 1.4);
            this.cam.heroZoom(_w.copy(hoop.rim).add(_v.set(0, -0.6, 0)), 3);
          }
        }
        break;
      }
      case 'miss':
        this.audio.crowd('ooh', 0.6);
        break;
      case 'rim':
        this.nearestHoop().onRim(e.strength);
        this.audio.rim(e.strength);
        if (this.ball.hot > 0.3)
          this.fx.sparks(this.ball.pos.x, this.ball.pos.y, this.ball.pos.z, 14, 0.7);
        break;
      case 'backboard':
        this.nearestHoop().onBoard(e.strength);
        this.audio.board(e.strength);
        break;
      case 'bounce':
        this.audio.bounce(e.strength);
        break;
      case 'net':
        this.nearestHoop().onSwish(0.8, this.ball.hot > 0.3);
        break;
      case 'pass':
        this.lastPass = { from: e.from, to: e.to, t: this.time };
        this.audio.squeak(0.5);
        break;
      case 'steal': {
        const r = this.row(e.id);
        if (r !== null) r.stl++;
        this.callout(pick(STEAL_CALLS), 'blue', 1, this.nameOf(e.id));
        this.audio.crowd('ooh', 0.8);
        this.audio.squeak(1);
        break;
      }
      case 'block': {
        const r = this.row(e.id);
        if (r !== null) r.blk++;
        this.callout(pick(BLOCK_CALLS), 'red', 2, this.nameOf(e.id));
        this.cam.shake(0.6);
        this.fx.sparks(this.ball.pos.x, this.ball.pos.y, this.ball.pos.z, 18, 0.8);
        this.audio.crowd('roar', 0.8);
        this.audio.board(0.5);
        break;
      }
      case 'rebound': {
        const r = this.row(e.id);
        if (r !== null) r.reb++;
        if (e.offensive) this.callout('OFFENSIVE BOARD', 'white', 0);
        break;
      }
      case 'crossover':
        if (e.ankles) {
          this.callout('ANKLES BROKEN!', 'gold', 2, this.nameOf(e.id));
          this.audio.crowd('roar', 0.9);
        }
        this.audio.squeak(1);
        break;
      case 'onFire':
        this.callout(
          e.id === this.localId ? "YOU'RE ON FIRE!" : "HE'S ON FIRE!",
          'fire',
          2,
          this.nameOf(e.id),
        );
        this.audio.crowd('roar', 1);
        this.audio.swish(true);
        break;
      case 'fireOut':
        this.callout('FIRE’S OUT', 'white', 0, this.nameOf(e.id));
        break;
      case 'shotClock':
        this.audio.buzzer(0.6);
        this.callout('SHOT CLOCK!', 'red', 1);
        break;
      case 'outOfBounds':
        this.callout('OUT OF BOUNDS', 'white', 0);
        break;
      case 'checkball':
        this.callout('CHECK BALL', 'white', 0, e.team === 0 ? TEAM_NAMES[0] : TEAM_NAMES[1]);
        break;
      case 'final': {
        this.audio.buzzer(1.3);
        this.audio.crowd('roar', 1);
        const hoop = this.nearestHoop();
        this.fx.confettiAt(hoop.rim.x, hoop.rim.y + 2, hoop.rim.z * 0.6, 220);
        const rows = [...this.box.values()].sort((a, b) => b.pts - a.pts);
        const mvp = rows.find(r => r.team === e.winner)?.id ?? null;
        this.hud.set({
          final: { winner: e.winner, score: e.score, box: rows.map(r => ({ ...r })), mvp },
        });
        if (this.lastScorer !== null && !this.cam.zooming) {
          this.slowmo = Math.max(this.slowmo, this.low ? 0.6 : 1);
        }
        break;
      }
    }
  }
}

function escapeHtml(s: string) {
  return s.replace(
    /["&'<>]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
