// ── The table: felt, cushions, wood rails, diamonds, pockets, cabinet ───
//
// Built in the table's own frame (the group the view places in the world):
// local X = sim x (the length), local Z = sim y, local Y up from the floor,
// the cloth's top at `feltY`. Low-poly and vertex-free (a handful of
// materials), so the toon pass gives it the house look.

import * as THREE from 'three';

import { CUSHION, L, POCKETS, R, W, HEAD_X, FOOT_X, cushionPolys, diamonds } from '../sim/table';

/** Wood rail width (top of the rail, past the cushion). */
export const RAIL = 0.11;
/** Outer half sizes. */
export const HX = L / 2 + CUSHION + RAIL;
export const HZ = W / 2 + CUSHION + RAIL;
const CUSH_H = 0.038;
const RAIL_H = 0.046;

export interface TableMesh {
  group: THREE.Group;
  /** Cloth top (local y). */
  feltY: number;
  /** The cloth (for pointer picks). */
  felt: THREE.Mesh;
  dispose(): void;
}

export interface TableLook {
  felt?: number;
  wood?: number;
}

function std(color: number, roughness = 0.8, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

/** A Shape from sim-frame points. */
function shape(pts: { x: number; y: number }[]): THREE.Shape {
  const s = new THREE.Shape();
  pts.forEach((p, i) => (i === 0 ? s.moveTo(p.x, p.y) : s.lineTo(p.x, p.y)));
  s.closePath();
  return s;
}

/** Extrude a sim-frame shape from y0 up to y1 (local frame). */
function slab(s: THREE.Shape, y0: number, y1: number, bevel = 0): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(s, {
    depth: y1 - y0 - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 6,
  });
  // Shape XY → local XZ, extrusion → +Y
  g.rotateX(Math.PI / 2);
  g.translate(0, y1 - bevel, 0);
  return g;
}

function roundedRect(hx: number, hz: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-hx + r, -hz);
  s.lineTo(hx - r, -hz);
  s.absarc(hx - r, -hz + r, r, -Math.PI / 2, 0, false);
  s.lineTo(hx, hz - r);
  s.absarc(hx - r, hz - r, r, 0, Math.PI / 2, false);
  s.lineTo(-hx + r, hz);
  s.absarc(-hx + r, hz - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-hx, -hz + r);
  s.absarc(-hx + r, -hz + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

export function buildTable(feltY: number, look: TableLook = {}): TableMesh {
  const group = new THREE.Group();
  group.name = 'pool-table';
  const mats: THREE.Material[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const mk = (g: THREE.BufferGeometry, m: THREE.Material, shadow = true) => {
    geos.push(g);
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const feltC = look.felt ?? 0x1d7a4c;
  const woodC = look.wood ?? 0x6a3a1c;
  const feltM = std(feltC, 0.95);
  const cushM = std(new THREE.Color(feltC).multiplyScalar(0.82).getHex(), 0.9);
  const woodM = std(woodC, 0.55);
  const darkWoodM = std(new THREE.Color(woodC).multiplyScalar(0.62).getHex(), 0.6);
  const pocketM = new THREE.MeshBasicMaterial({ color: 0x0b0806 });
  const leatherM = std(0x2b1a10, 0.7);
  const pearlM = std(0xf3ead0, 0.35);
  const spotM = new THREE.MeshBasicMaterial({ color: 0xe9f2e4 });
  mats.push(feltM, cushM, woodM, darkWoodM, pocketM, leatherM, pearlM, spotM);

  // ── Cloth (a slab under the cushions too) ──
  const felt = mk(
    new THREE.BoxGeometry(L + CUSHION * 2 + 0.01, 0.03, W + CUSHION * 2 + 0.01).translate(
      0,
      feltY - 0.015,
      0,
    ),
    feltM,
    false,
  );
  // Spots + the head string, faint
  for (const x of [HEAD_X, FOOT_X]) {
    const s = mk(new THREE.CircleGeometry(0.009, 10).rotateX(-Math.PI / 2), spotM, false);
    s.position.set(x, feltY + 0.0008, 0);
  }

  // ── Cushions ──
  for (const poly of cushionPolys()) mk(slab(shape(poly), feltY - 0.005, feltY + CUSH_H), cushM);

  // ── Wood rail frame (rounded outside, square inside the cushions) ──
  const frame = roundedRect(HX, HZ, 0.03);
  const hole = new THREE.Path();
  const ix = L / 2 + CUSHION;
  const iz = W / 2 + CUSHION;
  hole.moveTo(-ix, -iz);
  hole.lineTo(-ix, iz);
  hole.lineTo(ix, iz);
  hole.lineTo(ix, -iz);
  hole.closePath();
  frame.holes.push(hole);
  mk(slab(frame, feltY - 0.06, feltY + RAIL_H, 0.006), woodM);

  // ── Pockets: black cups through the rail, a leather lip ──
  for (const p of POCKETS) {
    const r = p.corner ? 0.068 : 0.062;
    const cup = mk(new THREE.CylinderGeometry(r, r * 0.9, RAIL_H + 0.07, 18), pocketM, false);
    cup.position.set(p.x + p.nx * 0.008, feltY + RAIL_H / 2 - 0.035 + 0.002, p.y + p.ny * 0.008);
    const lip = mk(new THREE.TorusGeometry(r + 0.004, 0.012, 6, 18).rotateX(Math.PI / 2), leatherM);
    lip.position.set(cup.position.x, feltY + RAIL_H + 0.002, cup.position.z);
  }

  // ── Diamonds on the rail tops ──
  const dia = new THREE.OctahedronGeometry(0.012, 0).scale(1, 0.25, 0.6);
  geos.push(dia);
  for (const d of diamonds()) {
    const m = new THREE.Mesh(dia, pearlM);
    const side = Math.abs(d.y) > W / 2 - 1e-6;
    const ox = side ? 0 : Math.sign(d.x) * (CUSHION + RAIL / 2);
    const oz = side ? Math.sign(d.y) * (CUSHION + RAIL / 2) : 0;
    m.position.set(d.x + ox, feltY + RAIL_H + 0.002, d.y + oz);
    if (!side) m.rotation.y = Math.PI / 2;
    group.add(m);
  }

  // ── Cabinet + legs ──
  const apronTop = feltY - 0.05;
  mk(
    new THREE.BoxGeometry(HX * 2 - 0.02, 0.2, HZ * 2 - 0.02).translate(0, apronTop - 0.1, 0),
    darkWoodM,
  );
  const legH = apronTop - 0.2;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const leg = mk(new THREE.BoxGeometry(0.13, legH, 0.13), darkWoodM);
      leg.position.set(sx * (HX - 0.2), legH / 2, sz * (HZ - 0.2));
      const foot = mk(new THREE.BoxGeometry(0.17, 0.05, 0.17), woodM);
      foot.position.set(sx * (HX - 0.2), 0.025, sz * (HZ - 0.2));
    }
  void R;

  return {
    group,
    feltY,
    felt,
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      group.removeFromParent();
    },
  };
}
