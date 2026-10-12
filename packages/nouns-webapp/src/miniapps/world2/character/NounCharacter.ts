// ── Rigged Noun character + skateboard (runtime side of the Blender pipeline) ──
//
// Loads /world2/noun_character.glb (+ manifest) once, clones per player,
// re-skins the shirt from the Noun seed, attaches the voxel head to the
// `head` bone and drives an AnimationMixer from the player state.

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

import { inkExcluded } from '../render/Toon';

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
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _want = new THREE.Vector3();

interface ClimbArm {
  upper: THREE.Object3D;
  fore: THREE.Object3D;
  hand: THREE.Object3D;
}

/**
 * Swing `bone` so the segment bone → `child` points along `worldDir`
 * (blended by `amount`). Works for any bone axis convention because it
 * measures the segment from the joint positions.
 */
function aimBone(
  bone: THREE.Object3D,
  child: THREE.Object3D,
  worldDir: THREE.Vector3,
  amount: number,
) {
  const parent = bone.parent;
  if (parent === null) return;
  bone.getWorldPosition(_pa);
  child.getWorldPosition(_pb);
  _dir.subVectors(_pb, _pa);
  if (_dir.lengthSq() < 1e-8) return;
  _dir.normalize();
  _qa.setFromUnitVectors(_dir, worldDir);
  _qa.slerp(_qb.identity(), 1 - amount);
  // world delta → bone-local: Pw⁻¹ · R · Pw · q
  parent.getWorldQuaternion(_qb);
  const pInv = _qb.clone().invert();
  bone.quaternion.premultiply(_qb).premultiply(_qa).premultiply(pInv);
  bone.updateMatrixWorld(true);
}

const _ikA = new THREE.Vector3();
const _ikB = new THREE.Vector3();
const _ikC = new THREE.Vector3();
const _ikN = new THREE.Vector3();
const _ikM = new THREE.Vector3();
const _ikE = new THREE.Vector3();
const _ikQ = new THREE.Quaternion();

/**
 * Two-bone IK (shoulder→elbow→wrist, hip→knee→ankle): swing `upper` and
 * `mid` so `end` lands on `target`, bending toward the world `pole`.
 */
function solveTwoBone(
  upper: THREE.Object3D,
  mid: THREE.Object3D,
  end: THREE.Object3D,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  amount: number,
) {
  if (amount < 0.002) return;
  upper.getWorldPosition(_ikA);
  mid.getWorldPosition(_ikB);
  end.getWorldPosition(_ikC);
  const l1 = _ikA.distanceTo(_ikB);
  const l2 = _ikB.distanceTo(_ikC);
  _ikN.subVectors(target, _ikA);
  const raw = _ikN.length();
  if (raw < 1e-5 || l1 < 1e-5 || l2 < 1e-5) return;
  _ikN.divideScalar(raw);
  const d = THREE.MathUtils.clamp(raw, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _ikM.copy(pole).addScaledVector(_ikN, -pole.dot(_ikN));
  if (_ikM.lengthSq() < 1e-8) _ikM.set(0, 1, 0).addScaledVector(_ikN, -_ikN.y);
  _ikM.normalize();
  _ikE
    .copy(_ikA)
    .addScaledVector(_ikN, l1 * cosA)
    .addScaledVector(_ikM, l1 * sinA)
    .sub(_ikA)
    .normalize();
  aimBone(upper, mid, _ikE, amount);
  mid.getWorldPosition(_ikB);
  _ikE.subVectors(target, _ikB).normalize();
  aimBone(mid, end, _ikE, amount);
}

/** Give `bone` this world orientation (slerped by `amount`). */
function setWorldQuat(bone: THREE.Object3D, q: THREE.Quaternion, amount = 1) {
  const parent = bone.parent;
  if (parent === null) return;
  parent.getWorldQuaternion(_ikQ);
  const local = _ikQ.invert().multiply(q);
  bone.quaternion.slerp(local, amount);
  bone.updateMatrixWorld(true);
}

/** Rotate `bone` about a world axis by `angle`. */
function turnBone(bone: THREE.Object3D, worldAxis: THREE.Vector3, angle: number) {
  const parent = bone.parent;
  if (parent === null || Math.abs(angle) < 1e-5) return;
  parent.getWorldQuaternion(_ikQ);
  _ikN.copy(worldAxis).applyQuaternion(_ikQ.invert());
  bone.quaternion.premultiply(_ikQ.setFromAxisAngle(_ikN, angle));
  bone.updateMatrixWorld(true);
}

/** Display names for flip tricks per ride mode (cosmetic; scoring is shared). */
const TRICK_NAMES: Partial<Record<BoardType, [RegExp, string][]>> = {
  scooter: [
    [/\b360 Flip\b/g, 'Whip Double Bar'],
    [/\bVarial Flip\b/g, 'Whip Barspin'],
    [/\bHardflip\b/g, 'Backwhip Barspin'],
    [/\bKickflip\b/g, 'Tailwhip'],
    [/\bHeelflip\b/g, 'Backwhip'],
    [/\bFS Shove-it\b/g, 'Back Barspin'],
    [/\bPop Shove-it\b/g, 'Barspin'],
    [/\bImpossible\b/g, 'Fingerwhip'],
    [/\bOllie\b/g, 'Bunny Hop'],
  ],
  blades: [
    [/\b360 Flip\b/g, 'Mute 720'],
    [/\bVarial Flip\b/g, 'Mute 360'],
    [/\bHardflip\b/g, 'Safety 360'],
    [/\bKickflip\b/g, 'Flat 360'],
    [/\bHeelflip\b/g, 'Back Flat 360'],
    [/\bFS Shove-it\b/g, 'Safety Grab'],
    [/\bPop Shove-it\b/g, 'Mute Grab'],
    [/\bImpossible\b/g, 'Japan Grab'],
    [/\bNose Manual\b/g, 'Toe Roll'],
    [/\bManual\b/g, 'Heel Roll'],
  ],
};

/** Rename board tricks for the HUD when riding a scooter or blades. */
export function rideTrickLabel(label: string, t: BoardType): string {
  const names = TRICK_NAMES[t];
  if (names === undefined) return label;
  let out = label;
  for (const [re, name] of names) out = out.replace(re, name);
  return out;
}

export type BoardType = 'skate' | 'hover' | 'scooter' | 'blades';
/** Ride modes in select-screen order (all cosmetic — the physics is shared). */
export const BOARD_TYPES: readonly BoardType[] = ['skate', 'hover', 'scooter', 'blades'];
export const BOARD_LABELS: Record<BoardType, string> = {
  skate: 'SKATEBOARD',
  hover: 'HOVERBOARD ⚡',
  scooter: 'SCOOTER 🛴',
  blades: 'BLADES',
};
/** Untrusted input (URL, storage, network) → a ride mode; unknown = skate. */
export function parseBoardType(v: unknown): BoardType {
  return typeof v === 'string' && (BOARD_TYPES as readonly string[]).includes(v)
    ? (v as BoardType)
    : 'skate';
}
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

// ── Ride kit: micro scooter + inline skates (procedural, shared geometry) ──

/** Scooter dimensions (metres, scooter frame: +Z nose, y = 0 ground). */
const SC = {
  wheelR: 0.055,
  deckTop: 0.09,
  /** Front axle and the top of the stem (bar height). */
  axle: new THREE.Vector3(0, 0.055, 0.34),
  top: new THREE.Vector3(0, 0.82, 0.3),
  barHalf: 0.25,
  gripX: 0.2,
} as const;

/** Where the soles go on the deck (z): front = left foot, back = right foot. */
const SC_FEET_Z = [0.07, -0.17];

/** Inline skate: wheel bottom sits this far below the sole. */
const BLADE_R = 0.034;
const BLADE_DROP = 0.088;

interface RideKit {
  geo: Record<string, THREE.BufferGeometry>;
  mat: Record<string, THREE.MeshStandardMaterial>;
}
let rideKit: RideKit | null = null;
function getRideKit(): RideKit {
  if (rideKit !== null) return rideKit;
  const std = (color: number, roughness = 0.6, metalness = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const fender = new THREE.CylinderGeometry(0.068, 0.068, 0.07, 14, 1, true, 0.5, 2.3);
  fender.rotateZ(Math.PI / 2);
  rideKit = {
    geo: {
      wheel: new THREE.CylinderGeometry(SC.wheelR, SC.wheelR, 0.03, 18).rotateZ(Math.PI / 2),
      hub: new THREE.CylinderGeometry(0.022, 0.022, 0.034, 10).rotateZ(Math.PI / 2),
      deck: new THREE.BoxGeometry(0.125, 0.026, 0.5),
      grip: new THREE.BoxGeometry(0.105, 0.004, 0.44),
      neck: new THREE.BoxGeometry(0.07, 0.04, 0.14),
      tube: new THREE.CylinderGeometry(1, 1, 1, 10),
      plate: new THREE.BoxGeometry(0.008, 0.11, 0.05),
      fender,
      bWheel: new THREE.CylinderGeometry(BLADE_R, BLADE_R, 0.022, 14).rotateZ(Math.PI / 2),
      bFrame: new THREE.BoxGeometry(0.01, 0.034, 0.27),
      bPlate: new THREE.BoxGeometry(0.1, 0.02, 0.29),
      bShell: new THREE.BoxGeometry(0.13, 0.085, 0.27),
      bCuff: new THREE.CylinderGeometry(0.08, 0.075, 0.13, 10, 1, true),
      bStrap: new THREE.BoxGeometry(0.13, 0.024, 0.07),
      bBrake: new THREE.BoxGeometry(0.04, 0.045, 0.06),
    },
    mat: {
      alu: std(0xc9ced6, 0.35, 0.6),
      dark: std(0x26272b, 0.7),
      tape: std(0x111214, 0.95),
      urethane: std(0x6fd8ff, 0.5),
      bar: std(0x2a2b30, 0.45, 0.3),
      gripRub: std(0xff3e6c, 0.8),
      boot: std(0xf4f1ea, 0.6),
      bootAccent: std(0x1d1f25, 0.6),
      bWheel: std(0xffd400, 0.5),
    },
  };
  rideKit.mat.dark.side = THREE.DoubleSide;
  rideKit.mat.bootAccent.side = THREE.DoubleSide;
  return rideKit;
}

function kitMesh(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  parent: THREE.Object3D,
) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** A tube from a to b (radius r) using the shared unit cylinder. */
function kitTube(
  a: THREE.Vector3,
  b: THREE.Vector3,
  r: number,
  mat: THREE.Material,
  parent: THREE.Object3D,
) {
  const m = new THREE.Mesh(getRideKit().geo.tube, mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.scale.set(r, a.distanceTo(b), r);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.castShadow = true;
  parent.add(m);
  return m;
}

interface ScooterRig {
  /** Counter-transformed each frame so board flips don't tumble the bars. */
  root: THREE.Group;
  /** Fork + front wheel + stem + bars: steers / bar-spins about the stem. */
  steer: THREE.Group;
  /** Deck + rear wheel + fender: tailwhips about the stem. */
  whip: THREE.Group;
  wheels: THREE.Object3D[];
  /** Hand targets: left (+X), right (−X). */
  grips: [THREE.Object3D, THREE.Object3D];
  /** Rotation taking +Y onto the stem axis. */
  axisQ: THREE.Quaternion;
}

function buildScooter(): ScooterRig {
  const k = getRideKit();
  const root = new THREE.Group();
  root.name = 'scooter';
  const axis = SC.top.clone().sub(SC.axle).normalize();
  const axisQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
  const stemLen = SC.top.distanceTo(SC.axle);
  const wheels: THREE.Object3D[] = [];
  const wheel = (parent: THREE.Object3D, x: number, y: number, z: number) => {
    const holder = new THREE.Group();
    holder.position.set(x, y, z);
    kitMesh(k.geo.wheel, k.mat.urethane, 0, 0, 0, holder);
    kitMesh(k.geo.hub, k.mat.alu, 0, 0, 0, holder);
    parent.add(holder);
    wheels.push(holder);
  };

  // Steering assembly, authored in the stem frame (origin = front axle, +Y up the stem)
  const steer = new THREE.Group();
  steer.position.copy(SC.axle);
  steer.quaternion.copy(axisQ);
  root.add(steer);
  wheel(steer, 0, 0, 0);
  for (const x of [-0.026, 0.026]) kitMesh(k.geo.plate, k.mat.alu, x, 0.05, 0, steer);
  kitTube(new THREE.Vector3(0, 0.09, 0), new THREE.Vector3(0, stemLen, 0), 0.016, k.mat.alu, steer);
  kitTube(new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(0, 0.34, 0), 0.024, k.mat.dark, steer);
  kitTube(
    new THREE.Vector3(SC.barHalf, stemLen, 0),
    new THREE.Vector3(-SC.barHalf, stemLen, 0),
    0.013,
    k.mat.bar,
    steer,
  );
  kitTube(
    new THREE.Vector3(0, stemLen - 0.06, 0),
    new THREE.Vector3(0, stemLen, 0),
    0.022,
    k.mat.bar,
    steer,
  );
  const grips: THREE.Object3D[] = [];
  for (const side of [1, -1]) {
    kitTube(
      new THREE.Vector3(side * (SC.gripX - 0.055), stemLen, 0),
      new THREE.Vector3(side * (SC.barHalf + 0.004), stemLen, 0),
      0.021,
      k.mat.gripRub,
      steer,
    );
    const g = new THREE.Object3D();
    g.position.set(side * SC.gripX, stemLen, 0);
    steer.add(g);
    grips.push(g);
  }

  // Deck assembly: pivots on the stem axis, children authored in scooter coords
  const whip = new THREE.Group();
  whip.position.copy(SC.axle);
  whip.quaternion.copy(axisQ);
  root.add(whip);
  const deckFrame = new THREE.Group();
  deckFrame.quaternion.copy(axisQ).invert();
  deckFrame.position.copy(SC.axle).applyQuaternion(deckFrame.quaternion).negate();
  whip.add(deckFrame);
  kitMesh(k.geo.deck, k.mat.alu, 0, SC.deckTop - 0.013, -0.03, deckFrame);
  kitMesh(k.geo.grip, k.mat.tape, 0, SC.deckTop + 0.002, -0.03, deckFrame);
  const neck = kitMesh(k.geo.neck, k.mat.alu, 0, 0.11, 0.25, deckFrame);
  neck.rotation.x = -0.55;
  // Head tube the stem turns in
  kitTube(
    SC.axle.clone().addScaledVector(axis, 0.09),
    SC.axle.clone().addScaledVector(axis, 0.2),
    0.024,
    k.mat.dark,
    deckFrame,
  );
  wheel(deckFrame, 0, SC.wheelR, -0.3);
  const fender = kitMesh(k.geo.fender, k.mat.dark, 0, SC.wheelR, -0.3, deckFrame);
  fender.castShadow = false;
  return {
    root,
    steer,
    whip,
    wheels,
    grips: [grips[0], grips[1]],
    axisQ,
  };
}

/** One inline skate in its own frame: origin = sole centre, +Z = toe. */
function buildBlade(brake: boolean): { group: THREE.Group; wheels: THREE.Object3D[] } {
  const k = getRideKit();
  const g = new THREE.Group();
  g.name = 'blade';
  kitMesh(k.geo.bShell, k.mat.boot, 0, 0.035, 0.01, g);
  kitMesh(k.geo.bPlate, k.mat.bootAccent, 0, -0.008, 0.005, g);
  const cuff = kitMesh(k.geo.bCuff, k.mat.bootAccent, 0, 0.11, -0.04, g);
  cuff.castShadow = false;
  kitMesh(k.geo.bStrap, k.mat.bootAccent, 0, 0.06, 0.03, g);
  for (const x of [-0.024, 0.024]) kitMesh(k.geo.bFrame, k.mat.alu, x, -0.032, 0.005, g);
  const wheels: THREE.Object3D[] = [];
  for (const z of [-0.1, -0.033, 0.033, 0.1]) {
    const h = new THREE.Group();
    h.position.set(0, -(BLADE_DROP - BLADE_R), z + 0.005);
    kitMesh(k.geo.bWheel, k.mat.bWheel, 0, 0, 0, h);
    g.add(h);
    wheels.push(h);
  }
  if (brake) kitMesh(k.geo.bBrake, k.mat.bootAccent, 0, -0.05, -0.16, g);
  return { group: g, wheels };
}

/** Back-foot kick cycle (sole position in the scooter frame) for phase 0..1. */
function scooterKick(s: number): THREE.Vector3 {
  const deck = new THREE.Vector3(0, SC.deckTop, -0.17);
  const down = new THREE.Vector3(-0.12, 0, -0.04);
  const back = new THREE.Vector3(-0.12, 0, -0.46);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  if (s < 0.18) {
    const t = smooth(s / 0.18);
    return deck
      .lerp(down, t)
      .setY(THREE.MathUtils.lerp(SC.deckTop, 0, t) + Math.sin(t * Math.PI) * 0.05);
  }
  if (s < 0.55) return down.lerp(back, smooth((s - 0.18) / 0.37));
  if (s < 0.9) {
    const t = smooth((s - 0.55) / 0.35);
    return back
      .lerp(deck, t)
      .setY(THREE.MathUtils.lerp(0, SC.deckTop, t) + Math.sin(t * Math.PI) * 0.12);
  }
  return deck;
}

interface RideBones {
  hips: THREE.Object3D;
  spine: THREE.Object3D | null;
  /** [left (+X), right (−X)] */
  arms: { upper: THREE.Object3D; fore: THREE.Object3D; hand: THREE.Object3D }[];
  legs: { thigh: THREE.Object3D; shin: THREE.Object3D; foot: THREE.Object3D }[];
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
  /** Rig container inside `body`: ride modes lift / spin it. */
  private stance = new THREE.Group();
  private rideBones: RideBones | null = null;
  /** Rest-pose ankle (foot bone) positions in character space: [left, right]. */
  private restAnkles: THREE.Vector3[] = [];
  private scooter: ScooterRig | null = null;
  private blades: THREE.Group[] = [];
  private bladeWheels: THREE.Object3D[] = [];
  /** Clip the game asked for (before the ride-mode remap). */
  private requested = '';
  private ride = {
    lift: 0,
    crouch: 0,
    /** Push / stride cycle phase (0..1) and how much of it is showing. */
    phase: 0,
    push: 0,
    tuck: 0,
    steer: 0,
    /** Trick angles read off the board pose this frame. */
    roll: 0,
    spin: 0,
    grab: 0,
  };

  constructor(seed: NounSeed, assets: CharacterAssets) {
    this.seed = seed;
    this.assets = assets;
    this.root.add(this.lift);
    this.lift.add(this.body);
    this.lift.add(this.board);
    this.body.add(this.stance);
    this.buildBody();
    this.buildBoard();
    this.buildRideKit();
  }

  private buildBody() {
    const { gltf, manifest } = this.assets;
    // Nouns proportions: the head dominates the silhouette.
    const headInfo = buildNounHead(this.seed, Math.max(HEAD_WIDTH, manifest.head?.width ?? 0));
    this.head = headInfo.group;
    if (gltf) {
      const model = cloneSkinned(gltf.scene) as THREE.Object3D;
      this.stance.add(model);
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
        // Nouns heads rest on the shoulders, not the neck top: drop by the neck length
        this.head.position.set(off[0], off[1] - 0.13, off[2]);
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
      inkExcluded.add(fx);
      this.hoverFx = fx;
    }
    if (this.hoverFx !== null) this.hoverFx.visible = t === 'hover';
    if (t !== 'hover') this.lift.position.y = 0;
    // Scooter / blades swap the skateboard out entirely
    if (this.boardModel !== null) this.boardModel.visible = t === 'skate' || t === 'hover';
    if (this.scooter !== null) this.scooter.root.visible = t === 'scooter';
    for (const b of this.blades) b.visible = t === 'blades';
    if (!this.isRideMode()) {
      this.stance.position.set(0, 0, 0);
      this.stance.quaternion.identity();
      this.ride.lift = 0;
    }
  }

  /** Scooter or inline skates (rider stands forward, posed procedurally). */
  private isRideMode() {
    return this.boardType === 'scooter' || this.boardType === 'blades';
  }

  /**
   * Board clips are a sideways stance; scooter and blade riders stand
   * forward, so most of them become the on-foot idle with the legs, arms
   * and crouch posed procedurally in `updateRide`. Bails stay as authored,
   * and blade grinds / powerslides keep the sideways (frontside) stance.
   */
  private rideClip(clip: string): string {
    if (!this.isRideMode() || !clip.startsWith('skate_') || /bail|getup/.test(clip)) return clip;
    if (this.boardType === 'blades' && (clip === 'skate_grind' || clip === 'skate_powerslide'))
      return clip;
    return 'idle';
  }

  /** Play a clip with a crossfade (no-op if already playing). */
  play(p: AnimParams) {
    if (!this.mixer) return;
    this.requested = p.clip;
    const mapped = this.rideClip(p.clip);
    if (mapped !== p.clip) p = { clip: mapped, fade: p.fade };
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
  update(
    dt: number,
    opts: {
      lean: number;
      travelled: number;
      riding?: boolean;
      grounded?: boolean;
      /** Wall climb: gait phase + blend (0..1) for the procedural arm reach. */
      climb?: { phase: number; amount: number };
    },
  ) {
    if (this.isRideMode()) {
      this.readTrick();
      // Undo last frame's procedural pose so it never accumulates on bones a clip doesn't key
      if (this.posedLast)
        for (const b of this.rideSnap) {
          b.o.position.copy(b.p);
          b.o.quaternion.copy(b.q);
        }
      this.posedLast = false;
    }
    this.mixer?.update(dt);
    this.climbBlend = THREE.MathUtils.lerp(
      this.climbBlend,
      opts.climb !== undefined ? opts.climb.amount : 0,
      1 - Math.exp(-12 * dt),
    );
    if (opts.climb !== undefined) this.climbPhase = opts.climb.phase;
    if (this.climbBlend > 0.01) this.poseClimbArms(this.climbBlend, this.climbPhase);
    // Procedural lean on top of the clip (rider + board bank into the carve)
    const lean = THREE.MathUtils.clamp(opts.lean, -1, 1);
    this.body.rotation.z = -lean * 0.22;
    this.board.rotation.z = -lean * 0.12;
    if (this.isRideMode()) {
      this.updateRide(dt, opts, lean);
      return;
    }
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
        if (pool !== undefined) {
          pool.position.y = -this.lift.position.y + 0.012;
          // The light pool belongs on the ground: hide it in the air
          pool.visible = opts.grounded !== false;
        }
      }
      return;
    }
    if (this.wheels.length > 0 && opts.travelled !== 0) {
      const ang = opts.travelled / this.wheelRadius;
      _q.setFromAxisAngle(this.wheelAxis, ang);
      for (const w of this.wheels) w.quaternion.multiply(_q);
    }
  }

  // ── Scooter + blades ───────────────────────────────────────────────────

  private findBone(name: string): THREE.Object3D | null {
    let hit: THREE.Object3D | null = null;
    this.stance.traverse(o => {
      if (hit === null && o.name.replace(/[.:_]/g, '').toLowerCase() === name) hit = o;
    });
    return hit as THREE.Object3D | null;
  }

  /** Scooter (on the board group) + a skate on each foot bone, all hidden until picked. */
  private buildRideKit() {
    const sc = buildScooter();
    sc.root.visible = false;
    this.board.add(sc.root);
    this.scooter = sc;
    const hips = this.findBone('hips');
    if (hips === null) return;
    const arms: RideBones['arms'] = [];
    const legs: RideBones['legs'] = [];
    for (const s of ['l', 'r']) {
      const upper = this.findBone(`upperarm${s}`);
      const fore = this.findBone(`forearm${s}`);
      const hand = this.findBone(`hand${s}`);
      if (upper !== null && fore !== null && hand !== null) arms.push({ upper, fore, hand });
      const thigh = this.findBone(`thigh${s}`);
      const shin = this.findBone(`shin${s}`);
      const foot = this.findBone(`foot${s}`);
      if (thigh !== null && shin !== null && foot !== null) legs.push({ thigh, shin, foot });
    }
    if (arms.length !== 2 || legs.length !== 2) return;
    this.rideBones = { hips, spine: this.findBone('spine'), arms, legs };
    // Rest pose (bind pose, soles on y = 0): fit a skate under each shoe
    this.root.updateMatrixWorld(true);
    const toStance = this.stance.matrixWorld.clone().invert();
    legs.forEach((leg, i) => {
      const ankle = leg.foot.getWorldPosition(new THREE.Vector3()).applyMatrix4(toStance);
      this.restAnkles.push(ankle);
      const toe = this.findBone(i === 0 ? 'toel' : 'toer');
      const fwd =
        toe !== null
          ? toe.getWorldPosition(new THREE.Vector3()).applyMatrix4(toStance).sub(ankle).setY(0)
          : new THREE.Vector3(0, 0, 1);
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1);
      fwd.normalize();
      const blade = buildBlade(i === 1);
      blade.group.position.set(ankle.x, 0, ankle.z).addScaledVector(fwd, 0.04);
      blade.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), fwd);
      blade.group.updateMatrix();
      // Re-express it in the foot bone's space so it rides along with the foot
      blade.group.applyMatrix4(
        leg.foot.matrixWorld.clone().invert().multiply(this.stance.matrixWorld),
      );
      blade.group.visible = false;
      leg.foot.add(blade.group);
      this.blades.push(blade.group);
      this.bladeWheels.push(...blade.wheels);
    });
  }

  private baseQ = new THREE.Quaternion();
  /** Bone poses as the mixer left them, restored before the next frame. */
  private posedLast = false;
  private rideSnap: { o: THREE.Object3D; p: THREE.Vector3; q: THREE.Quaternion }[] = [];

  /**
   * Board flips arrive as the board's pose (Ry(spin)·Rz(roll) on top of the
   * body's slide/manual pose). Pull the two angles back out: the scooter
   * turns roll into a tailwhip and spin into a bar spin; blades into a flat
   * spin and a grab. Works for remote riders too (only the pose is networked).
   */
  private readTrick() {
    this.baseQ.copy(this.body.quaternion);
    // inverse flip = Rz(−roll)·Ry(−spin): its Y twist gives the spin
    _qa.copy(this.baseQ).invert().multiply(this.board.quaternion).invert();
    const n = Math.hypot(_qa.y, _qa.w);
    if (n < 0.05) return; // mid half-roll: keep last frame's read
    this.ride.spin = -2 * Math.atan2(_qa.y, _qa.w);
    _qb.set(0, -_qa.y / n, 0, _qa.w / n); // twist⁻¹
    _qa.multiply(_qb);
    this.ride.roll = -2 * Math.atan2(_qa.z, _qa.w);
    // Wrap to (−π, π] so "no trick" reads as zero whichever sign q took
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    this.ride.spin = wrap(this.ride.spin);
    this.ride.roll = wrap(this.ride.roll);
    // Soft dead zone: carve banking (and net jitter) shouldn't twitch the deck
    const dz = (a: number) => (Math.abs(a) < 0.3 ? a * (a / 0.3) ** 2 : a);
    this.ride.spin = dz(this.ride.spin);
    this.ride.roll = dz(this.ride.roll);
  }

  private updateRide(
    dt: number,
    opts: { travelled: number; riding?: boolean; grounded?: boolean },
    lean: number,
  ) {
    const r = this.ride;
    const ease = (rate: number) => 1 - Math.exp(-rate * dt);
    const scooter = this.boardType === 'scooter';
    const req = this.requested;
    const shown = this.board.visible;
    const bailing = /bail|getup/.test(req);
    const sideways = bailing || (!scooter && (req === 'skate_grind' || req === 'skate_powerslide'));
    const posed =
      shown &&
      opts.riding !== false &&
      !sideways &&
      req.startsWith('skate_') &&
      this.climbBlend < 0.01 &&
      this.rideBones !== null;

    if (bailing || !shown || opts.riding === false) {
      r.roll = 0;
      r.spin = 0;
    }
    for (const b of this.blades) b.visible = !scooter && shown;
    const liftTo = !shown
      ? 0
      : scooter
        ? posed
          ? SC.deckTop
          : 0
        : sideways
          ? BLADE_DROP - this.deckTop
          : BLADE_DROP;
    r.lift = shown ? THREE.MathUtils.lerp(r.lift, liftTo, ease(16)) : 0;
    this.stance.position.set(0, r.lift, 0);

    // Wheels roll with the distance covered
    const wheels = scooter ? (this.scooter?.wheels ?? []) : this.bladeWheels;
    if (opts.travelled !== 0) {
      _q.setFromAxisAngle(_pa.set(1, 0, 0), opts.travelled / (scooter ? SC.wheelR : BLADE_R));
      for (const w of wheels) w.quaternion.multiply(_q);
    }

    // Trick envelopes (0 at the start/end of a flip, 1 mid-trick)
    const air = /ollie|flip|air|grab/.test(req);
    const whipT = Math.abs(Math.sin(r.roll / 2));
    const spinT = Math.abs(Math.sin(r.spin));
    const sc = this.scooter;
    if (scooter && sc !== null) {
      if (!bailing && shown) {
        // Hold the scooter level under the rider: undo the board flip/lift
        // the game applied, keep the body's slide/manual pose + a gentle bank
        this.board.updateMatrix();
        _qa.setFromAxisAngle(_pa.set(0, 0, 1), -lean * 0.12).premultiply(this.baseQ);
        const m = new THREE.Matrix4().compose(_pb.set(0, 0, 0), _qa, _want.set(1, 1, 1));
        m.premultiply(this.board.matrix.clone().invert());
        m.decompose(sc.root.position, sc.root.quaternion, sc.root.scale);
      } else {
        sc.root.position.set(0, 0, 0);
        sc.root.quaternion.identity();
        sc.root.scale.set(1, 1, 1);
      }
      r.steer = THREE.MathUtils.lerp(r.steer, lean * 0.42, ease(10));
      // Shove-it → bar spin (one full turn of the bars per half board spin)
      sc.steer.quaternion
        .copy(sc.axisQ)
        .multiply(_q.setFromAxisAngle(_pa.set(0, 1, 0), r.steer + r.spin * 2));
      // Kickflip → tailwhip: the deck orbits the stem
      sc.whip.quaternion.copy(sc.axisQ).multiply(_q.setFromAxisAngle(_pa.set(0, 1, 0), r.roll));
    }

    // Blades: flip → flat spin of the whole rider, shove-it → grab
    const spinYaw = scooter ? 0 : r.roll;
    this.stance.quaternion.setFromAxisAngle(_pa.set(0, 1, 0), posed ? spinYaw : 0);

    if (!posed || this.rideBones === null) {
      r.push = 0;
      return;
    }
    const bones = this.rideBones;
    this.posedLast = true;
    if (this.rideSnap.length === 0) {
      for (const o of [
        bones.hips,
        ...(bones.spine !== null ? [bones.spine] : []),
        ...bones.legs.flatMap(l => [l.thigh, l.shin, l.foot]),
        ...bones.arms.flatMap(a => [a.upper, a.fore, a.hand]),
      ])
        this.rideSnap.push({ o, p: new THREE.Vector3(), q: new THREE.Quaternion() });
    }
    for (const b of this.rideSnap) {
      b.p.copy(b.o.position);
      b.q.copy(b.o.quaternion);
    }

    // Crouch / push / tuck targets from the requested board clip
    const pushing = req === 'skate_push';
    const crouchTo =
      req === 'skate_crouch'
        ? 1
        : req === 'skate_land'
          ? 0.75
          : req === 'skate_powerslide'
            ? 0.7
            : req === 'skate_grind'
              ? 0.5
              : air
                ? 0.3
                : pushing
                  ? scooter
                    ? 0.35
                    : 0.45
                  : scooter
                    ? 0.12
                    : 0.3;
    r.crouch = THREE.MathUtils.lerp(r.crouch, crouchTo, ease(req === 'skate_land' ? 22 : 9));
    r.push = THREE.MathUtils.lerp(r.push, pushing ? 1 : 0, ease(pushing ? 6 : 4));
    if (r.push > 0.01) r.phase = (r.phase + dt * (scooter ? 1.05 : 1.3)) % 1;
    else r.phase = 0;
    const tuckTo = scooter ? whipT : air ? 0.45 + 0.4 * Math.max(whipT, spinT) : 0;
    r.tuck = THREE.MathUtils.lerp(r.tuck, tuckTo, ease(14));
    r.grab = THREE.MathUtils.lerp(r.grab, scooter ? 0 : spinT, ease(14));

    this.root.updateMatrixWorld(true);
    const sq = this.stance.getWorldQuaternion(new THREE.Quaternion());
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(sq);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(sq);
    const left = new THREE.Vector3(1, 0, 0).applyQuaternion(sq);

    // Hips: crouch down (+ sway over the gliding skate while striding)
    const sway = scooter ? 0 : Math.sin(r.phase * Math.PI * 2) * 0.06 * r.push;
    const hipsAt = bones.hips.getWorldPosition(new THREE.Vector3());
    hipsAt
      .addScaledVector(up, -(r.crouch * (scooter ? 0.2 : 0.24) + r.tuck * 0.05))
      .addScaledVector(left, sway)
      .addScaledVector(fwd, scooter ? -0.04 - 0.05 * r.push : -0.03 * r.crouch);
    if (bones.hips.parent !== null) {
      bones.hips.parent.worldToLocal(hipsAt);
      bones.hips.position.copy(hipsAt);
      bones.hips.updateMatrixWorld(true);
    }
    if (bones.spine !== null)
      turnBone(
        bones.spine,
        left,
        (scooter ? 0.14 : 0.22) + r.crouch * (scooter ? 0.22 : 0.3) + r.tuck * 0.15,
      );

    // Legs: plant the ankles on the deck / skate stance
    const ankleH = (i: number) => this.restAnkles[i]?.y ?? 0.09;
    const target = new THREE.Vector3();
    const pole = new THREE.Vector3();
    const footQ = new THREE.Quaternion();
    bones.legs.forEach((leg, i) => {
      const side = i === 0 ? 1 : -1;
      if (scooter && sc !== null) {
        // Feet stay put in the scooter frame while the deck whips round under them
        sc.root.localToWorld(target.set(0, SC.deckTop, SC_FEET_Z[i] ?? 0));
        if (i === 1 && r.push > 0.01) {
          // Back foot kicks: off the deck, sweep the ground, back on
          const p = scooterKick(r.phase);
          sc.root.localToWorld(p);
          target.lerp(p, r.push);
        }
        const sUp = _pb.set(0, 1, 0).applyQuaternion(sc.root.getWorldQuaternion(_qb));
        target.addScaledVector(sUp, ankleH(i) + r.tuck * 0.3);
      } else {
        const rest = this.restAnkles[i] ?? _pb.set(side * 0.1, 0.09, 0);
        target.set(rest.x * 1.2, ankleH(i), rest.z + side * 0.05);
        if (r.push > 0.01) {
          // Stride: each skate pushes out and back in turn, then recovers
          const s = (r.phase + (i === 0 ? 0 : 0.5)) % 1;
          const u = s < 0.5 ? s / 0.5 : 1 - (s - 0.5) / 0.5;
          target.x += side * 0.2 * u * r.push;
          target.z -= 0.16 * u * r.push;
          if (s >= 0.5) target.y += 0.08 * Math.sin(((s - 0.5) / 0.5) * Math.PI) * r.push;
        }
        target.y += r.tuck * 0.3;
        this.stance.localToWorld(target);
      }
      leg.foot.getWorldQuaternion(footQ);
      pole.copy(fwd).addScaledVector(left, side * 0.25);
      solveTwoBone(leg.thigh, leg.shin, leg.foot, target, pole, 1);
      setWorldQuat(leg.foot, footQ);
    });

    // Arms
    bones.arms.forEach((arm, i) => {
      const side = i === 0 ? 1 : -1;
      pole.copy(left).multiplyScalar(side).addScaledVector(fwd, -0.6).addScaledVector(up, -0.7);
      if (scooter && sc !== null) {
        // Hands stay on the grips (let go mid bar-spin)
        sc.grips[i].getWorldPosition(target);
        solveTwoBone(arm.upper, arm.fore, arm.hand, target, pole, 1 - spinT);
      } else {
        // Blades: arms swing against the stride and open out for balance in the air
        turnBone(arm.upper, fwd, side * (0.18 + 0.5 * r.tuck));
        turnBone(arm.upper, left, -side * Math.sin(r.phase * Math.PI * 2) * 0.55 * r.push);
        if (i === 1 && r.grab > 0.02) {
          // Grab: right hand to the right skate
          bones.legs[1].foot.getWorldPosition(target).addScaledVector(left, -0.06);
          solveTwoBone(arm.upper, arm.fore, arm.hand, target, pole, r.grab);
        }
      }
    });
  }

  private climbBlend = 0;
  private climbPhase = 0;
  private climbArms: ClimbArm[] | null = null;

  /**
   * Fake climb: no clip for it in the rig, so after the mixer has posed the
   * body, swing both arms overhead toward the wall, alternating which hand
   * reaches higher with the gait phase.
   */
  private poseClimbArms(amount: number, phase: number) {
    if (this.climbArms === null) {
      const find = (name: string) => {
        let hit: THREE.Object3D | null = null;
        this.body.traverse(o => {
          if (hit === null && o.name.replace(/[.:_]/g, '').toLowerCase() === name) hit = o;
        });
        return hit as THREE.Object3D | null;
      };
      const arms: ClimbArm[] = [];
      for (const s of ['l', 'r']) {
        const upper = find(`upperarm${s}`);
        const fore = find(`forearm${s}`);
        const hand = find(`hand${s}`);
        if (upper !== null && fore !== null && hand !== null) arms.push({ upper, fore, hand });
      }
      this.climbArms = arms;
    }
    if (this.climbArms.length === 0) return;
    this.root.updateMatrixWorld(true);
    const bodyQ = this.body.getWorldQuaternion(new THREE.Quaternion());
    const bodyPos = this.body.getWorldPosition(new THREE.Vector3());
    const sideAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(bodyQ);
    for (const arm of this.climbArms) {
      // Which side is this arm on (rig-agnostic)?
      arm.upper.getWorldPosition(_pa);
      const side = _pa.sub(bodyPos).dot(sideAxis) >= 0 ? 1 : -1;
      const reach = 0.5 + 0.5 * Math.sin(phase + (side > 0 ? 0 : Math.PI));
      // Upper arm: splayed out wide (the Noun head swallows anything overhead),
      // rising on the reaching side; +Z = into the wall
      _want
        .set(side * 0.85, 0.12 + 0.5 * reach, 0.5)
        .normalize()
        .applyQuaternion(bodyQ);
      aimBone(arm.upper, arm.fore, _want.clone(), amount);
      // Forearm: up the wall on the reaching hand, low + bent on the other
      _want
        .set(side * 0.35, -0.15 + 0.95 * reach, 0.75)
        .normalize()
        .applyQuaternion(bodyQ);
      aimBone(arm.fore, arm.hand, _want.clone(), amount);
    }
  }

  dispose() {
    if (this.hoverFx !== null) inkExcluded.delete(this.hoverFx);
    this.mixer?.stopAllAction();
    this.root.removeFromParent();
  }
}
