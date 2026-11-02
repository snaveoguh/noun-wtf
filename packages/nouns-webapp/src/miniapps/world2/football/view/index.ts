// ── Noun Football: the match view (everything you see and hear) ─────────
//
// createFootballView(opts, deps) → a FootballViewApi (contract.ts) that
// FootballMode lazy-loads (`const viewMod = () => import('../view')`).
// It draws SimStates on the stadium another part builds (StadiumViewApi,
// view/stadium/StadiumView.ts; view/stubStadium.ts stands in for it):
//
//   footballers  Noun riders in kit (footballer.ts), posed for every
//                Action through breakdance's PoseDriver (poses.ts), built
//                one a frame, LOD'd by distance + frustum (lod.ts)
//   ball         ball.ts (panels, spin, blob shadow, a trail on hard shots)
//   cameras      camera.ts / camFraming.ts: broadcast, player, high,
//                cinematic (walk-out, celebrations, penalties), replay
//   replays      replay.ts: the last 10 s recorded in draw(); goal
//                replays at 0.5× from two angles, then back to live
//   audio        audio.ts (crowd bed + danger swell, roar, chants,
//                whistles, kicks, net, woodwork, bounces)
//   HUD          hudStore.ts → FootballHud.tsx (scoreboard, radar, the
//                controlled player's tag + power bar, banners, hints)
//
// Drives the stadium: setPitch / setKits on a new match, board() when the
// score or clock text changes, crowd(excite, end) every frame from the
// danger + goals, netHit() on net events.

import type { CharacterAssets } from '../../character/NounCharacter';
import type {
  CamMode,
  FootballEvent,
  FootballViewApi,
  FootballViewOptions,
  MatchConfig,
  PitchSpec,
  PlayerState,
  SimState,
  StadiumViewApi,
  TeamId,
  TeamKit,
} from '../contract';

import * as THREE from 'three';

import { inkExcluded } from '../../render/Toon';
import { PITCH_11 } from '../contract';

import { FootballAudio } from './audio';
import { blobTexture, BallView, releaseBlob } from './ball';
import { FootballCamera } from './camera';
import { FootballerView, KitBank } from './footballer';
import {
  addedChip,
  formatClock,
  hexCss,
  inkOn,
  minuteLabel,
  periodEnd,
  periodLabel,
  setPieceHint,
} from './hudFormat';
import {
  HudStore,
  type Banner,
  type BannerKind,
  type FootballHudState,
  type HudTeam,
} from './hudStore';
import { LOD_HIGH, LOD_LOW, posesThisFrame, tierOf } from './lod';
import { holdsBall } from './poses';
import { blankState, lerpState, ReplayBuffer, ReplayDirector } from './replay';

export { FootballHud, type FootballHudProps } from './FootballHud';
export { HudStore } from './hudStore';
export type { FootballHudState, HudLive, Banner } from './hudStore';
export { StubStadium } from './stubStadium';
export { createMockMatch, createPoseSheet, mockConfig, MOCK_KITS, type MockMatch } from './mock';
export type { ShotName } from './camera';

export interface FootballViewDeps {
  scene: THREE.Scene;
  /** The stadium shell (view/stadium StadiumView, or StubStadium). Added to the scene if it has no parent. */
  stadium: StadiumViewApi;
  /** Character rig + clips (Game.assets). Null: no footballers (tests). */
  assets: CharacterAssets | null;
  toon: boolean;
  /** Real shadows for footballers (high quality); off: instanced blob shadows. */
  shadows: boolean;
  /** The game's AudioContext + master bus (pool's pattern: g.audio.ctx / g.audio.master). */
  audio?: () => AudioContext | null;
  audioOut?: () => AudioNode | null;
  /** The canvas (HUD tag projection size). Defaults to the window. */
  canvas?: HTMLElement | null;
  /** Precompile a new object's shaders while it's hidden (render/shaderWarm warmHidden + gfx.asDrawn). */
  warm?: (o: THREE.Object3D) => Promise<void>;
  /** Main stand side (the TV gantry): −1 = the pitch's −x touchline (default). */
  stand?: -1 | 1;
  /** Play a goal replay by itself 2.5 s after a goal (default true). */
  autoReplay?: boolean;
  reduceMotion?: boolean;
  /** dispose() frees the stadium too (default true). */
  ownStadium?: boolean;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _frustum = new THREE.Frustum();
const _sphere = new THREE.Sphere();

/** Real seconds of play before a goal a replay shows. */
export const REPLAY_SECONDS = 3.2;
/** Seconds into the celebration the auto replay starts. */
export const REPLAY_DELAY = 2.6;

const kitTeam = (k: TeamKit): HudTeam => ({
  name: k.name,
  short: k.short,
  shirt: hexCss(k.shirt),
  shorts: hexCss(k.shorts),
  ink: inkOn(k.shirt),
});

const BANNER_MS: Record<BannerKind, number> = {
  goal: 3600,
  yellow: 2200,
  red: 2600,
  offside: 1800,
  half: 3000,
  full: 4200,
  penalty: 2400,
  save: 1600,
  woodwork: 1800,
  kickoff: 1600,
};

export class FootballView implements FootballViewApi {
  readonly root = new THREE.Group();
  readonly hud: HudStore;
  readonly audio: FootballAudio;
  readonly cam: FootballCamera;
  readonly footballers = new Map<string, FootballerView>();
  /** Per-frame costs (ms, smoothed) for ?perf numbers + tests. */
  readonly stats = { drawMs: 0, poseMs: 0, posed: 0, visible: 0, frames: 0 };
  config: MatchConfig | null = null;
  private pitch: PitchSpec = PITCH_11;
  private ball: BallView;
  private bank: KitBank;
  private queue: { f: MatchConfig['players'][number]; kit: TeamKit }[] = [];
  private lastBuild = -Infinity;
  private buf = new ReplayBuffer(10);
  private director = new ReplayDirector();
  private shown: SimState = blankState();
  private scratch: SimState = blankState();
  private replayState: SimState = blankState();
  private prevMode: CamMode = 'broadcast';
  private replayAt = -1;
  private goalTime = -1;
  private goalZ = 0;
  private lastScorer: string | null = null;
  private excite = 0;
  private exciteEnd: TeamId | null = null;
  private danger = 0;
  private time = 0;
  private frame = 0;
  private hudAcc = 1;
  private boardKey = '';
  private bannerId = 0;
  private local: string | null = null;
  private blobs: THREE.InstancedMesh | null = null;
  private eye = new THREE.Vector3(0, 30, -60);
  private viewProj = new THREE.Matrix4();
  private haveCam = false;
  private disposed = false;
  private warmed = false;
  private live = false;

  constructor(
    readonly opts: FootballViewOptions,
    readonly deps: FootballViewDeps,
  ) {
    const f = opts.frame;
    this.root.name = 'football-view';
    this.root.position.set(f.x, f.y, f.z);
    this.root.rotation.y = f.yaw;
    deps.scene.add(this.root);
    if (deps.stadium.root.parent === null) deps.scene.add(deps.stadium.root);
    this.bank = new KitBank(deps.toon);
    this.ball = new BallView(PITCH_11.ballRadius, opts.low);
    this.ball.group.visible = false;
    this.root.add(this.ball.group);
    inkExcluded.add(this.ball.shadow);
    inkExcluded.add(this.ball.trail);
    this.cam = new FootballCamera(PITCH_11, deps.stand ?? -1);
    this.cam.reduceMotion = deps.reduceMotion === true;
    this.audio = new FootballAudio(deps.audio ?? (() => null), deps.audioOut ?? (() => null));
    this.hud = new HudStore(this.initialHud());
    if (!deps.shadows) {
      const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        map: blobTexture(),
        transparent: true,
        depthWrite: false,
        name: 'fb-blobs',
      });
      this.blobs = new THREE.InstancedMesh(geo, mat, 32);
      this.blobs.count = 0;
      this.blobs.renderOrder = 1;
      this.blobs.frustumCulled = false;
      this.root.add(this.blobs);
      inkExcluded.add(this.blobs);
    }
  }

  private initialHud(): FootballHudState {
    return {
      teams: [
        { name: 'HOME', short: 'HOM', shirt: '#d22209', shorts: '#fff', ink: '#fff' },
        { name: 'AWAY', short: 'AWY', shirt: '#2f8bff', shorts: '#fff', ink: '#fff' },
      ],
      score: [0, 0],
      clock: '00:00',
      extra: null,
      added: null,
      period: '1ST',
      phase: 'pregame',
      poss: 0,
      banners: [],
      hint: null,
      shootout: null,
      replay: false,
      wipe: 0,
      local: null,
      localTeam: null,
    };
  }

  // ── building ──────────────────────────────────────────────────────────

  get built() {
    return this.deps.stadium.built;
  }

  get pending() {
    return this.queue.length;
  }

  get replaying() {
    return this.director.active;
  }

  /** One slice: the stadium first, then one footballer (a Noun build is a hitch). */
  buildStep(): boolean {
    if (!this.deps.stadium.built) {
      this.deps.stadium.buildStep();
      return false;
    }
    this.buildOne();
    return this.queue.length === 0;
  }

  /** Build the next footballer, at most one per ~frame (draw() calls this too). */
  private buildOne() {
    if (this.queue.length === 0 || this.deps.assets === null) {
      if (this.deps.assets === null) this.queue.length = 0;
      return;
    }
    const now = performance.now();
    if (now - this.lastBuild < 12) return;
    this.lastBuild = now;
    const { f, kit } = this.queue.shift()!;
    const fb = new FootballerView(
      f,
      kit,
      this.deps.assets,
      this.bank,
      this.deps.toon,
      this.deps.shadows,
    );
    this.footballers.set(f.id, fb);
    this.root.add(fb.root);
    // The first Noun of a match: link its programs hidden (the rest share them)
    if (!this.warmed && this.deps.warm !== undefined) {
      this.warmed = true;
      void this.deps.warm(fb.root);
    }
  }

  setLocal(human: string | null) {
    this.local = human;
  }

  setMatch(config: MatchConfig) {
    this.clearMatch();
    this.config = config;
    this.pitch = config.pitch;
    this.deps.stadium.setPitch(config.pitch);
    this.deps.stadium.setKits(config.kits);
    this.cam.setPitch(config.pitch);
    this.cam.cut();
    if (this.local === null) this.local = config.humans[0]?.id ?? null;
    const localTeam = config.humans.find(h => h.id === this.local)?.team ?? null;
    this.hud.set({
      teams: [kitTeam(config.kits[0]), kitTeam(config.kits[1])],
      score: [0, 0],
      banners: [],
      replay: false,
      local: null,
      localTeam,
    });
    // Keepers first (the contract lists them first), then the rest alternating sides
    const t0 = config.players.filter(p => p.team === 0);
    const t1 = config.players.filter(p => p.team === 1);
    const order: MatchConfig['players'] = [];
    for (let i = 0; i < Math.max(t0.length, t1.length); i++) {
      if (t0[i] !== undefined) order.push(t0[i]);
      if (t1[i] !== undefined) order.push(t1[i]);
    }
    this.queue = order.map(f => ({ f, kit: config.kits[f.team] }));
    this.ball.group.visible = true;
    this.buf.clear();
    this.warmed = false;
  }

  clearMatch() {
    for (const fb of this.footballers.values()) {
      fb.root.removeFromParent();
      fb.dispose();
    }
    this.footballers.clear();
    this.queue = [];
    this.ball.group.visible = false;
    if (this.blobs !== null) this.blobs.count = 0;
    this.director.skip();
    this.buf.clear();
    this.hud.live.tag.visible = false;
    this.hud.live.power.visible = false;
    this.hud.live.radar.n = 0;
  }

  setLive(on: boolean) {
    this.live = on;
    this.deps.stadium.setLive(on);
    if (on) this.audio.start();
  }

  // ── drawing ───────────────────────────────────────────────────────────

  draw(prev: SimState, next: SimState, alpha: number, dt: number) {
    if (this.disposed) return;
    const t0 = performance.now();
    this.time += dt;
    this.frame++;
    this.buildOne();
    // Record (live only) and pick what to show
    if (!this.director.active) this.buf.push(next);
    if (this.replayAt >= 0 && this.time >= this.replayAt) {
      this.replayAt = -1;
      if (next.phase === 'goal' || next.phase === 'kickoff') this.replay(REPLAY_SECONDS);
    }
    let s: SimState;
    if (this.director.active) {
      if (this.director.update(dt)) {
        this.hud.set({ wipe: this.hud.state.wipe + 1 });
        this.cam.cut();
      }
      const seg = this.director.segment;
      if (seg === null || next.phase === 'live') {
        this.stopReplay();
        s = lerpState(prev, next, alpha, this.scratch);
      } else {
        this.cam.replayAngle = seg.angle;
        this.cam.replayGoalZ = this.goalZ;
        s = this.buf.sample(this.director.t, this.replayState) ?? next;
      }
    } else s = lerpState(prev, next, alpha, this.scratch);
    this.shown = s;
    this.drawPlayers(s, dt);
    this.drawBall(s, dt);
    this.updateCrowd(s, dt);
    this.hudAcc += dt;
    if (this.hudAcc > 0.25) {
      this.hudAcc = 0;
      this.updateHud(next);
    }
    this.updateRadar(s);
    const ms = performance.now() - t0;
    this.stats.drawMs += (ms - this.stats.drawMs) * 0.1;
    this.stats.frames++;
  }

  private drawPlayers(s: SimState, dt: number) {
    const cfg = this.opts.low ? LOD_LOW : LOD_HIGH;
    const local = this.local;
    let posed = 0;
    let visible = 0;
    let poseMs = 0;
    const mat = _m.multiplyMatrices(this.viewProj, this.root.matrixWorld);
    _frustum.setFromProjectionMatrix(mat);
    let blob = 0;
    const blobs = this.blobs;
    for (let i = 0; i < s.players.length; i++) {
      const p = s.players[i];
      const fb = this.footballers.get(p.id);
      if (fb === undefined) continue;
      const d = Math.hypot(p.x - this.eye.x, p.y + 1 - this.eye.y, p.z - this.eye.z);
      const important = p.human === local || s.ball.owner === p.id || this.director.active;
      const tier = tierOf(d, important, cfg);
      _sphere.center.set(p.x, p.y + 1, p.z);
      _sphere.radius = 2.2;
      const onScreen = !this.haveCam || _frustum.intersectsSphere(_sphere);
      if (onScreen) visible++;
      const pose = posesThisFrame(tier, this.frame, i, cfg, onScreen) || !this.haveCam;
      const t = performance.now();
      fb.update(p, s.ball, dt, this.time, pose, tier === 0);
      if (pose) {
        posed++;
        poseMs += performance.now() - t;
      }
      if (blobs !== null && p.off !== true && blob < blobs.instanceMatrix.count) {
        const h = Math.max(0, p.y);
        const k = 1.25 / (1 + h * 0.6);
        _q.identity();
        blobs.setMatrixAt(blob++, _m.compose(_v.set(p.x, 0.01, p.z), _q, _s.set(k, 1, k)));
      }
    }
    if (blobs !== null) {
      blobs.count = blob;
      blobs.instanceMatrix.needsUpdate = true;
    }
    this.stats.posed = posed;
    this.stats.visible = visible;
    this.stats.poseMs += (poseMs - this.stats.poseMs) * 0.1;
  }

  private drawBall(s: SimState, dt: number) {
    const b = s.ball;
    const at = _w.set(b.x, b.y, b.z);
    if (b.mode === 'held' && b.owner !== null) {
      const fb = this.footballers.get(b.owner);
      const p = fb?.s;
      if (fb !== undefined && p !== null && p !== undefined && holdsBall(p.action, p.actionT)) {
        fb.handsAt(at);
        // Just in front of the hands, not inside them
        at.x += Math.sin(p.yaw) * 0.1;
        at.z += Math.cos(p.yaw) * 0.1;
      }
    }
    this.ball.update(b, at, dt, this.eye);
  }

  private updateCrowd(s: SimState, dt: number) {
    const b = s.ball;
    const halfL = this.pitch.length / 2;
    const toLine = halfL - Math.abs(b.z);
    const wide = Math.abs(b.x) / (this.pitch.boxWidth / 2 + 8);
    const d =
      s.phase === 'live'
        ? Math.max(0, 1 - toLine / 28) * Math.max(0, 1 - Math.max(0, wide - 1) * 0.6)
        : 0;
    this.danger += (d - this.danger) * (1 - Math.exp(-2.5 * dt));
    this.excite = Math.max(0, this.excite - dt * 0.13);
    // The fans of the side attacking the end the ball's at
    const attacking: TeamId = b.z > 0 ? s.attackPlusZ : ((1 - s.attackPlusZ) as TeamId);
    const end = this.excite > 0.3 ? this.exciteEnd : this.danger > 0.25 ? attacking : null;
    this.deps.stadium.crowd(Math.min(1, Math.max(this.excite, this.danger * 0.6)), end, dt);
    this.audio.update(dt, this.danger, this.excite);
  }

  private updateRadar(s: SimState) {
    const r = this.hud.live.radar;
    const stand = this.cam.ctx.stand;
    const W = this.pitch.width / 2;
    const L = this.pitch.length / 2;
    let n = 0;
    r.me = -1;
    for (const p of s.players) {
      if (p.off === true || n >= r.xs.length) continue;
      r.xs[n] = Math.max(-1, Math.min(1, (-stand * p.x) / W));
      r.zs[n] = Math.max(-1, Math.min(1, p.z / L));
      r.team[n] = p.team;
      if (p.human === this.local && this.local !== null) r.me = n;
      n++;
    }
    r.n = n;
    r.bx = Math.max(-1, Math.min(1, (-stand * s.ball.x) / W));
    r.bz = Math.max(-1, Math.min(1, s.ball.z / L));
    r.flip = stand === -1 ? 1 : -1;
    r.aspect = this.pitch.width / this.pitch.length;
    // Power bar
    const ch = this.local !== null ? s.charge[this.local] : undefined;
    const pw = this.hud.live.power;
    pw.visible = ch !== undefined && !this.director.active;
    pw.value = ch?.power ?? 0;
    pw.kind = ch?.kind ?? '';
  }

  private updateHud(s: SimState) {
    const { main, extra } = formatClock(s.clock, s.period);
    const end = periodEnd(s.period);
    const local = this.local !== null ? s.players.find(p => p.human === this.local) : undefined;
    const now = performance.now();
    const banners = this.hud.state.banners.filter(b => now - b.at < b.ms);
    const hint =
      s.phase === 'restart' || s.phase === 'kickoff' || s.phase === 'shootout'
        ? setPieceHint(s.restart, this.hud.state.localTeam)
        : null;
    this.hud.set({
      score:
        s.score[0] === this.hud.state.score[0] && s.score[1] === this.hud.state.score[1]
          ? this.hud.state.score
          : [s.score[0], s.score[1]],
      clock: main,
      extra,
      added: s.clock >= end - 60 && s.period !== 5 ? addedChip(s.added) : null,
      period: periodLabel(s.period, s.phase),
      phase: s.phase,
      poss: s.poss,
      banners: banners.length === this.hud.state.banners.length ? this.hud.state.banners : banners,
      hint,
      shootout: s.shootout,
      local: local?.id ?? null,
    });
    const cfg = this.config;
    if (cfg !== null) {
      const key = `${s.score[0]}-${s.score[1]}-${main}`;
      if (key !== this.boardKey) {
        this.boardKey = key;
        this.deps.stadium.board({
          home: cfg.kits[0].short,
          away: cfg.kits[1].short,
          score: [s.score[0], s.score[1]],
          clock: extra !== null ? `${main} ${extra}` : main,
          text: s.phase === 'goal' ? 'GOAL!' : undefined,
        });
      }
    }
  }

  private banner(kind: BannerKind, text: string, sub?: string, team: TeamId | null = null) {
    const b: Banner = {
      id: ++this.bannerId,
      kind,
      text,
      sub,
      team,
      at: performance.now(),
      ms: BANNER_MS[kind],
    };
    const keep = this.hud.state.banners
      .filter(x => b.at - x.at < x.ms && x.kind !== kind)
      .slice(-1);
    this.hud.set({ banners: [...keep, b] });
  }

  private nameOf(id: string): string {
    const f = this.config?.players.find(p => p.id === id);
    return f !== undefined ? f.name : id;
  }

  // ── events ────────────────────────────────────────────────────────────

  events(events: FootballEvent[], state: SimState) {
    if (this.disposed) return;
    const replaying = this.director.active;
    for (const e of events) {
      switch (e.type) {
        case 'kick':
          this.audio.kick(e.power);
          if (e.kind === 'shot' || e.kind === 'volley') {
            if (e.power > 0.75) this.cam.addShake(0.25);
          }
          break;
        case 'header':
          this.audio.header(e.power);
          break;
        case 'touch':
          this.audio.kick(0.12 + 0.1 * e.quality);
          break;
        case 'bounce':
          this.audio.bounce(e.strength);
          break;
        case 'woodwork':
          this.audio.clang(e.part, e.strength);
          this.cam.addShake(0.35 * e.strength);
          this.banner('woodwork', e.part === 'bar' ? 'OFF THE BAR!' : 'OFF THE POST!');
          this.excite = Math.max(this.excite, 0.45);
          break;
        case 'net':
          this.audio.net(e.strength);
          this.deps.stadium.netHit?.(state.ball.x, state.ball.y, state.ball.z, e.strength);
          break;
        case 'goal': {
          this.audio.roar();
          this.excite = 1;
          this.exciteEnd = e.team;
          this.lastScorer = e.scorer;
          this.goalTime = state.time;
          this.goalZ = Math.sign(state.ball.z) * (this.pitch.length / 2) || this.pitch.length / 2;
          this.cam.addShake(0.5);
          const rec = state.goals[state.goals.length - 1];
          const minute =
            rec !== undefined ? `${rec.minute}'` : minuteLabel(state.clock, state.period);
          const sub = `${this.nameOf(e.scorer)}${e.ownGoal ? ' (OG)' : ''} · ${minute}`;
          this.banner('goal', 'GOAL!', sub, e.team);
          // The scorer's side celebrates a different way each goal
          for (const fb of this.footballers.values()) if (fb.f.team === e.team) fb.celebrate++;
          if (this.deps.autoReplay !== false && !replaying)
            this.replayAt = this.time + REPLAY_DELAY;
          break;
        }
        case 'save':
          this.audio.ooh(e.caught ? 0.7 : 1);
          this.banner('save', e.caught ? 'SAVED!' : 'WHAT A SAVE!');
          break;
        case 'chance':
          this.audio.ooh(0.5 + 0.5 * e.quality);
          this.excite = Math.max(this.excite, 0.35 * e.quality);
          break;
        case 'card':
          this.banner(
            e.color === 'yellow' ? 'yellow' : 'red',
            e.color === 'yellow' ? 'YELLOW CARD' : 'RED CARD',
            this.nameOf(e.id),
          );
          break;
        case 'offside':
          this.banner('offside', 'OFFSIDE', this.nameOf(e.id));
          break;
        case 'foul':
          if (e.penalty) this.banner('penalty', 'PENALTY!');
          break;
        case 'whistle':
          this.audio.whistle(e.kind);
          break;
        case 'period':
          if (e.period === 2) this.banner('half', 'HALF TIME');
          else if (e.period === 3) this.banner('half', 'EXTRA TIME');
          else if (e.period === 5) this.banner('penalty', 'PENALTIES');
          break;
        case 'final': {
          const [a, b] = e.score;
          const cfg = this.config;
          const sub =
            cfg !== null
              ? `${cfg.kits[0].short} ${a} – ${b} ${cfg.kits[1].short}${e.pens !== undefined ? ` (${e.pens[0]}–${e.pens[1]} PENS)` : ''}`
              : undefined;
          this.banner('full', 'FULL TIME', sub);
          if (e.winner !== null) {
            this.excite = 0.8;
            this.exciteEnd = e.winner;
          }
          break;
        }
        case 'shootout':
          if (e.scored) this.audio.roar();
          else this.audio.groan();
          this.excite = e.scored ? 0.7 : this.excite;
          this.exciteEnd = e.team;
          break;
        default:
          break;
      }
    }
    // A new half / restart after the goal phase: forget the pending replay
    if (state.phase === 'live' && this.replayAt >= 0) this.replayAt = -1;
  }

  // ── camera ────────────────────────────────────────────────────────────

  setCamera(mode: CamMode, focus?: string | null) {
    if (this.director.active && mode !== 'replay') {
      this.prevMode = mode;
      if (focus !== undefined) this.cam.focus = focus;
      return;
    }
    this.cam.setMode(mode, focus);
  }

  camera(cam: THREE.PerspectiveCamera, dt: number, state: SimState) {
    if (this.disposed) return;
    const s = this.director.active || this.shown.tick >= 0 ? this.shown : state;
    const el = this.deps.canvas;
    const w = el != null && el.clientWidth > 0 ? el.clientWidth : window.innerWidth;
    const h = el != null && el.clientHeight > 0 ? el.clientHeight : window.innerHeight;
    const aspect = w / Math.max(1, h);
    this.cam.update(
      dt,
      s,
      { controlled: this.localPlayer(s)?.id ?? null, scorer: this.lastScorer, time: this.time },
      aspect,
    );
    this.cam.apply(cam, this.opts.frame);
    if (Math.abs(cam.aspect - aspect) > 1e-3) {
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    this.root.updateMatrixWorld();
    // The eye in pitch space (LOD, trail), the view-projection (frustum)
    this.eye.copy(cam.position).applyMatrix4(_m.copy(this.root.matrixWorld).invert());
    this.viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.haveCam = true;
    this.updateTag(cam, s, w, h);
  }

  private localPlayer(s: SimState): PlayerState | undefined {
    if (this.local === null) return undefined;
    return s.players.find(p => p.human === this.local);
  }

  private updateTag(cam: THREE.PerspectiveCamera, s: SimState, w: number, h: number) {
    const tag = this.hud.live.tag;
    const p = this.localPlayer(s);
    const fb = p !== undefined ? this.footballers.get(p.id) : undefined;
    if (p === undefined || fb === undefined || this.director.active || p.off === true) {
      tag.visible = false;
      return;
    }
    _v.set(0, 2.5, 0).add(fb.root.position);
    _v.applyMatrix4(this.root.matrixWorld).project(cam);
    if (_v.z > 1 || Math.abs(_v.x) > 1.2 || Math.abs(_v.y) > 1.2) {
      tag.visible = false;
      return;
    }
    tag.visible = true;
    tag.x = (_v.x * 0.5 + 0.5) * w;
    tag.y = (-_v.y * 0.5 + 0.5) * h;
    tag.name = fb.f.name;
    tag.number = fb.f.number;
    tag.stamina = p.stamina;
    tag.team = p.team;
  }

  // ── replays ───────────────────────────────────────────────────────────

  replay(seconds: number): boolean {
    if (this.director.active) return true;
    const end = this.goalTime >= 0 ? Math.min(this.buf.span()[1], this.goalTime + 0.6) : undefined;
    if (!this.director.start(this.buf, seconds, ['goalcam', 'tele'], 0.5, end)) return false;
    if (this.goalTime < 0)
      this.goalZ = Math.sign(this.shown.ball.z) * (this.pitch.length / 2) || this.pitch.length / 2;
    this.prevMode = this.cam.mode === 'replay' ? this.prevMode : this.cam.mode;
    this.cam.setMode('replay');
    this.audio.slow = 0.85;
    this.hud.set({ replay: true, wipe: this.hud.state.wipe + 1 });
    return true;
  }

  stopReplay() {
    if (!this.director.active && this.cam.mode !== 'replay') return;
    this.director.skip();
    this.goalTime = -1;
    this.cam.setMode(this.prevMode);
    this.audio.slow = 1;
    this.hud.set({ replay: false, wipe: this.hud.state.wipe + 1 });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clearMatch();
    this.ball.dispose();
    inkExcluded.delete(this.ball.shadow);
    inkExcluded.delete(this.ball.trail);
    if (this.blobs !== null) {
      this.blobs.geometry.dispose();
      (this.blobs.material as THREE.Material).dispose();
      inkExcluded.delete(this.blobs);
      releaseBlob();
      this.blobs.dispose();
    }
    this.bank.dispose();
    this.audio.dispose();
    this.root.removeFromParent();
    if (this.deps.ownStadium !== false) this.deps.stadium.dispose();
    void this.live;
  }
}

/** The view FootballMode drives (see FootballViewApi in contract.ts). */
export function createFootballView(
  opts: FootballViewOptions,
  deps: FootballViewDeps,
): FootballView {
  return new FootballView(opts, deps);
}
