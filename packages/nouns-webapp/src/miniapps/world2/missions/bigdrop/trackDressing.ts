// ── The Big Drop: the race track's dressing (a PeakSystem) ──────────────
//
// What makes the line read at 2,000 km/h:
//   - noggles arches over the line at every 'gate' (the canonical 16×6
//     noggles, pixel for pixel, in voxels: red #f3322c frame, white/black
//     lenses), on two red legs at the lane edges;
//   - "12 KM" boards at every 'marker';
//   - race poles with flags down both lane edges, tall red poles at every
//     kicker lip;
//   - edge lights: screen-space points (a fixed pixel size whatever the
//     distance, no fog), white down the lane, red across kicker lips,
//     orange round the loop pads, so the line shows kilometres ahead.
//
// Streamed by track distance: everything from 300 m behind the rider to
// 2.5–5 km ahead (by quality) is rebuilt in one go each time the rider has
// covered a quarter of that (every ~2 s at 600 m/s). Instance matrices and
// point positions are relative to an anchor on the line (≤ ~5 km away, so
// float32 holds them to the mm); the meshes are put back at the anchor's
// local position every frame, which also covers rebases.

import type { PeakCtx, PeakSystem, PeakSystemFactory } from './contract';

import * as THREE from 'three';

import { inkExcluded, toonify } from '../../render/Toon';
import { peakHeight } from '../peakTerrain';

import { setSnowViewer } from './surface';
import { coneHeight } from './terrainPeak';
import {
  featuresIn,
  kickerShape,
  lineAt,
  type LineSample,
  loopBase,
  nearestTrack,
  sectionScale,
  TRACK,
} from './track';

/** The canonical noggles (nouns-assets glasses-square-red.png, 16×6; see home/introScene.ts). */
const NOGGLES = [
  '...RRRRRR.RRRRRR',
  '...RWWBBR.RWWBBR',
  'RRRRWWBBRRRWWBBR',
  'R..RWWBBR.RWWBBR',
  'R..RWWBBR.RWWBBR',
  '...RRRRRR.RRRRRR',
];
const NOG_RED = 0xf3322c;

const AHEAD = { low: 2500, medium: 4000, high: 5000 } as const;
const BEHIND = 300;
const MAX_POLES = 700;
const MAX_LIGHTS = 2400;
const GATES = 4;
const SIGNS = 7;

const POLE_BLUE = new THREE.Color(0x2b6ce0);
const POLE_RED = new THREE.Color(NOG_RED);
const FLAG_YELLOW = new THREE.Color(0xffd23a);
const LIGHT_WHITE = new THREE.Color(0xfff4d8);
const LIGHT_RED = new THREE.Color(0xff3a2a);
const LIGHT_ORANGE = new THREE.Color(0xff9a1f);
const LIGHT_BLUE = new THREE.Color(0x6fb4ff);

/** One voxel box into flat arrays (non-indexed, with colours). */
function box(
  pos: number[],
  nor: number[],
  col: number[],
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  c: THREE.Color,
) {
  const faces: [number[], number[][]][] = [
    [
      [1, 0, 0],
      [
        [x1, y0, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x1, y0, z1],
      ],
    ],
    [
      [-1, 0, 0],
      [
        [x0, y0, z1],
        [x0, y1, z1],
        [x0, y1, z0],
        [x0, y0, z0],
      ],
    ],
    [
      [0, 1, 0],
      [
        [x0, y1, z0],
        [x0, y1, z1],
        [x1, y1, z1],
        [x1, y1, z0],
      ],
    ],
    [
      [0, -1, 0],
      [
        [x0, y0, z1],
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y0, z1],
      ],
    ],
    [
      [0, 0, 1],
      [
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
        [x0, y0, z1],
      ],
    ],
    [
      [0, 0, -1],
      [
        [x0, y0, z0],
        [x0, y1, z0],
        [x1, y1, z0],
        [x1, y0, z0],
      ],
    ],
  ];
  for (const [n, q] of faces)
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(q[i]![0]!, q[i]![1]!, q[i]![2]!);
      nor.push(n[0]!, n[1]!, n[2]!);
      col.push(c.r, c.g, c.b);
    }
}

/**
 * A noggles arch, 1 unit per pixel: 16 wide (x from +8 to −8, so the image
 * reads left to right for a rider looking down +z), 6 tall from y = 0, legs
 * down to y = −16 under the outer columns. Faces −z (uphill).
 */
function noggleGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const red = new THREE.Color(NOG_RED);
  const white = new THREE.Color(0xffffff);
  const black = new THREE.Color(0x101010);
  const d = 0.6;
  NOGGLES.forEach((row, r) => {
    const y1 = 6 - r;
    for (let c = 0; c < 16; c++) {
      const k = row[c];
      if (k === '.') continue;
      const x0 = 8 - (c + 1);
      box(
        pos,
        nor,
        col,
        x0,
        y1 - 1,
        -d / 2,
        x0 + 1,
        y1,
        d / 2,
        k === 'R' ? red : k === 'W' ? white : black,
      );
    }
  });
  // Legs under the temple (left) and the right edge
  box(pos, nor, col, 7, -16, -d / 2, 8, 1, d / 2, red);
  box(pos, nor, col, -8, -16, -d / 2, -7, 0, d / 2, red);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

interface Sign {
  group: THREE.Group;
  board: THREE.Mesh;
  tex: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  label: string;
  peak: THREE.Vector3;
}

interface Gate {
  mesh: THREE.Mesh;
  peak: THREE.Vector3;
}

class TrackDressing implements PeakSystem {
  private root = new THREE.Group();
  private anchor = new THREE.Vector3();
  private builtS = -Infinity;
  private poles: THREE.InstancedMesh;
  private flags: THREE.InstancedMesh;
  private lights: THREE.Points;
  private lightPos: Float32Array;
  private lightCol: Float32Array;
  private gateGeo: THREE.BufferGeometry;
  private gateMat: THREE.MeshStandardMaterial;
  private gates: Gate[] = [];
  private signs: Sign[] = [];
  private postGeo = new THREE.BoxGeometry(0.4, 1, 0.4).translate(0, 0.5, 0);
  private postMat = new THREE.MeshStandardMaterial({ color: 0x30343c, roughness: 0.6 });
  private boardGeo = new THREE.PlaneGeometry(1, 0.5).rotateY(Math.PI);
  private near = { s: 0, lateral: 0, dist: 0 };
  private ln: LineSample = { cx: 0, dcx: 0, w: 0, gully: 0, cruise: 0, feats: [] };
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(private ctx: PeakCtx) {
    this.root.name = 'BigDropTrackDressing';
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 1, 6).translate(0, 0.5, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    this.poles = new THREE.InstancedMesh(poleGeo, poleMat, MAX_POLES);
    this.poles.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_POLES * 3),
      3,
    );
    this.poles.count = 0;
    this.poles.frustumCulled = false;
    const flagGeo = new THREE.PlaneGeometry(1, 0.62).translate(0.5, -0.31, 0);
    const flagMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      roughness: 0.8,
      emissive: 0x222222,
    });
    this.flags = new THREE.InstancedMesh(flagGeo, flagMat, MAX_POLES);
    this.flags.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_POLES * 3),
      3,
    );
    this.flags.count = 0;
    this.flags.frustumCulled = false;
    this.lightPos = new Float32Array(MAX_LIGHTS * 3);
    this.lightCol = new Float32Array(MAX_LIGHTS * 3);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.lightPos, 3));
    lg.setAttribute('color', new THREE.BufferAttribute(this.lightCol, 3));
    lg.setDrawRange(0, 0);
    this.lights = new THREE.Points(
      lg,
      new THREE.PointsMaterial({
        size: ctx.quality === 'low' ? 4 : 6,
        sizeAttenuation: false,
        vertexColors: true,
        fog: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.95,
      }),
    );
    this.lights.frustumCulled = false;
    inkExcluded.add(this.lights);
    this.gateGeo = noggleGeometry();
    this.gateMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.55,
      emissive: 0x2a0806,
    });
    for (let i = 0; i < GATES; i++) {
      const mesh = new THREE.Mesh(this.gateGeo, this.gateMat);
      mesh.visible = false;
      mesh.castShadow = true;
      this.gates.push({ mesh, peak: new THREE.Vector3() });
      this.root.add(mesh);
    }
    for (let i = 0; i < SIGNS; i++) this.signs.push(this.makeSign());
    this.root.add(this.poles, this.flags, this.lights);
    if (ctx.toon) toonify(this.root);
    ctx.group.add(this.root);
  }

  private makeSign(): Sign {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const board = new THREE.Mesh(this.boardGeo, new THREE.MeshBasicMaterial({ map: tex }));
    const post = new THREE.Mesh(this.postGeo, this.postMat);
    const group = new THREE.Group();
    group.add(post, board);
    group.visible = false;
    this.root.add(group);
    return { group, board, tex, canvas, label: '', peak: new THREE.Vector3() };
  }

  private drawSign(sg: Sign, label: string) {
    if (sg.label === label) return;
    sg.label = label;
    const g = sg.canvas.getContext('2d');
    if (g === null) return;
    g.fillStyle = '#101216';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#f3322c';
    g.fillRect(0, 0, 256, 14);
    g.fillRect(0, 114, 256, 14);
    g.fillStyle = '#ffffff';
    g.font = 'bold 64px "Pip3", "Courier New", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, 128, 66);
    sg.tex.needsUpdate = true;
  }

  update(): void {
    const ctx = this.ctx;
    const cam = ctx.game.gfx.camera.position;
    ctx.toPeak(cam.x, cam.y, cam.z, this.v);
    setSnowViewer(this.v.x, this.v.z);
    const r = ctx.riderPeak;
    const s = nearestTrack(r.x, r.z, this.near).s;
    const ahead = AHEAD[ctx.quality];
    if (s > this.builtS + ahead * 0.25 || s < this.builtS - 50) this.rebuild(s, ahead);
    // Keep everything at its local place (the origin moves on a rebase)
    ctx.toLocal(this.anchor.x, this.anchor.y, this.anchor.z, this.v);
    this.poles.position.copy(this.v);
    this.flags.position.copy(this.v);
    this.lights.position.copy(this.v);
    for (const g of this.gates)
      if (g.mesh.visible) ctx.toLocal(g.peak.x, g.peak.y, g.peak.z, g.mesh.position);
    for (const sg of this.signs)
      if (sg.group.visible) ctx.toLocal(sg.peak.x, sg.peak.y, sg.peak.z, sg.group.position);
  }

  /** The point `off` m to the side (+ = +x) of the line at `s`, on the snow + `lift`. */
  private edge(s: number, off: number, lift: number, out: THREE.Vector3): THREE.Vector3 {
    const ln = this.ln;
    const l = Math.sqrt(1 + ln.dcx * ln.dcx);
    const x = ln.cx + off / l;
    const z = s - (off * ln.dcx) / l;
    return out.set(x, peakHeight(x, z) + lift, z);
  }

  private rebuild(s: number, ahead: number) {
    this.builtS = s;
    const s0 = Math.max(TRACK.start + 20, s - BEHIND);
    const s1 = Math.min(TRACK.end, s + ahead);
    lineAt(s, this.ln);
    this.anchor.set(this.ln.cx, coneHeight(this.ln.cx, s), s);
    const A = this.anchor;
    const ln = this.ln;
    const p = this.v;
    let nPole = 0;
    let nLight = 0;
    const low = this.ctx.quality === 'low';
    const pole = (
      x: number,
      y: number,
      z: number,
      h: number,
      yaw: number,
      pc: THREE.Color,
      fc: THREE.Color | null,
    ) => {
      if (nPole >= MAX_POLES) return;
      this.q.setFromAxisAngle(this.up, yaw);
      this.m.compose(this.v.set(x - A.x, y - A.y, z - A.z), this.q, this.sc.set(1, h, 1));
      this.poles.setMatrixAt(nPole, this.m);
      this.poles.setColorAt(nPole, pc);
      // The flag hangs off the top, facing uphill; a hidden one is scaled to 0
      const fs = fc === null ? 0 : Math.max(1.4, h * 0.45);
      this.m.compose(this.v.set(x - A.x, y - A.y + h, z - A.z), this.q, this.sc.set(fs, fs, fs));
      this.flags.setMatrixAt(nPole, this.m);
      this.flags.setColorAt(nPole, fc ?? pc);
      nPole++;
    };
    const light = (x: number, y: number, z: number, c: THREE.Color) => {
      if (nLight >= MAX_LIGHTS) return;
      const o = nLight * 3;
      this.lightPos[o] = x - A.x;
      this.lightPos[o + 1] = y - A.y;
      this.lightPos[o + 2] = z - A.z;
      this.lightCol[o] = c.r;
      this.lightCol[o + 1] = c.g;
      this.lightCol[o + 2] = c.b;
      nLight++;
    };
    // Poles + flags down both edges, lights between them
    let k = 0;
    for (let t = s0; t < s1; k++) {
      const sc = sectionScale(t);
      lineAt(t, ln);
      const half = ln.w / 2;
      const yaw = Math.atan2(ln.dcx, 1);
      for (const side of [-1, 1]) {
        this.edge(t, side * (half + 2), 0, p);
        const pc = side > 0 ? POLE_BLUE : POLE_RED;
        pole(p.x, p.y - 0.3, p.z, 3.2 * Math.sqrt(sc), yaw, pc, k % 2 === 0 ? pc : FLAG_YELLOW);
      }
      t += 40 * sc * (low ? 1.5 : 1);
    }
    for (let t = s0; t < s1; ) {
      const sc = sectionScale(t);
      lineAt(t, ln);
      const half = ln.w / 2;
      for (const side of [-1, 1]) {
        this.edge(t, side * (half + 0.5), 0.6, p);
        light(p.x, p.y, p.z, LIGHT_WHITE);
      }
      t += 14 * sc * (low ? 1.6 : 1);
    }
    // Features
    let gi = 0;
    let si = 0;
    for (const f of featuresIn(s0, s1)) {
      if (f.kind === 'kicker') {
        const kk = kickerShape(f)!;
        const z = f.s + kk.lip;
        lineAt(z, ln);
        const yaw = Math.atan2(ln.dcx, 1);
        const tall = 9 + kk.h * 0.6;
        for (const side of [-1, 1]) {
          this.edge(z, side * (kk.halfW + 2.5), 0, p);
          pole(p.x, p.y - 0.3, p.z, tall, yaw, POLE_RED, LIGHT_ORANGE);
        }
        // A red light line across the lip
        for (let o = -kk.halfW; o <= kk.halfW; o += low ? 3 : 1.5) {
          this.edge(z - 0.4, o, 0.4, p);
          light(p.x, p.y, p.z, LIGHT_RED);
        }
        // Blue run-in lights up the ramp's edges
        for (let u = 0; u < kk.lip; u += Math.max(4, kk.lip / 14)) {
          lineAt(f.s + u, ln);
          for (const side of [-1, 1]) {
            this.edge(f.s + u, side * (kk.halfW + 0.5), 0.5, p);
            light(p.x, p.y, p.z, LIGHT_BLUE);
          }
        }
      } else if (f.kind === 'loop') {
        const b = loopBase(f);
        for (let z = f.s - b.lead; z <= f.s + f.len + b.lead; z += 3) {
          lineAt(z, ln);
          for (const side of [-1, 1]) {
            this.edge(z, side * (b.half + 0.5), 0.5, p);
            light(p.x, p.y, p.z, LIGHT_ORANGE);
          }
        }
      } else if (f.kind === 'gate' && gi < GATES) {
        const g = this.gates[gi++]!;
        lineAt(f.s, ln);
        const half = ln.w / 2;
        const l = Math.sqrt(1 + ln.dcx * ln.dcx);
        const yL = this.edge(f.s, half, 0, p).y;
        const yR = this.edge(f.s, -half, 0, p).y;
        const px = ln.w / 14;
        g.peak.set(ln.cx, Math.max(yL, yR) + Math.max(7, px * 2.2), f.s);
        g.mesh.rotation.set(0, Math.atan2(ln.dcx / l, 1 / l), 0);
        g.mesh.scale.setScalar(px);
        g.mesh.visible = true;
      } else if (f.kind === 'marker' && si < SIGNS) {
        const sg = this.signs[si++]!;
        lineAt(f.s, ln);
        const sc = Math.sqrt(sectionScale(f.s));
        // On the rider's right (−x side when looking down +z)
        this.edge(f.s, -(ln.w / 2 + 6 * sc), 0, p);
        sg.peak.copy(p);
        this.drawSign(sg, `${f.size} KM`);
        const w = 9 * sc;
        sg.board.scale.set(w, w, 1);
        sg.board.position.set(0, 6 * sc + w * 0.25, 0);
        sg.group.children[0]!.scale.set(sc, 6 * sc + w * 0.25, sc);
        sg.group.rotation.set(0, Math.atan2(ln.dcx, 1), 0);
        sg.group.visible = true;
      }
    }
    for (; gi < GATES; gi++) this.gates[gi]!.mesh.visible = false;
    for (; si < SIGNS; si++) this.signs[si]!.group.visible = false;
    this.poles.count = nPole;
    this.flags.count = nPole;
    this.poles.instanceMatrix.needsUpdate = true;
    this.flags.instanceMatrix.needsUpdate = true;
    if (this.poles.instanceColor !== null) this.poles.instanceColor.needsUpdate = true;
    if (this.flags.instanceColor !== null) this.flags.instanceColor.needsUpdate = true;
    const lg = this.lights.geometry;
    (lg.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (lg.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    lg.setDrawRange(0, nLight);
  }

  dispose(): void {
    this.ctx.group.remove(this.root);
    inkExcluded.delete(this.lights);
    const mats = new Set<THREE.Material>();
    const geos = new Set<THREE.BufferGeometry>();
    this.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry !== undefined) geos.add(m.geometry);
      if (m.material !== undefined)
        for (const mm of Array.isArray(m.material) ? m.material : [m.material]) {
          mats.add(mm);
          const src = mm.userData.toonSrc as THREE.Material | undefined;
          if (src !== undefined) mats.add(src);
        }
    });
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
    for (const sg of this.signs) sg.tex.dispose();
    this.poles.dispose();
    this.flags.dispose();
  }
}

export const createTrackDressing: PeakSystemFactory = ctx => new TrackDressing(ctx);
