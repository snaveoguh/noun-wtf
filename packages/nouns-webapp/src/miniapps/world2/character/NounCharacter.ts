// ── Rigged Noun character + skateboard (runtime side of the Blender pipeline) ──
//
// Loads /world2/noun_character.glb (+ manifest) once, clones per player,
// re-skins the shirt from the Noun seed, attaches the voxel head to the
// `head` bone and drives an AnimationMixer from the player state.

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

import { buildBodyTexture, buildNounHead, type NounSeed } from './NounAppearance';

export interface CharacterManifest {
  bones?: Record<string, string>;
  head?: { bone?: string; offset?: [number, number, number]; width?: number; scale?: number };
  uvRegions?: Record<string, [number, number, number, number]>;
  uvConvention?: string;
  clips?: Record<string, { duration?: number; loop?: boolean }>;
  skateboard?: {
    deckTopHeight?: number;
    wheelAxis?: [number, number, number] | string;
    wheelRadius?: number;
  };
  [k: string]: unknown;
}

export interface CharacterAssets {
  gltf: GLTF | null;
  board: GLTF | null;
  manifest: CharacterManifest;
  clips: Map<string, THREE.AnimationClip>;
}

let assetsPromise: Promise<CharacterAssets> | null = null;

export function loadCharacterAssets(): Promise<CharacterAssets> {
  if (assetsPromise) return assetsPromise;
  assetsPromise = (async () => {
    const loader = new GLTFLoader();
    const load = (url: string) =>
      new Promise<GLTF | null>(resolve =>
        loader.load(
          url,
          g => resolve(g),
          undefined,
          () => resolve(null),
        ),
      );
    const [gltf, board, manifest] = await Promise.all([
      load('/world2/noun_character.glb'),
      load('/world2/skateboard.glb'),
      fetch('/world2/character_manifest.json')
        .then(r =>
          r.ok && !(r.headers.get('content-type') ?? '').includes('html') ? r.json() : {},
        )
        .catch(() => ({})),
    ]);
    const clips = new Map<string, THREE.AnimationClip>();
    for (const c of gltf?.animations ?? []) clips.set(c.name, c);
    return { gltf, board, manifest: manifest as CharacterManifest, clips };
  })();
  return assetsPromise;
}

export interface AnimParams {
  clip: string;
  /** Crossfade seconds. */
  fade?: number;
  once?: boolean;
  timeScale?: number;
  /** Drive the clip time directly (e.g. push cycle). */
  time?: number;
}

const FALLBACK_CLIP: Record<string, string[]> = {
  skate_idle: ['skate_idle', 'idle'],
  skate_push: ['skate_push', 'skate_idle', 'walk'],
  skate_crouch: ['skate_crouch', 'skate_idle'],
  skate_ollie: ['skate_ollie', 'skate_air', 'jump_air'],
  skate_flip: ['skate_flip', 'skate_ollie', 'skate_air'],
  skate_air: ['skate_air', 'jump_air', 'skate_idle'],
  skate_grab: ['skate_grab', 'skate_air'],
  skate_land: ['skate_land', 'skate_idle'],
  skate_grind: ['skate_grind', 'skate_idle'],
  skate_manual: ['skate_manual', 'skate_idle'],
  skate_powerslide: ['skate_powerslide', 'skate_crouch', 'skate_idle'],
  skate_bail: ['skate_bail', 'fall'],
  skate_getup: ['skate_getup', 'idle'],
  idle: ['idle'],
  walk: ['walk', 'idle'],
  run: ['run', 'walk'],
  sprint: ['sprint', 'run'],
  jump_air: ['jump_air', 'fall', 'idle'],
  fall: ['fall', 'jump_air'],
  land: ['land', 'idle'],
  wave: ['wave', 'idle'],
  dance: ['dance', 'idle'],
  celebrate: ['celebrate', 'wave'],
};

const _q = new THREE.Quaternion();

export type BoardType = 'skate' | 'hover';
/** Head width in metres (body is ~1.15 m tall without it). */
export const HEAD_WIDTH = 1.15;

/** Build steps for the select screen: -1 = skinny … 1 = clinically obese. */
export const BUILDS = [
  { name: 'SKINNY', w: -1 },
  { name: 'SLIM', w: -0.5 },
  { name: 'REGULAR', w: 0 },
  { name: 'THICC', w: 0.35 },
  { name: 'CHONK', w: 0.7 },
  { name: 'CLINICALLY OBESE', w: 1 },
] as const;
export const HOVER_HEIGHT = 0.16;

let glowTex: THREE.CanvasTexture | null = null;
function getGlowTexture() {
  if (glowTex !== null) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(120,240,255,0.85)');
  g.addColorStop(0.6, 'rgba(40,140,255,0.25)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

export class NounCharacter {
  /** Rider frame root (placed on the surface, +Z = board nose / facing). */
  root = new THREE.Group();
  /** Body (rig) container — offsets from the rider frame. */
  body = new THREE.Group();
  /** Skateboard visual (child of root). */
  board = new THREE.Group();
  boardModel: THREE.Object3D | null = null;
  wheels: THREE.Object3D[] = [];
  private wheelAxis = new THREE.Vector3(1, 0, 0);
  private wheelRadius = 0.027;
  mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private currentName = '';
  private headBone: THREE.Object3D | null = null;
  head: THREE.Group | null = null;
  deckTop = 0.1;
  hasRig = false;
  seed: NounSeed;
  private assets: CharacterAssets;
  /** Lifts rider + board together (hoverboard float). */
  private lift = new THREE.Group();
  boardType: BoardType = 'skate';
  private hoverFx: THREE.Group | null = null;
  private hoverParts: THREE.Object3D[] = [];
  private hoverT = Math.random() * 10;

  constructor(seed: NounSeed, assets: CharacterAssets) {
    this.seed = seed;
    this.assets = assets;
    this.root.add(this.lift);
    this.lift.add(this.body);
    this.lift.add(this.board);
    this.buildBody();
    this.buildBoard();
  }

  private buildBody() {
    const { gltf, manifest } = this.assets;
    // Nouns proportions: the head dominates the silhouette.
    const headInfo = buildNounHead(this.seed, Math.max(HEAD_WIDTH, manifest.head?.width ?? 0));
    this.head = headInfo.group;
    if (gltf) {
      const model = cloneSkinned(gltf.scene) as THREE.Object3D;
      this.body.add(model);
      const regions = manifest.uvRegions ?? {};
      const { texture, shirt } = buildBodyTexture(this.seed, {
        front: regions.front ?? regions.torso_front ?? [0, 0, 0.5, 0.5],
        back: regions.back ?? regions.torso_back,
      });
      model.traverse(o => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        const out = mats.map(mat => {
          const sm = (mat as THREE.MeshStandardMaterial).clone();
          if (/nounbody/i.test(sm.name)) {
            sm.map = texture;
            sm.color.set(0xffffff);
            sm.roughness = 0.85;
          } else if (/nounskin/i.test(sm.name)) {
            sm.color.copy(headInfo.skin);
            sm.roughness = 0.7;
          } else if (/sleeve/i.test(sm.name)) {
            sm.color.copy(shirt);
          }
          return sm;
        });
        m.material = Array.isArray(m.material) ? out : out[0];
      });
      const boneName = manifest.head?.bone ?? manifest.bones?.head ?? 'head';
      model.traverse(o => {
        const n = o.name.replace(/[.:]/g, '');
        if (!this.headBone && (o.name === boneName || n === boneName.replace(/[.:]/g, '')))
          this.headBone = o;
      });
      if (this.headBone) {
        const off = manifest.head?.offset ?? [0, 0, 0];
        // Sit the head just above the collar
        this.head.position.set(off[0], off[1] + 0.06, off[2]);
        if (manifest.head?.scale !== undefined && manifest.head.scale > 0)
          this.head.scale.setScalar(manifest.head.scale);
        // Undo any bone scale so the head keeps its metric size
        const ws = new THREE.Vector3();
        model.updateMatrixWorld(true);
        this.headBone.getWorldScale(ws);
        if (ws.x > 0 && Math.abs(ws.x - 1) > 1e-3) this.head.scale.divideScalar(ws.x);
        this.headBaseScale = this.head.scale.x;
        this.headBone.add(this.head);
      } else {
        this.head.position.set(0, 1.15, 0);
        this.body.add(this.head);
      }
      this.mixer = new THREE.AnimationMixer(model);
      this.hasRig = this.assets.clips.size > 0;
    } else {
      // Procedural blocky stand-in until the rigged GLB is available.
      const { shirt } = buildBodyTexture(this.seed, {});
      const mk = (
        w: number,
        h: number,
        d: number,
        color: THREE.ColorRepresentation,
        y: number,
        x = 0,
      ) => {
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(w, h, d),
          new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
        );
        m.position.set(x, y, 0);
        m.castShadow = true;
        this.body.add(m);
        return m;
      };
      mk(0.44, 0.5, 0.26, shirt, 0.92);
      mk(0.16, 0.5, 0.18, 0x2c3e66, 0.42, -0.11);
      mk(0.16, 0.5, 0.18, 0x2c3e66, 0.42, 0.11);
      mk(0.12, 0.42, 0.14, shirt, 0.92, -0.3);
      mk(0.12, 0.42, 0.14, shirt, 0.92, 0.3);
      this.head.position.set(0, 1.18, 0);
      this.body.add(this.head);
    }
  }

  private buildBoard() {
    const { board, manifest } = this.assets;
    const sb = manifest.skateboard ?? {};
    if (board) {
      const m = board.scene.clone(true);
      m.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
        if (/^wheel/i.test(o.name)) this.wheels.push(o);
      });
      this.board.add(m);
      this.boardModel = m;
      this.deckTop = sb.deckTopHeight ?? 0.1;
      if (Array.isArray(sb.wheelAxis)) this.wheelAxis.set(...sb.wheelAxis).normalize();
      if (sb.wheelRadius !== undefined && sb.wheelRadius > 0) this.wheelRadius = sb.wheelRadius;
    } else {
      const g = new THREE.Group();
      const deck = new THREE.Mesh(
        new THREE.BoxGeometry(0.21, 0.02, 0.8),
        new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.95 }),
      );
      deck.position.y = 0.09;
      deck.castShadow = true;
      g.add(deck);
      const wm = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.5 });
      for (const [x, z] of [
        [-0.08, 0.26],
        [0.08, 0.26],
        [-0.08, -0.26],
        [0.08, -0.26],
      ]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.032, 14), wm);
        w.rotation.z = Math.PI / 2;
        const holder = new THREE.Group();
        holder.position.set(x, 0.027, z);
        holder.add(w);
        g.add(holder);
        this.wheels.push(holder);
      }
      this.board.add(g);
      this.boardModel = g;
      this.deckTop = 0.1;
    }
  }

  /** Swap between the skateboard and the hoverboard look. */
  /** -1 skinny … 0 regular … 1 clinically obese. */
  weight = 0;
  private morphMeshes: THREE.Mesh[] | null = null;

  setWeight(w: number) {
    this.weight = THREE.MathUtils.clamp(w, -1, 1);
    if (this.morphMeshes === null) {
      this.morphMeshes = [];
      this.body.traverse(o => {
        const m = o as THREE.Mesh;
        const dict = m.morphTargetDictionary;
        if (m.isMesh && dict !== undefined && ('weight_heavy' in dict || 'weight_thin' in dict)) {
          this.morphMeshes!.push(m);
        }
      });
    }
    const heavy = Math.max(0, this.weight);
    const thin = Math.max(0, -this.weight);
    if (this.morphMeshes.length > 0) {
      for (const m of this.morphMeshes) {
        const dict = m.morphTargetDictionary!;
        const inf = m.morphTargetInfluences!;
        if (dict.weight_heavy !== undefined) inf[dict.weight_heavy] = heavy;
        if (dict.weight_thin !== undefined) inf[dict.weight_thin] = thin;
      }
      this.body.scale.set(1, 1, 1);
    } else {
      // Fallback until the rig ships weight morphs: widen/narrow the body
      // across the shoulders only (keeps feet on the bolts), and undo it on
      // the head so the Noun head stays square.
      const sx = 1 + heavy * 0.75 - thin * 0.22;
      const sz = 1 + heavy * 0.35 - thin * 0.12;
      this.body.scale.set(sx, 1, sz);
      if (this.head !== null)
        this.head.scale.set(this.headBaseScale / sx, this.headBaseScale, this.headBaseScale / sz);
    }
  }

  private headBaseScale = 1;

  setBoardType(t: BoardType) {
    if (t === this.boardType) return;
    this.boardType = t;
    if (this.hoverParts.length === 0 && this.boardModel !== null) {
      this.boardModel.traverse(o => {
        if (/^(truck|wheel)/i.test(o.name)) this.hoverParts.push(o);
      });
      if (this.hoverParts.length === 0) this.hoverParts.push(...this.wheels);
    }
    for (const o of this.hoverParts) o.visible = t === 'skate';
    if (t === 'hover' && this.hoverFx === null) {
      const fx = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({
        map: getGlowTexture(),
        color: new THREE.Color(0x7ff4ff).multiplyScalar(3),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      for (const z of [0.24, -0.24]) {
        const pad = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), mat);
        pad.rotation.x = -Math.PI / 2;
        pad.position.set(0, 0.035, z);
        fx.add(pad);
      }
      // Ground splash: soft light pool under the board
      const pool = new THREE.Mesh(
        new THREE.PlaneGeometry(1.1, 1.4),
        new THREE.MeshBasicMaterial({
          map: getGlowTexture(),
          color: new THREE.Color(0x3fb8ff).multiplyScalar(0.9),
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      pool.rotation.x = -Math.PI / 2;
      pool.position.y = -HOVER_HEIGHT + 0.01;
      pool.name = 'hoverPool';
      fx.add(pool);
      this.board.add(fx);
      this.hoverFx = fx;
    }
    if (this.hoverFx !== null) this.hoverFx.visible = t === 'hover';
    if (t === 'skate') this.lift.position.y = 0;
  }

  /** Play a clip with a crossfade (no-op if already playing). */
  play(p: AnimParams) {
    if (!this.mixer) return;
    const name = this.resolve(p.clip);
    if (!name) return;
    let action = this.actions.get(name);
    if (!action) {
      const clip = this.assets.clips.get(name)!;
      action = this.mixer.clipAction(clip);
      this.actions.set(name, action);
    }
    if (p.time !== undefined) {
      action.time = p.time % action.getClip().duration;
    }
    action.timeScale = p.timeScale ?? 1;
    if (this.current === action) return;
    action.reset();
    if (p.time !== undefined) action.time = p.time % action.getClip().duration;
    action.setLoop(p.once === true ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = p.once === true;
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.play();
    if (this.current) this.current.crossFadeTo(action, p.fade ?? 0.15, false);
    this.current = action;
    this.currentName = name;
  }

  get playing() {
    return this.currentName;
  }

  private resolve(clip: string): string | null {
    const cands = FALLBACK_CLIP[clip] ?? [clip];
    for (const c of cands) if (this.assets.clips.has(c)) return c;
    return null;
  }

  /**
   * Per-frame update. `lean` tilts the rider into turns; `crouch` lowers;
   * `boardSpin` spins wheels (metres travelled this frame).
   */
  update(dt: number, opts: { lean: number; travelled: number; riding?: boolean }) {
    this.mixer?.update(dt);
    // Procedural lean on top of the clip (rider + board bank into the carve)
    const lean = THREE.MathUtils.clamp(opts.lean, -1, 1);
    this.body.rotation.z = -lean * 0.22;
    this.board.rotation.z = -lean * 0.12;
    if (this.boardType === 'hover') {
      this.hoverT += dt;
      if (opts.riding === false) {
        // On foot / bailing: rider is on the ground, board floats where it is
        this.lift.position.y = 0;
        this.board.position.y += HOVER_HEIGHT;
        return;
      }
      const bob = Math.sin(this.hoverT * 3.1) * 0.018 + Math.sin(this.hoverT * 7.3) * 0.006;
      this.lift.position.y = HOVER_HEIGHT + bob;
      if (this.hoverFx !== null) {
        const flick = 0.85 + Math.sin(this.hoverT * 31) * 0.08 + Math.random() * 0.07;
        this.hoverFx.scale.set(1, 1, 1).multiplyScalar(flick);
        const pool = this.hoverFx.getObjectByName('hoverPool');
        if (pool !== undefined) pool.position.y = -this.lift.position.y + 0.012;
      }
      return;
    }
    if (this.wheels.length > 0 && opts.travelled !== 0) {
      const ang = opts.travelled / this.wheelRadius;
      _q.setFromAxisAngle(this.wheelAxis, ang);
      for (const w of this.wheels) w.quaternion.multiply(_q);
    }
  }

  dispose() {
    this.mixer?.stopAllAction();
    this.root.removeFromParent();
  }
}
