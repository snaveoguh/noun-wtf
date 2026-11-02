// ── Life on the water off Puerto Noun ────────────────────────────────────
//
// - Buoys: yellow ones marking the line-up (~175 m out in front of the
//   town), orange swim-zone ones closer in. One InstancedMesh; each floats
//   on the CPU wave field (sea.ts), tilted to the surface.
// - Boats: three fishing pangas at anchor beyond the break, bobbing and
//   pitching on the swell. One InstancedMesh.
// - Gulls: 16 silhouettes wheeling over the beach and the line-up, one
//   InstancedMesh flapping by y scale (like CAMP's birds).
// - The locals: three NPC surfers (a shark, a wave and a crab head) who
//   sit in the line-up and ride waves with the same sim as you
//   (surf/bot.ts), built one a frame once you're near.
// 3 draws + the locals. Nothing is updated when the camera is far.

import type { Game } from '../Game';

import { ImageData } from '@noundry/nouns-assets';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { NounCharacter } from '../character/NounCharacter';
import { toonify } from '../render/Toon';
import { townToWorld, townYaw } from '../towns/site';
import { terrainHeight } from '../world/mountain/terrain';

import { COAST, type CoastFrame } from './coast';
import { NO_SURF, type SurfAnim } from './net/sf';
import { blankSea, seaAt, seaSlope, type SeaPoint } from './sea';
import { SurfBot } from './surf/bot';
import { newWater, stepWater, type SeaQuery, type WaterState } from './surf/sim';
import { DECK } from './view/poses';
import { Surfboard } from './view/Surfboard';
import { SurfRig } from './view/SurfRig';

/** Buoys / boats / gulls run within this far of the camera (m, coast distance). */
export const LIFE_NEAR = 900;
/** The locals are built within this far (m), hidden past LOCALS_HIDE. */
export const LOCALS_NEAR = 320;
export const LOCALS_HIDE = 480;

function colored(g: THREE.BufferGeometry, c: number): THREE.BufferGeometry {
  const p = g.index !== null ? g.toNonIndexed() : g;
  const col = new THREE.Color(c);
  const n = p.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.toArray(a, i * 3);
  p.deleteAttribute('uv');
  p.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return p;
}

function buoyGeometry(): THREE.BufferGeometry {
  const g = mergeGeometries([
    colored(new THREE.CylinderGeometry(0.42, 0.5, 0.7, 10).translate(0, 0.15, 0), 0xffffff),
    colored(new THREE.ConeGeometry(0.34, 0.9, 10).translate(0, 0.95, 0), 0xffffff),
    colored(new THREE.CylinderGeometry(0.43, 0.43, 0.14, 10).translate(0, 0.45, 0), 0x1b4965),
  ])!;
  g.computeVertexNormals();
  return g;
}

function boatGeometry(): THREE.BufferGeometry {
  // a panga: a long hull (half cylinder), a bench, an outboard
  const hull = new THREE.CylinderGeometry(0.85, 0.85, 6.4, 10, 1, true, Math.PI / 2, Math.PI)
    .rotateX(Math.PI / 2)
    .rotateZ(Math.PI)
    .scale(1, 0.7, 1)
    .translate(0, 0.55, 0);
  const g = mergeGeometries([
    colored(hull, 0xffffff),
    colored(new THREE.BoxGeometry(1.5, 0.12, 0.5).translate(0, 0.42, 0.6), 0xa7794c),
    colored(new THREE.BoxGeometry(1.5, 0.12, 0.5).translate(0, 0.42, -1.4), 0xa7794c),
    colored(new THREE.BoxGeometry(0.3, 0.8, 0.4).translate(0, 0.6, -3.25), 0x2a2320),
    colored(new THREE.BoxGeometry(1.75, 0.18, 6.3).translate(0, 0.62, 0), 0x2ec4b6),
  ])!;
  g.computeVertexNormals();
  return g;
}

function gullGeometry(): THREE.BufferGeometry {
  // a flat M: two swept wings + a body
  const pos = new Float32Array([
    // left wing
    0, 0, 0.18, -1.1, 0.18, -0.2, 0, 0, -0.2,
    // right wing
    0, 0, 0.18, 0, 0, -0.2, 1.1, 0.18, -0.2,
    // body
    -0.08, 0, 0.45, 0.08, 0, 0.45, 0, -0.05, -0.45,
  ]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return colored(g, 0xf4f1ea);
}

const HEADS = ['head-shark', 'head-wave', 'head-crab'] as const;

interface Local {
  s: WaterState;
  bot: SurfBot;
  ch: NounCharacter | null;
  rig: SurfRig | null;
  board: Surfboard | null;
  anim: SurfAnim;
  head: string;
  seed: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _n = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _w = { x: 0, z: 0 };
const _sl = { x: 0, z: 0 };

/** A rest spot in coast coords: (u along the town line, v' across). */
interface Spot {
  u: number;
  vp: number;
  color: number;
}

export class OceanLife {
  readonly group = new THREE.Group();
  private buoys: THREE.InstancedMesh;
  private boats: THREE.InstancedMesh;
  private gulls: THREE.InstancedMesh;
  private buoySpots: { x: number; z: number }[] = [];
  private boatSpots: { x: number; z: number; yaw: number }[] = [];
  private locals: Local[] = [];
  private sp: SeaPoint = blankSea();
  private time = 0;
  private query: SeaQuery;
  private seaT = 0;

  constructor(
    private game: Game,
    private c: CoastFrame,
  ) {
    this.group.name = 'oceanLife';
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    mat.name = 'OceanLife';
    const spots: Spot[] = [];
    // line-up markers ~175 m out, swim-zone markers ~70 m out
    for (let u = 20; u <= 220; u += 50) spots.push({ u, vp: COAST.shore + 175, color: 0xffd23f });
    for (let u = 40; u <= 200; u += 80) spots.push({ u, vp: COAST.shore + 70, color: 0xff6f61 });
    this.buoys = new THREE.InstancedMesh(buoyGeometry(), mat, spots.length);
    this.buoys.name = 'ocean:buoys';
    spots.forEach((s, i) => {
      const w = townToWorld(c.town, s.vp, s.u, _w);
      this.buoySpots.push({ x: w.x, z: w.z });
      this.buoys.setColorAt(i, new THREE.Color(s.color));
    });
    this.boats = new THREE.InstancedMesh(boatGeometry(), mat, 3);
    this.boats.name = 'ocean:boats';
    for (const [u, vp, yaw] of [
      [-60, COAST.shore + 330, 0.6],
      [150, COAST.shore + 420, 2.2],
      [300, COAST.shore + 380, -0.9],
    ] as const) {
      const w = townToWorld(c.town, vp, u, _w);
      this.boatSpots.push({ x: w.x, z: w.z, yaw });
    }
    const boatCols = [0xff6f61, 0xffd23f, 0x7ac74f];
    boatCols.forEach((col, i) => this.boats.setColorAt(i, new THREE.Color(col).lerp(new THREE.Color(0xffffff), 0.35)));
    const gmat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    gmat.name = 'Gulls';
    this.gulls = new THREE.InstancedMesh(gullGeometry(), gmat, 16);
    this.gulls.name = 'ocean:gulls';
    for (const m of [this.buoys, this.boats, this.gulls]) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
    }
    this.buoys.castShadow = this.boats.castShadow = game.gfx.quality !== 'low';
    if (game.gfx.toon) {
      toonify(this.buoys);
      toonify(this.boats);
    }
    this.query = {
      at: (x, z, out) => seaAt(x, z, this.seaT, out, this.c),
      ground: (x, z) => terrainHeight(x, z),
    };
    // the locals' spots in the line-up
    for (let i = 0; i < HEADS.length; i++) {
      const w = townToWorld(c.town, COAST.shore + 150 + i * 9, 70 + i * 45, _w);
      const s = newWater(i === 0 ? 'shortboard' : i === 1 ? 'longboard' : 'foamie');
      s.phase = 'paddle';
      s.x = w.x;
      s.z = w.z;
      s.yaw = Math.atan2(-c.rx * c.side, -c.rz * c.side);
      this.locals.push({
        s,
        bot: new SurfBot(w.x, w.z, i + 2, blankSea),
        ch: null,
        rig: null,
        board: null,
        anim: NO_SURF,
        head: HEADS[i],
        seed: 0x5eaf + i * 977,
      });
    }
  }

  /** Once a frame: `dCam` = the camera's coast distance, `t` the sea clock. */
  update(dt: number, t: number, dCam: number, cam: THREE.Vector3) {
    this.seaT = t;
    this.time += dt;
    const on = dCam > -LIFE_NEAR && cam.y < this.c.sea + 700;
    this.group.visible = on;
    if (!on) {
      for (const l of this.locals) if (l.ch !== null) l.ch.root.visible = false;
      if (this.locals.some(l => l.board !== null)) for (const l of this.locals) if (l.board) l.board.mesh.visible = false;
      return;
    }
    this.floatBuoys(t);
    this.floatBoats(t);
    this.flyGulls();
    this.updateLocals(dt, cam);
  }

  private floatBuoys(t: number) {
    for (let i = 0; i < this.buoySpots.length; i++) {
      const b = this.buoySpots[i];
      const sea = seaAt(b.x, b.z, t, this.sp, this.c);
      const y = sea?.y ?? this.c.sea;
      seaSlope(b.x, b.z, t, this.sp, _sl, 0.5);
      _n.set(-_sl.x, 1, -_sl.z).normalize();
      _q.setFromUnitVectors(_up, _n);
      _p.set(b.x, y - 0.2, b.z);
      this.buoys.setMatrixAt(i, _m.compose(_p, _q, _s.set(1, 1, 1)));
    }
    this.buoys.instanceMatrix.needsUpdate = true;
  }

  private floatBoats(t: number) {
    for (let i = 0; i < this.boatSpots.length; i++) {
      const b = this.boatSpots[i];
      // swing at anchor a little
      const yaw = b.yaw + Math.sin(this.time * 0.05 + i) * 0.25;
      const sea = seaAt(b.x, b.z, t, this.sp, this.c);
      const y = sea?.y ?? this.c.sea;
      seaSlope(b.x, b.z, t, this.sp, _sl, 2.5);
      _n.set(-_sl.x * 1.4, 1, -_sl.z * 1.4).normalize();
      _q.setFromUnitVectors(_up, _n).multiply(_q2.setFromAxisAngle(_up, yaw));
      _p.set(b.x, y - 0.25, b.z);
      this.boats.setMatrixAt(i, _m.compose(_p, _q, _s.set(1, 1, 1)));
    }
    this.boats.instanceMatrix.needsUpdate = true;
  }

  private flyGulls() {
    const c = this.c;
    const t = this.time;
    for (let i = 0; i < 16; i++) {
      // each circles its own centre over the beach / line-up
      const cu = 40 + ((i * 53) % 180);
      const cv = COAST.shore + 20 + ((i * 37) % 170);
      const r = 14 + ((i * 7) % 18);
      const sp = 0.18 + ((i * 13) % 7) * 0.02;
      const a = t * sp * (i % 2 === 0 ? 1 : -1) + i * 1.7;
      const w = townToWorld(c.town, cv + Math.sin(a) * r, cu + Math.cos(a) * r, _w);
      const y = c.sea + 9 + ((i * 11) % 9) + Math.sin(t * 0.7 + i) * 1.5;
      const dir = i % 2 === 0 ? 1 : -1;
      const heading = townYaw(c.town, Math.cos(a) * dir, -Math.sin(a) * dir);
      const flap = 0.35 + 0.65 * Math.abs(Math.sin(t * (5 + (i % 3)) + i));
      _q.setFromAxisAngle(_up, heading);
      _p.set(w.x, y, w.z);
      this.gulls.setMatrixAt(i, _m.compose(_p, _q, _s.set(0.9, flap, 0.9)));
    }
    this.gulls.instanceMatrix.needsUpdate = true;
  }

  private updateLocals(dt: number, cam: THREE.Vector3) {
    const g = this.game;
    let built = false;
    for (const l of this.locals) {
      const d = Math.hypot(l.s.x - cam.x, l.s.z - cam.z);
      // sim keeps running while near-ish, even unbuilt (so they're mid-session when you arrive)
      if (d < LOCALS_HIDE * 1.6) stepWater(l.s, l.bot.input(l.s, this.query), this.query, dt, []);
      if (l.ch === null) {
        if (d < LOCALS_NEAR && !built && g.assets) {
          this.build(l);
          built = true;
        } else continue;
      }
      const ch = l.ch!;
      const show = d < LOCALS_HIDE && l.s.phase !== 'off';
      ch.root.visible = show;
      if (l.board !== null) l.board.mesh.visible = show && l.s.phase !== 'swim';
      if (!show) continue;
      const s = l.s;
      l.anim = { phase: s.phase, board: s.board, lean: s.lean, crouch: s.crouch, stroke: s.stroke, sit: s.sit, t: s.t };
      ch.root.position.set(s.x, s.y, s.z);
      ch.root.quaternion.setFromAxisAngle(_up, s.yaw);
      ch.play({ clip: 'idle', fade: 0.3 });
      ch.update(dt, { lean: 0, travelled: 0, riding: false, grounded: true });
      l.rig!.update(dt, l.anim);
      if (l.board !== null) placeBoard(l.board.mesh, s, this.query, this.sp);
    }
  }

  private build(l: Local) {
    const g = this.game;
    const im = ImageData.images as Record<string, { filename: string }[]>;
    const head = Math.max(0, im.heads!.findIndex(x => x.filename === l.head));
    const r = (n: number, k: number) => (l.seed * (k + 1) * 2654435761) % n;
    const ch = new NounCharacter(
      {
        background: 0,
        body: r(im.bodies!.length, 1),
        accessory: r(im.accessories!.length, 2),
        head,
        glasses: r(im.glasses!.length, 3),
      },
      g.assets!,
    );
    ch.board.visible = false;
    if (g.gfx.toon) toonify(ch.root);
    if (g.gfx.quality === 'low') ch.setCastShadows(false);
    g.gfx.scene.add(ch.root);
    l.ch = ch;
    l.rig = new SurfRig(ch);
    l.board = new Surfboard(g.gfx.scene, l.s.board ?? 'foamie', g.gfx.toon);
  }

  dispose() {
    for (const l of this.locals) {
      l.ch?.root.removeFromParent();
      l.ch?.dispose();
      l.board?.dispose();
    }
    this.group.removeFromParent();
    for (const m of [this.buoys, this.boats, this.gulls]) {
      m.geometry.dispose();
      m.dispose();
    }
  }
}

/**
 * Put a board under a rider: on the surface (tilted to it), the rider's
 * heading, rolled into the carve; nose pushed under in a duck dive; under
 * their arm while wading. Shared by the local rider and remotes.
 */
export function placeBoard(mesh: THREE.Object3D, s: WaterState, q: SeaQuery, tmp: SeaPoint) {
  const yaw = s.yaw;
  if (s.phase === 'wade') {
    // carried: on its rail at the rider's right side
    const rx = -Math.cos(yaw);
    const rz = Math.sin(yaw);
    mesh.position.set(s.x + rx * 0.5, s.y + 0.85, s.z + rz * 0.5);
    mesh.quaternion.setFromAxisAngle(_up, yaw).multiply(_q2.setFromAxisAngle(_n.set(0, 0, 1), Math.PI / 2));
    return;
  }
  const sea = q.at(s.x, s.z, tmp);
  const y = s.phase === 'air' ? s.y : (sea?.y ?? s.y);
  // tilt to the surface
  const e = 0.6;
  const a = q.at(s.x + e, s.z, tmp)?.y ?? y;
  const b = q.at(s.x - e, s.z, tmp)?.y ?? y;
  const c = q.at(s.x, s.z + e, tmp)?.y ?? y;
  const d = q.at(s.x, s.z - e, tmp)?.y ?? y;
  _n.set(-(a - b) / (2 * e), 1, -(c - d) / (2 * e)).normalize();
  if (s.phase === 'air') _n.set(0, 1, 0);
  _q.setFromUnitVectors(_up, _n).multiply(_q2.setFromAxisAngle(_up, yaw));
  const roll = s.phase === 'ride' || s.phase === 'air' ? -s.lean * 0.35 : 0;
  const pitch = s.phase === 'duck' ? Math.sin(Math.min(1, s.t / 0.95) * Math.PI) * 0.5 : 0;
  _q.multiply(_q2.setFromEuler(new THREE.Euler(pitch, 0, roll, 'YXZ')));
  const sink = s.phase === 'duck' ? Math.sin(Math.min(1, s.t / 0.95) * Math.PI) * 1.1 : 0;
  mesh.position.set(s.x, y + DECK * 0.3 - sink, s.z);
  mesh.quaternion.copy(_q);
}
