// ── The mural billboard's frame: one merged mesh ────────────────────────
//
// Local frame: x along the wall, y up, z out of the wall (z = 0 is the wall
// face). The screen rectangle is `rect` in (x, y) (x relative to the
// group's origin); the frame stands off the wall on four struts, with a
// stepped (bevelled) border round the screen and a thin raised inner lip.
// Everything is boxes merged into one geometry with vertex colours: one draw.

import type { ScreenRect } from './billboardFit';

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const FRAME = {
  /** Border outside the picture (m). */
  border: 0.38,
  /** Front-to-back depth of the frame body (m). */
  depth: 0.42,
  /** Gap between the wall and the back of the frame (the struts). */
  standoff: 0.2,
  /** How far the picture sits back from the border's front face. */
  recess: 0.12,
  /** Width of the outer bevel step. */
  bevel: 0.1,
  /** Inner lip: width round the picture and how far it stands proud. */
  lip: 0.07,
  lipProud: 0.035,
  strut: 0.22,
} as const;

const C_FRAME = new THREE.Color(0x0d0d0d);
const C_BEVEL = new THREE.Color(0x161616);
const C_LIP = new THREE.Color(0x222222);
const C_STRUT = new THREE.Color(0x2b2b2b);

function box(
  out: THREE.BufferGeometry[],
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  color: THREE.Color,
) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) color.toArray(col, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.push(g);
}

/** Four bars round the rectangle (x0..x1, y0..y1) of width `w` outside it. */
function ring(
  out: THREE.BufferGeometry[],
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  w: number,
  z0: number,
  z1: number,
  color: THREE.Color,
) {
  box(out, x0 - w, x1 + w, y1, y1 + w, z0, z1, color); // top
  box(out, x0 - w, x1 + w, y0 - w, y0, z0, z1, color); // bottom
  box(out, x0 - w, x0, y0, y1, z0, z1, color); // left
  box(out, x1, x1 + w, y0, y1, z0, z1, color); // right
}

/** z of the picture's plane (local). */
export function screenZ(): number {
  return FRAME.standoff + FRAME.depth - FRAME.recess;
}

/** The frame's geometry round `rect`. */
export function buildFrameGeometry(rect: ScreenRect): THREE.BufferGeometry {
  const F = FRAME;
  const x0 = rect.u - rect.width / 2;
  const x1 = rect.u + rect.width / 2;
  const y0 = rect.bottom;
  const y1 = rect.bottom + rect.height;
  const zb = F.standoff;
  const zf = F.standoff + F.depth;
  const parts: THREE.BufferGeometry[] = [];
  // Back plate: nothing of the wall shows through the recess
  box(parts, x0 - F.border, x1 + F.border, y0 - F.border, y1 + F.border, zb, zb + 0.05, C_FRAME);
  // Border, in two steps: the outer band stops short of the front (the bevel)
  const inner = F.border - F.bevel;
  ring(parts, x0, x1, y0, y1, inner, zb, zf, C_FRAME);
  ring(parts, x0 - inner, x1 + inner, y0 - inner, y1 + inner, F.bevel, zb, zf - 0.09, C_BEVEL);
  // Raised inner lip round the picture
  ring(parts, x0, x1, y0, y1, F.lip, zf - 0.02, zf + F.lipProud, C_LIP);
  // Struts to the wall, a little into it so there's never a gap
  const sx = rect.width / 2 - Math.min(1.2, rect.width * 0.18);
  const sy = rect.height / 2 - Math.min(1.0, rect.height * 0.18);
  const cy = (y0 + y1) / 2;
  const s = F.strut / 2;
  for (const dx of [-sx, sx])
    for (const dy of [-sy, sy])
      box(
        parts,
        rect.u + dx - s,
        rect.u + dx + s,
        cy + dy - s,
        cy + dy + s,
        -0.05,
        zb + 0.01,
        C_STRUT,
      );
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged ?? new THREE.BufferGeometry();
}

/** Position-only box hull of the frame (for the collision world), local. */
export function buildFrameCollider(rect: ScreenRect): THREE.BufferGeometry {
  const F = FRAME;
  const w = rect.width + 2 * F.border;
  const h = rect.height + 2 * F.border;
  const d = F.standoff + F.depth;
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(rect.u, rect.bottom + rect.height / 2, d / 2);
  const pos = new THREE.BufferGeometry();
  pos.setAttribute('position', g.attributes.position.clone());
  pos.setIndex(g.index!.clone());
  g.dispose();
  const flat = pos.toNonIndexed();
  pos.dispose();
  return flat;
}
