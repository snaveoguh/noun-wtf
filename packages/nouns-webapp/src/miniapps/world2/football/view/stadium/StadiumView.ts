// ── NOUN STADIUM: the view (StadiumViewApi) ──────────────────────────────
//
// The whole stadium as nine meshes, one draw each (shell, seats, ground,
// pitch kit, nets, crowd, ad boards, the screen + sign, floodlight lamps),
// all children of `root`, which sits at the StadiumFrame (so everything is
// written pitch-local). Static parts are written straight into one merged
// buffer per material (geo.ts) over a few frames (`buildStep`, a slice a
// frame: each a few ms; `sliceMs` keeps the timings), then the lit ones
// are toonified like the rest of the world. Everything that moves (crowd,
// nets, ad boards) moves in shaders / uniforms / a texture offset: per
// frame the CPU only eases a handful of uniforms (`tick`).

import type { PitchSpec, StadiumFrame, StadiumViewApi, TeamId, TeamKit } from '../../contract';

import * as THREE from 'three';

import { textureDiet } from '../../../render/textureDiet';
import { toonify } from '../../../render/Toon';
import { PITCH_11 } from '../../contract';

import {
  COL,
  TAG_AWAY,
  TAG_HOME,
  buildAds,
  buildBoxes,
  buildCorners,
  buildFacade,
  buildGround,
  buildKit,
  buildRoof,
  buildScreen,
  buildTier,
  buildTunnel,
} from './build';
import { colliderPositions } from './collider';
import {
  crowdMaterial,
  crowdMesh,
  crowdUniforms,
  fanGeometry,
  fillCrowd,
  type CrowdUniforms,
} from './crowd';
import { Geo, linear } from './geo';
import { STANDS } from './layout';
import { netGeometry, netMaterial, netUniforms, type NetUniforms } from './nets';
import { QUIET_SHARE, crowdBudget, seatListSteps, type SeatList } from './seats';
import {
  adsTexture,
  netTexture,
  paintAds,
  paintBoard,
  screenTexture,
  type BoardInfo,
} from './textures';

export interface StadiumViewOptions {
  frame: StadiumFrame;
  quality: 'low' | 'medium' | 'high';
  /** Convert lit materials to the world's toon look. */
  toon: boolean;
}

const DEFAULT_KITS: [TeamKit, TeamKit] = [
  {
    name: 'Noun Reds',
    short: 'RED',
    shirt: 0xd22d2d,
    shorts: 0xffffff,
    socks: 0xd22d2d,
    keeper: 0x2bbf6a,
  },
  {
    name: 'Noun Blues',
    short: 'BLU',
    shirt: 0x2d5bd2,
    shorts: 0xffffff,
    socks: 0x2d5bd2,
    keeper: 0xf3c25b,
  },
];

/** Crowd hidden past this far from the eye (m). */
export const CROWD_DRAW = 420;
/** Fans built per slice. */
const CROWD_SLICE = 2500;

const BOARD_EVERY = 0.5;

export class StadiumView implements StadiumViewApi {
  readonly root = new THREE.Group();
  built = false;
  /** Build slice timings (ms), in order. */
  readonly sliceMs: number[] = [];

  private step = 0;
  private shell = new Geo();
  private seatsGeo = new Geo();
  private groundGeo = new Geo();
  private adsGeo = new Geo(true);
  private screenGeo = new Geo(true);
  private lampsGeo = new Geo();

  private mats: THREE.Material[] = [];
  private textures: THREE.Texture[] = [];
  private shellMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private groundMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });
  private kitMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -8,
  });
  private lampMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0x8a8a8a });

  private seatsMesh: THREE.Mesh | null = null;
  private kitMesh: THREE.Mesh | null = null;
  private netMesh: THREE.Mesh | null = null;
  private fans: THREE.InstancedMesh | null = null;
  private crowdFilled = 0;
  private seats: SeatList | null = null;
  private seatSteps: Generator<void, SeatList, void> | null = null;
  private budget: number;

  private cu: CrowdUniforms = crowdUniforms();
  private nu: NetUniforms = netUniforms();
  private ads = adsTexture();
  private screen = screenTexture();
  private netTex = netTexture();
  private adsMat: THREE.MeshBasicMaterial;
  private screenMat: THREE.MeshBasicMaterial;

  private kits: [TeamKit, TeamKit] = DEFAULT_KITS;
  private pitch: PitchSpec = PITCH_11;
  private live = false;
  private boardInfo: BoardInfo = { home: 'HOM', away: 'AWY', score: [0, 0], clock: '00:00' };
  private boardDirty = true;
  private boardT = 0;
  private time = 0;
  /** Crowd excitement targets (fan end 0, 1, neutral) and the eased values. */
  private exTarget = new THREE.Vector3(0.1, 0.1, 0.1);
  private waveT = 0;
  private waveNext = 40;
  private adK = 0;
  private adT = 0;
  private disposed = false;

  constructor(readonly opts: StadiumViewOptions) {
    const f = opts.frame;
    this.root.name = 'stadium';
    this.root.position.set(f.x, f.y, f.z);
    this.root.rotation.y = f.yaw;
    this.root.updateMatrixWorld(true);
    this.budget = crowdBudget(opts.quality, textureDiet.on);
    this.adsMat = new THREE.MeshBasicMaterial({ map: this.ads.tex });
    this.screenMat = new THREE.MeshBasicMaterial({ map: this.screen.tex });
    this.textures.push(this.ads.tex, this.screen.tex, this.netTex);
    this.mats.push(
      this.shellMat,
      this.groundMat,
      this.kitMat,
      this.lampMat,
      this.adsMat,
      this.screenMat,
    );
    paintAds(this.ads.cv, this.ads.tex, this.kits, 0);
  }

  /** The build, one slice per call. */
  private readonly steps: (() => boolean | void)[] = [
    () => buildGround(this.groundGeo),
    () => this.buildStand(0),
    () => this.buildStand(1),
    () => this.buildStand(2),
    () => this.buildStand(3),
    () => {
      buildFacade(this.shell);
      buildCorners(this.shell, this.lampsGeo);
    },
    () => {
      buildTunnel(this.shell);
      buildAds(this.shell, this.adsGeo);
      buildScreen(this.shell, this.screenGeo);
    },
    () => this.setPitch(this.pitch),
    () => {
      this.seatSteps ??= seatListSteps();
      const r = this.seatSteps.next();
      if (r.done !== true) return false;
      this.seats = r.value;
      this.seatSteps = null;
    },
    () => {
      const n = Math.min(this.budget, this.seats!.count);
      const mat = crowdMaterial(this.opts.toon, this.cu);
      this.mats.push(mat);
      this.fans = crowdMesh(fanGeometry(), mat, n);
      this.root.add(this.fans);
    },
    // fill the crowd a slice at a time (returns false until done)
    () => {
      const c = this.fans!;
      this.crowdFilled = fillCrowd(
        c,
        this.seats!,
        this.crowdFilled,
        this.crowdFilled + CROWD_SLICE,
      );
      return this.crowdFilled >= c.instanceMatrix.count;
    },
    () => {
      this.mesh(this.shell.toGeometry(), this.shellMat, 'shell', true);
      this.shell = new Geo();
    },
    () => this.finishSeats(),
    () => this.finish(),
    () => this.finishLook(),
  ];

  buildStep(): boolean {
    if (this.built || this.disposed) return this.built;
    const t0 = performance.now();
    const done = this.steps[this.step]!();
    this.sliceMs.push(performance.now() - t0);
    if (done !== false) this.step++;
    if (this.step >= this.steps.length) this.built = true;
    return this.built;
  }

  private buildStand(i: number) {
    const s = STANDS[i]!;
    s.tiers.forEach((t, k) => buildTier(s, t, k === 0, this.seatsGeo, this.shell));
    buildBoxes(s, this.shell);
    buildRoof(s, this.shell);
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, name: string, shadow = false) {
    const m = new THREE.Mesh(geo, mat);
    m.name = `stadium:${name}`;
    m.castShadow = shadow;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    this.root.add(m);
    return m;
  }

  private finishSeats() {
    const seats = this.seatsGeo.toGeometry();
    seats.userData.tags = Uint8Array.from(this.seatsGeo.tag);
    this.seatsMesh = this.mesh(seats, this.shellMat, 'seats');
    this.seatsGeo = new Geo();
  }

  private finish() {
    this.mesh(this.groundGeo.toGeometry(), this.groundMat, 'ground');
    const ads = this.mesh(this.adsGeo.toGeometry(), this.adsMat, 'ads');
    ads.receiveShadow = false;
    const scr = this.mesh(this.screenGeo.toGeometry(), this.screenMat, 'screen');
    scr.receiveShadow = false;
    const lamps = this.mesh(this.lampsGeo.toGeometry(), this.lampMat, 'lamps');
    lamps.receiveShadow = false;
    // free the writers
    this.groundGeo = this.adsGeo = this.screenGeo = this.lampsGeo = new Geo();
  }

  private finishLook() {
    this.applyKits();
    this.applyLive();
    if (this.opts.toon) toonify(this.root);
    this.root.updateMatrixWorld(true);
  }

  // ── StadiumViewApi ──

  setPitch(spec: PitchSpec): void {
    this.pitch = spec;
    const kit = new Geo();
    buildKit(kit, spec);
    const geo = kit.toGeometry();
    if (this.kitMesh !== null) {
      this.kitMesh.geometry.dispose();
      this.kitMesh.geometry = geo;
    } else {
      this.kitMesh = this.mesh(geo, this.kitMat, 'kit');
      if (this.built && this.opts.toon) toonify(this.kitMesh);
    }
    const ng = netGeometry(spec);
    if (this.netMesh !== null) {
      this.netMesh.geometry.dispose();
      this.netMesh.geometry = ng;
    } else {
      const mat = netMaterial(this.opts.toon, this.netTex, this.nu);
      this.mats.push(mat);
      this.netMesh = this.mesh(ng, mat, 'nets');
    }
  }

  setKits(kits: [TeamKit, TeamKit]): void {
    this.kits = kits;
    this.applyKits();
    paintAds(this.ads.cv, this.ads.tex, kits, this.adK);
    this.boardDirty = true;
  }

  private applyKits() {
    const [a, b] = this.kits;
    this.cu.uShirt0.value.setHex(a.shirt);
    this.cu.uShirt1.value.setHex(b.shirt);
    this.cu.uAlt0.value.setHex(a.shorts === a.shirt ? 0xffffff : a.shorts);
    this.cu.uAlt1.value.setHex(b.shorts === b.shirt ? 0xffffff : b.shorts);
    const m = this.seatsMesh;
    if (m === null) return;
    const col = m.geometry.getAttribute('color') as THREE.BufferAttribute;
    const tags = this.seatTags ?? (this.seatTags = this.captureTags());
    const shade = (hex: number, k: number) => {
      const [r, g, bl] = linear(hex);
      return [r * k, g * k, bl * k] as const;
    };
    const home = shade(a.shirt, 0.8);
    const away = shade(b.shirt, 0.8);
    const homeR = shade(a.shirt, 0.55);
    const awayR = shade(b.shirt, 0.55);
    const arr = col.array as Float32Array;
    for (let i = 0; i < tags.length; i++) {
      const t = tags[i]!;
      if (t === 0) continue;
      const c = t === TAG_HOME ? home : t === TAG_AWAY ? away : t === TAG_HOME + 2 ? homeR : awayR;
      arr[i * 3] = c[0];
      arr[i * 3 + 1] = c[1];
      arr[i * 3 + 2] = c[2];
    }
    col.needsUpdate = true;
  }

  private seatTags: Uint8Array | null = null;
  private captureTags(): Uint8Array {
    // the writer is gone by now: tags were kept on the geometry's userData
    return (this.seatsMesh!.geometry.userData.tags as Uint8Array | undefined) ?? new Uint8Array(0);
  }

  board(info: BoardInfo): void {
    const b = this.boardInfo;
    if (
      b.home === info.home &&
      b.away === info.away &&
      b.score[0] === info.score[0] &&
      b.score[1] === info.score[1] &&
      b.clock === info.clock &&
      b.text === info.text
    )
      return;
    this.boardInfo = { ...info, score: [info.score[0], info.score[1]] };
    this.boardDirty = true;
  }

  crowd(excite: number, end: TeamId | null, dt: number): void {
    void dt;
    const e = Math.max(0, Math.min(1, excite));
    const calm = this.live ? 0.1 : 0.05;
    if (end === null)
      this.exTarget.set(Math.max(calm, e), Math.max(calm, e), Math.max(calm, e * 0.8));
    else {
      const other = Math.max(calm, 0.12 * e);
      this.exTarget.set(
        end === 0 ? Math.max(calm, e) : other,
        end === 1 ? Math.max(calm, e) : other,
        Math.max(calm, e * 0.55),
      );
    }
  }

  netHit(px: number, py: number, pz: number, strength: number): void {
    const s = Math.max(0, Math.min(1, strength));
    const v = pz < 0 ? this.nu.uHit0.value : this.nu.uHit1.value;
    v.set(px, py, pz, this.time);
    if (pz < 0) this.nu.uStr.value.x = s;
    else this.nu.uStr.value.y = s;
  }

  setLive(on: boolean): void {
    this.live = on;
    this.boardDirty = true;
    this.applyLive();
  }

  private applyLive() {
    this.lampMat.color.setHex(this.live ? 0xffffff : 0x8a8a8a);
    const c = this.fans;
    if (c !== null) {
      const n = Math.min(this.crowdFilled, c.instanceMatrix.count);
      c.count = this.live ? n : Math.floor(n * QUIET_SHARE);
    }
    // floodlit: a touch of light on the pitch + stands (uniforms only)
    const glow = this.live ? 0x1c1c16 : 0x000000;
    for (const m of this.root.children) {
      const mat = (m as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
      if (
        mat !== undefined &&
        'emissive' in mat &&
        mat.emissive instanceof THREE.Color &&
        mat.userData.noToon !== true
      )
        if (m.name === 'stadium:ground' || m.name === 'stadium:kit' || m.name === 'stadium:seats')
          mat.emissive.setHex(glow);
    }
  }

  /**
   * Per frame (StadiumSystem): ease the crowd, run the wave, scroll the
   * ads, redraw the screen when due, hide the crowd when far.
   */
  tick(dt: number, eye: THREE.Vector3) {
    if (!this.built) return;
    this.time += dt;
    const u = this.cu;
    u.uTime.value = this.time;
    this.nu.uNetTime.value = this.time;
    const k = 1 - Math.exp(-dt * 3);
    u.uEx.value.lerp(this.exTarget, k);
    // crowd LOD: off when far
    const c = this.fans;
    if (c !== null) c.visible = eye.distanceTo(this.root.position) < CROWD_DRAW;
    // Mexican wave now and then (live, not mid-frenzy)
    const calm = Math.max(u.uEx.value.x, u.uEx.value.y) < 0.55;
    if (this.waveT > 0) {
      this.waveT -= dt;
      const p = 1 - this.waveT / 16;
      u.uWave.value.set((p * 2) % 1, Math.min(1, Math.min(p, 1 - p) * 8));
      if (this.waveT <= 0) u.uWave.value.set(0, 0);
    } else if (this.live && calm) {
      this.waveNext -= dt;
      if (this.waveNext <= 0) {
        this.waveT = 16;
        this.waveNext = 70 + ((this.time * 7.31) % 1) * 60;
      }
    }
    // ads drift along (texture offset: a uniform)
    this.ads.tex.offset.x = (this.ads.tex.offset.x + dt * 0.06) % 1;
    this.adT += dt;
    if (this.adT > 12) {
      this.adT = 0;
      this.adK++;
      paintAds(this.ads.cv, this.ads.tex, this.kits, this.adK);
    }
    // the big screen (≤ 2 Hz)
    this.boardT -= dt;
    if (this.boardDirty && this.boardT <= 0) {
      paintBoard(this.screen.cv, this.boardInfo, this.kits, this.live);
      this.screen.tex.needsUpdate = true;
      this.boardDirty = false;
      this.boardT = BOARD_EVERY;
    }
  }

  /** Collider geometry, world space relative to the frame's position (CollisionWorld.setDynamic). */
  colliderGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(colliderPositions(), 3));
    g.rotateY(this.opts.frame.yaw);
    return g;
  }

  /** Draw calls this stadium adds when everything is in view (perf). */
  get draws(): number {
    let n = 0;
    this.root.traverse(o => {
      if ((o as THREE.Mesh).isMesh && o.visible) n++;
    });
    return n;
  }

  /** Triangles of every mesh (instanced: × count). */
  get triangles(): number {
    let n = 0;
    this.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !o.visible) return;
      const g = m.geometry;
      const t = (g.index !== null ? g.index.count : g.getAttribute('position').count) / 3;
      n += (o as THREE.InstancedMesh).isInstancedMesh ? t * (o as THREE.InstancedMesh).count : t;
    });
    return n;
  }

  dispose(): void {
    this.disposed = true;
    this.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      const mat = m.material;
      // toonified materials are new objects: free them too
      if (Array.isArray(mat)) mat.forEach(x => x.dispose());
      else mat.dispose();
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
    for (const m of this.mats) m.dispose();
    for (const t of this.textures) t.dispose();
    this.root.removeFromParent();
    this.root.clear();
  }
}

export { COL };
