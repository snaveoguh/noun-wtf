// ── The parachute: a Nouns ram-air canopy with noggles on top ────────────
//
// A curved wing (a segmented slab bent down at the tips), cells in the
// noun.wtf yellow / red, the canonical noggles (NounOS intro's NOGGLES,
// pixel for pixel) painted big across the top, and suspension lines from
// the wing's underside down to the rider's shoulders. Positioned on the
// rider every frame (`place`); `open` (0..1) unfurls it from a bundle.
// One texture (256 × 64, 128 × 32 on the texture diet), shared.

import * as THREE from 'three';

import { NOG_RED, NOGGLES } from '../../../../components/NounOS/home/introScene';
import { textureDiet } from '../../render/textureDiet';

/** Span (m), chord (m), thickness (m), height of the wing over the rider's feet (m). */
export const WING = { span: 7.2, chord: 2.6, thick: 0.32, height: 5.6, bend: 6 } as const;
const CELLS = 9;
const YELLOW = '#ffd400';
/** Where the lines meet the rider (rider space: shoulders). */
const RISERS: readonly [number, number, number][] = [
  [0.22, 1.25, 0],
  [-0.22, 1.25, 0],
];

let sharedTex: THREE.CanvasTexture | null = null;

function texture(): THREE.CanvasTexture | null {
  if (sharedTex !== null) return sharedTex;
  if (typeof document === 'undefined') return null;
  const w = textureDiet.on ? 128 : 256;
  const h = w / 4;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g === null) return null;
  // Cells: yellow / red stripes across the span
  for (let i = 0; i < CELLS; i++) {
    g.fillStyle = i % 2 === 0 ? YELLOW : NOG_RED;
    g.fillRect(Math.floor((i * w) / CELLS), 0, Math.ceil(w / CELLS) + 1, h);
  }
  // Noggles, centred on a white panel
  const px = Math.floor(h / 8);
  const nw = NOGGLES[0]!.length * px;
  const nh = NOGGLES.length * px;
  const x0 = Math.floor((w - nw) / 2);
  const y0 = Math.floor((h - nh) / 2);
  g.fillStyle = '#ffffff';
  g.fillRect(x0 - px, y0 - px, nw + 2 * px, nh + 2 * px);
  const col = { R: NOG_RED, W: '#ffffff', B: '#000000' } as const;
  NOGGLES.forEach((row, y) =>
    [...row].forEach((k, x) => {
      if (k === '.') return;
      g.fillStyle = col[k as keyof typeof col];
      g.fillRect(x0 + x * px, y0 + y * px, px, px);
    }),
  );
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  sharedTex = t;
  return t;
}

/** The wing's mesh, bent round an arc so the tips hang down. */
function wingGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(WING.span, WING.thick, WING.chord, 24, 1, 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  const R = WING.bend;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const a = x / R;
    const r = R + y;
    // Thicker at the leading edge (+z), thin at the trailing edge
    const t = 0.55 + 0.45 * ((z + WING.chord / 2) / WING.chord);
    p.setXYZ(i, Math.sin(a) * r, Math.cos(a) * r - R + (y - y * t), z);
  }
  g.computeVertexNormals();
  return g;
}

/** Points on the wing's underside the lines hang from (wing space). */
function lineTops(): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const R = WING.bend;
  for (const fx of [-0.46, -0.27, -0.09, 0.09, 0.27, 0.46]) {
    const a = (fx * WING.span) / R;
    const r = R - WING.thick / 2;
    for (const z of [0.7, -0.6])
      out.push(new THREE.Vector3(Math.sin(a) * r, Math.cos(a) * r - R, z));
  }
  return out;
}

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();

export class Canopy {
  readonly root = new THREE.Group();
  /** Swings round the risers (bank in turns, pendulum). */
  private pivot = new THREE.Group();
  private wing: THREE.Mesh;
  private lines: THREE.LineSegments;
  private tops = lineTops();
  private bank = 0;
  private t = 0;

  constructor(parent: THREE.Object3D) {
    const tex = texture();
    const mat = new THREE.MeshStandardMaterial({
      color: tex === null ? YELLOW : 0xffffff,
      map: tex,
      roughness: 0.8,
      side: THREE.DoubleSide,
    });
    this.wing = new THREE.Mesh(wingGeometry(), mat);
    this.wing.castShadow = true;
    this.pivot.position.set(0, RISERS[0]![1], 0);
    this.wing.position.set(0, WING.height - RISERS[0]![1], 0);
    this.pivot.add(this.wing);
    this.root.add(this.pivot);
    const pos = new Float32Array(this.tops.length * 2 * 3);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.lines = new THREE.LineSegments(
      lg,
      new THREE.LineBasicMaterial({ color: 0x2a2a33, transparent: true, opacity: 0.7 }),
    );
    this.lines.frustumCulled = false;
    this.root.add(this.lines);
    this.root.visible = false;
    this.root.name = 'skydive-canopy';
    parent.add(this.root);
  }

  /**
   * Put it over a rider at `pos` facing `yaw`, `open` 0..1, banking with
   * `steer`. Hidden at open ≤ 0.
   */
  place(dt: number, pos: THREE.Vector3, yaw: number, open: number, steer: number) {
    const show = open > 0.001;
    this.root.visible = show;
    if (!show) return;
    this.t += dt;
    this.root.position.copy(pos);
    this.root.rotation.set(0, yaw, 0);
    this.bank += (steer * 0.32 - this.bank) * (1 - Math.exp(-3 * dt));
    // A little pendulum swing settling once it's open
    const swing = Math.sin(this.t * 1.9) * 0.05 * (1 - 0.6 * open);
    this.pivot.rotation.set(swing, 0, this.bank);
    // Unfurl: a bundle stretches up the lines, then spreads across the span
    const up = Math.min(1, open / 0.35);
    const spread = Math.max(0, Math.min(1, (open - 0.2) / 0.8));
    const s = 0.12 + 0.88 * spread * spread * (3 - 2 * spread);
    this.wing.scale.set(s, 0.6 + 0.4 * spread, 0.35 + 0.65 * spread);
    this.wing.position.y = (WING.height - RISERS[0]![1]) * (0.35 + 0.65 * up);
    // Lines: wing underside → the nearer shoulder (root space)
    this.pivot.updateMatrix();
    this.wing.updateMatrix();
    _m.multiplyMatrices(this.pivot.matrix, this.wing.matrix);
    const a = this.lines.geometry.attributes.position as THREE.BufferAttribute;
    this.tops.forEach((t, i) => {
      _v.copy(t).applyMatrix4(_m);
      const r = RISERS[t.x >= 0 ? 0 : 1]!;
      a.setXYZ(i * 2, _v.x, _v.y, _v.z);
      a.setXYZ(i * 2 + 1, r[0], r[1], r[2]);
    });
    a.needsUpdate = true;
  }

  hide() {
    this.root.visible = false;
  }

  dispose() {
    this.root.removeFromParent();
    this.wing.geometry.dispose();
    (this.wing.material as THREE.Material).dispose();
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
  }
}
