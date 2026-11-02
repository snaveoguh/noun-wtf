// ── A surfboard mesh (one per rider, shared geometry per model) ──────────
//
// Outline: a pointed nose, the widest point just ahead of the middle, a
// squash tail, extruded thin with a little rocker (nose and tail kicked
// up); vertex-coloured deck + a stripe down the stringer. Toonified like
// everything else; one draw.

import * as THREE from 'three';

import { toonify } from '../../render/Toon';
import { BOARDS, type BoardId } from '../surf/boards';

const geos = new Map<BoardId, THREE.BufferGeometry>();
let mat: THREE.MeshStandardMaterial | null = null;

export function boardGeometry(id: BoardId): THREE.BufferGeometry {
  const hit = geos.get(id);
  if (hit !== undefined) return hit;
  const b = BOARDS[id];
  const L = b.length;
  const W = b.width;
  const sh = new THREE.Shape();
  // in (x across, y along: +y = nose)
  const n = L / 2;
  const t = -L / 2;
  const nose = id === 'longboard' ? 0.42 : id === 'foamie' ? 0.5 : 0.18;
  sh.moveTo(0, n);
  sh.bezierCurveTo(W * nose, n, W / 2, n * 0.35, W / 2, 0.05 * L);
  sh.bezierCurveTo(W / 2, t * 0.55, W * 0.36, t * 0.92, W * 0.2, t);
  sh.lineTo(-W * 0.2, t);
  sh.bezierCurveTo(-W * 0.36, t * 0.92, -W / 2, t * 0.55, -W / 2, 0.05 * L);
  sh.bezierCurveTo(-W / 2, n * 0.35, -W * nose, n, 0, n);
  const thick = id === 'foamie' ? 0.09 : 0.065;
  const g = new THREE.ExtrudeGeometry(sh, {
    depth: thick,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 1,
    curveSegments: 10,
  });
  // lie it flat: shape y → +z (nose), extrude → +y (deck up)
  g.rotateX(-Math.PI / 2);
  g.translate(0, -thick / 2, 0);
  // rocker + colours
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const deck = new THREE.Color(b.deck);
  const stripe = new THREE.Color(b.stripe);
  const bottom = new THREE.Color(b.deck).multiplyScalar(0.82);
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const x = pos.getX(i);
    const k = (2 * z) / L;
    pos.setY(
      i,
      pos.getY(i) + 0.09 * Math.pow(Math.max(0, k), 3) + 0.04 * Math.pow(Math.max(0, -k), 3),
    );
    const top = pos.getY(i) > 0;
    const c = top && Math.abs(x) < W * 0.07 ? stripe : top ? deck : bottom;
    c.toArray(col, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  geos.set(id, g);
  return g;
}

function material() {
  if (mat === null) {
    mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 });
    mat.name = 'Surfboard';
  }
  return mat;
}

export class Surfboard {
  readonly mesh: THREE.Mesh;
  private id: BoardId;

  constructor(parent: THREE.Object3D, id: BoardId, toon: boolean) {
    this.id = id;
    this.mesh = new THREE.Mesh(boardGeometry(id), material());
    this.mesh.name = `surfboard:${id}`;
    this.mesh.castShadow = true;
    if (toon) toonify(this.mesh);
    parent.add(this.mesh);
  }

  setBoard(id: BoardId) {
    if (id === this.id) return;
    this.id = id;
    this.mesh.geometry = boardGeometry(id);
  }

  dispose() {
    this.mesh.removeFromParent();
    // geometry + material are shared
  }
}
