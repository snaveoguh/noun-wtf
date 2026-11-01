// ── Noun Breaks: the view (everything you see and hear) ─────────────────
//
// createBattleView(game) → a BattleView (contract.ts) for net/ to mount at
// the plaza spot. It reads SimState + SimEvents and draws the battle:
//
//   dancer.ts   Noun breakers posed procedurally on the beat (pose.ts →
//               rig.ts): toprock, footwork, power moves, freezes,
//               transitions, crashes; walking in and out of the circle
//   cypher.ts   chalk ring + cardboard, DJ booth + speakers, judges with
//               cards, light rigs;  crowd.ts: a ring of Nouns reacting
//   camera.ts   orbiting battle cam, punch-ins, wide crowd shots
//   audio.ts    the break beat on the sim's clock, scratches, crowd, cards
//   hudStore.ts + BreakHud.tsx   the HUD (net/ mounts it with view.hud)
//
// The view keeps its own beat clock phase-locked to the sim's (clock.ts),
// so animation and music stay on the beat between snapshots.
//
// For net/:
//   const view = createBattleView(game);           // a BattleView (+ .hud, .startAudio)
//   view.mount(config, { x, y, z, yaw });           // cypher −z (judges) faces `yaw + π`
//   view.setLocal(myId);
//   each frame: view.update(dt, sim.state(), events);
//   <BreakHud hud={view.hud} onKey={k => …} onGesture={() => view.startAudio()} />
//   view.unmount();                                 // puts the camera back as it was
// The cypher needs ~15 m of flat floor (crowd ring r ≈ 6.5 m, light poles at the corners).
// While mounted the view writes the game camera every update; hide the skate HUD around it.

import type { Game } from '../../Game';
import type {
  BattleConfig,
  BattlePhase,
  BattleView,
  CrewId,
  DancerPose,
  SimEvent,
  SimState,
} from '../contract';

import * as THREE from 'three';

import { type CharacterAssets } from '../../character/NounCharacter';
import { warmHidden } from '../../render/shaderWarm';
import { inkExcluded, toonify } from '../../render/Toon';
import { fetchTrack, HOUSE_ID, loadManifest, trackById } from '../tracks';

import { BreakAudio, type AudioBus } from './audio';
import { BattleCamera, type ShotKind } from './camera';
import { BeatClock } from './clock';
import { Crowd } from './crowd';
import { centreYaw, CypherDressing, edgeSpot } from './cypher';
import { DancerView } from './dancer';
import {
  BreakHudStore,
  CREW_COLORS,
  CREW_NAMES,
  initialHud,
  type BreakHudState,
  type CrewInfo,
} from './hudStore';
import { moveFamily, moveInfo, moveName } from './moves';

export { BreakHud, type BreakHudProps } from './BreakHud';
export { BreakHudStore, type BreakHudState, type BreakHudLive } from './hudStore';
export { createMockBattle, MockBattle, mockConfig, type MockOptions } from './mock';
export { VIEW_MOVES, moveName } from './moves';

export interface BreakViewDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  assets: () => CharacterAssets | null;
  quality: 'low' | 'medium' | 'high';
  toon: boolean;
  /** DOM layer over the canvas for name tags (Game.labelLayerEl). */
  labelLayer: HTMLElement | null;
  /** The game's audio bus, when it has one running. */
  audio: () => AudioBus | null;
  /** Runs a compile with the render target the frame draws into (Graphics.asDrawn). */
  asDrawn?: <T>(fn: () => T) => T;
}

const EMPTY_ASSETS: CharacterAssets = { gltf: null, board: null, manifest: {}, clips: new Map() };

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class BreakView implements BattleView {
  readonly hud = new BreakHudStore();
  readonly audio: BreakAudio;
  readonly clock = new BeatClock();
  readonly dancers = new Map<string, DancerView>();
  config: BattleConfig | null = null;
  group: THREE.Group | null = null;
  dressing: CypherDressing | null = null;
  crowd: Crowd | null = null;
  cam: BattleCamera;
  private d: BreakViewDeps;
  private saved: { pos: THREE.Vector3; quat: THREE.Quaternion; fov: number } | null = null;
  private localId: string | null = null;
  private labels = new Map<string, HTMLDivElement>();
  private phase: BattlePhase | null = null;
  private timers: number[] = [];
  private hype = 0.3;
  private calls = 0;
  private hudAcc = 0;
  private lastState: SimState | null = null;
  private lastKickAt = 0;
  private winnerAt: CrewId | 'tie' | null = null;
  private mounted = false;

  constructor(d: BreakViewDeps) {
    this.d = d;
    this.cam = new BattleCamera(d.camera);
    this.audio = new BreakAudio(d.audio);
  }

  // ── BattleView ────────────────────────────────────────────────────────

  mount(config: BattleConfig, at: { x: number; y: number; z: number; yaw: number }) {
    if (this.mounted) this.unmount();
    this.mounted = true;
    this.config = config;
    const d = this.d;
    const assets = d.assets() ?? EMPTY_ASSETS;
    const low = d.quality === 'low';
    const cam = d.camera;
    this.saved = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov };
    const g = new THREE.Group();
    g.name = 'NounBreaks';
    g.position.set(at.x, at.y, at.z);
    g.rotation.y = at.yaw;
    d.scene.add(g);
    g.updateMatrixWorld(true);
    this.group = g;
    // Crews: a 1v1 is named after its dancers
    const names: [string, string] = [...CREW_NAMES];
    if (config.crewSize === 1)
      for (const c of [0, 1] as const) {
        const dn = config.dancers.find(x => x.crew === c);
        if (dn !== undefined) names[c] = dn.name.toUpperCase();
      }
    this.dressing = new CypherDressing(assets, low);
    this.dressing.setCrews(CREW_COLORS, names);
    g.add(this.dressing.group);
    if (d.toon) toonify(this.dressing.group);
    for (const x of this.dressing.inkless) inkExcluded.add(x);
    this.crowd = new Crowd(assets, low ? 8 : d.quality === 'medium' ? 12 : 16, !low);
    g.add(this.crowd.group);
    if (d.toon) toonify(this.crowd.group);
    for (const dc of config.dancers) {
      const dv = new DancerView(dc.id, dc.seed, assets);
      if (d.toon) toonify(dv.root);
      g.add(dv.root);
      this.dancers.set(dc.id, dv);
      if (d.labelLayer !== null) {
        const el = document.createElement('div');
        el.className = 'w2-nametag w2-break-tag';
        d.labelLayer.appendChild(el);
        this.labels.set(dc.id, el);
      }
    }
    this.clock.reset();
    this.hud.state = initialHud();
    this.hud.set({
      rounds: config.rounds,
      bpm: config.bpm,
      localId: this.localId,
      crews: this.crewInfo([0, 0], null, names),
    });
    this.crewNames = names;
    this.phase = null;
    this.winnerAt = null;
    this.cam.cut();
    this.loadSong(config);
    // The stage's programs link in the background during the countdown (3 s
    // before the first beat); drawn at once they linked on first sight, a
    // 1.7 s freeze on an Android tablet. Shown when ready, 1.5 s at the latest.
    void warmHidden(d.renderer, g, d.camera, d.scene, d.asDrawn, 1500);
  }

  /** BattleConfig.track: the host's song, when this client can load it (the drums otherwise). */
  private loadSong(config: BattleConfig) {
    const id = config.track;
    if (id === undefined || id === HOUSE_ID) return;
    void loadManifest().then(list => {
      if (this.config !== config) return;
      const t = trackById(list, id);
      if (t.id !== id || t.file === null) {
        console.warn(`[breaks] no track "${id}" here: the generated beat plays`);
        return;
      }
      this.audio.playTrack(fetchTrack(t), t.offset, config.bpm);
      this.hud.set({ song: `♪ ${t.title}${t.artist !== '' ? ` · ${t.artist}` : ''}` });
    });
  }

  setLocal(id: string | null) {
    this.localId = id;
    this.hud.set({
      localId: id,
      crews: this.crewInfo(this.lastState?.totals ?? [0, 0], this.lastState),
    });
  }

  /** Unlock / start audio (call from a gesture when the game's context isn't running). */
  startAudio() {
    this.audio.start();
  }

  update(dt: number, state: SimState, events: readonly SimEvent[]) {
    if (!this.mounted || this.config === null || this.group === null) return;
    dt = Math.min(Math.max(dt, 0), 0.1);
    const c = this.config;
    const beat = this.clock.update(dt, state.beat, c.bpm);
    this.lastState = state;
    for (const p of state.poses) this.dancers.get(p.id)?.observe(p, state.beat);
    if (state.phase !== this.phase) this.enterPhase(state.phase, this.phase, state);
    for (const e of events) this.onEvent(e, state);

    // ── dancers ──
    const k = c.crewSize;
    const idx: [number, number] = [0, 0];
    for (const dc of c.dancers) {
      const dv = this.dancers.get(dc.id);
      if (dv === undefined) continue;
      const i = idx[dc.crew]++;
      const e = edgeSpot(dc.crew, i, k);
      if (state.phase === 'done' || state.phase === 'final') {
        if (
          state.winner !== undefined &&
          state.winner !== 'tie' &&
          dc.crew === state.winner &&
          dv.pose !== null
        )
          dv.cheer(0.5);
      }
      dv.update({ dt, beat, bpm: c.bpm, edge: e.p, edgeYaw: e.yaw, centreYaw: centreYaw(dc.crew) });
    }

    // ── crowd, dressing ──
    const up = state.turn !== null ? this.dancers.get(state.turn.id) : undefined;
    const upMove = up?.track.move ?? null;
    const fam = moveFamily(upMove);
    const hypeTo =
      state.phase === 'turn'
        ? 0.45 + Math.min(0.4, state.combo / 40) + (fam === 'power' ? 0.15 : 0)
        : state.phase === 'final' || state.phase === 'done'
          ? 0.9
          : 0.3;
    this.hype += (hypeTo - this.hype) * (1 - Math.exp(-2 * dt));
    this.crowd?.update(dt, beat, this.hype);
    // Speakers pump when a kick actually sounds (or on the beat without audio)
    const now = this.audio.now;
    if (now !== null && this.audio.running) {
      if (this.audio.kickedSince(this.lastKickAt)) this.dressing?.pump(1);
      this.lastKickAt = now;
    } else if (Math.floor(beat) !== Math.floor(beat - (dt * c.bpm) / 60)) this.dressing?.pump(0.8);
    this.dressing?.update(dt, beat, this.hype);

    // ── camera ──
    this.updateCamera(dt, state, beat, up);

    // ── audio ──
    this.audio.update(beat, c.bpm);
    this.audio.setHype(this.hype);

    // ── HUD ──
    const live = this.hud.live;
    live.beat = beat;
    live.prompts = state.prompts;
    live.lane = state.lane ?? null;
    live.forming = state.forming ?? null;
    live.turn = state.turn !== null ? { from: state.turn.from, to: state.turn.to } : null;
    this.hudAcc += dt;
    const hs = this.hud.state;
    if (
      this.hudAcc > 0.2 ||
      hs.combo !== state.combo ||
      hs.turnScore !== state.turnScore ||
      hs.phase !== state.phase ||
      hs.crews[0].total !== state.totals[0] ||
      hs.crews[1].total !== state.totals[1]
    ) {
      this.hudAcc = 0;
      const upCfg = state.turn !== null ? c.dancers.find(x => x.id === state.turn!.id) : undefined;
      this.hud.set({
        phase: state.phase,
        round: state.round,
        combo: state.combo,
        turnScore: state.turnScore,
        crews: this.crewInfo(state.totals, state),
        track: this.trackOwner(state),
        up:
          upCfg !== undefined
            ? {
                id: upCfg.id,
                name: upCfg.id === this.localId ? 'you' : upCfg.name,
                crew: upCfg.crew,
                local: upCfg.id === this.localId,
              }
            : null,
      });
    }
    this.drawLabels(state);
  }

  unmount() {
    if (!this.mounted) return;
    this.mounted = false;
    for (const t of this.timers) window.clearTimeout(t);
    this.timers = [];
    for (const dv of this.dancers.values()) dv.dispose();
    this.dancers.clear();
    for (const l of this.labels.values()) l.remove();
    this.labels.clear();
    if (this.dressing !== null) {
      for (const x of this.dressing.inkless) inkExcluded.delete(x);
      this.dressing.dispose();
    }
    this.dressing = null;
    this.crowd?.dispose();
    this.crowd = null;
    this.group?.removeFromParent();
    this.group = null;
    this.audio.dispose();
    // Hand the camera back exactly as it was
    const sv = this.saved;
    if (sv !== null) {
      const cam = this.d.camera;
      cam.position.copy(sv.pos);
      cam.quaternion.copy(sv.quat);
      if (cam.fov !== sv.fov) {
        cam.fov = sv.fov;
        cam.updateProjectionMatrix();
      }
      cam.updateMatrixWorld();
    }
    this.saved = null;
    this.config = null;
    this.lastState = null;
    this.hud.set(initialHud());
  }

  // ── internals ─────────────────────────────────────────────────────────

  private crewNames: [string, string] = [...CREW_NAMES];

  private crewInfo(
    totals: [number, number],
    state: SimState | null,
    names: [string, string] = this.crewNames,
  ): [CrewInfo, CrewInfo] {
    const ds = this.config?.dancers ?? [];
    const mk = (c: CrewId): CrewInfo => ({
      name: names[c],
      color: CREW_COLORS[c],
      total: totals[c],
      dancers: ds
        .filter(d => d.crew === c)
        .map(d => ({
          id: d.id,
          name: d.name,
          local: d.id === this.localId,
          up: state?.turn?.id === d.id,
        })),
    });
    return [mk(0), mk(1)];
  }

  /** Whose notes are on the beat track: SimState.promptsFor, else the dancer up. */
  private trackOwner(state: SimState): BreakHudState['track'] {
    const id = state.promptsFor ?? state.turn?.id;
    if (id === undefined || (state.prompts.length === 0 && (state.lane?.length ?? 0) === 0))
      return null;
    const d = this.config?.dancers.find(x => x.id === id);
    return d !== undefined ? { id, crew: d.crew, local: id === this.localId } : null;
  }

  private nameOf(id: string) {
    if (id === this.localId) return 'YOU';
    return (this.config?.dancers.find(d => d.id === id)?.name ?? id).toUpperCase();
  }

  private banner(text: string, tone: 'gold' | 'red' | 'blue' | 'white' = 'gold', sub?: string) {
    this.hud.set({ banner: { id: ++this.calls, text, sub, tone, at: performance.now() } });
  }

  private later(ms: number, f: () => void) {
    this.timers.push(window.setTimeout(f, ms));
  }

  private enterPhase(p: BattlePhase, prev: BattlePhase | null, state: SimState) {
    this.phase = p;
    const dr = this.dressing;
    switch (p) {
      case 'intro':
        this.audio.setMusic('full');
        this.banner('NOUN BREAKS', 'gold', `${this.crewNames[0]} vs ${this.crewNames[1]}`);
        break;
      case 'turn':
        this.audio.setMusic('full');
        dr?.setScratch(false);
        dr?.hideCards();
        break;
      case 'between':
        this.audio.setMusic('full');
        this.audio.scratch();
        dr?.setScratch(true);
        this.later(900, () => this.dressing?.setScratch(false));
        break;
      case 'judging':
        this.audio.setMusic('muffled');
        this.audio.scratch();
        this.banner('JUDGES!', 'white', `ROUND ${state.round + 1}`);
        break;
      case 'final':
        this.audio.setMusic('full');
        break;
      case 'done':
        this.audio.setMusic(prev === null ? 'off' : 'muffled');
        break;
    }
  }

  private onEvent(e: SimEvent, state: SimState) {
    const local = (id: string) => id === this.localId;
    const up = state.turn?.id ?? null;
    switch (e.e) {
      case 'beat':
        if (e.downbeat && state.phase === 'turn') this.cam.kick(0.35);
        break;
      case 'turn': {
        const crew = this.config?.dancers.find(d => d.id === e.id)?.crew ?? 0;
        this.banner(
          local(e.id) ? 'YOUR TURN' : this.nameOf(e.id),
          crew === 0 ? 'red' : 'blue',
          `ROUND ${e.round + 1}`,
        );
        this.audio.crowd('cheer', 0.5);
        this.crowd?.react('clap', 0.6);
        break;
      }
      case 'hit': {
        if (e.id !== up) break;
        const isLocal = local(e.id);
        this.hud.set({
          flash: {
            id: ++this.calls,
            grade: e.grade,
            local: isLocal,
            at: performance.now(),
            ...(e.wrong !== undefined ? { wrong: e.wrong } : {}),
          },
        });
        // (The lane bursts the note that was hit: SimState.lane carries its grade.)
        if (isLocal) this.audio.tick(e.grade);
        break;
      }
      case 'move': {
        const info = moveInfo(e.move);
        const big = info?.big === true;
        const calls = [
          ...this.hud.state.calls.filter(c => performance.now() - c.at < 1800),
          {
            id: ++this.calls,
            text: moveName(e.move).toUpperCase(),
            points: e.points,
            landed: e.landed,
            big,
            at: performance.now(),
          },
        ].slice(-3);
        this.hud.set({ calls });
        if (e.landed && (big || info?.family === 'power')) {
          this.audio.crowd('ooh', big ? 1 : 0.6);
          this.crowd?.react('ooh', big ? 1 : 0.6);
        }
        break;
      }
      case 'crash': {
        this.audio.crowd('groan', 0.9);
        this.crowd?.react('groan', 0.8);
        this.cam.shake(0.6);
        const crew = this.config?.dancers.find(d => d.id === e.id)?.crew;
        for (const dc of this.config?.dancers ?? [])
          if (dc.crew !== crew) this.dancers.get(dc.id)?.cheer(1.6);
        this.banner('BAILED!', 'white');
        break;
      }
      case 'freeze':
        this.audio.freeze();
        this.dressing?.strobe(1);
        this.cam.kick(1);
        this.crowd?.react('hands', 1);
        if (e.onBeat) this.audio.crowd('cheer', 0.9);
        break;
      case 'combo':
        if (e.combo >= 10) {
          this.banner(`${e.combo} COMBO!`, 'gold');
          if (e.combo >= 20) this.audio.horn();
        }
        break;
      case 'card': {
        this.dressing?.showCard(e.card);
        for (let i = 0; i < 3; i++) this.later(250 + i * 450, () => this.audio.card(i));
        this.hud.set({
          reveal: { round: e.round, card: e.card, at: performance.now() },
          cards: [...this.hud.state.cards.filter((_, i) => i !== e.round), e.card],
        });
        break;
      }
      case 'end': {
        this.winnerAt = e.winner;
        this.audio.horn();
        this.audio.crowd('roar', 1);
        this.crowd?.react('hands', 1);
        this.dressing?.strobe(1);
        this.hud.set({ winner: e.winner, crews: this.crewInfo(e.totals, state) });
        break;
      }
    }
  }

  private updateCamera(dt: number, state: SimState, beat: number, up: DancerView | undefined) {
    const g = this.group!;
    let shot: ShotKind = 'wide';
    let subject: DancerView | undefined = up;
    switch (state.phase) {
      case 'intro':
        shot = 'intro';
        break;
      case 'turn': {
        const f = moveFamily(up?.track.move ?? null);
        shot =
          up !== undefined && up.driver.ok && (f === 'power' || f === 'freeze')
            ? 'punch'
            : 'dancer';
        break;
      }
      case 'judging':
        shot = 'judges';
        break;
      case 'final':
      case 'done': {
        const w = state.winner ?? this.winnerAt;
        if (w !== undefined && w !== null && w !== 'tie') {
          const id = this.config?.dancers.find(d => d.crew === w)?.id;
          subject = id !== undefined ? this.dancers.get(id) : undefined;
          shot = subject !== undefined ? 'winner' : 'wide';
        } else shot = 'wide';
        break;
      }
      default:
        shot = 'wide';
    }
    const focus = _v.set(0, 1, 0);
    if (subject !== undefined) {
      subject.driver.hipsAt(_w);
      subject.root.updateMatrix();
      _w.applyMatrix4(subject.root.matrix);
      focus.copy(_w);
    }
    this.cam.update(
      dt,
      { shot, focus, beat, calm: up !== undefined && up.id === this.localId },
      g.matrixWorld,
    );
  }

  private drawLabels(state: SimState) {
    if (this.labels.size === 0 || this.group === null) return;
    const cam = this.d.camera;
    const el0 = this.d.renderer.domElement;
    const w = el0.clientWidth || 1280;
    const h = el0.clientHeight || 720;
    for (const p of state.poses as DancerPose[]) {
      const el = this.labels.get(p.id);
      const dv = this.dancers.get(p.id);
      if (el === undefined || dv === undefined) continue;
      // Hide tags on the dancer up (the HUD names them), show them on the edge
      if (p.centre) {
        el.style.display = 'none';
        continue;
      }
      _v.copy(dv.root.position)
        .add(_w.set(0, 2.45, 0))
        .applyMatrix4(this.group.matrixWorld)
        .project(cam);
      const vis = _v.z < 1 && _v.z > -1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
      if (!vis) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = 'block';
      el.style.transform = `translate(-50%, -100%) translate(${(((_v.x + 1) / 2) * w).toFixed(1)}px, ${(((1 - _v.y) / 2) * h).toFixed(1)}px)`;
      const crew = this.config?.dancers.find(d => d.id === p.id)?.crew ?? 0;
      const name =
        p.id === this.localId
          ? 'YOU'
          : (this.config?.dancers.find(d => d.id === p.id)?.name ?? p.id);
      const key = `${name}|${crew}`;
      if (el.dataset.k !== key) {
        el.dataset.k = key;
        const col = p.id === this.localId ? '#ffd400' : CREW_COLORS[crew];
        el.innerHTML = `<span style="border:2px solid ${col};font-weight:800;font-size:12px;background:rgba(0,0,0,.6);padding:2px 8px;border-radius:999px;${p.id === this.localId ? 'color:#ffd400' : ''}">${escapeHtml(name)}</span>`;
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

/** The view for a running Game (net/ mounts it at the plaza spot). */
export function createBattleView(game: Game): BreakView {
  return new BreakView({
    scene: game.gfx.scene,
    camera: game.gfx.camera,
    renderer: game.gfx.renderer,
    assets: () => game.assets,
    quality: game.gfx.quality,
    toon: game.gfx.toon,
    labelLayer: game.labelLayerEl,
    asDrawn: fn => game.gfx.asDrawn(fn),
    audio: () =>
      game.audio.ctx !== null && game.audio.master !== null
        ? { ctx: game.audio.ctx, out: game.audio.master }
        : null,
  });
}

/** The HUD store of a view made by createBattleView (for net/, which holds it as a BattleView). */
export function hudOf(v: BattleView): BreakHudStore | null {
  return v instanceof BreakView ? v.hud : null;
}
