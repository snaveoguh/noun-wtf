// ── World v2 game orchestrator ───────────────────────────────────────────
//
// Owns the renderer, level, player, characters, camera, audio and network,
// and runs the frame loop. React only mounts the canvas + reads `hud`.

import type { TimeOfDayPreset } from './nature/TimeOfDay';

import * as THREE from 'three';

import { PirateRadio } from './audio/PirateRadio';
import { SkateAudio } from './audio/SkateAudio';
import { parseSeedKey, randomSeed, seedKey, type NounSeed } from './character/NounAppearance';
import {
  loadCharacterAssets,
  NounCharacter,
  type BoardType,
  type CharacterAssets,
} from './character/NounCharacter';
import { Input, type InputFrame } from './core/Input';
import { Graffiti, SPRAY_COLORS } from './graffiti/Graffiti';
import { applyTimeOfDay, buildNatureShowcase, NatureSystem, replaceFallbackTrees } from './nature';
import { Net, type NetPose } from './net/Net';
import { CollisionWorld } from './physics/Collision';
import { RailSet } from './physics/Rails';
import { Graphics, type Quality } from './render/Graphics';
import { Particles } from './render/Particles';
import { SkateCamera } from './render/SkateCamera';
import { inkExcluded, toonify } from './render/Toon';
import { Player } from './skate/Player';
import { comboLabel, comboScore } from './skate/Tricks';
import { buildIceCreamVan, iceCreamVanCollisionBox } from './world/IceCreamVan';
import { loadLevel, type LevelData } from './world/Level';
import { PipBillboards } from './world/PipBillboards';

export interface HudState {
  loading: string | null;
  mode: 'foot' | 'board';
  state: string;
  speed: number;
  combo: { label: string; score: number; multiplier: number } | null;
  banked: { points: number; label: string; bailed: boolean; at: number } | null;
  session: number;
  best: number;
  players: number;
  connected: boolean;
  mic: 'off' | 'on' | 'muted';
  speaking: boolean;
  fps: number;
  manualBalance: number | null;
  inputMode: string;
  landmarks: { name: string; dist: number; bearing: number }[];
  chat: { id: string; name: string; text: string; at: number }[];
  quality: Quality;
  camMode: string;
  timeOfDay: TimeOfDayPreset;
  radio: { on: boolean; label: string; at: number };
  /** Spray colour + whether the crosshair is on a paintable surface. */
  spray: { color: string; aiming: boolean; active: boolean };
  baked: boolean;
}

interface RemoteAvatar {
  character: NounCharacter;
  label: HTMLDivElement | null;
  seedKey: string;
  lastPos: THREE.Vector3;
}

export interface GameOptions {
  canvas: HTMLCanvasElement;
  labelLayer: HTMLElement;
  seed?: NounSeed | null;
  nounId?: number;
  name?: string;
  quality?: Quality;
  offline?: boolean;
}

export class Game {
  gfx: Graphics;
  input: Input;
  world = new CollisionWorld();
  rails = new RailSet();
  player: Player;
  cam: SkateCamera;
  audio = new SkateAudio();
  net = new Net();
  particles = new Particles();
  graffiti: Graffiti | null = null;
  level: LevelData | null = null;
  assets: CharacterAssets | null = null;
  me: NounCharacter | null = null;
  seed: NounSeed;
  nounId: number;
  name: string;
  remotes = new Map<string, RemoteAvatar>();
  hud: HudState;
  private raf = 0;
  private last = 0;
  private running = false;
  private disposed = false;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private listeners = new Set<() => void>();
  private labelLayer: HTMLElement;
  private opts: GameOptions;
  private lastPos = new THREE.Vector3();
  private footstepAcc = 0;
  private hudAcc = 0;
  private sparkAcc = 0;
  private animTime = 0;
  private lowFpsTime = 0;

  constructor(opts: GameOptions) {
    this.opts = opts;
    this.labelLayer = opts.labelLayer;
    this.seed = opts.seed ?? randomSeed();
    this.nounId = opts.nounId ?? 0;
    this.name = opts.name ?? `noun ${seedKey(this.seed).split('-')[3]}`;
    const quality = opts.quality ?? pickQuality();
    this.gfx = new Graphics(opts.canvas, quality);
    this.input = new Input(opts.canvas);
    this.player = new Player(this.world, this.rails);
    this.cam = new SkateCamera(this.gfx.camera, this.world);
    this.gfx.scene.add(this.particles.group);
    inkExcluded.add(this.particles.group);
    this.hud = {
      loading: 'booting',
      mode: 'board',
      state: 'ground',
      speed: 0,
      combo: null,
      banked: null,
      session: 0,
      best: 0,
      players: 1,
      connected: false,
      mic: 'off',
      speaking: false,
      fps: 0,
      manualBalance: null,
      inputMode: 'keyboard',
      landmarks: [],
      chat: [],
      quality,
      camMode: 'follow',
      timeOfDay: 'afternoon',
      radio: { on: false, label: 'radio off', at: 0 },
      spray: { color: SPRAY_COLORS[2], aiming: false, active: false },
      baked: false,
    };
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  private setLoading(msg: string | null) {
    this.hud = { ...this.hud, loading: msg };
    this.emit();
  }

  async start() {
    this.setLoading('loading level');
    const [level, assets] = await Promise.all([
      loadLevel(this.gfx.renderer, m => this.setLoading(m)),
      loadCharacterAssets(),
    ]);
    if (this.disposed) return;
    this.level = level;
    this.assets = assets;
    this.gfx.scene.add(level.root);
    if (this.gfx.toon) {
      toonify(level.root);
      // Baked indirect light stacks on the toon ramp's full-bright band; tame it
      level.root.traverse(o => {
        const mats = (o as THREE.Mesh).material;
        for (const m of Array.isArray(mats) ? mats : mats !== undefined ? [mats] : []) {
          const tm = m as THREE.MeshToonMaterial;
          if (tm.lightMap !== null && tm.lightMap !== undefined) tm.lightMapIntensity *= 0.35;
        }
      });
    }
    this.world.build(level.collisionMeshes);
    this.player.softBounds = level.softBounds ?? Infinity;
    this.placeIceCreamVan(level);
    this.rails.load(level.rails);
    this.graffiti = new Graffiti(
      this.world,
      level.baked ? 'plaza' : 'park',
      this.opts.offline === true
        ? null
        : {
            save: (id, data) => this.net.graffitiSave(id, data),
            load: id => this.net.graffitiLoad(id),
          },
    );
    this.gfx.scene.add(this.graffiti.group);
    // Paint is decals on walls: the normals pass would draw each canvas as a
    // solid panel and ink its edges as floating black frames
    inkExcluded.add(this.graffiti.group);
    this.gfx.applyLevel(level);
    this.hud.baked = level.baked;
    this.buildNature(level);
    void this.billboards.attach(level.root);

    this.me = new NounCharacter(this.seed, assets);
    this.me.setBoardType(this.boardType);
    if (this.gfx.toon) toonify(this.me.root);
    this.me.setWeight(this.weight);
    this.gfx.scene.add(this.me.root);
    const spawn = level.spawns[Math.floor(Math.random() * level.spawns.length)] ?? {
      position: new THREE.Vector3(),
      yaw: 0,
    };
    this.player.spawn(spawn.position, spawn.yaw);
    this.cam.snap(this.player);
    this.lastPos.copy(this.player.pos);

    // Precompile shaders so the first frames don't hitch
    this.gfx.renderer.compile(this.gfx.scene, this.gfx.camera);

    if (this.opts.offline !== true) {
      this.net.onLeave = id => this.removeRemote(id);
      this.net.onChat = (id, text) => this.pushChat(id, text);
      this.net.onGraffiti = (id, tags) => this.graffiti?.onTags(id, tags);
      this.net.onOpen = () => this.graffiti?.loadAll();
      this.net.connect();
    }

    this.setLoading(null);
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Call from a user gesture (click/tap/key) to unlock audio. */
  unlockAudio() {
    this.audio.start();
    const ctx = this.audio.ctx;
    if (ctx !== null && !this.radioAttached) {
      this.radioAttached = true;
      this.radio.attach(ctx, ctx.destination, this.audio.noise);
      this.radio.onNowPlaying = label => {
        this.hud = {
          ...this.hud,
          radio: { on: this.radio.mode !== 'off', label, at: performance.now() },
        };
        this.emit();
      };
      // The plaza needs a soundtrack: start the pirate station on drop-in
      this.radio.setMode('pirate');
    }
  }

  radio = new PirateRadio();
  private radioAttached = false;
  billboards = new PipBillboards();

  /** off → pirate radio → live streams → off */
  cycleRadio() {
    this.unlockAudio();
    this.radio.cycle();
  }

  nextRadioTrack() {
    this.unlockAudio();
    this.radio.nextTrack();
  }

  resize(w: number, h: number) {
    this.gfx.resize(w, h);
  }

  /** Backgrounded behind the NounOS desk: no sim, no render, no input. */
  paused = false;

  setPaused(p: boolean) {
    if (this.paused === p) return;
    this.paused = p;
    this.input.setEnabled(!p);
  }

  private frame = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    if (this.paused) {
      this.last = now;
      return;
    }
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (dt <= 0) return;
    this.step(dt, now);
  };

  /** One simulation + render step (exposed for tests/automation). */
  /** Character-select mode: physics paused, camera orbits the rider. */
  showroom = false;
  boardType: BoardType = 'skate';
  weight = 0;

  setWeight(w: number) {
    this.weight = w;
    this.me?.setWeight(w);
  }

  setBoardType(t: BoardType) {
    this.boardType = t;
    this.me?.setBoardType(t);
  }
  showroomYaw = 0.5;

  step(dt: number, now = performance.now()) {
    if (this.showroom) {
      this.input.poll(now);
      this.updateShowroom(dt);
      return;
    }
    const input = this.input.poll(now);
    this.handleGlobalInput(input);

    // Physics in fixed-ish substeps for stability at low FPS
    const steps = Math.max(1, Math.ceil(dt / (1 / 90)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      // Only consume one-shot inputs on the first substep
      const f =
        i === 0
          ? input
          : {
              ...input,
              tricks: [],
              jumpPressed: false,
              boardTogglePressed: false,
              pushPressed: false,
              respawnPressed: false,
              emotePressed: 0,
            };
      this.player.update(h, f, this.cam.controlYaw, now);
      this.handlePlayerEvents();
    }

    this.cam.update(dt, this.player, input.lookX, input.lookY, now);
    this.updateMyCharacter(dt);
    this.updateAudio(dt);
    this.updateGraffiti(dt, input);
    this.updateNetwork(dt);
    this.particles.update(dt, p => {
      const hit = this.world.raycast(
        new THREE.Vector3(p.x, p.y + 0.5, p.z),
        new THREE.Vector3(0, -1, 0),
        1,
      );
      return hit ? hit.point.y : null;
    });
    this.gfx.followShadow(this.player.pos);
    this.nature?.update(dt, this.player.pos);
    this.billboards.update(dt);
    this.gfx.render(dt);
    this.updateHud(dt, input);
  }

  private updateShowroom(dt: number) {
    const p = this.player;
    this.showroomYaw += dt * 0.35;
    const riderYaw = Math.atan2(p.fwd.x, p.fwd.z);
    // Rider stands sideways on the board (chest toward -X of the board
    // frame), so orbit around the chest side with a gentle sway.
    const a = riderYaw - Math.PI / 2 + Math.sin(this.showroomYaw) * 0.7;
    const target = p.pos.clone().add(new THREE.Vector3(0, 1.35, 0));
    const cam = this.gfx.camera;
    const dist = 4.4;
    cam.position.set(target.x + Math.sin(a) * dist, target.y + 0.35, target.z + Math.cos(a) * dist);
    // Frame the Noun on the right third of the screen (menu panel on the left)
    const right = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    cam.lookAt(target.clone().addScaledVector(right, -0.75));
    if (Math.abs(cam.fov - 45) > 0.01) {
      cam.fov = 45;
      cam.updateProjectionMatrix();
    }
    this.updateMyCharacter(dt);
    this.gfx.followShadow(p.pos);
    this.nature?.update(dt, p.pos);
    this.gfx.render(dt);
  }

  nature: NatureSystem | null = null;

  /** Collision for props added on top of the baked level (ice cream van…). */
  private propCollision: THREE.Mesh[] = [];

  /** Park the DOGE ice cream van on the first clear, flat spot near the plaza. */
  private placeIceCreamVan(level: LevelData) {
    try {
      const candidates: [number, number, number][] = level.baked
        ? [
            [14, 40, -Math.PI / 2],
            [-14, 42, Math.PI / 2],
            [16, 22, -Math.PI / 2],
            [-16, 22, Math.PI / 2],
            [0, 44, Math.PI],
          ]
        : [
            [10, 10, 0],
            [-10, 10, 0],
          ];
      const down = new THREE.Vector3(0, -1, 0);
      const o = new THREE.Vector3();
      const isClear = (x: number, z: number, yaw: number) => {
        // Footprint incl. awning/stairs behind the van (local -Z)
        const c = Math.cos(yaw);
        const sn = Math.sin(yaw);
        let ground: number | null = null;
        for (const lx of [-1.5, 0, 1.5])
          for (const lz of [-5.6, -3, 0, 3.4]) {
            const wx = x + lx * c + lz * sn;
            const wz = z - lx * sn + lz * c;
            const hit = this.world.raycast(o.set(wx, 8, wz), down, 12);
            if (hit === null || hit.normal.y < 0.97) return null;
            if (ground === null) ground = hit.point.y;
            else if (Math.abs(hit.point.y - ground) > 0.12) return null;
          }
        return ground;
      };
      for (const [x, z, yaw] of candidates) {
        const y = isClear(x, z, yaw);
        if (y === null) continue;
        const van = buildIceCreamVan();
        van.position.set(x, y, z);
        van.rotation.y = yaw;
        van.updateMatrixWorld(true);
        if (this.gfx.toon) toonify(van);
        this.gfx.scene.add(van);
        this.propCollision.push(iceCreamVanCollisionBox(van));
        this.world.build([...level.collisionMeshes, ...this.propCollision]);
        return;
      }
    } catch (err) {
      console.warn('[world2] ice cream van failed to place', err);
    }
  }

  /** Lush foliage, water, rocks + time of day. Never allowed to break the game. */
  private buildNature(level: LevelData) {
    if (new URLSearchParams(window.location.search).get('nature') === '0') return;
    try {
      const nature = new NatureSystem(this.gfx);
      if (level.baked) {
        // Open lawn east of the plaza (probed clear: x 50–74, z 8–48)
        buildNatureShowcase(nature, this.world, new THREE.Vector3(60, 0, 26));
      } else {
        replaceFallbackTrees(level.root, nature);
      }
      nature.build();
      this.world.build([
        ...level.collisionMeshes,
        ...this.propCollision,
        ...nature.collisionMeshes(),
      ]);
      applyTimeOfDay(this.gfx, 'afternoon', level, { duration: 0 });
      this.nature = nature;
    } catch (err) {
      console.warn('[world2] nature layer failed, continuing without it', err);
      this.nature = null;
    }
  }

  private static TOD: TimeOfDayPreset[] = ['afternoon', 'golden', 'blue', 'night'];

  /** Cycle afternoon → golden → blue hour → night (2 s transition). */
  cycleTimeOfDay() {
    if (this.nature === null || this.level === null) return;
    const i = Game.TOD.indexOf(this.hud.timeOfDay);
    const next = Game.TOD[(i + 1) % Game.TOD.length];
    applyTimeOfDay(this.gfx, next, this.level);
    this.hud = { ...this.hud, timeOfDay: next };
    this.emit();
  }

  /**
   * ?diag=1 — render the current view under several pipeline configurations
   * and return snapshots, so a GPU-specific artefact can be pinned to a stage
   * from one screenshot on the affected machine.
   */
  runDiagnostics(): { label: string; url: string }[] {
    const g = this.gfx;
    const r = g.renderer;
    const canvas = r.domElement;
    const toonMats: THREE.Material[] = [];
    g.scene.traverse(o => {
      const m = (o as THREE.Mesh).material;
      for (const x of Array.isArray(m) ? m : m !== undefined ? [m] : []) {
        if (x.side === THREE.DoubleSide) toonMats.push(x);
      }
    });
    // Meshes whose material came from toonify(): remember both versions
    const swaps: {
      mesh: THREE.Mesh;
      toon: THREE.Material | THREE.Material[];
      pbr: THREE.Material | THREE.Material[];
    }[] = [];
    const ramps = new Map<THREE.MeshToonMaterial, THREE.Texture | null>();
    const unlit: {
      mesh: THREE.Mesh;
      orig: THREE.Material | THREE.Material[];
      basic: THREE.Material[];
    }[] = [];
    g.scene.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of list) {
        const tm = m as THREE.MeshToonMaterial;
        if (tm.isMeshToonMaterial === true) ramps.set(tm, tm.gradientMap);
      }
      unlit.push({
        mesh,
        orig: mesh.material,
        basic: list.map(m => {
          const sm = m as THREE.MeshStandardMaterial;
          return new THREE.MeshBasicMaterial({
            map: sm.map ?? null,
            color: sm.color?.clone() ?? new THREE.Color(0xffffff),
            vertexColors: sm.vertexColors,
            side: sm.side,
            transparent: sm.transparent,
            alphaTest: sm.alphaTest,
          });
        }),
      });
      if (!list.some(m => m.userData.toonSrc !== undefined)) return;
      const pbr = list.map(m => (m.userData.toonSrc as THREE.Material | undefined) ?? m);
      swaps.push({ mesh, toon: mesh.material, pbr: Array.isArray(mesh.material) ? pbr : pbr[0]! });
    });
    const dof = this.nature?.cinematic?.pass ?? null;
    const set = (o: {
      ink: boolean;
      grade: boolean;
      raw: boolean;
      shadows: boolean;
      front: boolean;
      pbr?: boolean;
      noRamp?: boolean;
      noDof?: boolean;
      unlit?: boolean;
    }) => {
      for (const sw of swaps) sw.mesh.material = o.pbr === true ? sw.pbr : sw.toon;
      if (o.unlit === true)
        for (const u of unlit) u.mesh.material = Array.isArray(u.orig) ? u.basic : u.basic[0]!;
      else for (const u of unlit) if (o.pbr !== true) u.mesh.material = u.orig;
      for (const [m, tex] of ramps) {
        const want = o.noRamp === true ? null : tex;
        if (m.gradientMap !== want) {
          m.gradientMap = want;
          m.needsUpdate = true;
        }
      }
      if (dof) dof.enabled = o.noDof !== true;
      if (g.inkPass) g.inkPass.enabled = o.ink;
      if (g.gradePass) g.gradePass.enabled = o.grade;
      g.rawRender = o.raw;
      if (r.shadowMap.enabled !== o.shadows) {
        r.shadowMap.enabled = o.shadows;
        g.scene.traverse(x => {
          const m = (x as THREE.Mesh).material;
          for (const y of Array.isArray(m) ? m : m !== undefined ? [m] : []) y.needsUpdate = true;
        });
      }
      for (const m of toonMats) {
        const want = o.front ? THREE.FrontSide : THREE.DoubleSide;
        if (m.side !== want) {
          m.side = want;
          m.needsUpdate = true;
        }
      }
    };
    const base = { ink: true, grade: true, raw: false, shadows: true, front: false };
    const configs: [string, Parameters<typeof set>[0]][] = [
      ['A baseline', base],
      ['B ink off', { ...base, ink: false }],
      ['C grade off', { ...base, grade: false }],
      ['D ink+grade off', { ...base, ink: false, grade: false }],
      ['E no post (raw)', { ...base, raw: true }],
      ['F shadows off', { ...base, shadows: false }],
      ['G single-sided', { ...base, front: true }],
      ['H single-sided + no shadows', { ...base, front: true, shadows: false }],
      ['I no depth-of-field', { ...base, noDof: true }],
      ['J no toon (original materials)', { ...base, pbr: true }],
      ['K toon, no light-band texture', { ...base, noRamp: true }],
      ['L unlit (texture colours only)', { ...base, unlit: true }],
    ];
    const out: { label: string; url: string }[] = [];
    for (const [label, c] of configs) {
      set(c);
      g.render(1 / 60);
      g.render(1 / 60);
      out.push({ label, url: canvas.toDataURL('image/jpeg', 0.72) });
    }
    set(base);
    for (const u of unlit) for (const m of u.basic) m.dispose();
    return out;
  }

  /** Leave the showroom and hand control to the player. */
  enterWorld() {
    this.showroom = false;
    this.cam.snap(this.player);
  }

  private updateGraffiti(dt: number, input: InputFrame) {
    const g = this.graffiti;
    if (g === null) return;
    if (input.colorCyclePressed) g.cycleColor(1);
    const p = this.player;
    // Gamepad: right trigger sprays only on foot (it's a grab on the board)
    const active = input.spray && (p.mode === 'foot' || input.mode !== 'gamepad');
    const cam = this.gfx.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    g.update(dt, active, cam.position, dir, p.pos);
    g.updateAudio(this.audio.ctx, this.audio.master, this.audio.noise);
  }

  private handleGlobalInput(input: InputFrame) {
    if (input.cameraTogglePressed) this.cam.cycleMode();
    if (input.micPressed) void this.toggleMic();
  }

  private handlePlayerEvents() {
    const p = this.player;
    for (const e of p.events) {
      switch (e.type) {
        case 'pop':
          this.audio.pop(e.strength);
          break;
        case 'flip':
          this.audio.flip();
          break;
        case 'land':
          this.audio.land(e.impact);
          if (e.impact > 3.5) {
            this.cam.addShake(Math.min(0.6, e.impact / 18));
            this.particles.dustAt(p.pos, Math.min(1, e.impact / 10));
          }
          break;
        case 'push':
          this.audio.push();
          break;
        case 'grindStart':
          this.audio.grindStart(e.railType);
          this.particles.sparksAt(p.pos, p.vel, 18);
          break;
        case 'bail':
          this.audio.bail(e.impact);
          this.cam.addShake(0.7);
          this.particles.dustAt(p.pos, 1);
          break;
        case 'footLand':
          this.audio.land(e.impact * 0.5);
          break;
        case 'climbStart':
        case 'mantle':
          this.audio.footstep();
          break;
        case 'wallJump':
          this.audio.land(2.5);
          this.particles.dustAt(p.pos.clone().add(new THREE.Vector3(0, 1, 0)), 0.35);
          break;
        default:
          break;
      }
    }
  }

  /** Choose the animation clip for the local player. */
  private pickAnim(): {
    clip: string;
    once?: boolean;
    time?: number;
    timeScale?: number;
    fade?: number;
  } {
    const p = this.player;
    if (p.climb !== null) {
      // No climb clip in the rig: the walk cycle's legs read as stepping up
      // the wall; NounCharacter overrides the arms into an overhead reach.
      if (p.climb.mantle !== null) return { clip: 'jump_air', fade: 0.12 };
      return { clip: 'walk', fade: 0.15, timeScale: 0.05 + p.climb.moving * 1.15 };
    }
    if (p.mode === 'foot') {
      if (!p.footGrounded) return { clip: p.vel.y > 0 ? 'jump_air' : 'fall', fade: 0.2 };
      const hs = Math.hypot(p.vel.x, p.vel.z);
      if (p.emote)
        return { clip: ['', 'wave', 'dance', 'celebrate'][p.emote] ?? 'wave', fade: 0.25 };
      if (hs > 5.6) return { clip: 'sprint', timeScale: hs / 6.5 };
      if (hs > 2.6) return { clip: 'run', timeScale: hs / 5.2 };
      if (hs > 0.25) return { clip: 'walk', timeScale: Math.max(0.6, hs / 1.9) };
      return { clip: 'idle', fade: 0.3 };
    }
    switch (p.state) {
      case 'bail':
        return p.bailTimer > 1.7
          ? { clip: 'skate_getup', once: true, fade: 0.25 }
          : { clip: 'skate_bail', once: true, fade: 0.08 };
      case 'grind':
        return { clip: 'skate_grind', fade: 0.1 };
      case 'manual':
        return { clip: 'skate_manual', fade: 0.15 };
      case 'air':
        if (p.flip) return { clip: 'skate_flip', once: true, fade: 0.06 };
        if (p.grab) return { clip: 'skate_grab', fade: 0.15 };
        if (p.airTime < 0.45 && !p.vertLip) return { clip: 'skate_ollie', once: true, fade: 0.06 };
        return { clip: 'skate_air', fade: 0.25 };
      default:
        if (p.sinceLand < 0.32 && p.lastLandImpact > 0)
          return { clip: 'skate_land', once: true, fade: 0.05 };
        if (p.powerslide > 0.5) return { clip: 'skate_powerslide', fade: 0.15 };
        if (p.crouch > 0.45) return { clip: 'skate_crouch', fade: 0.1 };
        if (p.pushTimer >= 0) return { clip: 'skate_push', fade: 0.12 };
        return { clip: 'skate_idle', fade: 0.25 };
    }
  }

  private updateMyCharacter(dt: number) {
    const me = this.me;
    if (!me) return;
    const p = this.player;
    const anim = this.pickAnim();
    me.play(anim);
    this.animTime += dt;

    const travelled = this.lastPos.distanceTo(p.pos) * (p.fakie ? -1 : 1);
    this.lastPos.copy(p.pos);

    // Place rider frame
    me.root.position.copy(p.pos);
    if (p.climb !== null) {
      const c = p.climb;
      me.root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.footYaw);
      me.board.visible = false;
      // Lean the chest into the wall, bob with each pull
      const mantling = c.mantle !== null;
      const lean = mantling ? 0.32 : 0.1 + Math.sin(c.phase * 2) * 0.03 * c.moving;
      me.body.quaternion
        .setFromAxisAngle(new THREE.Vector3(1, 0, 0), lean)
        // Hips sway toward the reaching hand
        .multiply(
          new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 0, 1),
            Math.sin(c.phase) * 0.09 * c.moving,
          ),
        );
      me.body.position.set(0, Math.abs(Math.sin(c.phase)) * 0.05 * c.moving, -0.04);
      this.footstepAcc += dt * c.moving * 2.4;
      if (this.footstepAcc > 1) {
        this.footstepAcc = 0;
        this.audio.footstep();
      }
    } else if (p.mode === 'foot') {
      me.root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.footYaw);
      me.board.visible = false;
      me.body.position.set(0, 0, 0);
      me.body.quaternion.identity();
      // Step sounds
      const hs = Math.hypot(p.vel.x, p.vel.z);
      if (p.footGrounded && hs > 0.5) {
        this.footstepAcc += dt * (hs > 3 ? 3.2 : 2.0);
        if (this.footstepAcc > 1) {
          this.footstepAcc = 0;
          this.audio.footstep();
        }
      }
    } else if (p.state === 'bail') {
      p.getRiderQuaternion(me.root.quaternion);
      me.board.visible = true;
      // Board flies loose in world space
      me.board.position.copy(p.looseBoard.pos).sub(p.pos);
      me.board.position.applyQuaternion(me.root.quaternion.clone().invert());
      me.board.quaternion.copy(me.root.quaternion.clone().invert().multiply(p.looseBoard.quat));
    } else {
      p.getRiderQuaternion(me.root.quaternion);
      // Kickturn/revert: start facing the old way and whip round
      if (p.kickturn > 0) {
        me.root.quaternion.multiply(
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.kickturn),
        );
      }
      me.board.visible = true;
      // Powerslide: board + rider rotate sideways
      const slideYaw = p.powerslide * 1.25 * (p.lean >= 0 ? 1 : -1);
      const manualQ = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        -p.manualPitch,
      );
      const slideQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), slideYaw);
      const grindYaw = p.state === 'grind' && p.grind ? 0 : 0;
      void grindYaw;
      // Flip rotates about the board centre (half deck height)
      const pivot = new THREE.Vector3(0, me.deckTop * 0.6, 0);
      const boardQ = slideQ.clone().multiply(manualQ).multiply(p.boardFlipQuat);
      me.board.quaternion.copy(boardQ);
      me.board.position
        .copy(pivot)
        .sub(pivot.clone().applyQuaternion(boardQ))
        .add(new THREE.Vector3(0, p.boardLift, 0));
      me.body.quaternion.copy(slideQ).multiply(manualQ);
      // Manual pitch pivots around the back wheels: raise the body a touch
      me.body.position.set(0, Math.abs(p.manualPitch) * 0.12, 0);
    }
    me.update(dt, {
      lean: p.mode === 'board' && p.state !== 'bail' ? p.lean : 0,
      travelled: p.mode === 'board' && p.state !== 'air' && p.state !== 'bail' ? travelled : 0,
      riding: p.mode === 'board' && p.state !== 'bail',
      grounded: p.state === 'ground' || p.state === 'manual',
      climb:
        p.climb !== null
          ? { phase: p.climb.phase, amount: p.climb.mantle !== null ? 0.55 : 1 }
          : undefined,
    });

    // Sparks while grinding metal
    if (p.state === 'grind' && p.grind) {
      this.sparkAcc += dt * Math.min(30, p.speed * 4);
      const metal =
        p.grind.rail.type === 'rail' ||
        p.grind.rail.type === 'coping' ||
        p.grind.rail.type === 'ledge';
      while (this.sparkAcc > 1) {
        this.sparkAcc -= 1;
        if (metal) this.particles.sparksAt(p.pos, p.vel, 1);
      }
    }
  }

  private updateAudio(dt: number) {
    const p = this.player;
    const rolling = p.mode === 'board' && (p.state === 'ground' || p.state === 'manual');
    const grinding = p.mode === 'board' && p.state === 'grind';
    this.audio.update(
      p.speed,
      rolling,
      grinding,
      p.grind?.rail.type ?? null,
      0.5,
      this.boardType === 'hover' && p.mode === 'board' && p.state !== 'bail',
    );
    void dt;
  }

  private ensureRemote(id: string, seedK: string): RemoteAvatar | null {
    if (!this.assets) return null;
    let r = this.remotes.get(id);
    if (r && r.seedKey !== seedK) {
      this.removeRemote(id);
      r = undefined;
    }
    if (!r) {
      const seed = parseSeedKey(seedK) ?? randomSeed();
      const character = new NounCharacter(seed, this.assets);
      if (this.gfx.toon) toonify(character.root);
      this.gfx.scene.add(character.root);
      const label = document.createElement('div');
      label.className = 'w2-nametag';
      this.labelLayer.appendChild(label);
      r = { character, label, seedKey: seedK, lastPos: new THREE.Vector3() };
      this.remotes.set(id, r);
    }
    return r;
  }

  private removeRemote(id: string) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.character.dispose();
    r.label?.remove();
    this.remotes.delete(id);
  }

  private updateNetwork(dt: number) {
    const p = this.player;
    const me = this.me;
    if (me) {
      const pose: NetPose = {
        pos: p.mode === 'board' && p.state === 'bail' ? p.pos : p.pos,
        quat: me.root.quaternion,
        boardQuat: me.board.quaternion,
        boardLift: me.board.position.y,
        anim: this.pickAnim().clip,
        animTime: this.animTime,
        mode: p.mode,
        lean: p.lean,
        speed: p.speed,
        name: this.name,
        seedKey: seedKey(this.seed),
        boardType: this.boardType,
        weight: this.weight,
        trick: this.player.combo.entries.length ? comboLabel(this.player.combo).slice(-60) : '',
      };
      this.net.send(dt, pose, this.nounId);
      const fwd = new THREE.Vector3();
      this.gfx.camera.getWorldDirection(fwd);
      this.net.tickVoice(dt, this.gfx.camera.position, fwd);
    }
    this.net.tick(dt);
    const cam = this.gfx.camera;
    const w = this.opts.canvas.clientWidth;
    const h = this.opts.canvas.clientHeight;
    for (const [id, rp] of this.net.players) {
      const r = this.ensureRemote(id, rp.seedKey);
      if (!r) continue;
      const c = rp.current;
      const ch = r.character;
      ch.root.position.copy(c.pos);
      ch.root.quaternion.copy(c.quat);
      ch.board.visible = c.mode === 'board';
      ch.board.quaternion.copy(c.boardQuat);
      ch.board.position.set(0, c.boardLift, 0);
      ch.play({ clip: c.anim, fade: 0.15, once: /bail|getup|ollie|flip|land/.test(c.anim) });
      const travelled = r.lastPos.distanceTo(c.pos);
      r.lastPos.copy(c.pos);
      ch.setBoardType(rp.boardType);
      if (ch.weight !== rp.weight) ch.setWeight(rp.weight);
      ch.update(dt, {
        lean: c.lean,
        travelled: c.mode === 'board' ? travelled : 0,
        riding: c.mode === 'board' && !c.anim.includes('bail'),
      });
      // Name tag
      if (r.label) {
        const v = c.pos
          .clone()
          .add(new THREE.Vector3(0, 2.05, 0))
          .project(cam);
        const visible = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
        const dist = cam.position.distanceTo(c.pos);
        r.label.style.display = visible && dist < 60 ? 'block' : 'none';
        if (visible) {
          r.label.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
          const talk = rp.speaking ? ' 🔊' : '';
          const said =
            rp.transcript && performance.now() - rp.transcriptAt < 6000
              ? `<div class="w2-said">${escapeHtml(rp.transcript)}</div>`
              : '';
          const trick = c.trick ? `<div class="w2-trick">${escapeHtml(c.trick)}</div>` : '';
          r.label.innerHTML = `${said}${trick}<span>${escapeHtml(rp.name || 'noun')}${talk}</span>`;
        }
      }
    }
    for (const id of [...this.remotes.keys()]) if (!this.net.players.has(id)) this.removeRemote(id);
  }

  private pushChat(id: string, text: string) {
    const name = this.net.players.get(id)?.name || 'noun';
    const chat = [...this.hud.chat, { id, name, text, at: performance.now() }].slice(-6);
    this.hud = { ...this.hud, chat };
    this.emit();
  }

  sendChat(text: string) {
    const t = text.trim();
    if (!t) return;
    this.net.sendChat(t);
    const chat = [
      ...this.hud.chat,
      { id: 'me', name: this.name, text: t, at: performance.now() },
    ].slice(-6);
    this.hud = { ...this.hud, chat };
    this.emit();
  }

  async toggleMic() {
    const r = await this.net.toggleMic();
    if (r === 'denied') return r;
    this.hud = { ...this.hud, mic: r === 'on' ? 'on' : 'muted' };
    this.emit();
    return r;
  }

  setSeed(seed: NounSeed) {
    if (!this.assets) return;
    this.seed = seed;
    if (this.me) {
      this.me.dispose();
    }
    this.me = new NounCharacter(seed, this.assets);
    this.me.setBoardType(this.boardType);
    if (this.gfx.toon) toonify(this.me.root);
    this.me.setWeight(this.weight);
    this.gfx.scene.add(this.me.root);
  }

  private updateHud(dt: number, input: InputFrame) {
    this.fpsAcc += dt;
    this.fpsFrames++;
    this.hudAcc += dt;
    if (this.hudAcc < 1 / 15) return;
    this.hudAcc = 0;
    let fps = this.hud.fps;
    if (this.fpsAcc > 0.5) {
      fps = Math.round(this.fpsFrames / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
      // Adaptive quality: sustained low FPS on high → drop pixel ratio
      if (fps < 40) this.lowFpsTime += 0.5;
      else this.lowFpsTime = 0;
      // Gentle steps with a floor: dropping a Retina screen to 1x is what
      // made the whole game read as blurry.
      const floor = window.devicePixelRatio >= 2 ? 1.25 : 1;
      if (this.lowFpsTime > 4 && this.gfx.renderer.getPixelRatio() > floor) {
        this.gfx.renderer.setPixelRatio(Math.max(floor, this.gfx.renderer.getPixelRatio() - 0.25));
        this.resize(this.opts.canvas.clientWidth, this.opts.canvas.clientHeight);
        this.lowFpsTime = 0;
      }
    }
    const p = this.player;
    const c = p.combo;
    const lm = (this.level?.landmarks ?? []).map(l => {
      const d = new THREE.Vector3().subVectors(l.position, p.pos);
      const bearing = Math.atan2(d.x, d.z) - this.cam.controlYaw;
      return { name: l.name, dist: Math.round(Math.hypot(d.x, d.z)), bearing };
    });
    this.hud = {
      ...this.hud,
      mode: p.mode,
      state: p.climb !== null ? 'climb' : p.state,
      speed: p.speed,
      combo: c.entries.length
        ? { label: comboLabel(c), score: comboScore(c), multiplier: c.multiplier }
        : null,
      banked: c.lastBanked,
      session: c.session,
      best: c.best,
      players: this.net.players.size + 1,
      connected: this.net.connected,
      speaking: this.net.voip.isSpeaking,
      fps,
      manualBalance: p.state === 'manual' ? p.manualBalance : null,
      inputMode: input.mode,
      landmarks: lm,
      camMode: this.cam.mode,
      spray: {
        color: SPRAY_COLORS[this.graffiti?.color ?? 2],
        aiming: this.graffiti?.aim !== null && this.graffiti?.aim !== undefined,
        active: this.graffiti?.spraying === true,
      },
    };
    this.emit();
  }

  dispose() {
    this.nature?.dispose();
    this.billboards.dispose();
    this.radio.dispose();
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.input.dispose();
    this.audio.dispose();
    this.graffiti?.dispose();
    this.net.dispose();
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
    this.gfx.dispose();
    this.world.dispose();
  }
}

function pickQuality(): Quality {
  const mobile =
    /android|iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && window.innerWidth < 1100);
  if (mobile) return 'low';
  const cores = navigator.hardwareConcurrency ?? 4;
  return cores >= 8 ? 'high' : 'medium';
}

function escapeHtml(s: string) {
  return s.replace(
    /["&'<>]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
