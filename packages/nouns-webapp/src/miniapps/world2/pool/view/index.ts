// ── Noun Pool's view: the table in the world, and everything on it ──────
//
// PoolMode (net/) owns the frame and tells the view, once a frame, where
// the balls are (the session's playback), what the local player is doing
// (aim, power, spin, ball in hand, the call) and what happened (the
// session's events: strokes, clacks, drops). The view draws the table at
// its spot in the world (a bar's prop, or the pool hall), rolls the balls,
// strokes the cue, poses the two players, points the camera and plays
// the sounds. It also answers pointer picks on the cloth.

import type { NounSeed } from '../../character/NounAppearance';
import type { CharacterAssets } from '../../character/NounCharacter';
import type { PocketId, PoolTable, Vec2 } from '../contract';
import type { SessionEvent } from '../net/session';

import * as THREE from 'three';

import { inkExcluded, toonify } from '../../render/Toon';
import { firstHit } from '../sim/aim';
import { POCKETS, R } from '../sim/table';

import { ballTexture } from './atlas';
import { PoolAudio } from './audio';
import { PoolCamera, type CamMode } from './camera';
import { CueStick, STROKE } from './cue';
import { AimGuide } from './guide';
import { buildHall, type Hall } from './hall';
import { TablePlayers, stance } from './players';
import { buildTable, HX, HZ, type TableMesh } from './table';

export { STROKE };
export type { CamMode };

export interface PoolViewDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLElement;
  assets: CharacterAssets | null;
  toon: boolean;
  shadows: boolean;
  audio: () => AudioContext | null;
  audioOut: () => AudioNode | null;
}

/** What the view needs to know each frame. */
export interface ViewFrame {
  balls: readonly (Vec2 | null)[];
  /** Somebody's lining up (local or remote / CPU): the cue + guide. */
  aim: null | {
    seat: 0 | 1;
    cue: Vec2;
    dx: number;
    dy: number;
    power: number;
    /** Show the guide (only for the local shooter). */
    guide: boolean;
    pro: boolean;
  };
  /** Ball in hand: the spot being tried and whether it's legal (null: not placing). */
  placing: { at: Vec2; ok: boolean } | null;
  /** Calling the 8: the pocket picked (null: not calling). */
  call: PocketId | null;
  calling: boolean;
  rolling: boolean;
  events: readonly SessionEvent[];
  /** The seat that shot the rolling shot. */
  shooter: 0 | 1;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _plane = new THREE.Plane();
const _hands = { bridge: new THREE.Vector3(), back: new THREE.Vector3() };
const _axis = new THREE.Vector3();
const _dq = new THREE.Quaternion();

interface BallMesh {
  mesh: THREE.Mesh;
  last: Vec2 | null;
  drop: number;
  dropAt: Vec2 | null;
}

export class PoolView {
  readonly root = new THREE.Group();
  readonly cam: PoolCamera;
  /** The table's frame (sim ↔ world). */
  readonly frame = new THREE.Group();
  private table: TableMesh;
  private balls: BallMesh[] = [];
  private ballGeo = new THREE.SphereGeometry(R, 22, 14);
  private ballMats: THREE.Material[] = [];
  private cue = new CueStick();
  private guide: AimGuide;
  private players: TablePlayers;
  private audio: PoolAudio;
  private hall: Hall | null = null;
  private feltY: number;
  private time = 0;
  private lastAim = { dx: 1, dz: 0 };
  private strokeSeat: 0 | 1 = 0;
  /** The ball that moved most this frame (the follow camera's target). */
  private leadAt: THREE.Vector3 = new THREE.Vector3();
  /** Camera choice while aiming (the player's toggle). */
  aimMode: 'aim' | 'top' = 'aim';
  readonly stats = { drawCalls: 0 };

  constructor(
    private deps: PoolViewDeps,
    readonly place: PoolTable,
    opts: { hall?: boolean } = {},
  ) {
    // Fit the prop's footprint (never smaller, so the prop never shows through)
    const s = Math.max(1, place.length / (HX * 2), place.width / (HZ * 2)) * 1.02;
    const top = place.height ?? 0.86;
    // Clear of the prop's own clutter (its leaning cue rises ~0.05 over its top)
    this.feltY = (top + 0.06) / s;
    this.root.name = 'noun-pool';
    this.root.position.set(place.x, place.y, place.z);
    this.root.rotation.y = place.yaw;
    this.frame.scale.setScalar(s);
    this.root.add(this.frame);
    this.table = buildTable(this.feltY);
    this.frame.add(this.table.group);
    if (opts.hall === true) {
      this.hall = buildHall();
      this.root.add(this.hall.group);
    }
    // Balls
    for (let id = 0; id < 16; id++) {
      const m = new THREE.MeshStandardMaterial({
        map: ballTexture(id),
        roughness: 0.22,
        metalness: 0,
      });
      this.ballMats.push(m);
      const mesh = new THREE.Mesh(this.ballGeo, m);
      mesh.castShadow = deps.shadows;
      // A random-looking start orientation (numbers not all facing one way)
      mesh.quaternion.setFromEuler(new THREE.Euler(id * 1.3, id * 2.1, id * 0.7));
      mesh.visible = false;
      this.frame.add(mesh);
      this.balls.push({ mesh, last: null, drop: -1, dropAt: null });
    }
    this.frame.add(this.cue.group);
    this.guide = new AimGuide(this.feltY);
    this.frame.add(this.guide.group);
    for (const m of this.guide.meshes()) inkExcluded.add(m);
    this.players = new TablePlayers(deps.assets, deps.toon);
    this.frame.add(this.players.group);
    if (deps.toon) {
      toonify(this.table.group);
      toonify(this.cue.group);
      if (this.hall !== null) toonify(this.hall.group);
      for (const b of this.balls) toonify(b.mesh);
    }
    this.cam = new PoolCamera(this.feltY);
    this.audio = new PoolAudio(deps.audio, deps.audioOut);
    deps.scene.add(this.root);
  }

  get hasHall() {
    return this.hall !== null;
  }

  setPlayers(seeds: [NounSeed, NounSeed]) {
    this.players.set(0, seeds[0]);
    this.players.set(1, seeds[1]);
  }

  /** Sim point → table-frame point at ball height. */
  private local(p: Vec2, out: THREE.Vector3) {
    return out.set(p.x, this.feltY + R, p.y);
  }

  /** Sim point → world. */
  toWorld(p: Vec2, out = new THREE.Vector3()): THREE.Vector3 {
    this.local(p, out);
    this.frame.updateMatrixWorld();
    return out.applyMatrix4(this.frame.matrixWorld);
  }

  /** Screen point → sim point on the cloth (null off the table plane). */
  pick(clientX: number, clientY: number): Vec2 | null {
    const el = this.deps.canvas.getBoundingClientRect();
    _ndc.set(((clientX - el.left) / el.width) * 2 - 1, -((clientY - el.top) / el.height) * 2 + 1);
    _ray.setFromCamera(_ndc, this.deps.camera);
    this.frame.updateMatrixWorld();
    const n = _w.set(0, 1, 0).transformDirection(this.frame.matrixWorld);
    const p0 = this.local({ x: 0, y: 0 }, _v).applyMatrix4(this.frame.matrixWorld);
    _plane.setFromNormalAndCoplanarPoint(n, p0);
    const hit = _ray.ray.intersectPlane(_plane, _v);
    if (hit === null) return null;
    const inv = this.frame.matrixWorld.clone().invert();
    hit.applyMatrix4(inv);
    if (Math.abs(hit.x) > HX + 0.5 || Math.abs(hit.z) > HZ + 0.5) return null;
    return { x: hit.x, y: hit.z };
  }

  /** The pocket nearest a sim point (within reach), for calling the 8. */
  pocketAt(p: Vec2): PocketId | null {
    let best: PocketId | null = null;
    let bd = 0.16 * 0.16;
    for (const q of POCKETS) {
      const d = (q.aim.x - p.x) ** 2 + (q.aim.y - p.y) ** 2;
      if (d < bd) {
        bd = d;
        best = q.id;
      }
    }
    return best;
  }

  setCam(mode: CamMode) {
    this.cam.mode = mode;
  }

  update(dt: number, f: ViewFrame) {
    this.time += dt;
    this.audio.frame();
    this.hall?.update(dt);
    if (this.hall !== null) for (const m of this.hall.lamp) m.visible = this.cam.mode !== 'top';
    // ── Events: strokes and sounds ──
    for (const e of f.events) {
      if (e.e === 'shot') {
        this.strokeSeat = e.seat;
        this.cue.stroke(0.04 + e.input.shot.power * 0.22);
        const s = e.input.shot;
        const n = Math.hypot(s.dx, s.dy) || 1;
        this.lastAim = { dx: s.dx / n, dz: s.dy / n };
        const v = 0.25 + s.power * 8.25;
        window.setTimeout(() => this.audio.cue(v), STROKE * 1000);
      } else if (e.e === 'phys') {
        const ev = e.ev;
        if (ev.k === 'ball') this.audio.clack(ev.j);
        else if (ev.k === 'rail') this.audio.thud(ev.j);
        else if (ev.k === 'pocket') {
          this.audio.drop(ev.v);
          const b = this.balls[ev.a];
          if (b !== undefined) {
            b.drop = 0;
            const p = POCKETS[ev.p]!;
            b.dropAt = { x: p.x, y: p.y };
          }
        }
      } else if (e.e === 'end' && e.winner !== null) this.players.celebrate(e.winner);
    }

    // ── Balls ──
    let most = 2e-4;
    this.leadAt = this.balls[0]!.mesh.position;
    for (let id = 0; id < 16; id++) {
      const b = this.balls[id]!;
      let p = f.balls[id] ?? null;
      if (id === 0 && f.placing !== null) p = f.placing.at;
      if (b.drop >= 0) {
        // Into the pocket: slide to its centre and sink (then it's gone, or respotted)
        b.drop += dt;
        const k = Math.min(1, b.drop / 0.28);
        const at = b.dropAt!;
        const m = b.mesh;
        m.position.x += (at.x - m.position.x) * Math.min(1, dt * 14);
        m.position.z += (at.y - m.position.z) * Math.min(1, dt * 14);
        m.position.y = this.feltY + R - k * k * 0.09;
        m.visible = k < 1;
        if (k >= 1) {
          b.drop = -1;
          b.last = null;
        }
        continue;
      }
      if (p === null) {
        b.mesh.visible = false;
        b.last = null;
        continue;
      }
      const m = b.mesh;
      m.visible = true;
      this.local(p, m.position);
      if (b.last !== null) {
        const dx = p.x - b.last.x;
        const dz = p.y - b.last.y;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > most && d < 0.5) {
          most = d;
          this.leadAt = m.position;
        }
        if (d > 1e-7 && d < 0.5) {
          _axis.set(dz, 0, -dx).divideScalar(d);
          _dq.setFromAxisAngle(_axis, d / R);
          m.quaternion.premultiply(_dq);
        }
      }
      b.last = { x: p.x, y: p.y };
    }

    // ── Cue, guide, players ──
    const a = f.aim;
    const cueBall = f.balls[0] ?? null;
    if (this.cue.striking) {
      const at = cueBall !== null ? this.local(cueBall, _v) : null;
      this.cue.update(dt, at, this.lastAim.dx, this.lastAim.dz, R);
    } else if (a !== null && !f.rolling) {
      const n = Math.hypot(a.dx, a.dy) || 1;
      this.lastAim = { dx: a.dx / n, dz: a.dy / n };
      this.cue.aim(
        this.local(a.cue, _v),
        this.lastAim.dx,
        this.lastAim.dz,
        0.03 + a.power * 0.22,
        R,
      );
    } else if (!f.rolling) this.cue.hide();
    if (a !== null && a.guide && !f.rolling && f.placing === null) {
      const n = Math.hypot(a.dx, a.dy) || 1;
      const hit = firstHit(
        f.balls.map((q, i) => (i === 0 ? null : q)),
        a.cue,
        a.dx / n,
        a.dy / n,
        0,
      );
      const obj = hit?.kind === 'ball' ? (f.balls[hit.id] ?? null) : null;
      this.guide.show(a.cue.x, a.cue.y, a.dx / n, a.dy / n, hit, a.pro, obj);
    } else this.guide.hideAim();
    this.guide.showHand(
      f.placing?.at.x ?? 0,
      f.placing?.at.y ?? 0,
      f.placing === null ? null : f.placing.ok,
    );
    this.guide.showPockets(f.call, f.calling && !f.rolling, this.time);

    const shooterSeat = f.rolling || this.cue.striking ? this.strokeSeat : (a?.seat ?? null);
    const cueAt = a?.cue ?? cueBall;
    let shooter: { seat: 0 | 1; x: number; z: number; dx: number; dz: number } | null = null;
    if (shooterSeat !== null && cueAt !== null) {
      const st = stance(cueAt.x, cueAt.y, this.lastAim.dx, this.lastAim.dz);
      shooter = { seat: shooterSeat, x: st.x, z: st.z, dx: this.lastAim.dx, dz: this.lastAim.dz };
    }
    const holding = this.cue.group.visible && shooter !== null && f.placing === null;
    this.players.update(
      dt,
      shooter,
      holding ? this.cue.hands(_hands) : null,
      this.cam.eye,
      this.cam.mode === 'top',
    );

    // ── Camera ──
    const lead = this.leadAt;
    if (f.rolling) {
      if (this.cam.mode !== 'follow' && this.aimMode === 'aim' && !this.cue.striking)
        this.cam.follow(this.balls[0]!.mesh.position);
    } else if (this.cam.mode === 'follow') this.cam.mode = this.aimMode;
    const camCue =
      a !== null ? this.local(a.cue, _w) : cueBall !== null ? this.local(cueBall, _w) : null;
    this.cam.update(
      this.deps.camera,
      this.frame,
      dt,
      camCue,
      this.lastAim.dx,
      this.lastAim.dz,
      lead,
    );
  }

  dispose() {
    for (const m of this.guide.meshes()) inkExcluded.delete(m);
    this.table.dispose();
    this.cue.dispose();
    this.guide.dispose();
    this.players.dispose();
    this.hall?.dispose();
    this.audio.dispose();
    this.ballGeo.dispose();
    for (const b of this.balls) (b.mesh.material as THREE.Material).dispose();
    for (const m of this.ballMats) {
      (m as THREE.MeshStandardMaterial).map?.dispose();
      m.dispose();
    }
    this.root.removeFromParent();
  }
}
