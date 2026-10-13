// ── Noun Jersey: the secret neighbourhood skatepark (chunk decorator) ───
//
// An homage to the opening suburban street level of a certain 2003 skate
// game: a main street with a strip of shops and a corner board shop, rows
// of houses with front yards, driveways and kerbs, a high school with a
// stair set, handrails and a basketball court, a drained backyard pool, an
// empty lot with makeshift plywood ramps, a little park with a mini ramp,
// parked cars, a fire hydrant, ledges, banks and quarter pipes. Original
// geometry and names only.
//
// Placement, terrace and speed governor: nounJersey.ts (park coords: a
// across from Main St's track-side edge, b downhill; y above the pad).
// Every prop is built in its own local frame (+Z = its front / the way you
// ride into it) and placed by a park-coords position + facing direction, so
// props are never mirrored (signs read right whichever side of the line the
// park lands on); only symmetric slabs and kerbs are laid out in park
// coords directly (Park.parkM).
//
// Cheap: all static geometry is merged by material into four meshes —
// solid (vertex colours), ground decals (polygon offset), signs (one canvas
// atlas) and thin rods (kept out of the ink normals pass) — plus one
// InstancedMesh for every tree: five draw calls. Built when the chunk that
// holds the middle of the neighbourhood gets its props, torn down with
// them: collision in the chunk's dynamic BVH, grind rails in the shared
// RailSet (added on load, removed on unload).

import type { ChunkContext, ChunkDecoration, ChunkDecorator } from './MountainStream';
import type { RailDef, RailSet } from '../../physics/Rails';

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { JERSEY_COURT } from '../../hoops/contract';
import { inkExcluded, toonify } from '../../render/Toon';

import { edgeDistance, hashInts } from './config';
import { NJ, njFrameNow, njToWorld, njYaw, type NjFrame } from './nounJersey';
import { terrainHeight } from './terrain';
import { SPOT_SITE } from './tracks';

// ── Palette ─────────────────────────────────────────────────────────────

const C = {
  asphalt: 0x4a4d55,
  asphaltLight: 0x5d6068,
  yard: 0x676a70,
  lineYellow: 0xf0c53a,
  lineWhite: 0xf2f2ee,
  sidewalk: 0xc2bdb3,
  concrete: 0xb3aea4,
  ledge: 0x9d9aa0,
  lawn: 0x5fae4e,
  grass: 0x58a848,
  dirt: 0x8d6a48,
  court: 0x3f7f5b,
  courtKey: 0xb85a3a,
  wood: 0xc49a62,
  woodDark: 0x8a6440,
  roof: 0x5b4a44,
  glass: 0x2b3f5c,
  door: 0x6b3b2a,
  trim: 0xf4f1ea,
  steel: 0xb9c0c8,
  darkSteel: 0x3b3f45,
  hydrant: 0xd22f22,
  barrier: 0xd8d4cc,
  pool: 0xb4dfea,
  poolTile: 0x2f5f9e,
  deck: 0xd9d2c3,
  patio: 0xb8b0a0,
  trunk: 0x6b4a2f,
  leaf: 0x3f8a3a,
  leaf2: 0x4f9e3e,
  noggleRed: 0xd22209,
} as const;

// ── Geometry kit (prop-local builders; +Z = front / ride-into direction) ─

type P2 = [number, number];

function box(w: number, h: number, d: number, x = 0, y = h / 2, z = 0) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

/** Box spanning [x0, x1] × [y0, y1] × [z0, z1]. */
function boxAt(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  return new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate(
    (x0 + x1) / 2,
    (y0 + y1) / 2,
    (z0 + z1) / 2,
  );
}

/** A (z, y) profile extruded across X (width w, centred). */
function prismX(profile: P2[], w: number) {
  const shape = new THREE.Shape();
  shape.moveTo(profile[0][0], profile[0][1]);
  for (let i = 1; i < profile.length; i++) shape.lineTo(profile[i][0], profile[i][1]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false, curveSegments: 1 });
  // Shape x → +Z, extrusion → −X; centre the width
  g.rotateY(-Math.PI / 2);
  g.translate(w / 2, 0, 0);
  return g;
}

/** An (x, y) profile extruded along Z (length len, centred). */
function prismZ(profile: P2[], len: number) {
  const shape = new THREE.Shape();
  shape.moveTo(profile[0][0], profile[0][1]);
  for (let i = 1; i < profile.length; i++) shape.lineTo(profile[i][0], profile[i][1]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -len / 2);
  return g;
}

/** Cylinder between two points. */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 8) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Quarter pipe profile (z, y): rides up toward +Z; returns the lip station. */
function qpProfile(radius: number, height: number, deck: number) {
  const amax = Math.acos(1 - height / radius);
  const uEnd = radius * Math.sin(amax);
  const pts: P2[] = [
    [0, 0],
    [uEnd + deck, 0],
    [uEnd + deck, height],
    [uEnd, height],
  ];
  const segs = 24;
  for (let i = segs - 1; i >= 1; i--) {
    const a = (i / segs) * amax;
    pts.push([radius * Math.sin(a), radius - radius * Math.cos(a)]);
  }
  return { pts, uEnd };
}

// ── Sign atlas (one canvas for every sign in the park) ──────────────────

interface SignSpec {
  key: string;
  /** Size in metres (sets the atlas slot aspect). */
  w: number;
  h: number;
  bg: string;
  fg: string;
  lines: { text: string; size: number; y: number; font?: string; color?: string }[];
  noggles?: boolean;
  border?: string;
  hand?: boolean;
}

const PX_PER_M = 44;
const ATLAS = 1024;

function signSpecs(arrow: string, turn: string): SignSpec[] {
  const block = '900 {px}px "Arial Black", Impact, "Helvetica Neue", Arial, sans-serif';
  return [
    {
      key: 'boardshop',
      w: 9,
      h: 1.9,
      bg: '#141414',
      fg: '#ffffff',
      noggles: true,
      border: '#d22209',
      lines: [{ text: 'BOARD SHOP', size: 0.52, y: 0.56, font: block }],
    },
    {
      key: 'pizza',
      w: 7,
      h: 0.9,
      bg: '#f7efe0',
      fg: '#c8321e',
      lines: [{ text: 'SLICE PIZZA', size: 0.7, y: 0.55, font: block }],
    },
    {
      key: 'laundry',
      w: 7,
      h: 0.9,
      bg: '#2c6fb0',
      fg: '#ffffff',
      lines: [{ text: 'SUDS LAUNDRY', size: 0.62, y: 0.55, font: block }],
    },
    {
      key: 'deli',
      w: 7,
      h: 0.9,
      bg: '#1f5a36',
      fg: '#f6e7b4',
      lines: [{ text: 'CORNER DELI', size: 0.66, y: 0.55, font: block }],
    },
    {
      key: 'arcade',
      w: 7,
      h: 0.9,
      bg: '#251a3d',
      fg: '#ff4fd8',
      lines: [{ text: 'GAME DEN', size: 0.7, y: 0.55, font: block }],
    },
    {
      key: 'school',
      w: 15,
      h: 1.5,
      bg: '#7a2d22',
      fg: '#f6e7b4',
      lines: [{ text: 'NOUN JERSEY HIGH', size: 0.66, y: 0.55, font: block }],
    },
    {
      key: 'noskate',
      w: 1.6,
      h: 1.1,
      bg: '#ffffff',
      fg: '#c8102e',
      border: '#c8102e',
      lines: [
        { text: 'NO', size: 0.34, y: 0.33, font: block },
        { text: 'SKATEBOARDING', size: 0.16, y: 0.7, font: block },
      ],
    },
    {
      key: 'welcome',
      w: 6,
      h: 2.6,
      bg: '#1d4f8f',
      fg: '#ffffff',
      border: '#f4f1ea',
      lines: [
        { text: 'WELCOME TO', size: 0.16, y: 0.24, font: block },
        { text: 'NOUN JERSEY', size: 0.3, y: 0.52, font: block },
        { text: 'skate & let skate', size: 0.13, y: 0.8, font: 'italic 700 {px}px Georgia, serif' },
      ],
    },
    {
      key: 'exit',
      w: 5,
      h: 2.6,
      bg: '#0f6b3a',
      fg: '#ffffff',
      border: '#ffffff',
      lines: [
        { text: `EXIT 19 ${arrow}`, size: 0.24, y: 0.28, font: block },
        { text: 'NOUN JERSEY', size: 0.26, y: 0.62, font: block },
        { text: `next ${turn}`, size: 0.13, y: 0.86, font: '700 {px}px Arial, sans-serif' },
      ],
    },
    {
      key: 'hand',
      w: 2.6,
      h: 1.2,
      bg: '#c8a46c',
      fg: '#1a1a1a',
      hand: true,
      lines: [
        {
          text: `NJ 19km ${arrow}`,
          size: 0.36,
          y: 0.42,
          font: 'italic 900 {px}px "Comic Sans MS", "Marker Felt", cursive',
        },
        {
          text: 'skaters only',
          size: 0.18,
          y: 0.78,
          font: 'italic 700 {px}px "Comic Sans MS", "Marker Felt", cursive',
          color: '#a01818',
        },
      ],
    },
    {
      key: 'tower',
      w: 12,
      h: 1.8,
      bg: '#9fc7d9',
      fg: '#1d3557',
      lines: [{ text: 'NOUN JERSEY', size: 0.78, y: 0.56, font: block }],
    },
    {
      key: 'park',
      w: 3.2,
      h: 0.9,
      bg: '#3e2a1a',
      fg: '#f4e2b0',
      lines: [{ text: 'MEMORIAL PARK', size: 0.42, y: 0.56, font: block }],
    },
  ];
}

interface Atlas {
  texture: THREE.CanvasTexture;
  slots: Map<string, { u0: number; v0: number; u1: number; v1: number; w: number; h: number }>;
}

const atlases = new Map<number, Atlas>();

function signAtlas(side: number): Atlas {
  const hit = atlases.get(side);
  if (hit !== undefined) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS;
  canvas.height = ATLAS;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#808080';
  g.fillRect(0, 0, ATLAS, ATLAS);
  const slots: Atlas['slots'] = new Map();
  let x = 0;
  let y = 0;
  let rowH = 0;
  const pad = 4;
  // Park coords +a is the frame's r · side, and r = (fz, −fx) points to the
  // LEFT of travel: side +1 puts the park on your left riding down the line
  const left = side > 0;
  for (const s of signSpecs(left ? '←' : '→', left ? 'left' : 'right')) {
    const pw = Math.min(ATLAS - 2 * pad, Math.round(s.w * PX_PER_M));
    const ph = Math.round(pw * (s.h / s.w));
    if (x + pw + pad > ATLAS) {
      x = 0;
      y += rowH + pad;
      rowH = 0;
    }
    drawSign(g, x + pad, y + pad, pw, ph, s);
    slots.set(s.key, {
      u0: (x + pad) / ATLAS,
      u1: (x + pad + pw) / ATLAS,
      v0: 1 - (y + pad + ph) / ATLAS,
      v1: 1 - (y + pad) / ATLAS,
      w: s.w,
      h: s.h,
    });
    x += pw + pad;
    rowH = Math.max(rowH, ph);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const atlas = { texture, slots };
  atlases.set(side, atlas);
  return atlas;
}

function drawSign(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  s: SignSpec,
) {
  g.save();
  g.translate(x, y);
  g.fillStyle = s.bg;
  g.fillRect(0, 0, w, h);
  if (s.hand === true) {
    // Plywood grain + a wonky painted edge
    g.strokeStyle = 'rgba(90,60,30,0.35)';
    g.lineWidth = 2;
    for (let i = 1; i < 7; i++) {
      g.beginPath();
      g.moveTo(0, (h * i) / 7);
      g.bezierCurveTo(w * 0.3, (h * i) / 7 + 4, w * 0.7, (h * i) / 7 - 4, w, (h * i) / 7 + 2);
      g.stroke();
    }
  }
  if (s.border !== undefined) {
    g.strokeStyle = s.border;
    g.lineWidth = Math.max(3, h * 0.06);
    g.strokeRect(g.lineWidth, g.lineWidth, w - 2 * g.lineWidth, h - 2 * g.lineWidth);
  }
  let textX = w / 2;
  if (s.noggles === true) {
    // Pixel noggles (⌐◨-◨) on the left
    const px = h / 9;
    const ox = h * 0.35;
    const oy = (h - 6 * px) / 2;
    const red = '#d22209';
    const cell = (cx: number, cy: number, cw: number, ch: number, c: string) => {
      g.fillStyle = c;
      g.fillRect(ox + cx * px, oy + cy * px, cw * px, ch * px);
    };
    cell(-2, 2, 3, 1, red);
    cell(-2, 2, 1, 2, red);
    for (const fx of [1, 8]) {
      cell(fx, 0, 6, 6, red);
      cell(fx + 1, 1, 2, 4, '#ffffff');
      cell(fx + 3, 1, 2, 4, '#000000');
    }
    cell(7, 2, 1, 1, red);
    textX = ox + 15 * px + (w - (ox + 15 * px)) / 2;
  }
  for (const l of s.lines) {
    const px = Math.round(h * l.size);
    g.font = (l.font ?? 'bold {px}px sans-serif').replace('{px}', String(px));
    g.fillStyle = l.color ?? s.fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const maxW = (s.noggles === true ? w - textX + (w - textX) : w) * 0.9;
    if (s.hand === true) {
      g.save();
      g.translate(textX, h * l.y);
      g.rotate(-0.04);
      g.fillText(l.text, 0, 0, maxW);
      g.restore();
    } else g.fillText(l.text, textX, h * l.y, maxW);
  }
  g.restore();
}

// ── Materials (shared for the session; geometry is per build) ───────────

let mats: {
  solid: THREE.MeshStandardMaterial;
  ground: THREE.MeshStandardMaterial;
  thin: THREE.MeshStandardMaterial;
} | null = null;

function materials() {
  if (mats === null) {
    const solid = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86 });
    solid.name = 'NounJerseySolid';
    const ground = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    ground.name = 'NounJerseyGround';
    const thin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 });
    thin.name = 'NounJerseyThin';
    mats = { solid, ground, thin };
  }
  return mats;
}

const signMats = new Map<number, THREE.MeshStandardMaterial>();

function signMaterial(side: number) {
  let m = signMats.get(side);
  if (m === undefined) {
    m = new THREE.MeshStandardMaterial({ map: signAtlas(side).texture, roughness: 0.8 });
    m.name = 'NounJerseySigns';
    signMats.set(side, m);
  }
  return m;
}

// ── Park builder ────────────────────────────────────────────────────────

type Bucket = 'solid' | 'ground' | 'thin' | 'hoop';

const _col = new THREE.Color();
const _p = { x: 0, z: 0 };

class Park {
  readonly geo: Record<Bucket, THREE.BufferGeometry[]> = {
    solid: [],
    ground: [],
    thin: [],
    hoop: [],
  };
  readonly signs: THREE.BufferGeometry[] = [];
  readonly col: THREE.BufferGeometry[] = [];
  readonly rails: RailDef[] = [];
  readonly trees: THREE.Matrix4[] = [];
  private railN = 0;
  readonly atlas: Atlas;

  constructor(
    readonly f: NjFrame,
    readonly origin: THREE.Vector3,
  ) {
    this.atlas = signAtlas(f.side);
  }

  /** Prop-local → chunk-local: at park (a, b), y above the pad, local +Z facing (da, db). */
  at(a: number, b: number, y = 0, da = 0, db = 1): THREE.Matrix4 {
    const w = njToWorld(this.f, a, b, _p);
    const yaw = njYaw(this.f, da, db);
    return new THREE.Matrix4().compose(
      v3(w.x - this.origin.x, this.f.P + y, w.z - this.origin.z),
      new THREE.Quaternion().setFromAxisAngle(v3(0, 1, 0), yaw),
      v3(1, 1, 1),
    );
  }

  /** Like `at`, but standing on the real terrain (props out on the slope). */
  onGround(a: number, b: number, da = 0, db = 1): THREE.Matrix4 {
    const w = njToWorld(this.f, a, b, _p);
    return this.at(a, b, terrainHeight(w.x, w.z) - this.f.P, da, db);
  }

  /**
   * Park coords directly: local (x, y, z) = (a, y, b). Mirrored when the
   * park lies left of the line — only for symmetric things (slabs, kerbs).
   */
  get parkM(): THREE.Matrix4 {
    return this.at(0, 0, 0, 0, 1).multiply(new THREE.Matrix4().makeScale(this.f.side, 1, 1));
  }

  /** Add a geometry (consumed) in colour `color` under matrix m. */
  add(
    g: THREE.BufferGeometry,
    color: number,
    m: THREE.Matrix4,
    opts: { collide?: boolean; bucket?: Bucket } = {},
  ) {
    const geo = g.index !== null ? g.toNonIndexed() : g;
    if (geo !== g) g.dispose();
    geo.applyMatrix4(m);
    if (m.determinant() < 0) flipWinding(geo);
    for (const k of Object.keys(geo.attributes))
      if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
    if (geo.attributes.normal === undefined) geo.computeVertexNormals();
    _col.setHex(color);
    const n = geo.attributes.position.count;
    const ca = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      ca[i * 3] = _col.r;
      ca[i * 3 + 1] = _col.g;
      ca[i * 3 + 2] = _col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(ca, 3));
    geo.clearGroups();
    this.geo[opts.bucket ?? 'solid'].push(geo);
    if (opts.collide === true) {
      const c = new THREE.BufferGeometry();
      c.setAttribute('position', geo.attributes.position.clone());
      this.col.push(c);
    }
    return geo;
  }

  /** Grind rail from prop-local points under m (stored in world space). */
  rail(type: RailDef['type'], pts: [number, number, number][], m: THREE.Matrix4) {
    const v = new THREE.Vector3();
    this.rails.push({
      id: `nj:${this.railN++}`,
      type,
      points: pts.map(p => {
        v.set(p[0], p[1], p[2]).applyMatrix4(m).add(this.origin);
        return [v.x, v.y, v.z] as [number, number, number];
      }),
    });
  }

  /** Sign face (plane facing local +Z, centred at x, y, z) from the atlas. */
  sign(key: string, m: THREE.Matrix4, x: number, y: number, z: number, scale = 1) {
    const s = this.atlas.slots.get(key)!;
    const g = new THREE.PlaneGeometry(s.w * scale, s.h * scale);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++)
      uv.setXY(i, uv.getX(i) < 0.5 ? s.u0 : s.u1, uv.getY(i) < 0.5 ? s.v0 : s.v1);
    g.translate(x, y, z);
    g.applyMatrix4(m);
    this.signs.push(g.toNonIndexed());
    g.dispose();
  }

  /** Flat decal rectangle on the pad (park coords). */
  decal(a0: number, a1: number, b0: number, b1: number, color: number, y = 0.012) {
    const g = new THREE.PlaneGeometry(a1 - a0, b1 - b0).rotateX(-Math.PI / 2);
    this.add(g, color, this.at((a0 + a1) / 2, (b0 + b1) / 2, y), { bucket: 'ground' });
  }

  /** Terrain-following decal strip along a park-coords polyline (on / off ramps). */
  strip(path: P2[], width: number, color: number) {
    const pos: number[] = [];
    const steps: P2[] = [];
    for (let i = 0; i < path.length - 1; i++) {
      const [a0, b0] = path[i];
      const [a1, b1] = path[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(a1 - a0, b1 - b0) / 2));
      for (let k = 0; k < n; k++) steps.push([a0 + ((a1 - a0) * k) / n, b0 + ((b1 - b0) * k) / n]);
    }
    steps.push(path[path.length - 1]);
    const edge = (i: number, s: number) => {
      const p = steps[Math.min(i, steps.length - 1)];
      const q = steps[Math.min(i + 1, steps.length - 1)];
      const r = steps[Math.max(0, i - 1)];
      const da = q[0] - r[0];
      const db = q[1] - r[1];
      const l = Math.hypot(da, db) || 1;
      const a = p[0] + (db / l) * s * (width / 2);
      const b = p[1] - (da / l) * s * (width / 2);
      const w = njToWorld(this.f, a, b, { x: 0, z: 0 });
      return v3(w.x - this.origin.x, terrainHeight(w.x, w.z) + 0.05, w.z - this.origin.z);
    };
    for (let i = 0; i < steps.length - 1; i++) {
      const a = edge(i, -1);
      const b = edge(i, 1);
      const c = edge(i + 1, -1);
      const d = edge(i + 1, 1);
      pos.push(
        a.x,
        a.y,
        a.z,
        c.x,
        c.y,
        c.z,
        b.x,
        b.y,
        b.z,
        b.x,
        b.y,
        b.z,
        c.x,
        c.y,
        c.z,
        d.x,
        d.y,
        d.z,
      );
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    // Faces up whichever way the strip turned out wound
    const ny = g.attributes.normal.getY(0);
    if (ny < 0) {
      const a = g.attributes.position.array as Float32Array;
      for (let i = 0; i < a.length; i += 9)
        for (let k = 0; k < 3; k++) {
          const t = a[i + 3 + k];
          a[i + 3 + k] = a[i + 6 + k];
          a[i + 6 + k] = t;
        }
      g.computeVertexNormals();
    }
    this.add(g, color, new THREE.Matrix4(), { bucket: 'ground' });
  }
}

/** Reverse every triangle (non-indexed) after a mirroring transform. */
function flipWinding(g: THREE.BufferGeometry) {
  for (const k of ['position', 'normal']) {
    const at = g.attributes[k] as THREE.BufferAttribute | undefined;
    if (at === undefined) continue;
    const a = at.array as Float32Array;
    const n = at.itemSize;
    for (let i = 0; i < a.length; i += 3 * n)
      for (let c = 0; c < n; c++) {
        const t = a[i + n + c];
        a[i + n + c] = a[i + 2 * n + c];
        a[i + 2 * n + c] = t;
      }
  }
}

// ── Props ───────────────────────────────────────────────────────────────

/** Box ledge (length along local Z) with both top edges grindable. */
function ledge(
  p: Park,
  m: THREE.Matrix4,
  w: number,
  h: number,
  len: number,
  color: number = C.ledge,
  y0 = 0,
) {
  p.add(box(w, h, len, 0, y0 + h / 2), color, m, { collide: true });
  for (const s of [-1, 1])
    p.rail(
      'ledge',
      [
        [s * (w / 2 - 0.03), y0 + h, -len / 2 + 0.05],
        [s * (w / 2 - 0.03), y0 + h, len / 2 - 0.05],
      ],
      m,
    );
}

/** Quarter pipe rising toward local +Z from z = 0, width along X, with coping. */
function quarterPipe(
  p: Park,
  m: THREE.Matrix4,
  width: number,
  radius: number,
  height: number,
  deck: number,
  color: number = C.concrete,
) {
  const { pts, uEnd } = qpProfile(radius, height, deck);
  p.add(prismX(pts, width), color, m, { collide: true });
  p.add(
    rod(v3(-width / 2, height, uEnd + 0.03), v3(width / 2, height, uEnd + 0.03), 0.055, 10),
    C.steel,
    m,
  );
  p.rail(
    'coping',
    [
      [-width / 2 + 0.2, height + 0.03, uEnd + 0.03],
      [width / 2 - 0.2, height + 0.03, uEnd + 0.03],
    ],
    m,
  );
  return uEnd + deck;
}

/** Wedge bank rising toward +Z over `len`, then a flat top of `flat`. */
function bank(
  p: Park,
  m: THREE.Matrix4,
  width: number,
  len: number,
  height: number,
  flat = 0,
  color: number = C.concrete,
) {
  p.add(
    prismX(
      [
        [0, 0],
        [len + flat, 0],
        [len + flat, height],
        [len, height],
      ],
      width,
    ),
    color,
    m,
    { collide: true },
  );
}

/** Curved kicker rising toward +Z. */
function kicker(
  p: Park,
  m: THREE.Matrix4,
  width: number,
  len: number,
  height: number,
  color: number = C.wood,
) {
  const pts: P2[] = [
    [len, 0],
    [len, height],
  ];
  for (let i = 9; i >= 0; i--) {
    const t = i / 10;
    pts.push([len * t, height * t * t]);
  }
  p.add(prismX(pts, width), color, m, { collide: true });
}

/** Handrail (thin bucket) between local points, with posts. */
function handrail(
  p: Park,
  m: THREE.Matrix4,
  a: THREE.Vector3,
  b: THREE.Vector3,
  ground: (z: number) => number,
) {
  p.add(rod(a, b, 0.032, 10), 0xc23a2b, m, { bucket: 'thin' });
  const posts = Math.max(2, Math.round(a.distanceTo(b) / 2.2) + 1);
  for (let i = 0; i < posts; i++) {
    const q = new THREE.Vector3().lerpVectors(a, b, i / (posts - 1));
    p.add(rod(v3(q.x, ground(q.z), q.z), q, 0.028, 8), C.darkSteel, m, { bucket: 'thin' });
  }
  p.rail(
    'rail',
    [
      [a.x, a.y + 0.03, a.z],
      [b.x, b.y + 0.03, b.z],
    ],
    m,
  );
}

function hydrant(p: Park, m: THREE.Matrix4) {
  p.add(new THREE.CylinderGeometry(0.17, 0.2, 0.62, 10).translate(0, 0.31, 0), C.hydrant, m);
  p.add(
    new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.62, 0),
    C.hydrant,
    m,
  );
  p.add(rod(v3(-0.3, 0.42, 0), v3(0.3, 0.42, 0), 0.07, 8), C.hydrant, m);
  p.col.push(posOnly(box(0.36, 0.75, 0.36), m));
}

function posOnly(g: THREE.BufferGeometry, m: THREE.Matrix4) {
  const n = g.index !== null ? g.toNonIndexed() : g;
  n.applyMatrix4(m);
  const c = new THREE.BufferGeometry();
  c.setAttribute('position', n.attributes.position.clone());
  if (n !== g) n.dispose();
  g.dispose();
  return c;
}

function lamp(p: Park, m: THREE.Matrix4) {
  p.add(new THREE.CylinderGeometry(0.07, 0.11, 6, 8).translate(0, 3, 0), C.darkSteel, m);
  p.add(rod(v3(0, 5.8, 0), v3(0, 6.1, 1.4), 0.045, 6), C.darkSteel, m, { bucket: 'thin' });
  p.add(box(0.35, 0.16, 0.7, 0, 6.02, 1.55), 0xf4ead0, m);
  p.col.push(posOnly(box(0.24, 5.5, 0.24), m));
}

function car(p: Park, m: THREE.Matrix4, color: number, wreck = false) {
  // Length along local Z (4.4 m), nose toward +Z
  const body = wreck ? 0x7b5a44 : color;
  p.add(box(1.8, 0.72, 4.4, 0, 0.36 + 0.3), body, m, { collide: true });
  p.add(boxAt(-0.78, 0.78, 1.02, 1.62, -1.3, 0.9), wreck ? 0x3a2c24 : C.glass, m, {
    collide: true,
  });
  p.add(boxAt(-0.8, 0.8, 1.6, 1.68, -1.3, 0.9), body, m);
  p.add(boxAt(-0.86, 0.86, 0.5, 0.72, 2.18, 2.22), C.steel, m);
  p.add(boxAt(-0.86, 0.86, 0.5, 0.72, -2.22, -2.18), C.steel, m);
  for (const x of [-0.82, 0.82])
    for (const z of [-1.4, 1.4])
      p.add(
        new THREE.CylinderGeometry(0.33, 0.33, 0.24, 12).rotateZ(Math.PI / 2).translate(x, 0.33, z),
        0x1b1b1b,
        m,
      );
}

function treeAt(p: Park, a: number, b: number, salt: number) {
  const s = 0.85 + hashInts(a | 0, b | 0, salt) * 0.4;
  const yaw = hashInts(b | 0, a | 0, salt + 1) * Math.PI * 2;
  const m = p.at(a, b, 0, Math.sin(yaw), Math.cos(yaw));
  p.trees.push(m.clone().multiply(new THREE.Matrix4().makeScale(s, s, s)));
  p.col.push(posOnly(box(0.4 * s, 3 * s, 0.4 * s), m));
}

/** Tree geometry (one InstancedMesh for all of them): trunk + two canopy blobs. */
function treeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const paint = (g: THREE.BufferGeometry, color: number) => {
    const n = g.index !== null ? g.toNonIndexed() : g;
    n.deleteAttribute('uv');
    _col.setHex(color);
    const ca = new Float32Array(n.attributes.position.count * 3);
    for (let i = 0; i < ca.length; i += 3) {
      ca[i] = _col.r;
      ca[i + 1] = _col.g;
      ca[i + 2] = _col.b;
    }
    n.setAttribute('color', new THREE.BufferAttribute(ca, 3));
    parts.push(n);
  };
  paint(new THREE.CylinderGeometry(0.14, 0.22, 3.2, 7).translate(0, 1.6, 0), C.trunk);
  paint(new THREE.IcosahedronGeometry(2.1, 1).translate(0, 4.2, 0), C.leaf);
  paint(new THREE.IcosahedronGeometry(1.4, 1).translate(0.7, 5.5, 0.3), C.leaf2);
  const g = mergeGeometries(parts, false)!;
  for (const q of parts) q.dispose();
  return g;
}

// ── The drained backyard pool (raised patio + bowl, one lofted mesh) ────
//
// The terrace floor is the analytic terrain, so a bowl can't be dug into
// it: the pool sits in a raised patio instead (a backyard on a slope,
// retained by a wall), banks up to the deck from both long sides. The
// whole thing is rings of the same rounded-rectangle outline offset in or
// out: patio wall, deck, a circular transition (80° at the coping, so the
// lip launches vert airs) and a flat floor. Rendered surfaces double as
// their own collision; the coping is one closed grind loop.

const POOL = {
  /** Half extents (x across, z along), corner radius, patio margin. */
  ex: 3.7,
  ez: 6.2,
  rc: 3.5,
  margin: 2.2,
  /** Deck height, floor height, top-of-transition angle. */
  deck: 2.0,
  floor: 0.03,
  alpha: (80 * Math.PI) / 180,
} as const;

function pool(p: Park, m: THREE.Matrix4) {
  const P = POOL;
  const H = P.deck - P.floor;
  const R = H / (1 - Math.cos(P.alpha));
  const S = R * Math.sin(P.alpha);
  const K = 9;
  // Outline: four corner arcs (centre + unit normal per point)
  const cs: { cx: number; cz: number; nx: number; nz: number }[] = [];
  const corners: [number, number, number][] = [
    [P.ex - P.rc, P.ez - P.rc, 0],
    [-(P.ex - P.rc), P.ez - P.rc, 0.5],
    [-(P.ex - P.rc), -(P.ez - P.rc), 1],
    [P.ex - P.rc, -(P.ez - P.rc), 1.5],
  ];
  for (const [cx, cz, a0] of corners)
    for (let k = 0; k <= K; k++) {
      const t = (a0 + (k / K) * 0.5) * Math.PI;
      cs.push({ cx, cz, nx: Math.cos(t), nz: Math.sin(t) });
    }
  const ring = (off: number, y: number) =>
    cs.map(c => v3(c.cx + c.nx * (P.rc + off), y, c.cz + c.nz * (P.rc + off)));
  /** Triangles of the band between two rings, wound to face `hint(i)`. */
  const band = (
    r0: THREE.Vector3[],
    r1: THREE.Vector3[],
    hint: (i: number) => THREE.Vector3,
    pos: number[] = [],
  ) => {
    const n = r0.length;
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = r0[i];
      const b = r0[j];
      const c = r1[j];
      const d = r1[i];
      e1.subVectors(b, a);
      e2.subVectors(d, a);
      const flip = e1.cross(e2).dot(hint(i)) < 0;
      if (!flip)
        pos.push(
          a.x,
          a.y,
          a.z,
          b.x,
          b.y,
          b.z,
          d.x,
          d.y,
          d.z,
          b.x,
          b.y,
          b.z,
          c.x,
          c.y,
          c.z,
          d.x,
          d.y,
          d.z,
        );
      else
        pos.push(
          a.x,
          a.y,
          a.z,
          d.x,
          d.y,
          d.z,
          b.x,
          b.y,
          b.z,
          b.x,
          b.y,
          b.z,
          d.x,
          d.y,
          d.z,
          c.x,
          c.y,
          c.z,
        );
    }
    return pos;
  };
  const emit = (pos: number[], color: number) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    // Smooth normals within one surface (shared positions), flat across surfaces
    p.add(smoothNormals(g), color, m, { collide: true });
  };
  const up = () => v3(0, 1, 0);
  const out = (i: number) => v3(cs[i].nx, 0, cs[i].nz);
  const inUp = (i: number) => v3(-cs[i].nx, 0.6, -cs[i].nz);
  // Patio wall + deck
  emit(band(ring(P.margin, -0.1), ring(P.margin, P.deck), out), C.patio);
  emit(band(ring(P.margin, P.deck), ring(0, P.deck), up), C.deck);
  // Transition: a tile band under the coping, then pool blue down to the floor
  const trans: THREE.Vector3[][] = [];
  const steps = 12;
  for (let k = 0; k <= steps; k++) {
    const phi = P.alpha * (1 - k / steps);
    const s = S - R * Math.sin(phi);
    trans.push(ring(-s, P.floor + R * (1 - Math.cos(phi))));
  }
  emit(band(trans[0], trans[1], inUp), C.poolTile);
  const walls: number[] = [];
  for (let k = 1; k < steps; k++) band(trans[k], trans[k + 1], inUp, walls);
  emit(walls, C.pool);
  // Floor: fan from the centre
  {
    const last = trans[steps];
    const pos: number[] = [];
    const c = v3(0, P.floor, 0);
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    for (let i = 0; i < last.length; i++) {
      const a = last[i];
      const b = last[(i + 1) % last.length];
      e1.subVectors(a, c);
      e2.subVectors(b, c);
      if (e1.cross(e2).y >= 0) pos.push(c.x, c.y, c.z, a.x, a.y, a.z, b.x, b.y, b.z);
      else pos.push(c.x, c.y, c.z, b.x, b.y, b.z, a.x, a.y, a.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    p.add(g, C.pool, m, { collide: true });
    p.add(
      new THREE.CylinderGeometry(0.22, 0.22, 0.02, 12).translate(0, P.floor + 0.012, 0),
      0x2a2f36,
      m,
    );
  }
  // Coping: a closed tube along the lip, grindable all the way round
  const curve = new THREE.CatmullRomCurve3(ring(0.02, P.deck + 0.01), true, 'centripetal');
  p.add(new THREE.TubeGeometry(curve, 96, 0.075, 6, true), C.trim, m);
  const rp = ring(0.04, P.deck + 0.04).map(v => [v.x, v.y, v.z] as [number, number, number]);
  rp.push(rp[0]);
  p.rail('coping', rp, m);
  return { patioX: P.ex + P.margin, patioZ: P.ez + P.margin, straightZ: P.ez - P.rc };
}

/** Index by position so computeVertexNormals smooths across shared vertices. */
function smoothNormals(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const a = g.attributes.position.array as Float32Array;
  const map = new Map<string, number>();
  const verts: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < a.length; i += 3) {
    const key = `${Math.round(a[i] * 1000)},${Math.round(a[i + 1] * 1000)},${Math.round(a[i + 2] * 1000)}`;
    let k = map.get(key);
    if (k === undefined) {
      k = verts.length / 3;
      map.set(key, k);
      verts.push(a[i], a[i + 1], a[i + 2]);
    }
    index.push(k);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  out.setIndex(index);
  out.computeVertexNormals();
  g.dispose();
  return out;
}

// ── Buildings ───────────────────────────────────────────────────────────

/** Single-storey shop: front at local +Z (depth d behind it), width w along X. */
function shop(
  p: Park,
  m: THREE.Matrix4,
  w: number,
  d: number,
  h: number,
  color: number,
  sign: string,
  awning: number,
) {
  p.add(box(w, h, d, 0, h / 2, -d / 2), color, m, { collide: true });
  p.add(boxAt(-w / 2, w / 2, h, h + 0.6, -0.4, 0.05), C.trim, m, { collide: true });
  // Storefront glass + door
  p.add(boxAt(-w / 2 + 0.8, w / 2 - 3.2, 0.5, 2.7, -0.05, 0.06), C.glass, m);
  p.add(boxAt(w / 2 - 2.6, w / 2 - 1.2, 0, 2.5, -0.05, 0.07), C.door, m);
  // Awning (sloped prism)
  p.add(
    prismX(
      [
        [0.05, 3.4],
        [1.5, 2.9],
        [1.5, 2.75],
        [0.05, 2.75],
      ],
      w - 0.6,
    ),
    awning,
    m,
  );
  p.sign(sign, m, 0, 4.0, 0.09);
  // Rooftop unit (roofs are climbable)
  p.add(box(2.2, 1.1, 1.6, w * 0.2, h + 0.55, -d * 0.55), C.steel, m, { collide: true });
}

/** Two-storey house: front (+Z) faces the street; gable roof, porch, windows. */
function house(p: Park, m: THREE.Matrix4, color: number) {
  const w = 11;
  const d = 12;
  const h = 5.6;
  p.add(box(w, h, d, 0, h / 2, -d / 2), color, m, { collide: true });
  const roofH = 2.8;
  p.add(
    prismX(
      [
        [0.5, 0],
        [-d - 0.5, 0],
        [-d / 2, roofH],
      ],
      w + 0.8,
    ).translate(0, h, 0),
    C.roof,
    m,
    { collide: true },
  );
  p.add(box(0.9, 2.2, 0.9, w * 0.25, h + 1.6, -d * 0.7), 0x8a4a3a, m, { collide: true });
  // Windows: two up, two down, one over the door
  for (const x of [-3.2, 3.2]) {
    p.add(boxAt(x - 0.8, x + 0.8, 1.0, 2.4, -0.05, 0.07), C.glass, m);
    p.add(boxAt(x - 0.8, x + 0.8, 3.4, 4.7, -0.05, 0.07), C.glass, m);
    p.add(boxAt(x - 0.95, x + 0.95, 0.9, 1.0, -0.05, 0.12), C.trim, m);
  }
  p.add(boxAt(-0.6, 0.6, 3.4, 4.7, -0.05, 0.07), C.glass, m);
  p.add(boxAt(-0.65, 0.65, 0.6, 2.7, -0.05, 0.08), C.door, m);
  // Porch: two steps (grindable front edges)
  p.add(boxAt(-1.6, 1.6, 0, 0.3, 0, 1.6), C.concrete, m, { collide: true });
  p.add(boxAt(-1.6, 1.6, 0, 0.6, 0, 0.8), C.concrete, m, { collide: true });
  p.rail(
    'ledge',
    [
      [-1.55, 0.3, 1.57],
      [1.55, 0.3, 1.57],
    ],
    m,
  );
  p.rail(
    'ledge',
    [
      [-1.55, 0.6, 0.77],
      [1.55, 0.6, 0.77],
    ],
    m,
  );
}

/** Wooden fence from (a0, b0) to (a1, b1) (park coords). */
function fence(p: Park, a0: number, a1: number, b0: number, b1: number) {
  const len = Math.hypot(a1 - a0, b1 - b0);
  const m = p.at((a0 + a1) / 2, (b0 + b1) / 2, 0, a1 - a0, b1 - b0);
  p.add(boxAt(-0.06, 0.06, 0, 1.3, -len / 2, len / 2), 0xe9e1cf, m, { collide: true });
  p.add(boxAt(-0.1, 0.1, 1.15, 1.25, -len / 2, len / 2), 0xd4cab4, m);
}

// ── Basketball court (Noun Hoops: hoops/contract.ts → JERSEY_COURT) ─────
//
// Markings and hoops to the contract's numbers: rims 1.15 m inside each
// baseline at park (59, 7.15) / (59, 28.85), 3.05 m up, the backboard face
// 0.8 m inside, each pole set back HOOP_POLE_BACK behind its baseline.
// The backboard, rim and net ("hoop tops") are their own little mesh,
// listed in njHoopTops, so Noun Hoops (hoops/view) can hide them and draw
// its live, wobbling versions in exactly the same place.

/** Pole: metres behind the baseline (outside the court). */
export const HOOP_POLE_BACK = 1.4;

/** Live hoop-top meshes of the built park (hoops/view hides them while it plays). */
export const njHoopTops = new Set<THREE.Object3D>();

/** Flat strip along a park-coords polyline (court markings), facing up. */
function lineStrip(p: Park, pts: P2[], t: number, color: number, y: number) {
  const pos: number[] = [];
  const n = pts.length;
  const off = (i: number): [P2, P2] => {
    const q0 = pts[Math.max(0, i - 1)];
    const q1 = pts[Math.min(n - 1, i + 1)];
    const da = q1[0] - q0[0];
    const db = q1[1] - q0[1];
    const l = Math.hypot(da, db) || 1;
    const na = (-db / l) * (t / 2);
    const nb = (da / l) * (t / 2);
    return [
      [pts[i][0] + na, pts[i][1] + nb],
      [pts[i][0] - na, pts[i][1] - nb],
    ];
  };
  for (let i = 0; i < n - 1; i++) {
    const [a, b] = off(i);
    const [c, d] = off(i + 1);
    for (const tri of [
      [a, c, b],
      [b, c, d],
    ]) {
      // Wind every triangle to face +y (park a, b → local x, z)
      const [u, v, w] = tri;
      const cy = (w[0] - u[0]) * (v[1] - u[1]) - (v[0] - u[0]) * (w[1] - u[1]);
      const o = cy >= 0 ? [u, v, w] : [u, w, v];
      for (const q of o) pos.push(q[0], y, q[1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nrm = new Float32Array(pos.length);
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  p.add(g, color, p.parkM, { bucket: 'ground' });
}

function arcPts(ca: number, cb: number, r: number, th0: number, th1: number, seg = 0): P2[] {
  const n = seg > 0 ? seg : Math.max(6, Math.ceil((Math.abs(th1 - th0) * r) / 0.25));
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const th = th0 + ((th1 - th0) * i) / n;
    out.push([ca + Math.cos(th) * r, cb + Math.sin(th) * r]);
  }
  return out;
}

/** Filled disc / annulus sector on the court (park coords). */
function discDecal(
  p: Park,
  ca: number,
  cb: number,
  r0: number,
  r1: number,
  color: number,
  y: number,
) {
  const g = new THREE.RingGeometry(Math.max(0.001, r0), r1, 40).rotateX(-Math.PI / 2);
  p.add(g, color, p.at(ca, cb, y), { bucket: 'ground' });
}

function courtLines(p: Park, a0: number, a1: number, b0: number, b1: number) {
  const K = JERSEY_COURT;
  const y = 0.034;
  const t = 0.1;
  const L = C.lineWhite;
  const am = (a0 + a1) / 2;
  const bm = (b0 + b1) / 2;
  // Boundary, half-court line
  p.decal(a0, a1, b0, b0 + t, L, y);
  p.decal(a0, a1, b1 - t, b1, L, y);
  p.decal(a0, a0 + t, b0, b1, L, y);
  p.decal(a1 - t, a1, b0, b1, L, y);
  p.decal(a0, a1, bm - t / 2, bm + t / 2, L, y);
  // Centre circle (painted) + tip-off ring + pixel noggles ⌐◨-◨
  discDecal(p, am, bm, 0, 1.8 - t / 2, C.courtKey, 0.028);
  lineStrip(p, arcPts(am, bm, 1.8, 0, Math.PI * 2, 64), t, L, y);
  lineStrip(p, arcPts(am, bm, 0.6, 0, Math.PI * 2, 32), t, L, y);
  {
    const px = 0.13;
    const cell = (cx: number, cy: number, w: number, h: number, c: number) => {
      // Noggles read along the court's length (b): x → b, y → a
      const bA = bm - 7.5 * px + cx * px;
      const aA = am + 3 * px - cy * px;
      p.decal(aA - h * px, aA, bA, bA + w * px, c, 0.031);
    };
    cell(-2, 2, 3, 1, C.noggleRed);
    cell(-2, 2, 1, 2, C.noggleRed);
    for (const fx of [1, 8]) {
      cell(fx, 0, 6, 6, C.noggleRed);
      cell(fx + 1, 1, 2, 4, 0xffffff);
      cell(fx + 3, 1, 2, 4, 0x111111);
    }
    cell(7, 2, 1, 1, C.noggleRed);
  }
  for (const [bE, s] of [
    [b0, 1],
    [b1, -1],
  ] as const) {
    const bR = bE + s * K.rimFromBaseline;
    const bK = bE + s * K.keyLength;
    const kw = K.keyWidth / 2;
    // Key: painted lane + outline
    p.decal(am - kw, am + kw, Math.min(bE, bK), Math.max(bE, bK), C.courtKey, 0.028);
    lineStrip(
      p,
      [
        [am - kw, bE],
        [am - kw, bK],
        [am + kw, bK],
        [am + kw, bE],
      ],
      t,
      L,
      y,
    );
    // Lane hash marks
    for (const d of [2.0, 2.9, 3.8])
      for (const side of [-1, 1]) {
        const a = am + side * kw;
        p.decal(
          Math.min(a, a + side * 0.3),
          Math.max(a, a + side * 0.3),
          bE + s * d,
          bE + s * d + s * t,
          L,
          y,
        );
      }
    // Free-throw circle: solid outside the key, dashed inside it
    const into = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    lineStrip(p, arcPts(am, bK, 1.8, into - Math.PI / 2, into + Math.PI / 2), t, L, y);
    for (let k = 0; k < 6; k++) {
      const th0 = into + Math.PI / 2 + (k * Math.PI) / 6;
      lineStrip(p, arcPts(am, bK, 1.8, th0 + 0.06, th0 + Math.PI / 12, 4), t, L, y);
    }
    // Restricted area under the rim
    lineStrip(p, arcPts(am, bR, 1.25, into - Math.PI / 2, into + Math.PI / 2), t, L, y);
    // Three-point line: straight from the baseline to the rim's depth, then the arc
    const r3 = K.threeRadius;
    const arc = arcPts(am, bR, r3, into - Math.PI / 2, into + Math.PI / 2);
    // arc runs from the +a side to the −a side (s > 0) or the reverse (s < 0)
    const startA = arc[0][0];
    const endA = arc[arc.length - 1][0];
    lineStrip(p, [[startA, bE], ...arc, [endA, bE]], t, L, y);
  }
}

// ── Layout ──────────────────────────────────────────────────────────────
//
//  b ↓   a →  0 ─ Main St ─ 12 ─ walk ─ 21 ── shops ── 33 alley 40 ── schoolyard ── 92 school 118 │ tower
//    0 ┬  on-ramp from the line ↘
//      │  pizza · laundry · deli · arcade        court (46–72 × 6–30)    stairs + rails + hubbas
//   54 │  ⌐◨-◨ BOARD SHOP (corner)               street course           banks up to the platform
//   68 ┼──────────────────────── Cross St ───────────────────────────────────── QP (a 115–120)
//   80 │  houses (4 lots, yards, driveways) │ backyards │ pool patio │ empty lot: plywood ramps
//  120 │                                    │           │            │ Memorial Park: mini ramp
//  150 ┴  off-ramp back to the line ↙

function buildPark(f: NjFrame, origin: THREE.Vector3): Park {
  const p = new Park(f, origin);
  const { W, L } = NJ;
  const dn = (a: number, b: number, y = 0) => p.at(a, b, y, 0, 1); // local +Z = downhill
  const up = (a: number, b: number, y = 0) => p.at(a, b, y, 0, -1);
  const toA = (a: number, b: number, y = 0) => p.at(a, b, y, 1, 0); // local +Z = into the park
  const toM = (a: number, b: number, y = 0) => p.at(a, b, y, -1, 0); // local +Z = toward Main St
  const pm = p.parkM;

  // ── Ground: streets, yards, court, lot, park ──
  p.decal(0, 12, -6, L + 6, C.asphalt);
  for (let b = 2; b < L; b += 7) p.decal(5.92, 6.08, b, b + 3.5, C.lineYellow, 0.03);
  p.decal(12, W, 68, 80, C.asphalt);
  for (let a = 24; a < W - 6; a += 7) p.decal(a, a + 3.5, 73.92, 74.08, C.lineYellow, 0.03);
  p.decal(33, 40, 0, 68, C.asphaltLight);
  p.decal(40, 92, 0, 68, C.yard);
  p.decal(46, 72, 6, 30, C.court, 0.022);
  courtLines(p, 46, 72, 6, 30);
  p.decal(70, W, 82, 118, C.dirt);
  p.decal(37, 70, 80, 150, C.grass);
  p.decal(70, W, 120, 150, C.grass);
  p.decal(80, 84, 120, 150, C.sidewalk, 0.022);
  p.decal(93.6, 102.4, 131, 139, C.wood, 0.022);
  // On-ramp from the line (top of the terrace) and off-ramp back onto it
  p.strip(
    [
      [-9.5, -95],
      [-6, -60],
      [1, -25],
      [6, -6],
    ],
    9,
    C.asphalt,
  );
  p.strip(
    [
      [6, L + 6],
      [1, L + 26],
      [-9, L + 50],
    ],
    9,
    C.asphalt,
  );

  // ── Jersey barriers between the line and Main St (grindable tops) ──
  {
    const prof: P2[] = [
      [-0.3, 0],
      [0.3, 0],
      [0.3, 0.08],
      [0.17, 0.32],
      [0.08, 0.8],
      [-0.08, 0.8],
      [-0.17, 0.32],
      [-0.3, 0.08],
    ];
    const b0 = 10;
    const n = 34;
    const seg = prismZ(prof, 3.6).translate(0, 0, 1.8);
    for (let i = 0; i < n; i++)
      p.add(seg.clone(), C.barrier, dn(-0.8, b0 + i * 3.8), { collide: true });
    seg.dispose();
    p.rail(
      'ledge',
      [
        [0, 0.8, 0.05],
        [0, 0.8, n * 3.8 - 0.25],
      ],
      dn(-0.8, b0),
    );
  }

  // ── Shop side (north block) ──
  // Sidewalk a ∈ [12, 21] with a grindable kerb on Main St and Cross St
  p.add(boxAt(12, 21, -0.2, 0.15, 0, 68), C.sidewalk, pm, { collide: true });
  p.rail(
    'curb',
    [
      [12.03, 0.15, 0.3],
      [12.03, 0.15, 67.7],
    ],
    pm,
  );
  p.rail(
    'curb',
    [
      [12.3, 0.15, 67.97],
      [20.7, 0.15, 67.97],
    ],
    pm,
  );
  const shops: [number, string, number][] = [
    [0xa8553f, 'pizza', 0x2b6a3e],
    [0x8fc9b0, 'laundry', 0x2c6fb0],
    [0xd9b24a, 'deli', 0x1f5a36],
    [0xa894c8, 'arcade', 0xc23a2b],
  ];
  shops.forEach(([color, sign, awning], i) =>
    shop(p, toM(21, 2 + 13 * i + 6.5), 12.6, 12, 4.6, color, sign, awning),
  );
  // Corner board shop: two storeys, signs on both streets
  {
    const m = toM(21, 61);
    p.add(box(14, 7.6, 12, 0, 3.8, -6), 0x2e6fba, m, { collide: true });
    p.add(boxAt(-7, 7, 7.6, 8.1, -12, 0.1), C.trim, m, { collide: true });
    p.add(boxAt(-5.5, 3.5, 0.4, 3.0, -0.05, 0.06), C.glass, m);
    p.add(boxAt(4.2, 5.8, 0, 2.6, -0.05, 0.07), C.door, m);
    for (const x of [-4.5, 0, 4.5])
      p.add(boxAt(x - 1.4, x + 1.4, 5.4, 6.9, -0.05, 0.06), C.glass, m);
    p.sign('boardshop', m, 0, 4.15, 0.1, 1.1);
    p.sign('boardshop', p.at(27, 68, 0, 0, 1), 0, 4.3, 0.1, 0.95);
    // Shop-front bench ledge + a red kicker on the walk
    ledge(p, dn(14.4, 56.5, 0.15), 0.55, 0.45, 7);
    kicker(p, dn(17.6, 44, 0.15), 1.6, 1.6, 0.35, C.noggleRed);
  }
  // Planter ledges in front of the shops (bushes on top, ledges grindable)
  for (const b of [9, 24, 37]) {
    ledge(p, dn(17.5, b, 0.15), 1.0, 0.5, 6, C.concrete);
    p.add(box(0.8, 0.5, 5.6, 0, 0.9), 0x3f7a35, dn(17.5, b, 0.15));
  }
  hydrant(p, dn(13.1, 46.5, 0.15));
  for (const b of [6, 31, 58]) lamp(p, toM(12.6, b, 0.15));
  p.add(box(0.5, 1.1, 0.45, 0, 0.55), 0x2c6fb0, dn(13.3, 18, 0.15));
  p.add(box(0.5, 1.1, 0.45, 0, 0.55), 0xd9b24a, dn(13.3, 18.6, 0.15));
  p.add(
    new THREE.CylinderGeometry(0.3, 0.27, 0.9, 10).translate(0, 0.45, 0),
    0x3b5a3b,
    dn(13.3, 41, 0.15),
  );
  car(p, dn(10.9, 28), 0xf2c94c);
  // Back alley dumpster (grindable lid edges)
  {
    const m = dn(36.5, 20);
    p.add(boxAt(-1.0, 1.0, 0, 1.35, -1.8, 1.8), 0x2f6b4a, m, { collide: true });
    for (const x of [-0.97, 0.97])
      p.rail(
        'ledge',
        [
          [x, 1.35, -1.7],
          [x, 1.35, 1.7],
        ],
        m,
      );
  }

  // ── High school + schoolyard ──
  {
    const m = toM(92, 34);
    p.add(box(56, 8.6, 26, 0, 4.3, -13), 0xc9a27a, m, { collide: true });
    p.add(boxAt(-28, 28, 8.6, 9.2, -26, 0.15), 0x7a2d22, m, { collide: true });
    for (const y of [1.2, 4.3])
      for (let x = -25; x <= 22; x += 6.5)
        if (y > 3 || Math.abs(x + 2.1) > 5)
          p.add(boxAt(x, x + 4.2, y, y + 1.7, -0.05, 0.06), C.glass, m);
    p.add(boxAt(-3.5, 3.5, 1.2, 3.6, -0.05, 0.08), C.door, m);
    p.sign('school', m, 0, 7.4, 0.1);
    p.add(box(4, 1.6, 3, 10, 9.2 + 0.8, -10), C.steel, m, { collide: true });
    // Flag pole on the platform
    p.add(rod(v3(-8, 1.2, 6), v3(-8, 10, 6), 0.06), C.steel, m, { bucket: 'thin' });
    p.add(box(0.05, 1.2, 1.9, -8, 9.2, 6.95), 0xc8102e, m);
  }
  // Entrance platform (1.2 m) with a 6-stair down toward the yard, a centre
  // handrail, hubbas both sides, grindable edges and banks at both ends
  {
    const top = 1.2;
    const m = toM(92, 34);
    p.add(boxAt(-10, 10, 0, top, 0, 8), C.concrete, m, { collide: true });
    const sm = p.at(84, 34, 0, -1, 0);
    const stairPts: P2[] = [
      [0, 0],
      [0, top],
    ];
    for (let i = 0; i < 6; i++) {
      stairPts.push([i * 0.36 + 0.36, top - i * 0.2]);
      stairPts.push([i * 0.36 + 0.36, top - (i + 1) * 0.2]);
    }
    p.add(prismX(stairPts, 8), C.concrete, sm, { collide: true });
    const railY = (z: number) => top - (z - 0.36) / 1.8 + 0.85;
    const step = (z: number) => (z < 0 ? top : z >= 2.16 ? 0 : top - Math.floor(z / 0.36) * 0.2);
    handrail(p, sm, v3(0, railY(-0.3), -0.3), v3(0, railY(2.76), 2.76), step);
    // Hubbas: sloped ledges from the platform down beside the stairs
    const hub = (z: number) => top + 0.45 - ((z + 0.6) / 3.16) * top;
    for (const x of [-4.3, 4.3]) {
      p.add(
        prismX(
          [
            [-0.6, 0],
            [2.56, 0],
            [2.56, 0.45],
            [-0.6, top + 0.45],
          ],
          0.6,
        ).translate(x, 0, 0),
        C.ledge,
        sm,
        { collide: true },
      );
      p.rail(
        'ledge',
        [
          [x, hub(-0.55), -0.55],
          [x, hub(2.5), 2.5],
        ],
        sm,
      );
    }
    for (const [x0, x1] of [
      [-9.9, -4.7],
      [4.7, 9.9],
    ])
      p.rail(
        'ledge',
        [
          [x0, top, 7.97],
          [x1, top, 7.97],
        ],
        m,
      );
    bank(p, p.at(88, 17.5, 0, 0, 1), 8, 6.5, top);
    bank(p, p.at(88, 50.5, 0, 0, -1), 8, 6.5, top);
    const nm = toM(84.7, 27.2, top);
    p.add(rod(v3(0, 0, -0.06), v3(0, 1.9, -0.06), 0.04), C.darkSteel, nm, { bucket: 'thin' });
    p.add(box(1.65, 1.15, 0.05, 0, 1.45, -0.02), C.trim, nm);
    p.sign('noskate', nm, 0, 1.45, 0.01);
  }
  // Basketball hoops at both ends of the court (a 46–72, b 6–30), to the
  // Noun Hoops contract: the pole stands behind the baseline, the arm
  // reaches in over it to the board, the rim hangs 1.15 m inside
  for (const [bE, dir] of [
    [6, 1],
    [30, -1],
  ] as const) {
    const K = JERSEY_COURT;
    const m = p.at(59, bE - dir * HOOP_POLE_BACK, 0, 0, dir);
    // Local +Z = into the court; z = 0 at the pole
    const zFace = HOOP_POLE_BACK + K.boardFromBaseline;
    const zBack = zFace - 0.07;
    const zRim = HOOP_POLE_BACK + K.rimFromBaseline;
    const top = K.boardBottom + K.boardHeight * 0.55;
    p.add(
      new THREE.CylinderGeometry(0.1, 0.12, top + 0.2, 10).translate(0, (top + 0.2) / 2, 0),
      C.darkSteel,
      m,
    );
    p.add(boxAt(-0.32, 0.32, 0, 0.06, -0.32, 0.32), C.concrete, m);
    // Arm + brace to the back of the board
    p.add(rod(v3(0, top, 0), v3(0, top, zBack - 0.12), 0.07, 8), C.darkSteel, m, {
      bucket: 'thin',
    });
    p.add(rod(v3(0, top - 1.0, 0.06), v3(0, top - 0.05, zBack - 0.4), 0.05, 8), C.darkSteel, m, {
      bucket: 'thin',
    });
    p.add(
      boxAt(
        -0.35,
        0.35,
        K.boardBottom + 0.1,
        K.boardBottom + K.boardHeight - 0.1,
        zBack - 0.12,
        zBack,
      ),
      C.darkSteel,
      m,
    );
    // Hoop tops (hidden while Noun Hoops draws its live ones)
    const bw = K.boardWidth / 2;
    const b0 = K.boardBottom;
    const b1 = K.boardBottom + K.boardHeight;
    p.add(boxAt(-bw, bw, b0, b1, zBack, zFace), C.trim, m, { bucket: 'hoop' });
    const zP = zFace + 0.004;
    const frame = (x0: number, x1: number, y0: number, y1: number, w: number, c: number) => {
      p.add(boxAt(x0, x1, y0, y0 + w, zFace, zP), c, m, { bucket: 'hoop' });
      p.add(boxAt(x0, x1, y1 - w, y1, zFace, zP), c, m, { bucket: 'hoop' });
      p.add(boxAt(x0, x0 + w, y0, y1, zFace, zP), c, m, { bucket: 'hoop' });
      p.add(boxAt(x1 - w, x1, y0, y1, zFace, zP), c, m, { bucket: 'hoop' });
    };
    frame(-bw, bw, b0, b1, 0.06, C.noggleRed);
    frame(-0.295, 0.295, K.rimHeight + 0.15, K.rimHeight + 0.6, 0.05, C.noggleRed);
    p.add(boxAt(-bw, bw, b0 - 0.08, b0, zBack - 0.02, zFace + 0.03), 0x2a2d35, m, {
      bucket: 'hoop',
    });
    p.add(
      new THREE.TorusGeometry(K.rimRadius, 0.018, 6, 20)
        .rotateX(Math.PI / 2)
        .translate(0, K.rimHeight, zRim),
      0xe86a2a,
      m,
      { bucket: 'hoop' },
    );
    p.add(
      boxAt(-0.08, 0.08, K.rimHeight - 0.09, K.rimHeight + 0.01, zFace, zRim - K.rimRadius + 0.01),
      0xe86a2a,
      m,
      {
        bucket: 'hoop',
      },
    );
    // Resting net: strands twisting down to a narrower ring
    for (let i = 0; i < 12; i++) {
      const a0 = (i / 12) * Math.PI * 2;
      const a1 = a0 + Math.PI / 6;
      const r0 = K.rimRadius - 0.01;
      p.add(
        rod(
          v3(Math.cos(a0) * r0, K.rimHeight - 0.01, zRim + Math.sin(a0) * r0),
          v3(Math.cos(a1) * 0.14, K.rimHeight - 0.42, zRim + Math.sin(a1) * 0.14),
          0.008,
          3,
        ),
        0xf4f1ea,
        m,
        { bucket: 'hoop' },
      );
    }
    p.col.push(posOnly(box(0.3, top + 0.2, 0.3), m));
  }
  // Schoolyard street course: flat bar, manual pad, picnic tables, kicker
  handrail(p, dn(52, 42), v3(0, 0.38, -5), v3(0, 0.38, 5), () => 0);
  {
    const m = dn(66, 46);
    p.add(boxAt(-2, 2, 0, 0.25, -5, 5), C.concrete, m, { collide: true });
    for (const x of [-1.97, 1.97])
      p.rail(
        'ledge',
        [
          [x, 0.25, -4.9],
          [x, 0.25, 4.9],
        ],
        m,
      );
  }
  for (const b of [40, 52]) {
    const m = toA(76, b);
    ledge(p, m, 0.8, 0.75, 3.2, C.woodDark);
    p.add(boxAt(-1.4, -0.9, 0, 0.42, -1.6, 1.6), C.woodDark, m, { collide: true });
    p.add(boxAt(0.9, 1.4, 0, 0.42, -1.6, 1.6), C.woodDark, m, { collide: true });
  }
  kicker(p, p.at(58, 62, 0, 0, -1), 2.4, 2.4, 0.55, C.concrete);
  treeAt(p, 88, 3, 11);
  treeAt(p, 88, 65, 12);
  treeAt(p, 43, 64, 13);

  // ── Cross St ends in a quarter pipe ──
  quarterPipe(p, toA(115.3, 74), 11.8, 3.2, 2.3, 1.6);

  // ── Houses: four lots along Main St (b0 … b0 + 17) ──
  const houseColors = [0xf2e2c4, 0xa9cbe0, 0xe8b4a8, 0xc8d8a8];
  p.add(boxAt(12, 15, -0.2, 0.15, 80, 150), C.sidewalk, pm, { collide: true });
  p.rail(
    'curb',
    [
      [12.03, 0.15, 80.3],
      [12.03, 0.15, 149.7],
    ],
    pm,
  );
  for (let k = 0; k < 4; k++) {
    const b0 = 82 + 17 * k;
    // Driveway (up to the side of the house) and the front lawn
    p.add(boxAt(15, 31, -0.2, 0.15, b0 + 0.5, b0 + 4), C.concrete, pm, { collide: true });
    p.add(boxAt(15, 25, -0.2, 0.15, b0 + 4, b0 + 17), C.lawn, pm, { collide: true });
    house(p, toM(25, b0 + 10.5), houseColors[k]);
    car(p, p.at(21.5, b0 + 2.25, 0.15, -1, 0), [0xc23a2b, 0x2e6fba, 0xf4f1ea, 0x2b2b2b][k]);
    treeAt(p, 19.5, b0 + 12.5, 20 + k);
    p.add(rod(v3(0, 0, 0), v3(0, 1.0, 0), 0.04), C.woodDark, dn(15.6, b0 + 4.6, 0.15), {
      bucket: 'thin',
    });
    p.add(
      box(0.25, 0.25, 0.45, 0, 1.1),
      [0x2b2b2b, 0xc23a2b, 0x2c6fb0, 0x3f7a35][k],
      dn(15.6, b0 + 4.6, 0.15),
    );
    if (k !== 1) fence(p, 47, 47, b0, b0 + 17);
  }
  // Fences between the backyards (the pool yard's run out to the empty lot)
  for (const b of [82, 133, 150]) fence(p, 37, 47, b, b);
  fence(p, 37, 68, 99, 99);
  fence(p, 37, 68, 116, 116);
  hydrant(p, dn(13.1, 107, 0.15));
  for (const b of [92, 116, 140]) lamp(p, toM(12.6, b, 0.15));
  car(p, dn(10.9, 96), 0x8fc9b0);
  car(p, up(10.9, 131), 0xa894c8);

  // ── The drained pool: lot 1's backyard, raised patio + bowl ──
  {
    const pa = 55;
    const pb = 107.5;
    const info = pool(p, dn(pa, pb));
    // Banks up to the deck on both long sides (where the patio wall is straight)
    const bw = Math.min(5, info.straightZ * 2 - 0.2);
    bank(p, toM(pa + info.patioX + 6.2, pb), bw, 6.2, POOL.deck);
    bank(p, toA(pa - info.patioX - 6.2, pb), bw, 6.2, POOL.deck);
    // Sun lounger on the shallow-end deck
    p.add(
      boxAt(-0.35, 0.35, 0, 0.4, -0.9, 0.9),
      0xf4f1ea,
      dn(pa, pb + info.patioZ - 1.1, POOL.deck),
    );
  }

  // ── Empty lot: makeshift plywood ramps ──
  quarterPipe(p, toA(115.2, 100), 8, 2.8, 1.8, 1.4, C.wood);
  kicker(p, toA(88, 98), 2.4, 2.4, 0.6, C.wood);
  kicker(p, toM(101, 108), 2.2, 2.0, 0.5, C.woodDark);
  bank(p, toM(80, 90), 4, 4, 1.0, 1.2, C.wood);
  {
    const m = dn(94, 108);
    p.add(boxAt(-1.2, 1.2, 0, 0.4, -2.4, 2.4), C.woodDark, m, { collide: true });
    for (const x of [-1.17, 1.17])
      p.rail(
        'ledge',
        [
          [x, 0.4, -2.3],
          [x, 0.4, 2.3],
        ],
        m,
      );
  }
  car(p, p.at(108, 86, 0, 1, 0.2), 0, true);
  {
    // Cable spool on its side
    const m = dn(76, 113);
    for (const x of [-0.55, 0.55])
      p.add(
        new THREE.CylinderGeometry(1.0, 1.0, 0.12, 16).rotateZ(Math.PI / 2).translate(x, 1.0, 0),
        C.wood,
        m,
        {
          collide: true,
        },
      );
    p.add(
      new THREE.CylinderGeometry(0.45, 0.45, 1.0, 12).rotateZ(Math.PI / 2).translate(0, 1.0, 0),
      C.woodDark,
      m,
      {
        collide: true,
      },
    );
  }

  // ── Memorial Park: mini ramp, benches, trees ──
  {
    const flat = 2.2;
    const ca = 98;
    const cb = 135;
    quarterPipe(p, p.at(ca + flat, cb, 0, 1, 0), 8, 2.4, 1.5, 1.8, C.wood);
    quarterPipe(p, p.at(ca - flat, cb, 0, -1, 0), 8, 2.4, 1.5, 1.8, C.wood);
    ledge(p, dn(75, 128), 0.6, 0.45, 4, C.woodDark);
    ledge(p, dn(75, 142), 0.6, 0.45, 4, C.woodDark);
    ledge(p, toA(89, 124), 0.6, 0.45, 4, C.concrete);
    const sm = toM(82.2, 121);
    p.add(box(3.4, 1.0, 0.12, 0, 1.25), C.woodDark, sm);
    p.sign('park', sm, 0, 1.25, 0.07);
    for (const x of [-1.4, 1.4]) p.add(box(0.12, 0.8, 0.12, x, 0.4), C.woodDark, sm);
    for (const [a, b] of [
      [73, 122],
      [73, 148],
      [86, 147],
      [112, 123],
      [117, 141],
      [109, 148],
      [92, 122],
      [104, 123],
    ])
      treeAt(p, a, b, 40 + a);
  }
  for (const [a, b] of [
    [41, 92],
    [43, 128],
    [41, 146],
    [60, 140],
    [64, 124],
    [116, 64],
  ])
    treeAt(p, a, b, 60 + b);

  // ── Water tower behind the school: the town's name, seen from up the line ──
  {
    const m = toM(126, 30);
    const legY = 15;
    for (const [x, z] of [
      [-2.8, -2.8],
      [2.8, -2.8],
      [-2.8, 2.8],
      [2.8, 2.8],
    ])
      p.add(rod(v3(x * 1.35, 0, z * 1.35), v3(x, legY, z), 0.22, 8), 0x8fa7b5, m, {
        collide: true,
      });
    p.add(new THREE.CylinderGeometry(4.6, 4.6, 5.2, 24).translate(0, legY + 2.6, 0), C.trim, m, {
      collide: true,
    });
    p.add(new THREE.ConeGeometry(4.8, 2.0, 24).translate(0, legY + 6.2, 0), 0x6d8796, m);
    p.add(
      new THREE.TorusGeometry(4.7, 0.06, 4, 32).rotateX(Math.PI / 2).translate(0, legY + 0.2, 0),
      C.darkSteel,
      m,
      { bucket: 'thin' },
    );
    // Name band: a curved slice of the atlas round the front of the tank
    // (θ = 0 is local +Z; u runs left → right seen from the front)
    const s = p.atlas.slots.get('tower')!;
    const theta = s.w / 4.65;
    const g = new THREE.CylinderGeometry(4.65, 4.65, s.h, 24, 1, true, -theta / 2, theta);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++)
      uv.setXY(i, s.u0 + uv.getX(i) * (s.u1 - s.u0), s.v0 + uv.getY(i) * (s.v1 - s.v0));
    g.translate(0, legY + 2.8, 0).applyMatrix4(m);
    p.signs.push(g.toNonIndexed());
    g.dispose();
  }

  // ── Signs out by the line (render only: nothing to slam into at speed) ──
  {
    // Welcome board at the top of Main St
    const m = up(-3.5, -4);
    p.add(box(6.3, 2.9, 0.18, 0, 2.55), C.woodDark, m);
    p.sign('welcome', m, 0, 2.55, 0.1);
    for (const x of [-2.6, 2.6]) p.add(box(0.16, 1.2, 0.16, x, 0.6), C.woodDark, m);
    // Highway-style exit sign beside the lane, coming down into the cut
    const e = p.onGround(-7.2, -68, 0, -1);
    p.add(box(5.2, 2.8, 0.12, 0, 4.1), C.darkSteel, e);
    p.sign('exit', e, 0, 4.1, 0.07);
    for (const x of [-1.8, 1.8])
      p.add(rod(v3(x, -0.3, -0.1), v3(x, 2.8, -0.1), 0.06), C.darkSteel, e, { bucket: 'thin' });
    // Hand-painted plywood sign further up the line
    const hm = p.onGround(-7.6, -NJ.U0 - 100, 0, -1);
    p.add(box(2.7, 1.3, 0.06, 0, 1.55), C.wood, hm);
    p.sign('hand', hm, 0, 1.55, 0.04);
    p.add(box(0.1, 1.4, 0.1, 0, 0.4, -0.06), C.woodDark, hm);
  }
  return p;
}

// ── Decorator ───────────────────────────────────────────────────────────

export interface NjBuildStats {
  drawCalls: number;
  triangles: number;
  collisionTriangles: number;
  rails: number;
  trees: number;
  ms: number;
}

/** Last build's numbers (perf audits / tests). */
export const njStats: NjBuildStats = {
  drawCalls: 0,
  triangles: 0,
  collisionTriangles: 0,
  rails: 0,
  trees: 0,
  ms: 0,
};

/**
 * Just outside the corner board shop's door (world x, z), for the game's
 * "enter board shop" prompt. Mirrors the shop block in buildPark: origin at
 * park (21, 61) facing Main St, door at local x ≈ 5, front face at z = 0.
 */
export function njShopDoor(f: NjFrame, out: { x: number; z: number }) {
  const yaw = njYaw(f, -1, 0);
  const o = njToWorld(f, 21, 61, out);
  const lx = 5;
  const lz = 0.9;
  const x = o.x + lx * Math.cos(yaw) + lz * Math.sin(yaw);
  const z = o.z - lx * Math.sin(yaw) + lz * Math.cos(yaw);
  out.x = x;
  out.z = z;
  return out;
}

/** The park, in the chunk that holds the middle of the neighbourhood. */
export function nounJerseyDecorator(rails: RailSet): ChunkDecorator {
  return {
    id: 'nounjersey',
    populate(ctx: ChunkContext): ChunkDecoration | null {
      // Nowhere near 19 km out: don't grow the network to find out
      const cx = ctx.origin.x + ctx.size / 2;
      const cz = ctx.origin.z + ctx.size / 2;
      if (Math.abs(edgeDistance(cx, cz) - SPOT_SITE.trigger) > 2500) return null;
      const f = njFrameNow();
      if (f === null) return null;
      const anchor = njToWorld(f, NJ.W / 2, NJ.L / 2, { x: 0, z: 0 });
      if (
        anchor.x < ctx.origin.x ||
        anchor.x >= ctx.origin.x + ctx.size ||
        anchor.z < ctx.origin.z ||
        anchor.z >= ctx.origin.z + ctx.size
      )
        return null;
      const t0 = performance.now();
      const p = buildPark(f, ctx.origin);
      const root = new THREE.Group();
      root.name = 'NounJersey';
      const M = materials();
      const disposables: { dispose(): void }[] = [];
      let tris = 0;
      let calls = 0;
      const addMesh = (
        geos: THREE.BufferGeometry[],
        mat: THREE.Material,
        name: string,
        shadow: boolean,
      ) => {
        if (geos.length === 0) return null;
        const g = mergeGeometries(geos, false)!;
        for (const q of geos) q.dispose();
        g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, mat);
        mesh.name = name;
        mesh.castShadow = shadow;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        root.add(mesh);
        disposables.push(g);
        tris += g.attributes.position.count / 3;
        calls++;
        return mesh;
      };
      addMesh(p.geo.solid, M.solid, 'NounJerseySolid', true);
      addMesh(p.geo.ground, M.ground, 'NounJerseyGround', false);
      const thin = addMesh(p.geo.thin, M.thin, 'NounJerseyThin', true);
      const hoopTops = addMesh(p.geo.hoop, M.thin, 'NounJerseyHoopTops', true);
      addMesh(p.signs, signMaterial(f.side), 'NounJerseySigns', false);
      if (p.trees.length > 0) {
        const tg = treeGeometry();
        const im = new THREE.InstancedMesh(tg, M.solid, p.trees.length);
        im.name = 'NounJerseyTrees';
        p.trees.forEach((m, i) => im.setMatrixAt(i, m));
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.castShadow = true;
        im.receiveShadow = true;
        root.add(im);
        disposables.push(tg, { dispose: () => im.dispose() });
        tris += (tg.attributes.position.count / 3) * p.trees.length;
        calls++;
      }
      if (ctx.toon) toonify(root);
      // Thin rods (handrails, hoop rims, poles) stay out of the ink normals pass
      if (thin !== null) inkExcluded.add(thin);
      if (hoopTops !== null) {
        inkExcluded.add(hoopTops);
        njHoopTops.add(hoopTops);
      }
      root.updateMatrixWorld(true);
      // Collision (chunk-local, position only)
      let n = 0;
      for (const c of p.col) n += c.attributes.position.array.length;
      const arr = new Float32Array(n);
      let o = 0;
      for (const c of p.col) {
        arr.set(c.attributes.position.array as Float32Array, o);
        o += c.attributes.position.array.length;
        c.dispose();
      }
      const collision = new THREE.BufferGeometry();
      collision.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      rails.add(p.rails);
      const railIds = p.rails.map(r => r.id);
      Object.assign(njStats, {
        drawCalls: calls,
        triangles: Math.round(tris),
        collisionTriangles: n / 9,
        rails: p.rails.length,
        trees: p.trees.length,
        ms: performance.now() - t0,
      });
      return {
        object: root,
        collision,
        dispose: () => {
          rails.remove(railIds);
          if (thin !== null) inkExcluded.delete(thin);
          if (hoopTops !== null) {
            inkExcluded.delete(hoopTops);
            njHoopTops.delete(hoopTops);
          }
          collision.dispose();
          for (const d of disposables) d.dispose();
        },
      };
    },
  };
}
