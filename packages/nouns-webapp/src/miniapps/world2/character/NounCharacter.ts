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

  constructor(seed: NounSeed, assets: CharacterAssets) {
    this.seed = seed;
    this.assets = assets;
    this.root.add(this.body);
    this.root.add(this.board);
    this.buildBody();
    this.buildBoard();
  }

  private buildBody() {
    const { gltf, manifest } = this.assets;
    const headInfo = buildNounHead(this.seed, manifest.head?.width ?? 0.6);
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
        this.head.position.set(off[0], off[1], off[2]);
        if (manifest.head?.scale !== undefined && manifest.head.scale > 0)
          this.head.scale.setScalar(manifest.head.scale);
        // Undo any bone scale so the head keeps its metric size
        const ws = new THREE.Vector3();
        model.updateMatrixWorld(true);
        this.headBone.getWorldScale(ws);
        if (ws.x > 0 && Math.abs(ws.x - 1) > 1e-3) this.head.scale.divideScalar(ws.x);
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
  update(dt: number, opts: { lean: number; travelled: number }) {
    this.mixer?.update(dt);
    // Procedural lean on top of the clip (rider + board bank into the carve)
    const lean = THREE.MathUtils.clamp(opts.lean, -1, 1);
    this.body.rotation.z = -lean * 0.22;
    this.board.rotation.z = -lean * 0.12;
    if (this.wheels.length && opts.travelled !== 0) {
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
