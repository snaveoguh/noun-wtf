// ── World v2 game orchestrator ───────────────────────────────────────────
//
// Owns the renderer, level, player, characters, camera, audio and network,
// and runs the frame loop. React only mounts the canvas + reads `hud`.

import type { TimeOfDayPreset } from './nature/TimeOfDay';

import * as THREE from 'three';

import { claimAudio } from '@/lib/nounFmBus';

import { isNativeApp } from './audio/beatsPicker';
import { GameRadio, type RadioMode } from './audio/GameRadio';
import { NounBeats } from './audio/NounBeats';
import { Sfx } from './audio/sfx/Sfx';
import { SkateAudio } from './audio/SkateAudio';
import { resolveCallout } from './audio/voice/booth/clips';
import { HEAR_RANGE, PlayerVoices, type RemoteHear } from './audio/voice/booth/runtime';
import { myTag, voiceNet } from './audio/voice/booth/voiceSync';
import { seedVoice } from './audio/voice/cast';
import { RiderVoice } from './audio/voice/RiderVoice';
import { TtsEngine } from './audio/voice/TtsEngine';
import { HOUSE_VOICE, hyped, RIDER_VOICE, ttsVoiceOf } from './audio/voice/ttsVoice';
import { VoiceBox } from './audio/voice/VoiceBox';
import { readDeviceNet, realVoicesOn, type VoiceModeLike } from './audio/voice/voicePrefs';
import { BreakMode } from './breakdance/net/BreakMode';
import { DeckSync } from './character/deckStore';
import { parseSeedKey, randomSeed, seedKey, type NounSeed } from './character/NounAppearance';
import {
  loadCharacterAssets,
  NounCharacter,
  rideTrickLabel,
  type BoardType,
  type CharacterAssets,
} from './character/NounCharacter';
import { Input, type InputFrame } from './core/Input';
import { CutscenePlayer } from './cutscene/CutscenePlayer';
import { gameHost } from './cutscene/host';
import { DragonRide } from './dragon/DragonRide';
import { Drops } from './drops/Drops';
import { Graffiti } from './graffiti/Graffiti';
import { courtSpawn, hoopsEntry } from './hoops/net/court';
import { HideSeekMode } from './hideseek/net/HideSeekMode';
import { HoopsMode } from './hoops/net/HoopsMode';
import { InteriorSystem } from './interiors/InteriorSystem';
import { MissionSystem } from './missions/MissionSystem';
import { applyTimeOfDay, buildNatureShowcase, NatureSystem, replaceFallbackTrees } from './nature';
import { setSkyGroundFog } from './nature/TimeOfDay';
import { CALLOUT_CODES, Net, type NetPose, type RemoteCallout } from './net/Net';
import { fetchStats, riderId, StatsTracker, type MyBests, type WorldStats } from './net/Stats';
import { JerseyCrew } from './npc/JerseyCrew';
import { CollisionWorld } from './physics/Collision';
import { RailSet } from './physics/Rails';
import { FmSpots } from './radio/FmSpots';
import { NounFm } from './radio/NounFm';
import {
  TOWN_THEME_FADE_S,
  TOWN_THEME_SONG,
  townThemeStep,
  type TownThemeState,
} from './radio/townTheme';
import { localTransport, netTransport } from './radio/transport';
import {
  autoQuality,
  type FpsLadder,
  isWeakDevice,
  ladderTick,
  readDevice,
  stepDown,
  WEAK_BOOT_SCALE,
} from './render/deviceTier';
import { Graphics, type Quality } from './render/Graphics';
import { Particles } from './render/Particles';
import { SkateCamera } from './render/SkateCamera';
import { inkExcluded, toonify } from './render/Toon';
import { RecordsHub } from './replay/Records';
import { ReplayView } from './replay/ReplayView';
import { LEGEND_BADGE } from './respect/effects';
import { RespectHooks } from './respect/hooks';
import { RespectSystem } from './respect/RespectSystem';
import { httpSync } from './respect/sync';
import { AudioMixer } from './settings/mixer';
import { settings } from './settings/store';
import { Player } from './skate/Player';
import { comboLabel, comboScore } from './skate/Tricks';
import { townsDecorator } from './towns/build';
import { isGrownTown, townSpawn } from './towns/site';
import { TownSystem } from './towns/TownSystem';
import { TradeClient } from './trade/TradeClient';
import { VanDrive } from './van/VanDrive';
import { buildIceCreamVan, vanStation, type VanStation } from './world/IceCreamVan';
import { landmarksDecorator } from './world/landmarks/decorator';
import { LandmarkSystem } from './world/landmarks/LandmarkSystem';
import { loadLevel, type LevelData } from './world/Level';
import { buildMegaRamp, placeMegaRamp, type PlacedMegaRamp } from './world/MegaRamp';
import { dressingDecorator } from './world/mountain/DressingDecorator';
import { megaRampDecorator } from './world/mountain/MegaRamps';
import { MountainStream } from './world/mountain/MountainStream';
import { bowlCentre, bowlFrame, bowlSpawn, inBowl } from './world/mountain/noggleBowl';
import { noggleBowlDecorator } from './world/mountain/NoggleBowlPark';
import {
  NJ,
  njFrame,
  njInCore,
  njSpawn,
  njSpeedLimit,
  njToWorld,
} from './world/mountain/nounJersey';
import { nounJerseyDecorator, njShopDoor } from './world/mountain/NounJerseyPark';
import { rampDecorator, warmMountainProps } from './world/mountain/Props';
import {
  edgeDistance,
  megaFrame,
  megaSpawn,
  megaSpeedLimit,
  terrainHeight,
  terrainInDomain,
  terrainSurface,
} from './world/mountain/terrain';
import { MEGA_SITE } from './world/mountain/tracks';
import { Wildlife } from './world/mountain/Wildlife';
import { PipBillboards } from './world/PipBillboards';

/** `?megaramp=` dev param: '1' = city boulevard ramp, 'mtn' = spawn on the hero mountain ramp. */
function megaParam(): string | null {
  return new URLSearchParams(window.location.search).get('megaramp');
}

/**
 * Dev / test URL params that teleport you or open the game up. Sessions
 * with any of them never post stats (a `?spot=nj` start is 19 km "downhill").
 */
// Per-frame scratch (the rider pose and particle ground checks run every
// frame; fresh vectors there were steady GC churn on weak phones)
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const DOWN = new THREE.Vector3(0, -1, 0);
const _v = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qInv = new THREE.Quaternion();
const _manualQ = new THREE.Quaternion();
const _slideQ = new THREE.Quaternion();
const _boardQ = new THREE.Quaternion();

function devRun(): boolean {
  const q = new URLSearchParams(window.location.search);
  return ['megaramp', 'spot', 'debug', 'diag'].some(k => q.has(k));
}

/** `?purse=5000` (offline / dev runs only): a bigger starting purse, to try the dragon. */
function purseParam(): number | undefined {
  const n = Number(new URLSearchParams(window.location.search).get('purse'));
  return Number.isInteger(n) && n > 0 && n <= 1_000_000 ? n : undefined;
}

/** `?spot=nj` / `?spot=bowl` dev params: spawn in a secret spot (Noun Jersey, the Noggle Bowl). */
function spotParam(): string | null {
  return new URLSearchParams(window.location.search).get('spot');
}

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
  radio: { on: boolean; mode: RadioMode; label: string; at: number };
  /** Spray colour + whether the crosshair is on a paintable surface. */
  spray: { color: string; aiming: boolean; active: boolean };
  baked: boolean;
  /** Out on the mountain: metres downhill from the city + current surface. */
  mountain: { down: number; surface: string; streak: number } | null;
  /** All-time boards + play counts (null until loaded). */
  stats: WorldStats | null;
  /** This browser's own records. */
  mine: MyBests;
  mineCombo: number | undefined;
  /** One-off banner (e.g. finding the secret spot). */
  toast: { text: string; at: number; tag?: string } | null;
  /** At the Noun Jersey board shop's door (opens the deck designer). */
  shop: boolean;
  /** At the NOUN FM decks inside the ice cream van (opens the station panel). */
  fmDecks: boolean;
}

interface RemoteAvatar {
  character: NounCharacter;
  label: HTMLDivElement | null;
  /** Fortnite-style marker: over far riders, or pinned to the screen edge. */
  pointer: HTMLDivElement | null;
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
  /** Per-bus volumes (settings/mixer.ts): sfx, radio, voice under one master. */
  readonly mixer = new AudioMixer();
  /** Sampled + synthesized one-shots, loops and town ambience (audio/sfx), on the sfx bus. */
  readonly sfx = new Sfx(
    () => this.audio.ctx,
    () => this.bus('sfx'),
    () => this.audio.noise,
    () => this.bus('radio'),
  );
  /** Character voices (audio/voice): every NPC line is spoken, on the npc bus. */
  readonly voice = new VoiceBox(
    () => this.audio.ctx,
    () => this.bus('npc'),
    () => this.audio.noise,
  );
  /**
   * Real character voices (Piper neural TTS in a worker): loads lazily the
   * first time a line is spoken with voices on; VoiceBox babbles meanwhile.
   */
  readonly tts = new TtsEngine();
  /** Settings: real voices auto / on / off (settings/bind.ts sets it). */
  voiceMode: VoiceModeLike = 'auto';
  private readonly deviceNet = readDeviceNet();
  /** Real voices allowed on this device with the current setting. */
  realVoicesOn(): boolean {
    return realVoicesOn(this.voiceMode, this.deviceNet);
  }
  /**
   * Voice Booth (audio/voice/booth/): the player's own recordings and trained
   * model, and other riders' shared voices.
   */
  readonly voices = new PlayerVoices(() => this.audio.ctx, this.voice);
  private calloutSeq = 0;
  private chatVoiceSeq = 0;
  /** The rider's own callouts (bails, speed, records): their recordings, model or seed voice. */
  readonly rider: RiderVoice = new RiderVoice({
    voice: this.voice,
    tts: this.tts,
    seed: () => {
      const s = this.seed;
      return [s.background, s.body, s.accessory, s.head, s.glasses];
    },
    audioCtx: () => this.audio.ctx,
    realOn: () => this.realVoicesOn(),
    busy: () => this.cutscene.id !== null,
    own: this.voices.own,
    house: () => (this.realVoicesOn() ? this.voices.house() : null),
    onSay: pick => {
      // Relay the event + line only (never audio): others play my clip or my TTS
      this.net.callout = [
        ++this.calloutSeq,
        CALLOUT_CODES.indexOf(pick.ev),
        pick.index,
        pick.clean ? 1 : 0,
      ];
    },
  });
  /** In-engine cutscenes (cutscene/): while one plays it owns the camera and the clock. */
  readonly cutscene: CutscenePlayer = new CutscenePlayer(gameHost(this));

  private bus(b: 'sfx' | 'radio' | 'npc'): AudioNode | null {
    const ctx = this.audio.ctx;
    return ctx === null ? null : this.mixer.attach(ctx).bus(b);
  }
  net = new Net();
  particles = new Particles();
  graffiti: Graffiti | null = null;
  /** On-chain drop party pickups (null when VITE_WORLD_DROPS_ADDRESS is unset). */
  readonly drops = Drops.create();
  level: LevelData | null = null;
  assets: CharacterAssets | null = null;
  me: NounCharacter | null = null;
  seed: NounSeed;
  nounId: number;
  name: string;
  remotes = new Map<string, RemoteAvatar>();
  crew: JerseyCrew | null = null;
  /** Noun Trade towns + their customers (towns/): the TownsApi (trade/contract.ts). */
  towns: TownSystem | null = null;
  /** Nounish landmarks (world/landmarks/): discoveries, compass, map pins. */
  landmarks: LandmarkSystem | null = null;
  /** Missions: the Oracle and the cast, progress, the Big Drop (missions/). */
  readonly missions: MissionSystem = new MissionSystem(this);
  /** Enterable buildings (interiors/): doors, rooms, residents; InteriorsApi. */
  readonly interiors: InteriorSystem = new InteriorSystem(this);
  /** Noun Hoops (hoops/net/HoopsMode.ts): while active it owns the frame; the skater stays parked. */
  readonly hoops: HoopsMode = new HoopsMode(this);
  /** Noun Breaks (breakdance/net/BreakMode.ts): the plaza cypher; while active it owns the frame. */
  readonly breaks: BreakMode = new BreakMode(this);
  /** Noun Hide & Seek (hideseek/net/HideSeekMode.ts): played in the normal game; hides hiders' tags. */
  readonly hideseek: HideSeekMode = new HideSeekMode(this);
  /** Noun Trade (trade/): server-held coin + van cargo; towns/ calls trade.act for street sales. */
  readonly trade: TradeClient;
  /** Noun Trade: the drivable ice cream van (van/; trade/contract.ts VanDriveApi). */
  readonly van2: VanDrive;
  /** The Noun dragon (dragon/): bought at the Dragon Roost, called with Z, flown. */
  readonly dragon: DragonRide;
  /** RESPECT (respect/): the score, tiers, persistence; the hooks report the street's events. */
  readonly respect: RespectSystem;
  readonly respectHooks: RespectHooks;
  hud: HudState;
  private raf = 0;
  private last = 0;
  private running = false;
  private disposed = false;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private listeners = new Set<() => void>();
  private labelLayer: HTMLElement;
  /** The name-tag DOM layer (hoops/view puts its ballers' tags there). */
  get labelLayerEl(): HTMLElement {
    return this.labelLayer;
  }
  private opts: GameOptions;
  private lastPos = new THREE.Vector3();
  private footstepAcc = 0;
  private hudAcc = 0;
  private sparkAcc = 0;
  private animTime = 0;
  private lowFpsTime = 0;
  /** The low tier's step-down ladder (auto quality on 'low' only). */
  private ladder: FpsLadder | null = null;
  /** A weak phone (booted at a lower render scale). */
  weakDevice = false;

  constructor(opts: GameOptions) {
    this.opts = opts;
    this.stats.onRecord = e => this.records.onRecord(e);
    this.stats.onRaise = (_k, _v, prev) => {
      // Beating a best you already had (not filling in a first one)
      if (prev !== undefined && prev > 0) this.rider.record();
    };
    this.voice.realVoice = () => (this.realVoicesOn() ? this.tts : null);
    this.labelLayer = opts.labelLayer;
    this.seed = opts.seed ?? randomSeed();
    this.nounId = opts.nounId ?? 0;
    this.name = opts.name ?? `noun ${seedKey(this.seed).split('-')[3]}`;
    const quality = opts.quality ?? autoQuality(readDevice());
    this.gfx = new Graphics(opts.canvas, quality);
    // Low: only the rider's own Noun casts a shadow (NPCs, customers, remotes don't)
    NounCharacter.castShadows = quality !== 'low';
    // 'low' picked automatically: a weak phone boots lighter and the ladder
    // may keep stepping down (an explicit Low / ?q=low stays as chosen)
    if (quality === 'low' && opts.quality === undefined) {
      this.ladder = { bad: 0, age: 0 };
      this.weakDevice = isWeakDevice(readDevice(this.gfx.renderer.getContext()));
      if (this.weakDevice)
        this.gfx.applyLite({
          ...this.gfx.lite,
          scale: Math.min(this.gfx.lite.scale, WEAK_BOOT_SCALE),
        });
    }
    this.input = new Input(opts.canvas);
    this.player = new Player(this.world, this.rails);
    this.cam = new SkateCamera(this.gfx.camera, this.world);
    this.van2 = new VanDrive(this);
    this.dragon = new DragonRide(this);
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
      radio: { on: false, mode: 'off', label: 'radio off', at: 0 },
      spray: { color: '#f3322c', aiming: false, active: false },
      baked: false,
      mountain: null,
      stats: null,
      mine: { best: {}, comboLabel: '' },
      mineCombo: undefined,
      toast: null,
      shop: false,
      fmDecks: false,
    };
    this.fm = new NounFm(opts.offline === true ? localTransport() : netTransport(this.net));
    this.beats = new NounBeats({
      offline: opts.offline === true,
      native: typeof window !== 'undefined' && isNativeApp(window.location.search, window),
    });
    this.radio.setBeats(this.beats);
    this.spots = new FmSpots(this.fm, {
      duck: on => this.duckRadio(on),
      volume: () => this.mixer.gain('radio') * this.radio.volume,
    });
    const tradeOffline = opts.offline === true || devRun();
    this.trade = new TradeClient({
      offline: tradeOffline,
      devPurse: tradeOffline ? purseParam() : undefined,
    });
    // The till: coins for a sale, chips stacking for a buy
    this.trade.onActed = (a, r) => {
      if (!r.ok) return this.sfx.play('ui-cancel', { gain: 0.5 });
      if (a.t === 'sell') this.sfx.play('coins', { gain: 0.8 });
      else if (a.t === 'buy') this.sfx.play('chips', { gain: 0.8 });
      else if (a.t === 'upgrade') this.sfx.play('mission-accept', { gain: 0.6 });
    };
    this.respect = new RespectSystem({ sync: tradeOffline ? null : httpSync(riderId()) });
    this.respectHooks = new RespectHooks(this);
    this.wireFm();
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
      loadLevel(this.gfx.renderer, m => this.setLoading(m), { lite: this.gfx.quality === 'low' }),
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
    if (level.mountain !== undefined) this.buildMountain(level);
    const fountain = level.spawns.find(s => /fountain/i.test(s.name ?? ''));
    if (fountain) this.player.homeSpots.push({ pos: fountain.position.clone(), yaw: fountain.yaw });
    this.placeIceCreamVan(level);
    this.rails.load(level.rails);
    this.placeMegaRamp(level);
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
    this.graffiti.onStroke = (plane, at) => this.respectHooks.stroke(plane, at);
    if (this.drops !== null) this.gfx.scene.add(this.drops.group);
    // Paint is decals on walls: the normals pass would draw each canvas as a
    // solid panel and ink its edges as floating black frames
    inkExcluded.add(this.graffiti.group);
    this.gfx.applyLevel(level);
    this.hud.baked = level.baked;
    this.buildNature(level);
    if (new URLSearchParams(window.location.search).get('dressing') === '1')
      this.buildDressingDemo(level);
    void this.billboards.attach(level.root);
    this.interiors.start(level);

    // Local-only NPC crew at the secret Noun Jersey park (spawns within ~400 m)
    if (this.mountain !== null)
      this.crew = new JerseyCrew({
        scene: this.gfx.scene,
        world: this.world,
        assets,
        quality: this.gfx.quality,
        toon: this.gfx.toon,
        labelLayer: this.labelLayer,
        camera: this.gfx.camera,
        canvas: this.opts.canvas,
        onWave: (name, seed, at) => this.respectHooks.wave(name, seed, at),
      });
    if (this.mountain !== null)
      this.towns = new TownSystem({
        scene: this.gfx.scene,
        camera: this.gfx.camera,
        canvas: this.opts.canvas,
        labelLayer: this.labelLayer,
        toon: this.gfx.toon,
        quality: this.gfx.quality,
        assets: () => this.assets,
        player: this.player,
        controlYaw: () => this.cam.controlYaw,
        toast: (text, tag) => {
          this.hud = { ...this.hud, toast: { text, tag, at: performance.now() } };
          this.emit();
        },
        game: this,
        say: (seed, text, at) => {
          // Customers speak up within earshot
          const d = at.distanceTo(this.player.pos);
          if (d < 32) this.voice.speak({ text, voice: seedVoice(seed), gain: 1 - (d / 32) * 0.75 });
        },
        sound: (id, gain) => this.sfx.play(id, { gain }),
      });
    if (this.mountain !== null)
      this.landmarks = new LandmarkSystem({
        player: this.player,
        controlYaw: () => this.cam.controlYaw,
        toast: (text, tag) => {
          this.hud = { ...this.hud, toast: { text, tag, at: performance.now() } };
          this.emit();
        },
      });
    // Dry Gulch's theme ("Sell It Cold") on riding into the cowboy town
    this.towns?.on('enter', t => this.onTownTheme('enter', t));
    this.towns?.on('leave', t => this.onTownTheme('leave', t));
    // Town ambience: wind in Dry Gulch, waves and gulls in Puerto Noun
    this.towns?.on('enter', t => this.sfx.setBed(t === 'cowboy' || t === 'beach' ? t : null));
    this.towns?.on('leave', () => this.sfx.setBed(null));
    this.me = new NounCharacter(this.seed, assets);
    this.me.setBoardType(this.boardType);
    this.me.setCastShadows(true);
    if (this.gfx.toon) toonify(this.me.root);
    this.me.setWeight(this.weight);
    this.gfx.scene.add(this.me.root);
    this.missions.start();
    const spawn = level.spawns[Math.floor(Math.random() * level.spawns.length)] ?? {
      position: new THREE.Vector3(),
      yaw: 0,
    };
    this.player.spawn(spawn.position, spawn.yaw);
    if (this.megaRamp !== null)
      this.player.spawn(this.megaRamp.spawn.position, this.megaRamp.spawn.yaw);
    // `?megaramp=mtn`: straight onto the hero mountain mega ramp's drop-in
    if (megaParam() === 'mtn' && this.mountainHero !== null)
      this.player.spawn(this.mountainHero.pos, this.mountainHero.yaw);
    // `?spot=nj`: straight into the secret Noun Jersey park, ~19 km down
    if (spotParam() === 'nj' && this.mountain !== null) {
      const sp = njSpawn();
      if (sp !== null) this.player.spawn(new THREE.Vector3(sp.x, sp.y, sp.z), sp.yaw);
    }
    // `?play=hoops`: the homescreen's Noun Hoops entrance, onto the court (a normal session, not devRun)
    if (hoopsEntry() !== null && this.mountain !== null) {
      const sp = courtSpawn();
      if (sp !== null) this.player.spawn(new THREE.Vector3(sp.x, sp.y, sp.z), sp.yaw);
    }
    // `?spot=bowl`: the top of the Noggle Bowl's roll-in, ~42 km down the −X line
    if (spotParam() === 'bowl' && this.mountain !== null) {
      const sp = bowlSpawn();
      if (sp !== null) this.player.spawn(new THREE.Vector3(sp.x, sp.y, sp.z), sp.yaw);
    }
    // `?spot=cowboy` / `beach` / `noggle` / `shroom` / `neon` / `crater`: top of
    // main street in a Noun Trade town (dev; no stats)
    const ts = spotParam();
    if (isGrownTown(ts) && this.mountain !== null) {
      const sp = townSpawn(ts);
      if (sp !== null) this.player.spawn(new THREE.Vector3(sp.x, sp.y, sp.z), sp.yaw);
    }
    this.cam.snap(this.player);
    this.lastPos.copy(this.player.pos);

    // Mesh the mountain around the spawn (terrain, rocks, ramps) so their
    // shaders are in the precompile below instead of hitching on first sight
    this.mountain?.prime(this.player.pos);
    // Precompile shaders so the first frames don't hitch
    this.gfx.renderer.compile(this.gfx.scene, this.gfx.camera);

    if (this.opts.offline === true) voiceNet.enabled = false;
    if (this.opts.offline !== true) {
      this.net.onCallout = (id, c) => void this.remoteCallout(id, c);
      this.net.onChatVoice = (id, tag, clip) => {
        const rp = this.net.players.get(id);
        if (rp === undefined || this.hideseek.labelFor(id) === 'hide') return;
        void this.voices.playRemoteChat(tag, clip, rp.transcript, this.hearOf(rp.current.pos));
      };
      this.net.onLeave = id => this.removeRemote(id);
      this.net.onChat = (id, text) => this.pushChat(id, text);
      this.net.onGraffiti = (id, tags) => this.graffiti?.onTags(id, tags);
      this.net.onOpen = () => {
        this.graffiti?.loadAll();
      };
      this.net.connect();
      void this.refreshStats();
    }
    void this.trade.load();

    this.setLoading(null);
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Call from a user gesture (click/tap/key) to unlock audio. */
  unlockAudio() {
    this.audio.out ??= ctx => this.mixer.attach(ctx).bus('sfx');
    this.audio.start();
    const ctx = this.audio.ctx;
    if (ctx !== null && !this.radioAttached) {
      this.radioAttached = true;
      const radioBus = this.mixer.attach(ctx).bus('radio') ?? ctx.destination;
      // the station ducks under the rider's own spots (intro, town themes),
      // which go straight into the radio bus
      this.radioDuck = ctx.createGain();
      this.radioDuck.connect(radioBus);
      this.radio.attach(ctx, this.radioDuck);
      this.fm.attach(ctx, this.radioDuck, this.audio.noise);
      this.spots.attach(ctx, radioBus);
      this.radio.onNowPlaying = label => {
        this.hud = {
          ...this.hud,
          radio: {
            on: this.radio.mode !== 'off',
            mode: this.radio.mode,
            label,
            at: performance.now(),
          },
        };
        this.emit();
      };
      // Off by default: the site-wide NOUN FM player is the soundtrack; the
      // rider can still tune the van's station in (M / the FM panel)
      this.radio.setMode(savedRadioMode() ?? 'off');
    }
  }

  /** The rider's own spots on the radio (the start-of-game intro, town themes). */
  readonly spots: FmSpots;
  private radioDuck: GainNode | null = null;
  private townTheme: TownThemeState = { lastStart: -Infinity, playing: false };

  private duckRadio(on: boolean) {
    const g = this.radioDuck;
    const ctx = this.audio.ctx;
    if (g === null || ctx === null) return;
    g.gain.setTargetAtTime(on ? 0.12 : 1, ctx.currentTime, on ? 0.15 : 0.4);
    this.radio.setDucked(on);
  }

  private onTownTheme(ev: 'enter' | 'leave', town: string) {
    const blocked =
      this.replay.active ||
      this.missions.ud.active ||
      this.spots.view.intro ||
      this.cutscene.active;
    const r = townThemeStep(this.townTheme, ev, town, performance.now(), blocked);
    this.townTheme = r.state;
    if (r.action === 'play') void this.spots.town(TOWN_THEME_SONG);
    else if (r.action === 'stop') this.spots.stopTown(TOWN_THEME_FADE_S);
  }

  /** Remember the rider's radio pick (M / the FM panel) for next time. */
  saveRadioMode() {
    try {
      localStorage.setItem(RADIO_MODE_STORE, this.radio.mode);
    } catch {
      // no storage
    }
  }

  radio = new GameRadio();
  /** NOUN BEATS' real hip-hop tracks (per player; the worklet is its offline fallback). */
  readonly beats: NounBeats;
  private radioAttached = false;
  /** NOUN FM, the shared station in the ice cream van (radio/). */
  readonly fm: NounFm;
  /** The van's station bits (decks zone, lights), once it's parked. */
  van: VanStation | null = null;
  private fmFwd = new THREE.Vector3();

  /** NOUN FM joins the radio cycle (nothing on air: silence, never a generated station). */
  private wireFm() {
    const fm = this.fm;
    this.radio.fm = fm;
    fm.volume = this.radio.volume;
    fm.onBreak = (tag, text) => {
      this.hud = { ...this.hud, toast: { tag, text, at: performance.now() } };
      this.emit();
    };
    fm.onTrackChange = (label, tuned) => {
      if (tuned) this.radio.onNowPlaying?.(label);
      else {
        this.hud = {
          ...this.hud,
          toast: {
            tag: '📻 NOW PLAYING ON COMMUNITY RADIO',
            text: label.replace(/^COMMUNITY RADIO · /, ''),
            at: performance.now(),
          },
        };
        this.emit();
      }
    };
  }

  private updateFm(dt: number) {
    const cam = this.gfx.camera;
    cam.getWorldDirection(this.fmFwd);
    // One music player at a time: NOUN BEATS on keeps the van's screen down
    this.fm.nearScreen = this.radio.mode !== 'beats';
    this.fm.update(dt, cam.position, this.fmFwd);
    // our radio on, or the van audible nearby: the site-wide NOUN FM holds
    claimAudio(
      'noun-world-radio',
      !this.paused && (this.radio.mode !== 'off' || (this.fm.view.near && this.fm.live)),
    );
    this.van?.animate(dt, this.fm.level, this.fm.live);
    const decks =
      this.van !== null &&
      !this.hoops.active &&
      !this.van2.driving &&
      this.player.speed < 4 &&
      this.van.atDecks(this.player.pos);
    if (decks !== this.hud.fmDecks) {
      this.hud = { ...this.hud, fmDecks: decks };
      this.emit();
    }
  }
  billboards = new PipBillboards();

  /** off → NOUN FM → NOUN BEATS → live streams → off */
  cycleRadio() {
    this.unlockAudio();
    this.radio.cycle();
    this.saveRadioMode();
  }

  nextRadioTrack() {
    this.unlockAudio();
    this.radio.nextTrack();
  }

  resize(w: number, h: number) {
    this.gfx.resize(w, h);
  }

  /**
   * Overrides the gameplay camera just before the world renders (the Grand
   * Exchange's descent through the Noggles Fountain, exchange3d/world/).
   */
  camHook: ((cam: THREE.PerspectiveCamera, dt: number) => void) | null = null;

  /** Backgrounded behind the NounOS desk: no sim, no render, no input. */
  paused = false;

  setPaused(p: boolean) {
    if (this.paused === p) return;
    this.paused = p;
    this.input.setEnabled(!p);
    this.fm.setHidden(p);
    this.beats.setHidden(p);
    if (p) claimAudio('noun-world-radio', false);
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

  /** Dev: Noun Breaks' battle view on its mock battle, in front of the skater (breakdance/view/dev.ts). */
  breakDev = (o?: import('./breakdance/view/dev').BreakDevOptions) =>
    import('./breakdance/view/dev').then(m => m.breakDemo(this, o));

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
    // The Big Drop is snowboards only (peak.ts sets it and restores yours after)
    if (this.missions.ud.active && t !== 'snowboard') return;
    this.boardType = t;
    this.me?.setBoardType(t);
  }
  showroomYaw = 0.5;

  /** Custom deck graphics (board shop) on my board and everyone else's. */
  private decks = new DeckSync();

  step(dt: number, now = performance.now()) {
    if (this.replay.active) {
      // Scenes never run in replays
      if (this.cutscene.active) this.cutscene.abort();
      return this.stepReplay(dt, now);
    }
    this.decks.tick(this.me, this.net, this.remotes);
    if (this.showroom) {
      this.input.poll(now);
      this.updateShowroom(dt);
      // NOUN FM keeps playing over character select
      this.updateFm(dt);
      return;
    }
    // ── Noun Hoops: sim + view at the court; skater, skate camera and stats untouched ──
    if (this.hoops.active) {
      this.input.poll(now); // drain the skate controls so nothing fires on the way back
      this.hoops.step(dt);
      this.updateFm(dt);
      this.animTime += dt; // keeps my parked pose fresh for the room
      this.updateNetwork(dt);
      this.crew?.update(dt, this.hoops.focus);
      this.missions.update(dt);
      this.mountain?.update(this.hoops.focus, this.hoops.focusVel);
      this.nature?.update(dt, this.hoops.focus);
      this.gfx.followShadow(this.hoops.focus);
      this.gfx.render(dt);
      return;
    }
    // ── Noun Breaks: a battle at the plaza cypher; skater parked on the circle's edge ──
    if (this.breaks.active) {
      this.input.poll(now);
      this.breaks.step(dt);
      this.updateFm(dt);
      this.animTime += dt;
      this.updateNetwork(dt);
      this.missions.update(dt);
      this.mountain?.update(this.breaks.focus, this.breaks.focusVel);
      this.nature?.update(dt, this.breaks.focus);
      this.gfx.followShadow(this.breaks.focus);
      this.gfx.render(dt);
      return;
    }
    if (this.cutscene.active) return this.stepCutscene(dt, now);
    this.cutscene.tick();
    const input = this.input.poll(now);
    // Driving the ice cream van: E / R / spray are the van's this frame
    const driving = this.van2.preStep(input) || this.dragon.preStep(input);
    // On foot (and on walls) the mouse is a free cursor for painting
    this.input.freeCursor = !driving && this.player.mode === 'foot' && input.mode !== 'gamepad';
    this.handleGlobalInput(input);
    this.handleSprayKeys(input);

    // Physics in fixed-ish substeps for stability at low FPS — and short
    // enough at mountain speeds (≤ ~0.5 m per step) that nothing tunnels
    // (up to ~2.8 km/s at 60 fps; past that steps stretch to ~0.6 m at 30 fps)
    const steps = Math.min(
      160,
      Math.max(1, Math.ceil(dt / (1 / 90)), Math.ceil((this.player.speed * dt) / 0.5)),
    );
    const h = dt / steps;
    for (let i = 0; i < steps && !driving; i++) {
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
      this.player.backSkate = this.boardType === 'blades';
      this.player.update(h, f, this.cam.controlYaw, now);
      this.handlePlayerEvents();
    }

    if (this.van2.driving) this.van2.drive(dt, input, now);
    else if (this.dragon.riding) this.dragon.fly(dt, input, now);
    else {
      this.cam.update(dt, this.player, input.lookX, input.lookY, now);
      this.updateMyCharacter(dt);
    }
    this.updateAudio(dt);
    {
      const p = this.player;
      const riding =
        p.mode === 'board' && p.state !== 'bail' && !this.van2.driving && !this.dragon.riding;
      this.rider.tick(dt, p.speed, riding);
    }
    this.updateFm(dt);
    this.updateGraffiti(dt, input);
    this.updateNetwork(dt);
    this.van2.update(dt);
    this.dragon.update(dt);
    // On the Big Drop the world you left waits: nothing down there streams
    // or triggers round a rider who's somewhere else entirely
    const away = this.missions.ud.active || this.interiors.inside;
    // A van ride can't touch a drop (its proof would be a 140 km/h walk)
    if (!driving && !away) this.drops?.update(dt, this.player);
    if (!away) this.crew?.update(dt, this.player.pos);
    this.missions.update(dt);
    this.interiors.update(dt);
    if (!away) {
      this.towns?.update(dt);
      this.landmarks?.update(dt);
    }
    this.particles.update(dt, p => {
      const hit = this.world.raycast(_v.set(p.x, p.y + 0.5, p.z), DOWN, 1);
      return hit ? hit.point.y : null;
    });
    this.gfx.followShadow(this.player.pos);
    if (this.mountain !== null && !away) {
      this.mountain.update(this.player.pos, this.player.vel);
      // Out on the slopes (or way up a tower) the sky dome below the horizon
      // turns to haze, since the world falls away below eye level. Down in
      // the streets it stays exactly as it was.
      const c = this.gfx.camera.position;
      const out = edgeDistance(c.x, c.z) + Math.max(0, c.y - 30);
      setSkyGroundFog(THREE.MathUtils.smoothstep(out, 4, 90));
    }
    if (this.wild !== null && !away) {
      // Local rider first (the creature name tag follows them), then remotes
      this.riders.length = 0;
      this.riders.push(this.player.pos);
      for (const r of this.remotes.values()) this.riders.push(r.character.root.position);
      this.wild.update(dt, this.gfx.camera, this.riders);
    }
    if (!away) {
      this.nature?.update(dt, this.player.pos);
      this.billboards.update(dt);
    }
    this.camHook?.(this.gfx.camera, dt);
    this.gfx.render(dt);
    this.updateHud(dt, input);
    if (!away) this.hoops.idle(dt);
    if (!away) this.breaks.idle(dt);
    this.hideseek.update(dt);
  }

  /**
   * A cutscene: the rider's physics and input wait; the world runs on the
   * scene's clock (slow-mo / frozen), the scene owns the camera.
   */
  private stepCutscene(dt: number, now: number) {
    const input = this.input.poll(now); // drained, so nothing fires on the way back
    const cs = this.cutscene;
    cs.update(dt);
    const wdt = dt * cs.timeScale;
    this.updateMyCharacter(wdt);
    this.updateFm(dt);
    this.updateNetwork(dt);
    this.van2.update(wdt);
    const away = this.missions.ud.active || this.interiors.inside;
    if (!away) this.crew?.update(wdt, this.player.pos);
    this.missions.update(wdt);
    if (!away) this.towns?.update(wdt);
    this.particles.update(wdt, () => null);
    this.sfx.update(dt);
    this.gfx.followShadow(this.player.pos);
    if (!away) {
      this.mountain?.update(this.player.pos, this.player.vel);
      this.nature?.update(wdt, this.player.pos);
      this.billboards.update(wdt);
    }
    this.gfx.render(dt);
    // Stats see the scene like the Upside Down: suspended (only time played counts)
    this.updateHud(dt, input);
  }

  /** Replaying: the ride plays back, the world streams around the ghost, nothing else moves. */
  private stepReplay(dt: number, now: number) {
    this.input.poll(now); // drained, so nothing fires on the way back
    this.replay.step(dt);
    const f = this.replay.focus;
    this.mountain?.update(f, this.replay.focusVel);
    this.nature?.update(dt, f);
    this.gfx.followShadow(f);
    this.updateNetwork(dt);
    this.gfx.render(dt);
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
  /** Endless downhill terrain past the alleys (baked plaza only). */
  mountain: MountainStream | null = null;
  /** Critters + hill houses + oddities on the mountain (animated per frame). */
  wild: Wildlife | null = null;
  private riders: THREE.Vector3[] = [];
  /** Drop-in deck of the hero mega ramp on the mountain (an R respawn spot). */
  mountainHero: { pos: THREE.Vector3; yaw: number } | null = null;

  private buildMountain(level: LevelData) {
    try {
      const m = new MountainStream(this.world, this.gfx.quality, this.gfx.toon);
      warmMountainProps();
      // Streams, ponds, bridges, plants, trees + rocks (replaces rockDecorator)
      m.addDecorator(dressingDecorator(this.gfx.quality));
      m.addDecorator(rampDecorator);
      // Mega ramp set pieces: terrace + bridge + ramp, rails stream with the chunk
      m.addDecorator(megaRampDecorator(this.rails));
      // The secret spot (Noun Jersey, ~19 km down the +Z line): same pattern
      m.addDecorator(nounJerseyDecorator(this.rails));
      // …and the Noggle Bowl (~42 km down the −X line): walls, deck, coping
      m.addDecorator(noggleBowlDecorator());
      // Noun Trade towns (Dry Gulch, Noggle City, Puerto Noun, Neon Nouns down
      // the +X line; Shroom Hollow down +Z; Crater Lil down −X)
      m.addDecorator(townsDecorator());
      // Wild landmarks (the Big Noun, Meltdown, the Noggle Wheel, …)
      m.addDecorator(landmarksDecorator());
      // Creatures, hill houses + oddities (also keeps trees out of the houses)
      const wild = new Wildlife(this.gfx.quality);
      m.addDecorator(wild.decorator());
      this.gfx.scene.add(wild.group);
      this.wild = wild;
      this.gfx.scene.add(m.group);
      this.mountain = m;
      this.player.mountain = level.mountain ?? null;
      this.player.terrain = {
        height: terrainHeight,
        inDomain: terrainInDomain,
        surface: terrainSurface,
        speedLimit: (x, y, z) => Math.min(megaSpeedLimit(x, y, z), njSpeedLimit(x, y, z)),
      };
      // R respawn: the hero mega ramp's drop-in, a short way down the +Z line
      m.network.ensure(MEGA_SITE.heroS + 200);
      const hero = m.network.main(0).megas[0];
      if (hero !== undefined && !megaFrame(hero).dead) {
        const sp = megaSpawn(hero);
        this.mountainHero = { pos: new THREE.Vector3(sp.x, sp.y, sp.z), yaw: sp.yaw };
        this.player.homeSpots.push(this.mountainHero);
      }
    } catch (err) {
      console.warn('[world2] mountain failed, continuing without it', err);
      this.mountain = null;
    }
  }

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
        // Parked for good, so NOUN FM broadcasts from it: pop-top, decks, walk-in
        const van = buildIceCreamVan({ station: true });
        van.position.set(x, y, z);
        van.rotation.y = yaw;
        van.updateMatrixWorld(true);
        if (this.gfx.toon) toonify(van);
        this.gfx.scene.add(van);
        this.van = vanStation(van);
        this.fm.vanPos = van.localToWorld(this.van.speakers.clone());
        // Respawn spot: beside the serving hatch, facing out (moves with the van)
        const side = new THREE.Vector3(3.2, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        const home = { pos: new THREE.Vector3(x, y, z).add(side), yaw: yaw + Math.PI / 2 };
        this.player.homeSpots.push(home);
        // Drivable (van/): its walk-in collision is a dynamic body that moves with it
        this.van2.attach(van, home);
        return;
      }
    } catch (err) {
      console.warn('[world2] ice cream van failed to place', err);
    }
  }

  /**
   * Dev set piece (`?megaramp=1`): the mega ramp on the east lawn, spawn on
   * its drop-in. (`?megaramp=mtn` spawns on the hero ramp on the mountain.)
   */
  megaRamp: PlacedMegaRamp | null = null;

  private placeMegaRamp(level: LevelData) {
    if (megaParam() !== '1') return;
    try {
      const ramp = buildMegaRamp({ seed: 1 });
      // East boulevard (x ≈ 64) is open from z −64 to 64; the ~115 m run heads +Z
      // and finishes on the lawn east of the plaza. Render-only palms either side
      // brush the scaffold edges; nothing there has collision.
      const ground = this.world.raycast(
        new THREE.Vector3(64, 20, -62),
        new THREE.Vector3(0, -1, 0),
        40,
      );
      this.megaRamp = placeMegaRamp(ramp, new THREE.Vector3(64, ground?.point.y ?? 0, -62), 0);
      if (this.gfx.toon) toonify(ramp.group);
      this.gfx.scene.add(ramp.group);
      this.propCollision.push(...this.megaRamp.collision);
      this.world.build([...level.collisionMeshes, ...this.propCollision]);
      this.rails.load([...level.rails, ...this.megaRamp.rails]);
    } catch (err) {
      console.warn('[world2] mega ramp failed to place', err);
      this.megaRamp = null;
    }
  }

  /** Lush foliage, water, rocks + time of day. Never allowed to break the game. */
  private buildNature(level: LevelData) {
    if (new URLSearchParams(window.location.search).get('nature') === '0') return;
    try {
      const nature = new NatureSystem(this.gfx);
      if (level.baked) {
        // Open lawn east of the plaza (probed clear: x 50–74, z 8–48)
        if (this.megaRamp === null)
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

  /** Dev (?dressing=1): mountain dressing on a standalone test patch east of the plaza. */
  private buildDressingDemo(level: LevelData) {
    void import('./world/mountain/DressingDemo')
      .then(({ buildDressingDemo }) => {
        if (this.disposed) return;
        const demo = buildDressingDemo(this.gfx);
        this.world.build([
          ...level.collisionMeshes,
          ...this.propCollision,
          ...(this.nature?.collisionMeshes() ?? []),
          ...demo.collisionMeshes,
        ]);
        (window as unknown as { __dressing?: unknown }).__dressing = demo;
        console.info('[world2] dressing demo', demo.stats);
      })
      .catch(err => console.warn('[world2] dressing demo failed', err));
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

  private sprayRay = new THREE.Raycaster();

  private sprayWheel = 0;

  /**
   * Spray-can keys, before the player sees the frame: T / Shift+T colour,
   * [ / ] or wheel (while spraying) nozzle, Ctrl/Cmd+Z undo, Alt+click pick,
   * and 1–9, 0 swatches while pointing at a wall (emotes otherwise).
   */
  private handleSprayKeys(input: InputFrame) {
    const g = this.graffiti;
    if (g === null) return;
    if (input.colorCyclePressed) g.cycleColor(input.sprint && input.mode === 'keyboard' ? -1 : 1);
    if ((input.sizeStep ?? 0) !== 0) g.stepSize(input.sizeStep!);
    this.sprayWheel += input.wheel ?? 0;
    if (Math.abs(this.sprayWheel) >= 60) {
      g.stepSize(this.sprayWheel < 0 ? 1 : -1);
      this.sprayWheel = 0;
    }
    if (input.undoPressed === true) g.undo();
    const onFoot = this.player.mode === 'foot';
    if (input.pickPressed === true && onFoot) g.pickAt();
    const d = input.digitPressed ?? -1;
    if (d >= 0 && onFoot && (g.aim !== null || g.spraying)) {
      g.pickSwatch(d);
      input.emotePressed = 0;
    }
  }

  private updateGraffiti(dt: number, input: InputFrame) {
    const g = this.graffiti;
    if (g === null) return;
    const p = this.player;
    // Gamepad: right trigger sprays only on foot (it's a grab on the board).
    // Never on the Big Drop: its snow isn't anywhere the shared walls know.
    const active =
      input.spray &&
      (p.mode === 'foot' || input.mode !== 'gamepad') &&
      !this.missions.ud.active &&
      !this.interiors.inside;
    const cam = this.gfx.camera;
    const dirs: THREE.Vector3[] = [];
    const trail = this.input.cursorTrail.splice(0);
    if (this.input.freeCursor) {
      // Paint exactly where the mouse points, through every position since
      // last frame (smooth curves even at a low frame rate)
      if (!active || trail.length === 0) trail.length = 0;
      trail.push([this.input.cursorX, this.input.cursorY]);
      for (const [x, y] of trail) {
        this.sprayRay.setFromCamera(new THREE.Vector2(x, y), cam);
        dirs.push(this.sprayRay.ray.direction.clone());
      }
    } else {
      const dir = new THREE.Vector3();
      cam.getWorldDirection(dir);
      dirs.push(dir);
    }
    g.update(dt, active, cam.position, dirs, p.pos, {
      line: input.mode === 'keyboard' && input.sprint,
      cursor: p.mode === 'foot' || active,
    });
    g.updateAudio(this.audio.ctx, this.audio.master, this.audio.noise);
  }

  private handleGlobalInput(input: InputFrame) {
    if (input.cameraTogglePressed) this.cam.cycleMode();
    if (input.micPressed) void this.toggleMic();
  }

  private handlePlayerEvents() {
    const p = this.player;
    this.respectHooks.frame();
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
          this.rider.bail();
          this.respectHooks.bail();
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
    // In the saddle: sat still (the rig has no seated clip; idle beats legs sprinting in the air)
    if (this.dragon.riding) return { clip: 'idle', fade: 0.3 };
    if (p.climb !== null) {
      // No climb clip in the rig: the walk cycle's legs read as stepping up
      // the wall; NounCharacter overrides the arms into an overhead reach.
      if (p.climb.mantle !== null) return { clip: 'jump_air', fade: 0.12 };
      return { clip: 'walk', fade: 0.15, timeScale: 0.05 + p.climb.moving * 1.15 };
    }
    if (p.vault !== null) return { clip: 'jump_air', fade: 0.08 };
    if (p.mode === 'foot') {
      if (!p.footGrounded) return { clip: p.vel.y > 0 ? 'jump_air' : 'fall', fade: 0.2 };
      const hs = Math.hypot(p.vel.x, p.vel.z);
      if (p.emote)
        return { clip: ['', 'wave', 'dance', 'celebrate'][p.emote] ?? 'wave', fade: 0.25 };
      if (this.hideseek.blending) return { clip: 'skate_crouch', fade: 0.35 };
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
      me.root.quaternion.setFromAxisAngle(AXIS_Y, p.footYaw);
      me.board.visible = false;
      // Lean the chest into the wall, bob with each pull
      const mantling = c.mantle !== null;
      const lean = mantling ? 0.32 : 0.1 + Math.sin(c.phase * 2) * 0.03 * c.moving;
      me.body.quaternion
        .setFromAxisAngle(AXIS_X, lean)
        // Hips sway toward the reaching hand
        .multiply(_q.setFromAxisAngle(AXIS_Z, Math.sin(c.phase) * 0.09 * c.moving));
      me.body.position.set(0, Math.abs(Math.sin(c.phase)) * 0.05 * c.moving, -0.04);
      this.footstepAcc += dt * c.moving * 2.4;
      if (this.footstepAcc > 1) {
        this.footstepAcc = 0;
        this.audio.footstep();
      }
    } else if (p.mode === 'foot') {
      me.root.quaternion.setFromAxisAngle(AXIS_Y, p.footYaw);
      me.board.visible = false;
      me.body.position.set(0, 0, 0);
      me.body.quaternion.identity();
      // Vault: tuck forward over the hands
      if (p.vault !== null)
        me.body.quaternion.setFromAxisAngle(
          AXIS_X,
          Math.sin(p.vault.k * Math.PI) * (p.vault.kind === 'over' ? 0.45 : 0.3),
        );
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
      _qInv.copy(me.root.quaternion).invert();
      me.board.position.applyQuaternion(_qInv);
      me.board.quaternion.copy(_qInv).multiply(p.looseBoard.quat);
    } else {
      p.getRiderQuaternion(me.root.quaternion);
      // Kickturn/revert: start facing the old way and whip round
      if (p.kickturn > 0) {
        me.root.quaternion.multiply(_q.setFromAxisAngle(AXIS_Y, p.kickturn));
      }
      me.board.visible = true;
      // Powerslide: board + rider rotate sideways
      const slideYaw = p.powerslide * 1.25 * (p.lean >= 0 ? 1 : -1);
      const manualQ = _manualQ.setFromAxisAngle(AXIS_X, -p.manualPitch);
      const slideQ = _slideQ.setFromAxisAngle(AXIS_Y, slideYaw);
      // Flip rotates about the board centre (half deck height)
      const pivot = _pivot.set(0, me.deckTop * 0.6, 0);
      const boardQ = _boardQ.copy(slideQ).multiply(manualQ).multiply(p.boardFlipQuat);
      me.board.quaternion.copy(boardQ);
      me.board.position
        .copy(pivot)
        .sub(_v.copy(pivot).applyQuaternion(boardQ))
        .add(_v.set(0, p.boardLift, 0));
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
          : p.vault !== null
            ? { phase: 0, amount: 0.6 * Math.sin(Math.min(1, p.vault.k * 1.6) * Math.PI) }
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
      this.boardType === 'scooter' ? 1.45 : this.boardType === 'blades' ? 1.2 : 1,
    );
    this.sfx.update(dt);
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
      const pointer = document.createElement('div');
      pointer.className = 'w2-pointer';
      pointer.innerHTML = '<i>▲</i><span></span>';
      this.labelLayer.appendChild(pointer);
      r = { character, label, pointer, seedKey: seedK, lastPos: new THREE.Vector3() };
      this.remotes.set(id, r);
    }
    return r;
  }

  private removeRemote(id: string) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.character.dispose();
    r.label?.remove();
    r.pointer?.remove();
    this.remotes.delete(id);
  }

  /** How a sound at `pos` reaches the listener (the camera): distance gain + stereo pan. */
  hearOf(pos: THREE.Vector3): RemoteHear {
    const cam = this.gfx.camera;
    const d = cam.position.distanceTo(pos);
    const gain = Math.max(0, 1 - d / HEAR_RANGE) ** 1.3;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const dir = pos.clone().sub(cam.position);
    const len = dir.length();
    const pan = len > 0.5 ? Math.max(-0.85, Math.min(0.85, right.dot(dir) / len)) : 0;
    return { gain, pan };
  }

  /** A remote rider's callout: their recording, else their stock voice. */
  private async remoteCallout(id: string, c: RemoteCallout) {
    const rp = this.net.players.get(id);
    if (rp === undefined || this.hideseek.labelFor(id) === 'hide') return;
    const hear = this.hearOf(rp.current.pos);
    if (hear.gain <= 0.02) return;
    const tag = rp.voiceTag;
    const manifest = await this.voices.manifest(tag);
    const res = resolveCallout({
      ...c,
      listenerClean: this.rider.brain.clean,
      clips: manifest,
      allowClip: this.voices.canHear(tag),
      tts: this.realVoicesOn(),
    });
    if (res === null || res.source === null) return;
    if (res.source === 'recording') {
      const ok = await this.voices.playRemoteClip(tag, res.key, manifest[res.key]!, hear, res.text);
      if (ok) return;
      if (!this.realVoicesOn()) return;
    }
    const seed = parseSeedKey(rp.seedKey) ?? randomSeed();
    const sv = seedVoice([seed.background, seed.body, seed.accessory, seed.head, seed.glasses]);
    this.voices.log.remoteFallbacks++;
    // Everyone's default is the house voice; their seed voice until it's loaded
    const house = this.voices.house();
    this.voice.speak({
      text: res.text,
      voice: sv,
      tts: house !== null ? HOUSE_VOICE : { ...hyped(ttsVoiceOf(sv)), gap: RIDER_VOICE.gap },
      engine: house ?? undefined,
      gain: hear.gain,
      pan: hear.pan,
    });
  }

  private updateNetwork(dt: number) {
    const p = this.player;
    // Share my voice tag only while sharing recordings is on
    this.net.voiceTag = settings.get().shareRecordings ? (myTag() ?? '') : '';
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
        vehicle: this.van2.driving ? 'van' : this.dragon.riding ? 'dragon' : undefined,
        trick: this.player.combo.entries.length
          ? rideTrickLabel(comboLabel(this.player.combo), this.boardType).slice(-60)
          : '',
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
      // Name tag (hide & seek: hidden / faint for hiders, see hideseek/policy.ts)
      const show = this.hideseek.labelFor(id);
      if (r.label) {
        const v = c.pos
          .clone()
          .add(new THREE.Vector3(0, 2.05, 0))
          .project(cam);
        const visible = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
        const dist = cam.position.distanceTo(c.pos);
        r.label.style.display = visible && dist < 60 && show !== 'hide' ? 'block' : 'none';
        r.label.style.opacity = show === 'faint' ? '0.4' : '';
        if (visible) {
          r.label.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
          const talk = rp.speaking ? ' 🔊' : '';
          const said =
            rp.transcript && performance.now() - rp.transcriptAt < 6000
              ? `<div class="w2-said">${escapeHtml(rp.transcript)}</div>`
              : '';
          const trick = c.trick ? `<div class="w2-trick">${escapeHtml(c.trick)}</div>` : '';
          r.label.innerHTML = `${said}${trick}<span>${escapeHtml(rp.name || 'noun')}${rp.respectBadge === 'L' ? LEGEND_BADGE : ''}${talk}</span>`;
        }
        if (r.pointer) {
          const close = (visible && dist < 60) || show !== 'show';
          r.pointer.style.display = close ? 'none' : 'block';
          if (!close)
            this.placePointer(r.pointer, c.pos, v, visible, dist, rp.name || 'noun', w, h);
        }
      }
    }
    for (const id of [...this.remotes.keys()]) if (!this.net.players.has(id)) this.removeRemote(id);
  }

  /**
   * Point at a rider we can't see well: a marker over them when they're on
   * screen but far off, otherwise an arrow pinned to the screen edge in
   * their direction (behind you points down), with name and distance.
   */
  private placePointer(
    el: HTMLDivElement,
    pos: THREE.Vector3,
    ndc: THREE.Vector3,
    onScreen: boolean,
    dist: number,
    name: string,
    w: number,
    h: number,
  ) {
    const span = el.lastElementChild as HTMLSpanElement | null;
    const text = `${name} ${dist >= 1000 ? `${(dist / 1000).toFixed(1)}km` : `${Math.round(dist)}m`}`;
    if (span && span.textContent !== text) span.textContent = text;
    const arrow = el.firstElementChild as HTMLElement | null;
    if (onScreen) {
      el.classList.remove('w2-edge');
      if (arrow) arrow.style.transform = 'rotate(180deg)';
      el.style.transform = `translate(-50%, -100%) translate(${((ndc.x + 1) / 2) * w}px, ${((1 - ndc.y) / 2) * h}px)`;
      return;
    }
    // Direction in camera space; behind the camera the projection flips,
    // so steer by the camera-space x/y instead (straight behind → bottom)
    const pc = pos
      .clone()
      .add(new THREE.Vector3(0, 1.5, 0))
      .applyMatrix4(this.gfx.camera.matrixWorldInverse);
    let dx = pc.x;
    let dy = pc.y;
    if (pc.z > 0) {
      dy = -Math.abs(dy) - Math.abs(dx) * 0.25 - 1;
    }
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    // Keep clear of the HUD up top and the site tray / touch pad below
    const mx = 44;
    const top = 90;
    const bottom = 110;
    const cy = (top + (h - bottom)) / 2;
    const hw = w / 2 - mx;
    const hh = (h - bottom - top) / 2;
    const t = Math.min(hw / Math.max(1e-6, Math.abs(dx)), hh / Math.max(1e-6, Math.abs(dy)));
    const x = w / 2 + dx * t;
    const y = cy - dy * t;
    el.classList.add('w2-edge');
    if (arrow) arrow.style.transform = `rotate(${Math.atan2(dx, dy)}rad)`;
    el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
  }

  private pushChat(id: string, text: string) {
    const name = this.hideseek.chatName(id, this.net.players.get(id)?.name || 'noun');
    const chat = [...this.hud.chat, { id, name, text, at: performance.now() }].slice(-6);
    this.hud = { ...this.hud, chat };
    this.emit();
  }

  sendChat(text: string) {
    const t = text.trim();
    if (!t) return;
    this.net.sendChat(t);
    // My own words in my own voice (Voice Booth model), if that's on
    void this.voices.speakChat(t, riderId()).then(r => {
      if (r !== null) this.net.chatVoice = [r.tag, r.id, ++this.chatVoiceSeq];
    });
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
    this.me.setCastShadows(true);
    if (this.gfx.toon) toonify(this.me.root);
    this.me.setWeight(this.weight);
    this.gfx.scene.add(this.me.root);
  }

  /** Records, lifetime totals and play counts (world-stats board). */
  readonly stats = new StatsTracker(
    () => this.name,
    () => this.opts.offline === true || devRun(),
  );

  /** Instant replay of a recorded ride (a slow-mo ghost); the game pauses meanwhile. */
  readonly replay = new ReplayView({
    // Read late: field initialisers run before the constructor makes gfx
    scene: () => this.gfx.scene,
    camera: () => this.gfx.camera,
    makeRider: () => {
      if (!this.assets) return null;
      const r = new NounCharacter(this.seed, this.assets);
      r.setBoardType(this.boardType);
      if (this.gfx.toon) toonify(r.root);
      return r;
    },
  });
  /** Record cards (saved / refused, REPLAY, APPEAL), told by the stats tracker. */
  readonly records = new RecordsHub(this.stats, this.replay, () => this.name);
  private statsPolledAt = -Infinity;

  /** Reload the all-time boards (opening the league, and once a minute). */
  async refreshStats() {
    this.statsPolledAt = performance.now();
    this.stats.flush(false);
    const s = await fetchStats();
    if (s === null) return;
    this.hud = { ...this.hud, stats: s };
    this.emit();
  }

  private trackStats(dt: number) {
    // Offline the ride is still kept for replays, just never posted
    if (this.opts.offline === true && !this.stats.devLive)
      return this.stats.recordOnly(dt, this.player);
    this.stats.update(dt, this.player, this.player.combo, this.hud.mountain?.down ?? 0);
    if (performance.now() - this.statsPolledAt > 60_000) void this.refreshStats();
    const mine = this.stats.mine;
    if (mine !== this.hud.mine || mine.best.combo !== this.hud.mineCombo) {
      this.hud = { ...this.hud, mine, mineCombo: mine.best.combo };
    }
  }

  private updateHud(dt: number, input: InputFrame) {
    this.trackStats(dt);
    this.fpsAcc += dt;
    this.fpsFrames++;
    this.hudAcc += dt;
    if (this.hudAcc < 1 / 15) return;
    this.hudAcc = 0;
    let fps = this.hud.fps;
    if (this.fpsAcc > 0.5) {
      const window_ = this.fpsAcc;
      fps = Math.round(this.fpsFrames / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
      // Low tier on auto: the step-down ladder (render scale → shadows → post)
      if (this.ladder !== null) {
        if (ladderTick(this.ladder, fps, window_)) {
          const next = stepDown(this.gfx.lite);
          if (next !== null) {
            this.gfx.applyLite(next);
            this.resize(this.opts.canvas.clientWidth, this.opts.canvas.clientHeight);
            if (import.meta.env.DEV) console.info('[perf] stepped down', next, `${fps} fps`);
          } else this.ladder = null; // nothing left to drop
        }
      }
      // Adaptive quality: sustained low FPS on high → drop pixel ratio
      if (fps < 40) this.lowFpsTime += 0.5;
      else this.lowFpsTime = 0;
      // Gentle steps with a floor: dropping a Retina screen to 1x is what
      // made the whole game read as blurry.
      const floor = window.devicePixelRatio >= 2 ? 1.25 : 1;
      if (
        this.gfx.quality !== 'low' &&
        this.lowFpsTime > 4 &&
        this.gfx.renderer.getPixelRatio() > floor
      ) {
        this.gfx.renderer.setPixelRatio(Math.max(floor, this.gfx.renderer.getPixelRatio() - 0.25));
        this.resize(this.opts.canvas.clientWidth, this.opts.canvas.clientHeight);
        this.lowFpsTime = 0;
      }
    }
    const p = this.player;
    const c = p.combo;
    const lm = (this.level?.landmarks ?? []).map(l => {
      const dx = l.position.x - p.pos.x;
      const dz = l.position.z - p.pos.z;
      const bearing = Math.atan2(dx, dz) - this.cam.controlYaw;
      return { name: l.name, dist: Math.round(Math.hypot(dx, dz)), bearing };
    });
    if (this.mountain !== null) this.updateSecretSpot(lm);
    if (this.mountain !== null) this.updateBowl(lm);
    this.towns?.landmarks(lm);
    this.landmarks?.compass(lm);
    this.hud = {
      ...this.hud,
      mode: p.mode,
      state: p.climb !== null ? 'climb' : p.state,
      speed: p.speed,
      combo: c.entries.length
        ? {
            label: rideTrickLabel(comboLabel(c), this.boardType),
            score: comboScore(c),
            multiplier: c.multiplier,
          }
        : null,
      banked:
        c.lastBanked !== null
          ? { ...c.lastBanked, label: rideTrickLabel(c.lastBanked.label, this.boardType) }
          : null,
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
      mountain: this.missions.ud.active
        ? {
            down: Math.round(this.missions.ud.depth),
            surface: 'snow',
            streak: Math.round(p.runTime),
          }
        : this.mountain !== null && edgeDistance(p.pos.x, p.pos.z) > 0
          ? {
              down: Math.round(edgeDistance(p.pos.x, p.pos.z)),
              surface: p.surface ?? 'grass',
              streak: Math.round(p.runTime),
            }
          : null,
      spray: {
        color: this.graffiti?.colorHex ?? '#f3322c',
        aiming: this.graffiti?.aim !== null && this.graffiti?.aim !== undefined,
        active: this.graffiti?.spraying === true,
      },
    };
    this.emit();
  }

  /** Secret spot: no compass entry until you're close, a banner the first time in. */
  private njFound = false;

  private updateSecretSpot(lm: { name: string; dist: number; bearing: number }[]) {
    const f = njFrame();
    if (f === null) return;
    const p = this.player.pos;
    const door = njShopDoor(f, { x: 0, z: 0 });
    const shop =
      Math.hypot(door.x - p.x, door.z - p.z) < 2.6 &&
      Math.abs(p.y - f.P) < 2 &&
      this.player.speed < 6;
    if (shop !== this.hud.shop) this.hud = { ...this.hud, shop };
    const c = njToWorld(f, NJ.W / 2, NJ.L / 2, { x: 0, z: 0 });
    const dx = c.x - p.x;
    const dz = c.z - p.z;
    const dist = Math.hypot(dx, dz);
    // (first: the compass only shows the first few)
    if (dist < 420)
      lm.unshift({
        name: 'Noun Jersey',
        dist: Math.round(dist),
        bearing: Math.atan2(dx, dz) - this.cam.controlYaw,
      });
    if (!this.njFound && njInCore(p.x, p.z)) {
      this.njFound = true;
      this.hud = {
        ...this.hud,
        toast: { text: 'SECRET SPOT FOUND: NOUN JERSEY', at: performance.now() },
      };
    }
  }

  /** The Noggle Bowl: same as the secret spot (compass when close, a banner the first time in). */
  private bowlFound = false;

  private updateBowl(lm: { name: string; dist: number; bearing: number }[]) {
    const p = this.player.pos;
    const f = bowlFrame(p.x, p.z);
    if (f === null) return;
    const c = bowlCentre(f, { x: 0, z: 0 });
    const dx = c.x - p.x;
    const dz = c.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 600)
      lm.unshift({
        name: 'Noggle Bowl',
        dist: Math.round(dist),
        bearing: Math.atan2(dx, dz) - this.cam.controlYaw,
      });
    if (!this.bowlFound && inBowl(p.x, p.z)) {
      this.bowlFound = true;
      this.hud = {
        ...this.hud,
        toast: {
          tag: '⌐◨-◨ 42 km out',
          text: 'SECRET SPOT FOUND: THE NOGGLE BOWL',
          at: performance.now(),
        },
      };
    }
  }

  dispose() {
    claimAudio('noun-world-radio', false);
    this.cutscene.abort();
    this.voice.stopAll();
    this.tts.dispose();
    this.voices.dispose();
    this.sfx.dispose();
    this.missions.dispose();
    this.interiors.dispose();
    this.hoops.dispose();
    this.breaks.dispose();
    this.hideseek.dispose();
    this.van2.dispose();
    this.dragon.dispose();
    this.stats.dispose();
    this.drops?.dispose();
    this.mountain?.dispose();
    this.wild?.dispose();
    this.nature?.dispose();
    this.billboards.dispose();
    this.radio.dispose();
    this.beats.dispose();
    this.fm.dispose();
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.input.dispose();
    this.audio.dispose();
    this.graffiti?.dispose();
    this.net.dispose();
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
    this.crew?.dispose();
    this.towns?.dispose();
    this.respect.dispose();
    this.gfx.dispose();
    this.world.dispose();
  }
}

function escapeHtml(s: string) {
  return s.replace(
    /["&'<>]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

// v3: the site-wide NOUN FM player became the default soundtrack and the
// pirate station went, so older picks are dropped once (everyone starts off)
const RADIO_MODE_STORE = 'noun-world-radio-v3';

/** The radio mode the rider last picked (null: never picked, off by default). */
function savedRadioMode(): 'off' | 'fm' | 'beats' | null {
  try {
    const m = localStorage.getItem(RADIO_MODE_STORE);
    return m === 'off' || m === 'fm' || m === 'beats' ? m : null;
  } catch {
    return null;
  }
}
