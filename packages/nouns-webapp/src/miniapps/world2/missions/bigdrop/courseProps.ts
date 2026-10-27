// ── The Big Drop's SSX course: the things on it (three.js) ───────────────
//
// START and FINISH arches, checkpoint gates, boost pads (scrolling
// chevrons), rails / a log / a fence (registered with the game's RailSet so
// the board grinds them), the ice cave and the rock bore (meshes + their
// own colliders), rock arches over the S-curves, the SPLIT's signs and the
// shortcut's edge poles.
//
// Built in slices (a build is a hitch): one job list ordered by track
// distance, worked through for at most ~2 ms a frame, the stretch just
// ahead of the rider first. Everything stays until the rider leaves (the
// course is ~5 km: a few dozen objects). Every mesh is built relative to
// its own anchor (peak coordinates) and put back at the anchor's local
// position every frame, which also covers rebases; colliders go through
// ctx.setCollider (the dimension shifts them). Course rails live in the
// game's RailSet in LOCAL coordinates: they're re-added on every rebase.

import type { PeakCtx } from './contract';
import type { BoostPad, Cave, RailSpec, RockArch } from './courseSpec';
import type { RailDef } from '../../physics/Rails';

import * as THREE from 'three';

import { textureDiet } from '../../render/textureDiet';
import { toonify } from '../../render/Toon';
import { peakHeight } from '../peakTerrain';

import {
  CAVE_RING,
  CAVE_SEG,
  caveSection,
  type LineFrame,
  lineFrame,
  linePoint,
  railPoints,
} from './courseGeom';
import {
  ARCHES,
  BOOSTS,
  BRANCH,
  CAVES,
  CHECKPOINTS,
  COURSE,
  COURSE_SECTIONS,
  PAD,
  RAILS,
} from './courseSpec';

/** Per-frame build budget (ms). */
const BUDGET_MS = 2;
/** Build what's within this far ahead of the rider first (m of s). */
const NEAR_AHEAD = 1500;
/** Rail ids in the game's RailSet. */
const RAIL_PREFIX = 'bigdrop-ssx:';

interface Job {
  s: number;
  run: () => void;
}

interface Anchored {
  obj: THREE.Object3D;
  peak: THREE.Vector3;
}

const _f: LineFrame = { x: 0, z: 0, dirX: 0, dirZ: 1, sideX: 1, sideZ: 0, half: 0 };
const _p = { x: 0, y: 0, z: 0 };

export class CourseProps {
  readonly root = new THREE.Group();
  private jobs: Job[] = [];
  private anchored: Anchored[] = [];
  private colliders: string[] = [];
  /** Course rails in peak coordinates (re-added in local coordinates on a rebase). */
  private rails: { id: string; type: RailDef['type']; pts: number[] }[] = [];
  private mats: THREE.Material[] = [];
  private textures: THREE.Texture[] = [];
  /** The boost pads' shared chevrons (scrolled every frame). */
  private padTex: THREE.CanvasTexture;
  private padMat: THREE.MeshBasicMaterial;
  private snowMat: THREE.MeshStandardMaterial;
  private rockMat: THREE.MeshStandardMaterial;
  private iceMat: THREE.MeshBasicMaterial;
  private metalMat: THREE.MeshStandardMaterial;
  private woodMat: THREE.MeshStandardMaterial;
  private postMat: THREE.MeshStandardMaterial;
  private v = new THREE.Vector3();
  /** Seconds since the start (pad scroll). */
  private time = 0;

  constructor(private ctx: PeakCtx) {
    this.root.name = 'BigDropCourse';
    this.padTex = this.chevronTexture();
    this.padMat = this.mat(
      new THREE.MeshBasicMaterial({
        map: this.padTex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        fog: true,
      }),
    );
    this.padMat.userData.noToon = true;
    this.snowMat = this.mat(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.9,
        metalness: 0,
        emissive: 0x6a7890,
        emissiveIntensity: 0.5,
        side: THREE.DoubleSide,
      }),
    );
    this.rockMat = this.mat(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.95,
        flatShading: true,
        side: THREE.DoubleSide,
      }),
    );
    // The caves' inside: unlit, so the glow bands read in the dark
    this.iceMat = this.mat(
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    );
    this.metalMat = this.mat(
      new THREE.MeshStandardMaterial({
        color: 0xdfe6f0,
        metalness: 0.7,
        roughness: 0.25,
        emissive: 0x2a3550,
      }),
    );
    this.woodMat = this.mat(new THREE.MeshStandardMaterial({ color: 0x7a4a26, roughness: 0.9 }));
    this.postMat = this.mat(new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.6 }));
    this.queue();
    ctx.group.add(this.root);
  }

  // ── Jobs ──────────────────────────────────────────────────────────────

  private queue() {
    const J = (s: number, run: () => void) => this.jobs.push({ s, run });
    J(COURSE.start, () => this.gate(COURSE.start, 'START', 'start'));
    J(COURSE.finish, () => this.gate(COURSE.finish, 'FINISH', 'finish'));
    for (const c of CHECKPOINTS) J(c.s, () => this.gate(c.s, c.name, 'cp'));
    for (const p of BOOSTS) J(p.s, () => this.pad(p));
    for (const r of RAILS) J(r.s0, () => this.rail(r));
    for (const c of CAVES) J(c.s0, () => this.cave(c));
    for (const a of ARCHES) J(a.s, () => this.arch(a));
    // Section boards (the first is the START arch's)
    let s0: number = COURSE_SECTIONS[0]!.s1;
    for (const c of COURSE_SECTIONS.slice(1)) {
      const at = s0 + 12;
      J(at, () => this.sign(at, 'main', -1, c.name, '#ffd400'));
      s0 = c.s1;
    }
    // THE SPLIT: which way is which, and poles down the shortcut
    const fork = BRANCH.s0 - 40;
    J(fork, () => {
      this.sign(fork, 'main', BRANCH.side, 'SAFE LINE', '#3ad46a');
      this.sign(fork, 'main', -BRANCH.side, 'SHORTCUT', '#f3322c');
    });
    J(BRANCH.s0 + 60, () => this.branchPoles());
    J(BRANCH.kickerS - 30, () => this.sign(BRANCH.kickerS - 30, 'branch', 1, 'GAP!', '#f3322c'));
    this.jobs.sort((a, b) => a.s - b.s);
  }

  /** Work through the queue for up to BUDGET_MS, nearest the rider first. */
  update(dt: number, riderS: number) {
    this.time += dt;
    this.padTex.offset.y = -(this.time * 1.6) % 1;
    if (this.jobs.length > 0) {
      const t0 = performance.now();
      while (this.jobs.length > 0 && performance.now() - t0 < BUDGET_MS) {
        let pick = 0;
        for (let i = 0; i < this.jobs.length; i++) {
          const d = this.jobs[i]!.s - riderS;
          if (d > -300 && d < NEAR_AHEAD) {
            pick = i;
            break;
          }
        }
        const job = this.jobs.splice(pick, 1)[0]!;
        try {
          job.run();
        } catch (err) {
          console.warn('[bigdrop] a course prop failed to build', err);
        }
      }
    }
    for (const a of this.anchored) this.ctx.toLocal(a.peak.x, a.peak.y, a.peak.z, a.obj.position);
  }

  /** Everything built? (tests and the browser run read it) */
  get done(): boolean {
    return this.jobs.length === 0;
  }

  /** The floating origin moved: course rails are local, so re-add them. */
  rebase() {
    this.syncRails();
  }

  private syncRails() {
    const rails = this.ctx.game.rails;
    rails.remove(this.rails.map(r => r.id));
    const defs: RailDef[] = [];
    for (const r of this.rails) {
      const points: [number, number, number][] = [];
      for (let i = 0; i < r.pts.length; i += 3) {
        this.ctx.toLocal(r.pts[i]!, r.pts[i + 1]!, r.pts[i + 2]!, this.v);
        points.push([this.v.x, this.v.y, this.v.z]);
      }
      defs.push({ id: r.id, type: r.type, points });
    }
    rails.add(defs);
  }

  /** Re-add any course rail something else dropped (a RailSet.load elsewhere). */
  checkRails() {
    const have = new Set(this.ctx.game.rails.rails.map(r => r.id));
    if (this.rails.some(r => !have.has(r.id))) this.syncRails();
  }

  // ── Builders ──────────────────────────────────────────────────────────

  private mat<M extends THREE.Material>(m: M): M {
    this.mats.push(m);
    return m;
  }

  private add(obj: THREE.Object3D, peak: THREE.Vector3) {
    if (this.ctx.toon) toonify(obj);
    this.ctx.toLocal(peak.x, peak.y, peak.z, obj.position);
    this.anchored.push({ obj, peak });
    this.root.add(obj);
  }

  private collider(id: string, geo: THREE.BufferGeometry, peak: THREE.Vector3) {
    // Position-only copy: the BVH reorders its index
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', geo.getAttribute('position').clone());
    if (geo.index !== null) g.setIndex(geo.index.clone());
    this.ctx.setCollider(`ssx:${id}`, g, peak);
    this.colliders.push(`ssx:${id}`);
  }

  private canvasTex(
    w: number,
    h: number,
    draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  ) {
    // (half size on the weak-phone texture diet)
    const k = textureDiet.on ? 0.5 : 1;
    const c = document.createElement('canvas');
    c.width = Math.round(w * k);
    c.height = Math.round(h * k);
    const g = c.getContext('2d');
    if (g !== null) {
      g.scale(k, k);
      draw(g, w, h);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    this.textures.push(t);
    return t;
  }

  private chevronTexture(): THREE.CanvasTexture {
    const t = this.canvasTex(64, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = 'rgba(20,40,120,0.55)';
      g.fillRect(0, 0, w, h);
      // Two chevrons pointing down the line (+v)
      for (const y0 of [8, 72]) {
        g.fillStyle = '#ffd400';
        g.beginPath();
        g.moveTo(4, y0);
        g.lineTo(w / 2, y0 + 30);
        g.lineTo(w - 4, y0);
        g.lineTo(w - 4, y0 + 18);
        g.lineTo(w / 2, y0 + 48);
        g.lineTo(4, y0 + 18);
        g.closePath();
        g.fill();
      }
      g.strokeStyle = '#59e1ff';
      g.lineWidth = 6;
      g.strokeRect(3, -4, w - 6, h + 8);
    });
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  private label(text: string, color: string, checker: boolean) {
    return this.canvasTex(512, 128, (g, w, h) => {
      g.fillStyle = '#101216';
      g.fillRect(0, 0, w, h);
      if (checker) {
        const q = 16;
        for (let y = 0; y < h; y += q)
          for (let x = 0; x < w; x += q) {
            if (((x + y) / q) % 2 !== 0) continue;
            if (y >= q * 2 && y < h - q * 2) continue;
            g.fillStyle = '#ffffff';
            g.fillRect(x, y, q, q);
          }
      } else {
        g.fillStyle = color;
        g.fillRect(0, 0, w, 14);
        g.fillRect(0, h - 14, w, 14);
      }
      g.fillStyle = checker ? color : '#ffffff';
      g.font = 'bold 64px "Pip3", "Courier New", monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, w / 2, h / 2 + 2);
    });
  }

  /** START / FINISH arch or a checkpoint gate across the main line at s. */
  private gate(s: number, text: string, kind: 'start' | 'finish' | 'cp') {
    lineFrame('main', s, _f);
    const half = _f.half + 3;
    const base = new THREE.Vector3(_f.x, peakHeight(_f.x, _f.z), _f.z);
    const g = new THREE.Group();
    const tall = kind === 'cp' ? 12 : 16;
    const color = kind === 'start' ? '#3ad46a' : kind === 'finish' ? '#ffd400' : '#59e1ff';
    const postMat =
      kind === 'cp'
        ? this.mat(
            new THREE.MeshStandardMaterial({ color: 0x1e88ff, roughness: 0.4, emissive: 0x0a2a60 }),
          )
        : this.mat(
            new THREE.MeshStandardMaterial({ color: 0xf3322c, roughness: 0.4, emissive: 0x401010 }),
          );
    const postGeo = new THREE.CylinderGeometry(0.7, 0.9, tall + 4, 10).translate(
      0,
      (tall + 4) / 2 - 4,
      0,
    );
    for (const side of [-1, 1]) {
      const px = _f.sideX * half * side;
      const pz = _f.sideZ * half * side;
      const y = peakHeight(_f.x + px, _f.z + pz) - base.y;
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(px, y, pz);
      g.add(post);
    }
    const tex = this.label(text, color, kind !== 'cp');
    const bannerMat = this.mat(new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    bannerMat.userData.noToon = true;
    const bw = half * 2;
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(bw, Math.min(bw / 4, 7)), bannerMat);
    banner.position.set(0, tall, 0);
    // Facing back up the line, so you read it riding in
    banner.rotation.y = Math.atan2(-_f.dirX, -_f.dirZ);
    g.add(banner);
    this.add(g, base);
  }

  private pad(p: BoostPad) {
    const base = new THREE.Vector3();
    linePoint(p.line, p.s, p.lat, _p);
    base.set(_p.x, _p.y, _p.z);
    const nx = 3;
    const nz = 7;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j < nz; j++) {
      const s = p.s - PAD.len / 2 + (PAD.len * j) / (nz - 1);
      lineFrame(p.line, s, _f);
      for (let i = 0; i < nx; i++) {
        const lat = p.lat - PAD.half + (2 * PAD.half * i) / (nx - 1);
        const x = _f.x + _f.sideX * lat;
        const z = _f.z + _f.sideZ * lat;
        pos.push(x - base.x, peakHeight(x, z) + 0.12 - base.y, z - base.z);
        uv.push(i / (nx - 1), 1 - j / (nz - 1));
      }
    }
    for (let j = 0; j < nz - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        idx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.padMat);
    mesh.renderOrder = 2;
    this.add(mesh, base);
  }

  private rail(r: RailSpec) {
    const pts = railPoints(r);
    const base = new THREE.Vector3(pts[0]!, pts[1]!, pts[2]!);
    const rel: THREE.Vector3[] = [];
    for (let i = 0; i < pts.length; i += 3)
      rel.push(new THREE.Vector3(pts[i]! - base.x, pts[i + 1]! - base.y, pts[i + 2]! - base.z));
    const g = new THREE.Group();
    const curve = new THREE.CatmullRomCurve3(rel);
    const segs = rel.length * 2;
    const radius = r.look === 'log' ? 0.42 : 0.08;
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, segs, radius, r.look === 'log' ? 9 : 6, false),
      r.look === 'log' ? this.woodMat : this.metalMat,
    );
    g.add(tube);
    if (r.look === 'fence') {
      const low = rel.map(p => p.clone().setY(p.y - 0.5));
      g.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(new THREE.CatmullRomCurve3(low), segs, 0.06, 5, false),
          this.woodMat,
        ),
      );
    }
    // Posts down into the snow
    const every = r.look === 'fence' ? 3 : 6;
    const postGeo = new THREE.CylinderGeometry(
      r.look === 'log' ? 0.18 : 0.06,
      r.look === 'log' ? 0.22 : 0.08,
      1,
      6,
    ).translate(0, -0.5, 0);
    for (let i = 0; i < rel.length; i += Math.max(1, Math.round(every / 3))) {
      const p = rel[i]!;
      const post = new THREE.Mesh(postGeo, r.look === 'rail' ? this.postMat : this.woodMat);
      post.position.copy(p);
      post.scale.y = r.h + 0.5;
      g.add(post);
    }
    this.add(g, base);
    // The grind: the rail's top (a log's top is its radius over the line)
    const top: number[] = pts.slice();
    if (r.look === 'log') for (let i = 1; i < top.length; i += 3) top[i] = top[i]! + radius;
    this.rails.push({
      id: RAIL_PREFIX + r.id,
      type: r.look === 'log' ? 'ledge' : 'rail',
      pts: top,
    });
    this.syncRails();
  }

  /** The cave's rings → inner (seen from inside) and outer (snow / rock) shells, plus the portal rims. */
  private cave(cv: Cave) {
    const inner: number[] = [];
    const outer: number[] = [];
    const n = Math.max(2, Math.ceil((cv.s1 - cv.s0) / CAVE_RING) + 1);
    const m = CAVE_SEG + 3;
    lineFrame(cv.line, (cv.s0 + cv.s1) / 2, _f);
    const base = new THREE.Vector3(_f.x, peakHeight(_f.x, _f.z), _f.z);
    const ip: number[] = [];
    const op: number[] = [];
    const ic: number[] = [];
    const oc: number[] = [];
    const ice = cv.look === 'ice';
    const cIn = new THREE.Color(ice ? 0x0c1838 : 0x241f1c);
    const cGlow = new THREE.Color(ice ? 0x63e8ff : 0xffa23a);
    const cOut = new THREE.Color(ice ? 0xf2f7ff : 0x7c7f86);
    const cOut2 = new THREE.Color(ice ? 0xcfe2f6 : 0x5b5e66);
    const tmp = new THREE.Color();
    for (let j = 0; j < n; j++) {
      const s = cv.s0 + ((cv.s1 - cv.s0) * j) / (n - 1);
      caveSection(cv, s, inner, outer);
      // Glow bands every few rings, brighter down the walls' middle
      const band = j % 3 === 0;
      for (let k = 0; k < m; k++) {
        ip.push(inner[k * 3]! - base.x, inner[k * 3 + 1]! - base.y, inner[k * 3 + 2]! - base.z);
        op.push(outer[k * 3]! - base.x, outer[k * 3 + 1]! - base.y, outer[k * 3 + 2]! - base.z);
        const wall = k > 0 && k < m - 1 ? Math.sin((Math.PI * (k - 1)) / CAVE_SEG) : 0;
        const portal = j === 0 || j === n - 1;
        tmp.copy(cIn);
        if (band || portal) tmp.lerp(cGlow, portal ? 0.9 : 0.35 + 0.5 * (1 - wall));
        else if (ice && (k + j) % 5 === 0) tmp.lerp(cGlow, 0.15);
        ic.push(tmp.r, tmp.g, tmp.b);
        tmp.copy(cOut).lerp(cOut2, ((k * 7 + j * 3) % 5) / 8);
        oc.push(tmp.r, tmp.g, tmp.b);
      }
    }
    const strip = (flip: boolean) => {
      const idx: number[] = [];
      for (let j = 0; j < n - 1; j++)
        for (let k = 0; k < m - 1; k++) {
          const a = j * m + k;
          const b = a + m;
          if (flip) idx.push(a, a + 1, b, a + 1, b + 1, b);
          else idx.push(a, b, a + 1, a + 1, b, b + 1);
        }
      return idx;
    };
    const mk = (p: number[], c: number[], idx: number[]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const innerGeo = mk(ip, ic, strip(false));
    const outerGeo = mk(op, oc, strip(true));
    // Portal rims: inner ring k to outer ring k, both ends
    const rp: number[] = [];
    const rc: number[] = [];
    const ridx: number[] = [];
    for (const j of [0, n - 1]) {
      const o = rp.length / 3;
      for (let k = 0; k < m; k++) {
        const q = (j * m + k) * 3;
        rp.push(ip[q]!, ip[q + 1]!, ip[q + 2]!, op[q]!, op[q + 1]!, op[q + 2]!);
        rc.push(cGlow.r, cGlow.g, cGlow.b, cOut.r, cOut.g, cOut.b);
      }
      for (let k = 0; k < m - 1; k++) {
        const a = o + k * 2;
        ridx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const rimGeo = mk(rp, rc, ridx);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(innerGeo, this.iceMat));
    g.add(new THREE.Mesh(outerGeo, ice ? this.snowMat : this.rockMat));
    const rimMat = this.mat(
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    );
    g.add(new THREE.Mesh(rimGeo, rimMat));
    this.add(g, base);
    // One collider: both shells and the rims
    const all = new THREE.BufferGeometry();
    const cp = new Float32Array(ip.length + op.length + rp.length);
    cp.set(ip, 0);
    cp.set(op, ip.length);
    cp.set(rp, ip.length + op.length);
    all.setAttribute('position', new THREE.BufferAttribute(cp, 3));
    const ci: number[] = [];
    const n1 = ip.length / 3;
    const n2 = n1 + op.length / 3;
    for (const i of strip(false)) ci.push(i);
    for (const i of strip(true)) ci.push(i + n1);
    for (const i of ridx) ci.push(i + n2);
    all.setIndex(ci);
    this.collider(cv.id, all, base);
    all.dispose();
    // A sign at the mouth
    this.sign(cv.s0 - 25, cv.line, 1, ice ? 'ICE CAVE' : 'ROCK BORE', ice ? '#59e1ff' : '#ffa23a');
  }

  /** A rock arch over the main line at s (its feet outside the lane). */
  private arch(a: RockArch) {
    lineFrame('main', a.s, _f);
    const L = _f.half + 9;
    const base = new THREE.Vector3(_f.x, peakHeight(_f.x, _f.z), _f.z);
    const yL = peakHeight(_f.x - _f.sideX * L, _f.z - _f.sideZ * L) - base.y;
    const yR = peakHeight(_f.x + _f.sideX * L, _f.z + _f.sideZ * L) - base.y;
    const pts: THREE.Vector3[] = [];
    const N = 16;
    for (let i = 0; i <= N; i++) {
      const th = (Math.PI * i) / N;
      const c = Math.cos(th);
      const lat = L * c;
      const y = yR + (yL - yR) * (0.5 - 0.5 * c) - 4 + (L * 0.95 + 4) * Math.sin(th);
      pts.push(new THREE.Vector3(_f.sideX * lat, y, _f.sideZ * lat));
    }
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 3.2, 7, false);
    // Rough it up, and colour it in strata
    const P = geo.getAttribute('position') as THREE.BufferAttribute;
    const col: number[] = [];
    const c0 = new THREE.Color(0x6e6a66);
    const c1 = new THREE.Color(0x9a948c);
    const t = new THREE.Color();
    for (let i = 0; i < P.count; i++) {
      const j = Math.sin(i * 12.9898) * 43758.5453;
      const r = j - Math.floor(j);
      P.setXYZ(
        i,
        P.getX(i) * (0.92 + 0.16 * r),
        P.getY(i) + (r - 0.5) * 0.8,
        P.getZ(i) * (0.92 + 0.16 * r),
      );
      t.copy(c0).lerp(c1, (Math.floor(P.getY(i) / 2.5) % 2 === 0 ? 0.2 : 0.7) + 0.2 * r);
      col.push(t.r, t.g, t.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    // A snow cap along the top
    const capPts = pts.slice(3, N - 2).map(p => p.clone().setY(p.y + 2.6));
    const cap = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(capPts), 16, 1.4, 6, false),
      this.mat(
        new THREE.MeshStandardMaterial({
          color: 0xf6faff,
          roughness: 0.9,
          emissive: 0x5a6880,
          emissiveIntensity: 0.4,
        }),
      ),
    );
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo, this.rockMat), cap);
    this.add(g, base);
    this.collider(a.id, geo, base);
  }

  /** A board on a post `side` of `line` at s. */
  private sign(s: number, line: 'main' | 'branch', side: number, text: string, color: string) {
    lineFrame(line, s, _f);
    const lat = side * (_f.half + 7);
    linePoint(line, s, lat, _p);
    const base = new THREE.Vector3(_p.x, _p.y, _p.z);
    const g = new THREE.Group();
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 7, 0.5).translate(0, 2.5, 0),
      this.postMat,
    );
    const tex = this.label(text, color, false);
    const bm = this.mat(new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    bm.userData.noToon = true;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.5), bm);
    board.position.y = 6.5;
    board.rotation.y = Math.atan2(-_f.dirX, -_f.dirZ);
    g.add(post, board);
    this.add(g, base);
  }

  /** Poles with flags down both edges of the shortcut. */
  private branchPoles() {
    const pts: { x: number; y: number; z: number; side: number }[] = [];
    for (let s = BRANCH.s0 + 40; s < BRANCH.s1 - 40; s += 20)
      for (const side of [-1, 1]) {
        linePoint('branch', s, side * (BRANCH.half + 1.5), _p);
        pts.push({ x: _p.x, y: _p.y, z: _p.z, side });
      }
    const base = new THREE.Vector3(pts[0]!.x, pts[0]!.y, pts[0]!.z);
    const geo = new THREE.CylinderGeometry(0.09, 0.12, 3.4, 6).translate(0, 1.4, 0);
    const mat = this.mat(new THREE.MeshStandardMaterial({ roughness: 0.5 }));
    const mesh = new THREE.InstancedMesh(geo, mat, pts.length);
    const m = new THREE.Matrix4();
    const red = new THREE.Color(0xf3322c);
    const yel = new THREE.Color(0xffd400);
    pts.forEach((p, i) => {
      m.makeTranslation(p.x - base.x, p.y - base.y, p.z - base.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, p.side > 0 ? red : yel);
    });
    mesh.frustumCulled = false;
    this.add(mesh, base);
  }

  dispose() {
    this.ctx.game.rails.remove(this.rails.map(r => r.id));
    this.rails = [];
    for (const id of this.colliders) this.ctx.setCollider(id, null);
    this.colliders = [];
    this.root.removeFromParent();
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>(this.mats);
    this.root.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry !== undefined) geos.add(mesh.geometry);
      if (mesh.material !== undefined)
        for (const mm of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          mats.add(mm);
          const src = mm.userData.toonSrc as THREE.Material | undefined;
          if (src !== undefined) mats.add(src);
        }
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
    for (const t of this.textures) t.dispose();
    this.jobs = [];
    this.anchored = [];
  }
}
