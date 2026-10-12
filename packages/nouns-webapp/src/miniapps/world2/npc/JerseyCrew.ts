// ── Noun Jersey crew: NPC Nouns skating the secret park ──────────────────
//
// A local-only, cosmetic crew of random Nouns that rides the Noun Jersey
// park (world/mountain/NounJerseyPark.ts) while you're near it: a Main St /
// Cross St street loop (kerb + Jersey barrier grinds, quarter pipe carve),
// a schoolyard line (manual pad, kicker, flat bar), an empty-lot line
// (plywood kickers, the box, the bank), a mini-ramp pumper and a few Nouns
// just hanging out. Not networked: every client sees its own crew.
//
// Cheap on purpose: no physics per rider. Each line is a hand-authored
// spline in park coords (njToWorld), resampled every 0.5 m with one
// downward raycast per sample against the park's collision (redone when
// the streamed colliders change). Riders are kinematic along it: speed
// toward a cruise target (pushing when slow, gravity on slopes, slowed
// for tight turns), auto-ollies onto steps (kerbs, rails, pads), launches
// off drops (kicker lips, box ends), occasional flat-ground flips, and the
// odd bail. They swerve / slow for the player and each other.
//
// Lifecycle: spawned (one character per frame, no hitch) only within
// ~400 m of the park, disposed past ~480 m. 19 km out, so normally zero.

import type { CollisionWorld } from '../physics/Collision';
import type { Quality } from '../render/Graphics';

import * as THREE from 'three';

import { randomSeed } from '../character/NounAppearance';
import { NounCharacter, type CharacterAssets } from '../character/NounCharacter';
import { toonify } from '../render/Toon';
import {
  NJ,
  njCoords,
  njFrame,
  njToWorld,
  njYaw,
  type NjFrame,
} from '../world/mountain/nounJersey';
import { njStats } from '../world/mountain/NounJerseyPark';

// ── Tunables ────────────────────────────────────────────────────────────

const SPAWN_RADIUS = 400;
const DESPAWN_RADIUS = 480;
/** Air gravity (a touch floatier than the player's, reads better at range). */
const G_AIR = 14;
const G_SLOPE = 9.8;
const DS = 0.5;
const RAY_UP = 4.5;
/** Riders beyond this from the camera are hidden (still simulated). */
const DRAW_DIST = 200;
/** Within this, the mixer runs every frame; beyond, every other frame. */
const FULL_ANIM_DIST = 45;
const LABEL_DIST = 32;

const COUNTS: Record<Quality, { loops: [number, number, number]; mini: number; hang: number }> = {
  high: { loops: [3, 3, 3], mini: 1, hang: 2 },
  medium: { loops: [2, 2, 2], mini: 1, hang: 1 },
  low: { loops: [1, 1, 1], mini: 1, hang: 1 },
};

const NAMES = [
  'Lil Kickflip',
  'Grindo',
  'Nollie Nick',
  'Pushmo',
  'Bonk',
  'Fakie Fren',
  'Tre Flip Tim',
  'Manny',
  'Slappy',
  'Dorf',
  'Crookie',
  'Bluntsy',
  'Drop-In Dot',
  'Sk8 Noun',
  'Wallie',
  'Boneless Bo',
];

// ── Park lines (park coords: a across from Main St's kerb line, b downhill) ─

interface LineSpec {
  pts: [number, number][];
  /** Cruise speed range (m/s). */
  cruise: [number, number];
}

const LINES: LineSpec[] = [
  // Main St down → kerb grind → Cross St → quarter pipe carve → back →
  // up Main St along the Jersey barrier (grind) → U-turn at the top
  {
    cruise: [7, 8.5],
    pts: [
      [8, 8],
      [8, 20],
      [8.6, 27],
      [10.4, 31.5],
      [11.95, 35],
      [11.95, 39.5],
      [11.95, 44],
      [10.2, 48],
      [8, 54],
      [8, 62],
      [10, 70],
      [17, 76.5],
      [40, 76.5],
      [70, 76.5],
      [100, 76.5],
      [110, 76.2],
      [117.4, 74],
      [110, 71.3],
      [90, 71],
      [50, 71],
      [20, 71],
      [9, 69],
      [3.5, 64],
      [0.6, 60],
      [-0.8, 56],
      [-0.8, 46],
      [-0.8, 34],
      [-0.8, 27],
      [1.4, 22],
      [3.4, 15],
      [4, 8],
      [5.2, 3.6],
      [7.2, 3.8],
    ],
  },
  // Schoolyard: up the manual pad, round onto Cross St, kicker toward the
  // school, flat bar back down, across the court
  {
    cruise: [5.5, 6.8],
    pts: [
      [66, 14],
      [66, 26],
      [66, 36],
      [66, 41],
      [66, 46],
      [66, 51],
      [66, 56],
      [66.5, 63],
      [64.5, 69.5],
      [60.5, 71],
      [58.2, 67.5],
      [58, 63.5],
      [58, 61],
      [58, 59.5],
      [58, 56],
      [56, 51.5],
      [52.6, 49],
      [52, 47],
      [52, 42],
      [52, 37],
      [52, 33],
      [52.5, 26],
      [54, 18],
      [57.5, 11],
      [62, 9],
      [65, 10.5],
    ],
  },
  // Empty lot: plywood kicker → quarter pipe carve → woodDark kicker onto
  // the box → round over the bank and drop off its back
  {
    cruise: [5.5, 6.8],
    pts: [
      [73.5, 96],
      [78, 98],
      [84, 98],
      [88, 98],
      [90.4, 98],
      [96, 98.5],
      [104, 99.5],
      [110, 100],
      [116.6, 100.4],
      [111, 103.6],
      [106, 107.6],
      [103.5, 108],
      [101, 108],
      [99, 108],
      [94, 108],
      [90, 108],
      [86.5, 105],
      [85, 99.5],
      [84, 93.5],
      [81.5, 90],
      [78, 90],
      [76, 90],
      [74.5, 90],
      [72, 90.6],
      [71, 93.2],
    ],
  },
];

/** Memorial Park mini ramp: pump back and forth along this line. */
const MINI = { a0: 92.6, a1: 103.4, b: 135 };

/** Hangout spots: park (a, b), facing (da, db). */
const HANGS: { a: number; b: number; da: number; db: number; mood: 'idle' | 'dance' }[] = [
  { a: 18.6, b: 51.8, da: -1, db: 0.2, mood: 'idle' },
  { a: 97, b: 128.8, da: 0.1, db: 1, mood: 'dance' },
  { a: 19, b: 50.2, da: -0.6, db: 0.8, mood: 'idle' },
];

interface Feature {
  kind: 'grind' | 'manual';
  a0: number;
  b0: number;
  a1: number;
  b1: number;
  /** Grind: height above the pad. */
  y: number;
}

const FEATURES: Feature[] = [
  // Schoolyard flat bar
  { kind: 'grind', a0: 52, b0: 37.3, a1: 52, b1: 46.7, y: 0.41 },
  // Jersey barrier tops between the line and Main St
  { kind: 'grind', a0: -0.8, b0: 10.3, a1: -0.8, b1: 138.8, y: 0.8 },
  // Main St kerb (shop side)
  { kind: 'grind', a0: 12.03, b0: 33.5, a1: 12.03, b1: 45, y: 0.15 },
  // Manual pad + the lot's box
  { kind: 'manual', a0: 64.2, b0: 41.2, a1: 67.8, b1: 50.8, y: 0 },
  { kind: 'manual', a0: 92.9, b0: 105.7, a1: 95.1, b1: 110.3, y: 0 },
];

// Per-sample flags
const F_GRIND = 1;
const F_MANUAL = 2;
const F_STEP = 4;
const F_DROP = 8;

// ── Tracks (sampled lines) ──────────────────────────────────────────────

interface Track {
  closed: boolean;
  n: number;
  len: number;
  ds: number;
  cruise: [number, number];
  x: Float32Array;
  z: Float32Array;
  y: Float32Array;
  /** Horizontal unit tangent. */
  tx: Float32Array;
  tz: Float32Array;
  /** Surface normal. */
  nx: Float32Array;
  ny: Float32Array;
  nz: Float32Array;
  /** Signed curvature (1/m) and the speed cap it implies (looking ahead). */
  k: Float32Array;
  vcap: Float32Array;
  flags: Uint8Array;
  /** Grind height above the pad (NaN = none). */
  grindY: Float32Array;
}

const _w = { x: 0, z: 0 };

function makeTrack(f: NjFrame, pts: [number, number][], closed: boolean, cruise: [number, number]) {
  const ctrl = pts.map(([a, b]) => {
    const w = njToWorld(f, a, b, _w);
    return new THREE.Vector3(w.x, 0, w.z);
  });
  const curve = new THREE.CatmullRomCurve3(ctrl, closed, 'centripetal');
  const len = curve.getLength();
  const n = Math.max(8, Math.round(len / DS));
  const sp = curve.getSpacedPoints(closed ? n : n - 1);
  const N = n;
  const t: Track = {
    closed,
    n: N,
    len,
    ds: closed ? len / n : len / (n - 1),
    cruise,
    x: new Float32Array(N),
    z: new Float32Array(N),
    y: new Float32Array(N),
    tx: new Float32Array(N),
    tz: new Float32Array(N),
    nx: new Float32Array(N),
    ny: new Float32Array(N),
    nz: new Float32Array(N),
    k: new Float32Array(N),
    vcap: new Float32Array(N),
    flags: new Uint8Array(N),
    grindY: new Float32Array(N),
  };
  for (let i = 0; i < N; i++) {
    t.x[i] = sp[i].x;
    t.z[i] = sp[i].z;
  }
  const idx = (i: number) => (closed ? (i + N) % N : Math.min(N - 1, Math.max(0, i)));
  for (let i = 0; i < N; i++) {
    const a = idx(i - 1);
    const b = idx(i + 1);
    let dx = t.x[b] - t.x[a];
    let dz = t.z[b] - t.z[a];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    t.tx[i] = dx;
    t.tz[i] = dz;
  }
  for (let i = 0; i < N; i++) {
    const a = idx(i - 1);
    const b = idx(i + 1);
    // Signed turn rate: cross of the neighbouring tangents over the arc
    const cr = t.tx[a] * t.tz[b] - t.tz[a] * t.tx[b];
    const dt = t.tx[a] * t.tx[b] + t.tz[a] * t.tz[b];
    t.k[i] = Math.atan2(cr, dt) / (2 * t.ds);
  }
  // Speed cap from curvature (lateral accel ~5 m/s²), braking looked ahead
  for (let i = 0; i < N; i++) {
    const k = Math.abs(t.k[i]);
    t.vcap[i] = THREE.MathUtils.clamp(Math.sqrt(5 / Math.max(k, 1e-3)), 3, 12);
  }
  for (let pass = 0; pass < 2; pass++)
    for (let i = N - 1; i >= 0; i--) {
      const nx = closed ? (i + 1) % N : i + 1;
      if (nx >= N) continue;
      // v² ≤ v_next² + 2·a·ds (a = 4 m/s² of braking)
      t.vcap[i] = Math.min(t.vcap[i], Math.sqrt(t.vcap[nx] * t.vcap[nx] + 8 * t.ds));
    }
  // Features in park coords
  for (let i = 0; i < N; i++) {
    const c = njCoords(f, t.x[i], t.z[i]);
    const pa = c.vp - NJ.V0;
    const pb = c.u - NJ.U0;
    t.grindY[i] = NaN;
    for (const ft of FEATURES) {
      if (ft.kind === 'grind') {
        const ex = ft.a1 - ft.a0;
        const ez = ft.b1 - ft.b0;
        const el = ex * ex + ez * ez;
        const s = ((pa - ft.a0) * ex + (pb - ft.b0) * ez) / el;
        if (s < 0 || s > 1) continue;
        const d = Math.hypot(pa - (ft.a0 + ex * s), pb - (ft.b0 + ez * s));
        if (d < 0.45) {
          t.flags[i] |= F_GRIND;
          t.grindY[i] = ft.y;
        }
      } else if (pa > ft.a0 && pa < ft.a1 && pb > ft.b0 && pb < ft.b1) {
        t.flags[i] |= F_MANUAL;
      }
    }
  }
  return t;
}

const _ro = new THREE.Vector3();
const _rd = new THREE.Vector3(0, -1, 0);

/** Heights + normals: one ray per sample against the park's collision. */
function sampleHeights(t: Track, f: NjFrame, world: CollisionWorld) {
  const { n } = t;
  for (let i = 0; i < n; i++) {
    t.flags[i] &= ~(F_STEP | F_DROP);
    if (!Number.isNaN(t.grindY[i])) {
      t.y[i] = f.P + t.grindY[i];
      t.nx[i] = 0;
      t.ny[i] = 1;
      t.nz[i] = 0;
      continue;
    }
    _ro.set(t.x[i], f.P + RAY_UP, t.z[i]);
    const hit = world.raycast(_ro, _rd, RAY_UP + 6);
    if (hit !== null) {
      t.y[i] = hit.point.y;
      const nrm = hit.normal;
      if (nrm.y < 0.2) nrm.set(0, 1, 0);
      t.nx[i] = nrm.x;
      t.ny[i] = nrm.y;
      t.nz[i] = nrm.z;
    } else {
      t.y[i] = f.P;
      t.nx[i] = 0;
      t.ny[i] = 1;
      t.nz[i] = 0;
    }
  }
  // Steps (sharp rise onto something flat: hop up) and drops (sharp fall,
  // much steeper than the slope leading in: kicker lips, box/rail ends)
  const last = t.closed ? n : n - 2;
  for (let i = 1; i < last; i++) {
    const a = t.y[(i - 1 + n) % n];
    const b = t.y[i];
    const c = t.y[(i + 1) % n];
    const d = t.y[(i + 2) % n];
    if (c - b > 0.1 + Math.max(0, b - a) * 1.5 && Math.abs(d - c) < 0.06) t.flags[i] |= F_STEP;
    if (b - c > 0.1 + Math.max(0, a - b) * 1.5) t.flags[i] |= F_DROP;
  }
}

// ── Riders ──────────────────────────────────────────────────────────────

type NpcState = 'ride' | 'air' | 'grind' | 'bail' | 'pump' | 'hang';

interface Npc {
  ch: NounCharacter;
  label: HTMLDivElement;
  name: string;
  hover: boolean;
  state: NpcState;
  track: Track | null;
  s: number;
  dir: number;
  v: number;
  cruise: number;
  y: number;
  vy: number;
  off: number;
  /** Seconds in the current state / since the last trick / since landing. */
  t: number;
  sinceTrick: number;
  sinceLand: number;
  pushT: number;
  flip: boolean;
  airClip: string;
  manual: number;
  bailBoard: number;
  /** Mini ramp: how high this run pumps. */
  hTop: number;
  /** Hangout. */
  hang: { x: number; y: number; z: number; yaw: number; mood: 'idle' | 'dance' } | null;
  waveT: number;
  waved: boolean;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  lastPos: THREE.Vector3;
  lean: number;
  parity: number;
  animAcc: number;
}

const _up = new THREE.Vector3();
const _fw = new THREE.Vector3();
const _rt = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _ax = new THREE.Vector3();
const _v = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const X = new THREE.Vector3(1, 0, 0);

export interface JerseyCrewOptions {
  scene: THREE.Scene;
  world: CollisionWorld;
  assets: CharacterAssets;
  quality: Quality;
  toon: boolean;
  labelLayer: HTMLElement;
  camera: THREE.Camera;
  canvas: HTMLCanvasElement;
}

export class JerseyCrew {
  npcs: Npc[] = [];
  /** Riders still to build (one per frame). */
  private pending: (() => void)[] = [];
  private tracks: Track[] = [];
  private mini: Track | null = null;
  private frame: NjFrame | null = null;
  private heightsKey = '';
  private resampleT = 0;
  private center = { x: 0, z: 0 };
  private o: JerseyCrewOptions;
  active = false;
  private names: string[] = [];

  constructor(o: JerseyCrewOptions) {
    this.o = o;
  }

  /** Per frame: spawns / despawns by distance and moves the crew. */
  update(dt: number, player: THREE.Vector3) {
    const f = this.frame ?? njFrame();
    if (f === null) return;
    if (this.frame === null) {
      this.frame = f;
      njToWorld(f, NJ.W / 2, NJ.L / 2, this.center);
    }
    const d = Math.hypot(player.x - this.center.x, player.z - this.center.z);
    if (!this.active) {
      if (d > SPAWN_RADIUS) return;
      this.spawn(f);
    } else if (d > DESPAWN_RADIUS) {
      this.clear();
      return;
    }
    const build = this.pending.shift();
    if (build !== undefined) build();
    this.refreshHeights(dt, f);
    const cam = this.o.camera.position;
    for (const npc of this.npcs) this.step(npc, dt, player, cam);
    this.updateLabels(cam);
  }

  private spawn(f: NjFrame) {
    this.active = true;
    this.tracks = LINES.map(l => makeTrack(f, l.pts, true, l.cruise));
    this.mini = makeTrack(
      f,
      [
        [MINI.a0, MINI.b],
        [(MINI.a0 + MINI.a1) / 2, MINI.b],
        [MINI.a1, MINI.b],
      ],
      false,
      [0, 0],
    );
    this.heightsKey = '';
    this.refreshHeights(1e3, f);
    this.names = [...NAMES].sort(() => Math.random() - 0.5);
    const c = COUNTS[this.o.quality];
    c.loops.forEach((count, li) => {
      for (let k = 0; k < count; k++) {
        const s = ((k + Math.random() * 0.4) / count) * this.tracks[li].len;
        this.pending.push(() => this.addRider(this.tracks[li], s));
      }
    });
    for (let k = 0; k < c.mini; k++) this.pending.push(() => this.addPumper());
    for (let k = 0; k < c.hang; k++) this.pending.push(() => this.addHanger(f, HANGS[k]));
  }

  private clear() {
    for (const npc of this.npcs) this.disposeNpc(npc);
    this.npcs = [];
    this.pending = [];
    this.tracks = [];
    this.mini = null;
    this.active = false;
  }

  /** Re-ray the lines whenever the streamed colliders around the park change. */
  private refreshHeights(dt: number, f: NjFrame) {
    this.resampleT -= dt;
    if (this.resampleT > 0) return;
    this.resampleT = 1;
    const key = `${this.o.world.dynamicCount}:${njStats.ms}`;
    if (key === this.heightsKey) return;
    this.heightsKey = key;
    for (const t of this.tracks) sampleHeights(t, f, this.o.world);
    if (this.mini !== null) sampleHeights(this.mini, f, this.o.world);
    for (const h of this.npcs) if (h.hang !== null) h.hang.y = this.groundAt(h.hang.x, h.hang.z, f);
  }

  private groundAt(x: number, z: number, f: NjFrame) {
    _ro.set(x, f.P + RAY_UP, z);
    const hit = this.o.world.raycast(_ro, _rd, RAY_UP + 6);
    return hit !== null ? hit.point.y : f.P;
  }

  private makeNpc(state: NpcState, track: Track | null, hover: boolean): Npc {
    const ch = new NounCharacter(randomSeed(), this.o.assets);
    if (this.o.toon) toonify(ch.root);
    ch.setBoardType(hover ? 'hover' : 'skate');
    ch.setWeight(Math.random() < 0.6 ? 0 : -0.6 + Math.random() * 1.3);
    const shadows = this.o.quality !== 'low';
    ch.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = shadows && m.castShadow;
      if (!shadows) m.receiveShadow = false;
    });
    this.o.scene.add(ch.root);
    const name = this.names[this.npcs.length % this.names.length] ?? 'noun';
    const label = document.createElement('div');
    label.className = 'w2-nametag';
    label.style.opacity = '0.8';
    label.style.display = 'none';
    label.innerHTML = `<span style="font-size:11px">${name} <i style="font-style:normal;font-size:9px;opacity:.65;letter-spacing:.05em">NPC</i></span>`;
    this.o.labelLayer.appendChild(label);
    return {
      ch,
      label,
      name,
      hover,
      state,
      track,
      s: 0,
      dir: 1,
      v: 0,
      cruise: 0,
      y: 0,
      vy: 0,
      off: 0,
      t: 0,
      sinceTrick: Math.random() * 3,
      sinceLand: 9,
      pushT: 0,
      flip: false,
      airClip: 'skate_ollie',
      manual: 0,
      bailBoard: 0,
      hTop: 1.2,
      hang: null,
      waveT: 0,
      waved: false,
      pos: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      lastPos: new THREE.Vector3(),
      lean: 0,
      parity: this.npcs.length & 1,
      animAcc: 0,
    };
  }

  private addRider(t: Track, s: number) {
    const npc = this.makeNpc('ride', t, Math.random() < 0.3);
    npc.s = s;
    npc.cruise = t.cruise[0] + Math.random() * (t.cruise[1] - t.cruise[0]);
    npc.v = npc.cruise * 0.8;
    this.place(npc);
    this.npcs.push(npc);
  }

  private place(npc: Npc) {
    npc.y = this.yAt(npc.track!, npc.s);
    this.pose(npc, 0, this.o.camera.position, true);
  }

  private addPumper() {
    if (this.mini === null) return;
    const npc = this.makeNpc('pump', this.mini, Math.random() < 0.3);
    npc.s = this.mini.len / 2;
    npc.dir = 1;
    npc.hTop = 1.05 + Math.random() * 0.25;
    this.place(npc);
    this.npcs.push(npc);
  }

  private addHanger(f: NjFrame, h: (typeof HANGS)[number] | undefined) {
    if (h === undefined) return;
    const npc = this.makeNpc('hang', null, Math.random() < 0.3);
    const w = njToWorld(f, h.a, h.b, { x: 0, z: 0 });
    npc.hang = {
      x: w.x,
      y: this.groundAt(w.x, w.z, f),
      z: w.z,
      yaw: njYaw(f, h.da, h.db),
      mood: h.mood,
    };
    npc.pos.set(w.x, npc.hang.y, w.z);
    npc.quat.setFromAxisAngle(Y, npc.hang.yaw);
    npc.ch.root.position.copy(npc.pos);
    npc.ch.root.quaternion.copy(npc.quat);
    this.npcs.push(npc);
  }

  // ── Sampling helpers ──

  private wrap(t: Track, s: number) {
    if (t.closed) return ((s % t.len) + t.len) % t.len;
    return Math.min(t.len, Math.max(0, s));
  }

  /** Lerped height at arc length s. */
  private yAt(t: Track, s: number) {
    const u = this.wrap(t, s) / t.ds;
    const i = Math.floor(u);
    const fr = u - i;
    const i0 = t.closed ? i % t.n : Math.min(t.n - 1, i);
    const i1 = t.closed ? (i + 1) % t.n : Math.min(t.n - 1, i + 1);
    return t.y[i0] + (t.y[i1] - t.y[i0]) * fr;
  }

  private idx(t: Track, s: number) {
    const i = Math.round(this.wrap(t, s) / t.ds);
    return t.closed ? i % t.n : Math.min(t.n - 1, i);
  }

  /** Any of `mask` within [s0, s1] (forward)? Returns the distance to it, or -1. */
  private flagAhead(t: Track, s: number, dist: number, mask: number) {
    const i0 = Math.floor(this.wrap(t, s) / t.ds);
    const steps = Math.ceil(dist / t.ds);
    for (let k = 1; k <= steps; k++) {
      const i = t.closed ? (i0 + k) % t.n : i0 + k;
      if (i >= t.n) return -1;
      if ((t.flags[i] & mask) !== 0) return k * t.ds - (this.wrap(t, s) - i0 * t.ds);
    }
    return -1;
  }

  // ── Simulation ──

  private step(npc: Npc, dt: number, player: THREE.Vector3, cam: THREE.Vector3) {
    npc.t += dt;
    npc.sinceTrick += dt;
    npc.sinceLand += dt;
    if (npc.state === 'hang') this.stepHang(npc, dt, player);
    else if (npc.state === 'pump') this.stepPump(npc, dt);
    else this.stepRide(npc, dt, player);
    this.pose(npc, dt, cam);
  }

  private stepHang(npc: Npc, dt: number, player: THREE.Vector3) {
    const h = npc.hang!;
    const dx = player.x - h.x;
    const dz = player.z - h.z;
    const near = dx * dx + dz * dz < 8 * 8;
    let yaw = h.yaw;
    if (near) {
      yaw = Math.atan2(dx, dz);
      if (!npc.waved) {
        npc.waved = true;
        npc.waveT = 2.6;
      }
    } else if (dx * dx + dz * dz > 14 * 14) npc.waved = false;
    npc.waveT -= dt;
    npc.pos.set(h.x, h.y, h.z);
    _q.setFromAxisAngle(Y, yaw);
    npc.quat.slerp(_q, 1 - Math.exp(-4 * dt));
    const clip = npc.waveT > 0 ? 'wave' : h.mood;
    npc.ch.play({ clip, fade: 0.3 });
  }

  private stepPump(npc: Npc, dt: number) {
    const t = npc.track!;
    const y0 = this.yAt(t, t.len / 2);
    const h = this.yAt(t, npc.s) - y0;
    npc.v = Math.sqrt(Math.max(0.36, 2 * G_SLOPE * (npc.hTop - h)));
    npc.s += npc.dir * npc.v * dt;
    if (this.yAt(t, npc.s) - y0 >= npc.hTop) {
      npc.dir = -npc.dir;
      npc.hTop = 1.05 + Math.random() * 0.28;
    }
    npc.s = this.wrap(t, npc.s);
    npc.y = this.yAt(t, npc.s);
    const low = this.yAt(t, npc.s) - y0 < 0.25;
    npc.ch.play({ clip: low ? 'skate_crouch' : 'skate_idle', fade: 0.3 });
  }

  private stepRide(npc: Npc, dt: number, player: THREE.Vector3) {
    const t = npc.track!;
    const i = this.idx(t, npc.s);
    const tx = t.tx[i];
    const tz = t.tz[i];
    // ── Avoidance: the player, plus slower / stopped crew ahead ──
    let block = Infinity;
    let blockLat = 0;
    const consider = (ox: number, oz: number) => {
      const dx = ox - npc.pos.x;
      const dz = oz - npc.pos.z;
      const along = dx * tx + dz * tz;
      if (along < 0.3 || along > 11) return;
      const lat = dx * tz - dz * tx;
      if (Math.abs(lat) > 1.8) return;
      if (along < block) {
        block = along;
        blockLat = lat;
      }
    };
    consider(player.x, player.z);
    for (const o of this.npcs)
      if (o !== npc && (o.state === 'bail' || (o.track === t && o.v < npc.v - 1.5)))
        consider(o.pos.x, o.pos.z);
    let target = Math.min(npc.cruise, t.vcap[i]);
    let offTarget = 0;
    const featureNear = this.flagAhead(t, npc.s, 7, F_STEP | F_DROP | F_GRIND) >= 0;
    if (block < Infinity) {
      if (!featureNear && npc.state === 'ride') {
        const away = blockLat >= 0 ? -1 : 1;
        offTarget = THREE.MathUtils.clamp(npc.off + away * (2.2 - Math.abs(blockLat)), -2.6, 2.6);
      }
      // Slow right down if it's close and we can't (or haven't yet) got round
      const clear = Math.abs(blockLat) > 1.2 && !featureNear;
      if (!clear) target *= THREE.MathUtils.clamp((block - 1.6) / 4, 0, 1);
    }
    const offRate = 2.2 * dt;
    npc.off += THREE.MathUtils.clamp(offTarget - npc.off, -offRate, offRate);
    if (npc.state === 'grind') npc.off *= Math.exp(-10 * dt);

    // ── Speed ──
    const slope = (this.yAt(t, npc.s + 0.5) - this.yAt(t, npc.s - 0.5)) / 1;
    if (npc.state === 'ride') {
      npc.v -= G_SLOPE * Math.max(-1.5, Math.min(1.5, slope)) * dt;
      if (npc.v < target) {
        if (Math.abs(slope) < 0.05) npc.v += 2.4 * dt;
        npc.pushT =
          npc.v < target - 0.7 && npc.hover === false ? Math.max(npc.pushT, 0.9) : npc.pushT;
      } else {
        npc.v -= (npc.v - target > 1 ? 4.5 : 0.8) * dt;
      }
      if (slope > 0.05) npc.v = Math.max(npc.v, 1.0);
      npc.v = THREE.MathUtils.clamp(npc.v, 0, 12);
    } else if (npc.state === 'grind') {
      npc.v = Math.max(3, npc.v - 0.7 * dt);
    } else if (npc.state === 'bail') {
      npc.v = Math.max(0, npc.v - 9 * dt);
    }
    npc.pushT -= dt;

    // ── Move + vertical ──
    const sPrev = npc.s;
    npc.s = this.wrap(t, npc.s + npc.v * dt);
    if (npc.state === 'ride' || npc.state === 'grind') {
      // Crossed a drop: launch off it with the slope we came up
      const iPrev = Math.floor(sPrev / t.ds) % t.n;
      const iNow = Math.floor(npc.s / t.ds) % t.n;
      let dropped = false;
      for (let k = iPrev, guard = 0; k !== iNow && guard < 64; k = (k + 1) % t.n, guard++) {
        if ((t.flags[k] & F_DROP) !== 0) {
          dropped = true;
          break;
        }
      }
      if (dropped) {
        const climb = (t.y[iPrev % t.n] - t.y[(iPrev - 2 + t.n) % t.n]) / (2 * t.ds);
        const kicker = climb > 0.2;
        this.takeOff(npc, Math.max(0, climb) * npc.v + (kicker ? 1.4 : 0.9), kicker ? 0.45 : 0);
      } else if (npc.state === 'ride') {
        // Hop onto a step (kerb, rail, pad) — or the odd flat-ground trick
        const lookFor = npc.v * 0.45 + 0.6;
        const ds = this.flagAhead(t, npc.s, lookFor, F_STEP);
        if (ds >= 0 && Math.abs(npc.off) < 0.4) {
          const si = this.idx(t, npc.s + ds);
          const dh = t.y[(si + 1) % t.n] - t.y[si];
          const vy = Math.sqrt(2 * G_AIR * (Math.max(0.1, dh) + 0.3));
          const lead = npc.v * (vy / G_AIR) * 0.8;
          if (ds <= lead) this.takeOff(npc, vy, 0.15);
        } else if (
          npc.sinceTrick > 3 &&
          Math.abs(slope) < 0.03 &&
          block === Infinity &&
          npc.v > 4 &&
          !featureNear &&
          Math.random() < 0.12 * dt
        ) {
          this.takeOff(npc, 4.3, 0.4);
        }
      }
      if (npc.state === 'ride' || npc.state === 'grind') {
        npc.y = this.yAt(t, npc.s);
        const fl = t.flags[this.idx(t, npc.s)];
        npc.state = (fl & F_GRIND) !== 0 ? 'grind' : 'ride';
        npc.manual = (fl & F_MANUAL) !== 0 ? 1 : 0;
      }
    } else if (npc.state === 'air') {
      npc.vy -= G_AIR * dt;
      npc.y += npc.vy * dt;
      const gy = this.yAt(t, npc.s);
      if (npc.vy < 0 && npc.y <= gy) {
        npc.y = gy;
        npc.vy = 0;
        npc.sinceLand = 0;
        const fl = t.flags[this.idx(t, npc.s)];
        const bailP = npc.flip ? 0.12 : npc.t > 0.6 ? 0.07 : 0.03;
        if ((fl & F_GRIND) === 0 && Math.random() < bailP) {
          npc.state = 'bail';
          npc.t = 0;
          npc.bailBoard = 0;
        } else {
          npc.state = (fl & F_GRIND) !== 0 ? 'grind' : 'ride';
          npc.t = 0;
        }
        npc.flip = false;
      }
    } else if (npc.state === 'bail') {
      npc.y = this.yAt(t, npc.s);
      npc.bailBoard = Math.min(1, npc.bailBoard + dt * 1.6);
      if (npc.t > 2.5) {
        npc.state = 'ride';
        npc.t = 0;
        npc.sinceTrick = 0;
        npc.pushT = 1.2;
      }
    }
    // Lean into the turn
    const leanT = THREE.MathUtils.clamp(((t.k[i] * npc.v * npc.v) / 9.8) * 0.7, -1, 1);
    npc.lean += (leanT - npc.lean) * (1 - Math.exp(-6 * dt));
    this.pickClip(npc);
  }

  private takeOff(npc: Npc, vy: number, flipChance: number) {
    npc.state = 'air';
    npc.vy = vy;
    npc.t = 0;
    npc.sinceTrick = 0;
    npc.flip = Math.random() < flipChance;
    npc.airClip = npc.flip ? 'skate_flip' : vy > 5 ? 'skate_air' : 'skate_ollie';
    // Flip / ollie restart: hop through another clip so `play` resets it
    npc.ch.play({ clip: 'skate_crouch', fade: 0.01 });
  }

  private pickClip(npc: Npc) {
    const ch = npc.ch;
    switch (npc.state) {
      case 'air':
        ch.play({ clip: npc.airClip, once: npc.airClip !== 'skate_air', fade: 0.06 });
        return;
      case 'grind':
        ch.play({ clip: 'skate_grind', fade: 0.1 });
        return;
      case 'bail':
        ch.play(
          npc.t > 1.6
            ? { clip: 'skate_getup', once: true, fade: 0.25 }
            : { clip: 'skate_bail', once: true, fade: 0.08 },
        );
        return;
      default:
        if (npc.sinceLand < 0.32) ch.play({ clip: 'skate_land', once: true, fade: 0.05 });
        else if (npc.manual > 0) ch.play({ clip: 'skate_manual', fade: 0.15 });
        else if (npc.pushT > 0 && npc.v > 0.3) ch.play({ clip: 'skate_push', fade: 0.12 });
        else ch.play({ clip: 'skate_idle', fade: 0.25 });
    }
  }

  // ── Pose + animation ──

  private pose(npc: Npc, dt: number, cam: THREE.Vector3, snap = false) {
    const ch = npc.ch;
    const t = npc.track;
    if (t !== null) {
      const u = npc.s / t.ds;
      const i0 = t.closed ? Math.floor(u) % t.n : Math.min(t.n - 1, Math.floor(u));
      const i1 = t.closed ? (i0 + 1) % t.n : Math.min(t.n - 1, i0 + 1);
      const fr = u - Math.floor(u);
      const x = t.x[i0] + (t.x[i1] - t.x[i0]) * fr;
      const z = t.z[i0] + (t.z[i1] - t.z[i0]) * fr;
      const tx = t.tx[i0] + (t.tx[i1] - t.tx[i0]) * fr;
      const tz = t.tz[i0] + (t.tz[i1] - t.tz[i0]) * fr;
      // Lateral offset (swerving)
      npc.pos.set(x + tz * npc.off, npc.y, z - tx * npc.off);
      // Orientation: up = surface normal on the ground, world up otherwise
      if (npc.state === 'ride' || npc.state === 'pump' || npc.state === 'bail')
        _up
          .set(
            t.nx[i0] + (t.nx[i1] - t.nx[i0]) * fr,
            t.ny[i0] + (t.ny[i1] - t.ny[i0]) * fr,
            t.nz[i0] + (t.nz[i1] - t.nz[i0]) * fr,
          )
          .normalize();
      else _up.copy(Y);
      const slope = (t.y[i1] - t.y[i0]) / t.ds;
      _fw.set(tx, npc.state === 'air' || npc.state === 'grind' ? 0 : slope, tz);
      _fw.addScaledVector(_up, -_fw.dot(_up)).normalize();
      _rt.crossVectors(_up, _fw);
      _m.makeBasis(_rt, _up, _fw);
      _q.setFromRotationMatrix(_m);
      if (snap) npc.quat.copy(_q);
      else npc.quat.slerp(_q, 1 - Math.exp(-14 * dt));
    }
    ch.root.position.copy(npc.pos);
    ch.root.quaternion.copy(npc.quat);

    // Board: flips, manual pitch, bails (thrown ahead), hangout (set down beside)
    const b = ch.board;
    b.position.set(0, 0, 0);
    b.quaternion.identity();
    ch.body.position.set(0, 0, 0);
    ch.body.quaternion.identity();
    b.visible = true;
    if (npc.state === 'hang') {
      b.position.set(0.55, 0, 0.15);
      b.quaternion.setFromAxisAngle(Y, 0.5);
    } else if (npc.state === 'air' && npc.flip) {
      const k = Math.min(1, npc.t / 0.42);
      const pivot = ch.deckTop * 0.6;
      b.quaternion.setFromAxisAngle(Z, k * Math.PI * 2);
      _v.set(0, pivot, 0).applyQuaternion(b.quaternion);
      b.position.set(-_v.x, pivot - _v.y + Math.sin(k * Math.PI) * 0.18, -_v.z);
    } else if (npc.state === 'ride' && npc.manual > 0) {
      _qb.setFromAxisAngle(X, -0.22);
      b.quaternion.copy(_qb);
      ch.body.quaternion.copy(_qb);
      ch.body.position.y = 0.026;
    } else if (npc.state === 'bail') {
      const e = 1 - (1 - npc.bailBoard) * (1 - npc.bailBoard);
      b.position.set(0.4 * e, 0, 1.6 * e);
      _ax.set(0, 0.3, 1).normalize();
      b.quaternion.setFromAxisAngle(_ax, e * Math.PI);
    }

    // Visibility + animation LOD
    const dist = cam.distanceTo(npc.pos);
    ch.root.visible = dist < DRAW_DIST;
    const travelled = npc.lastPos.distanceTo(npc.pos);
    npc.lastPos.copy(npc.pos);
    if (!ch.root.visible) return;
    npc.animAcc += dt;
    npc.parity ^= 1;
    if (dist > FULL_ANIM_DIST && npc.parity === 1) return;
    const adt = npc.animAcc;
    npc.animAcc = 0;
    const riding = npc.state !== 'hang' && npc.state !== 'bail';
    ch.update(adt, {
      lean: riding ? npc.lean : 0,
      travelled: npc.state === 'ride' || npc.state === 'pump' ? travelled : 0,
      riding,
      grounded: npc.state !== 'air',
    });
  }

  private _p = new THREE.Vector3();

  private updateLabels(cam: THREE.Vector3) {
    const camera = this.o.camera;
    const w = this.o.canvas.clientWidth;
    const h = this.o.canvas.clientHeight;
    for (const npc of this.npcs) {
      const dist = cam.distanceTo(npc.pos);
      let show = dist < LABEL_DIST;
      if (show) {
        const v = this._p.copy(npc.pos);
        v.y += 2.05;
        v.project(camera);
        show = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
        if (show)
          npc.label.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
      }
      const disp = show ? 'block' : 'none';
      if (npc.label.style.display !== disp) npc.label.style.display = disp;
    }
  }

  private disposeNpc(npc: Npc) {
    const ch = npc.ch;
    ch.dispose();
    // Per-character: the cloned body materials (+ their toon copies), the
    // shirt texture and the hover glow materials. Geometry, head atlases,
    // the board's materials and the toon ramp are shared.
    ch.board.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.Material;
      if (mat.blending === THREE.AdditiveBlending) mat.dispose();
    });
    ch.body.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        const src = mat.userData.toonSrc as THREE.Material | undefined;
        const sm = mat as THREE.MeshStandardMaterial;
        if (/nounbody/i.test(sm.name)) sm.map?.dispose();
        src?.dispose();
        mat.dispose();
      }
    });
    npc.label.remove();
  }

  dispose() {
    this.clear();
  }
}
