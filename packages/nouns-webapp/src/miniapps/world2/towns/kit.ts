// ── Town builder kit: primitives, a merge-by-material builder, sign atlas ─
//
// Same recipe as Noun Jersey (world/mountain/NounJerseyPark.ts): every prop
// is built in its own local frame (+Z = its front) and placed by a town-
// coords position + facing, so nothing is ever mirrored (signs read right
// whichever side of the line the far side lands on). All static geometry
// is merged by material: solid (vertex colours), ground decals (polygon
// offset), thin rods (kept out of the ink normals pass) and signs (one
// canvas atlas per town), plus one InstancedMesh per repeated plant.

import * as THREE from 'three';

import { townToWorld, townYaw, type TownFrame } from './site';

export type P2 = [number, number];

export function box(w: number, h: number, d: number, x = 0, y = h / 2, z = 0) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

/** Box spanning [x0, x1] × [y0, y1] × [z0, z1]. */
export function boxAt(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  return new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate(
    (x0 + x1) / 2,
    (y0 + y1) / 2,
    (z0 + z1) / 2,
  );
}

/** A (z, y) profile extruded across X (width w, centred): roofs, ramps. */
export function prismX(profile: P2[], w: number) {
  const shape = new THREE.Shape();
  shape.moveTo(profile[0][0], profile[0][1]);
  for (let i = 1; i < profile.length; i++) shape.lineTo(profile[i][0], profile[i][1]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false, curveSegments: 1 });
  g.rotateY(-Math.PI / 2);
  g.translate(w / 2, 0, 0);
  return g;
}

export function cyl(rTop: number, rBot: number, h: number, seg = 8, x = 0, y = h / 2, z = 0) {
  return new THREE.CylinderGeometry(rTop, rBot, h, seg, 1).translate(x, y, z);
}

/** Cylinder between two points. */
export function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 6) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}

export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Bake one colour into a geometry (non-indexed, position + normal + color). */
export function painted(g: THREE.BufferGeometry, color: number, m?: THREE.Matrix4) {
  const geo = g.index !== null ? g.toNonIndexed() : g;
  if (geo !== g) g.dispose();
  if (m !== undefined) geo.applyMatrix4(m);
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
  return geo;
}

// ── Signs ───────────────────────────────────────────────────────────────

export interface SignSpec {
  key: string;
  /** Size in metres. */
  w: number;
  h: number;
  bg: string;
  fg: string;
  border?: string;
  /** Hand-painted plywood / weathered boards. */
  hand?: boolean;
  lines: { text: string; size: number; y: number; color?: string; font?: string }[];
}

export const BLOCK_FONT = '900 {px}px "Arial Black", Impact, "Helvetica Neue", Arial, sans-serif';
export const WEST_FONT = 'bold {px}px Rockwell, "Courier New", Georgia, serif';

const PX_PER_M = 40;
const ATLAS = 1024;

export interface Atlas {
  texture: THREE.CanvasTexture;
  slots: Map<string, { u0: number; v0: number; u1: number; v1: number; w: number; h: number }>;
}

export function buildAtlas(specs: SignSpec[]): Atlas {
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
  for (const s of specs) {
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
  return { texture, slots };
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
    // Weathered boards: grain lines + plank seams
    g.strokeStyle = 'rgba(40,20,5,0.28)';
    g.lineWidth = 2;
    for (let i = 1; i < 6; i++) {
      g.beginPath();
      g.moveTo(0, (h * i) / 6);
      g.bezierCurveTo(w * 0.3, (h * i) / 6 + 3, w * 0.7, (h * i) / 6 - 3, w, (h * i) / 6 + 1);
      g.stroke();
    }
  }
  if (s.border !== undefined) {
    g.strokeStyle = s.border;
    g.lineWidth = Math.max(3, h * 0.06);
    g.strokeRect(g.lineWidth, g.lineWidth, w - 2 * g.lineWidth, h - 2 * g.lineWidth);
  }
  for (const l of s.lines) {
    const px = Math.round(h * l.size);
    g.font = (l.font ?? BLOCK_FONT).replace('{px}', String(px));
    g.fillStyle = l.color ?? s.fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (s.hand === true) {
      g.save();
      g.translate(w / 2, h * l.y);
      g.rotate(-0.025);
      g.fillText(l.text, 0, 0, w * 0.9);
      g.restore();
    } else g.fillText(l.text, w / 2, h * l.y, w * 0.9);
  }
  g.restore();
}

// ── Builder ─────────────────────────────────────────────────────────────

/** glow: unlit neon (Neon Nouns' strips, lanterns, windows at night). */
export type Bucket = 'solid' | 'ground' | 'thin' | 'glow';

const _col = new THREE.Color();
const _p = { x: 0, z: 0 };
const Y = new THREE.Vector3(0, 1, 0);

export class TownBuilder {
  readonly geo: Record<Bucket, THREE.BufferGeometry[]> = {
    solid: [],
    ground: [],
    thin: [],
    glow: [],
  };
  readonly signs: THREE.BufferGeometry[] = [];
  readonly col: THREE.BufferGeometry[] = [];
  /** Instanced plants: kind → matrices (chunk-local). */
  readonly plants: THREE.Matrix4[] = [];

  constructor(
    readonly f: TownFrame,
    readonly origin: THREE.Vector3,
    readonly atlas: Atlas,
  ) {}

  /** Prop-local → chunk-local: at town (v', u), y above the pad, local +Z facing (dv', du). */
  at(vp: number, u: number, y = 0, dvp = 0, du = 1): THREE.Matrix4 {
    const w = townToWorld(this.f, vp, u, _p);
    return new THREE.Matrix4().compose(
      v3(w.x - this.origin.x, this.f.P + y, w.z - this.origin.z),
      new THREE.Quaternion().setFromAxisAngle(Y, townYaw(this.f, dvp, du)),
      v3(1, 1, 1),
    );
  }

  /** Like `at`, with the y given as an absolute world height. */
  atY(vp: number, u: number, worldY: number, dvp = 0, du = 1): THREE.Matrix4 {
    return this.at(vp, u, worldY - this.f.P, dvp, du);
  }

  /** Add a geometry (consumed) in colour `color` under matrix m. */
  add(
    g: THREE.BufferGeometry,
    color: number,
    m: THREE.Matrix4,
    opts: { collide?: boolean; bucket?: Bucket } = {},
  ) {
    const geo = painted(g, color, m);
    this.geo[opts.bucket ?? 'solid'].push(geo);
    if (opts.collide === true) {
      const c = new THREE.BufferGeometry();
      c.setAttribute('position', geo.attributes.position.clone());
      this.col.push(c);
    }
    return geo;
  }

  /** Sign face (plane facing local +Z, centred at x, y, z) from the atlas. */
  sign(key: string, m: THREE.Matrix4, x: number, y: number, z: number, scale = 1) {
    const s = this.atlas.slots.get(key);
    if (s === undefined) return;
    const g = new THREE.PlaneGeometry(s.w * scale, s.h * scale);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++)
      uv.setXY(i, uv.getX(i) < 0.5 ? s.u0 : s.u1, uv.getY(i) < 0.5 ? s.v0 : s.v1);
    g.translate(x, y, z);
    g.applyMatrix4(m);
    this.signs.push(g.toNonIndexed());
    g.dispose();
  }

  /** Flat decal rectangle on the pad (town coords). */
  decal(v0: number, v1: number, u0: number, u1: number, color: number, y = 0.015) {
    const g = new THREE.PlaneGeometry(v1 - v0, u1 - u0).rotateX(-Math.PI / 2);
    this.add(g, color, this.at((v0 + v1) / 2, (u0 + u1) / 2, y), { bucket: 'ground' });
  }

  /**
   * Ground-following sheet over town coords (vs × us grid), height from
   * `h(u, v')` (world y) — the beach's sand over the lagoon slopes.
   */
  sheet(vs: number[], us: number[], h: (u: number, vp: number) => number, color: number) {
    const pos: number[] = [];
    const P = (vp: number, u: number) => {
      const w = townToWorld(this.f, vp, u, _p);
      return [w.x - this.origin.x, h(u, vp), w.z - this.origin.z];
    };
    for (let i = 0; i < us.length - 1; i++)
      for (let j = 0; j < vs.length - 1; j++) {
        const a = P(vs[j], us[i]);
        const b = P(vs[j + 1], us[i]);
        const c = P(vs[j], us[i + 1]);
        const d = P(vs[j + 1], us[i + 1]);
        pos.push(...a, ...c, ...b, ...b, ...c, ...d);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    // Faces up whichever way the frame's handedness wound it
    if (g.attributes.normal.getY(0) < 0) {
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

  /** One instanced plant at town (v', u), standing on world height y, turned + scaled. */
  plant(vp: number, u: number, worldY: number, turn: number, scale: number) {
    const w = townToWorld(this.f, vp, u, _p);
    this.plants.push(
      new THREE.Matrix4().compose(
        v3(w.x - this.origin.x, worldY, w.z - this.origin.z),
        new THREE.Quaternion().setFromAxisAngle(Y, turn),
        v3(scale, scale, scale),
      ),
    );
  }
}
