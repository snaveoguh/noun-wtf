// ── The cypher spot in the plaza: where it goes, where everyone stands ───
//
// The plaza city (world/Level.ts + level.json): the Noggles Fountain at the
// origin (~7 m round), skate spots round the edges (Big Six, Three Stair,
// QP Bay, Pyramid, Ledge Garden, Planters), the ice cream van parked on the
// first clear one of its own spots, the Oracle by the fountain, spawns at
// Plaza South / Fountain. The cypher takes the first candidate below whose
// whole circle is flat, open floor (probed straight down, like the van) and
// that keeps clear of all of those.

import type { CrewId, CrewSize } from '../contract';

import * as THREE from 'three';

export interface CypherSpot {
  x: number;
  y: number;
  z: number;
  /** The way the circle faces: crew 0 stands at −X local, crew 1 at +X. */
  yaw: number;
}

/** Circle radius (crowd ring) and how close you need to be for the prompt. */
export const CYPHER_R = 4.6;
export const PROMPT_R = 6.5;
/** Players this close count as "at the cypher" (for 1v1 / crews). */
export const HERE_R = 12;

/** Candidates (x, z, yaw) in the order tried. */
export const CYPHER_CANDIDATES: readonly [number, number, number][] = [
  // The open floor north of the fountain, between Big Six and the Three Stair
  [0, -15, 0],
  [-14, -12, Math.PI / 4],
  [14, -12, -Math.PI / 4],
  // East side, between the fountain and QP Bay
  [16, 10, -Math.PI / 2],
  [-16, 9, Math.PI / 2],
];

/** Things to keep clear of: [x, z, radius]. */
export const CYPHER_AVOID: readonly [number, number, number][] = [
  [0, 0, 8.5], // Noggles Fountain
  // The Oracle's spots (missions/MissionSystem.ts PLAZA_SPOTS)
  [-8.5, 8.5, 2],
  [8.5, 8.5, 2],
  [-10, -8, 2],
  [10, -8, 2],
  [-6, 18, 2],
  // The ice cream van's spots (Game.placeIceCreamVan)
  [14, 40, 7],
  [-14, 42, 7],
  [16, 22, 7],
  [-16, 22, 7],
  [0, 44, 7],
  // Spawns
  [0, 11, 2.5],
  [0, 28, 2.5],
  [32, 3, 2.5],
  [-30, 15, 2.5],
];

/** Downward probe at (x, z): floor height and whether it's flat; null = nothing. */
export type Probe = (x: number, z: number) => { y: number; flat: boolean } | null;

/** Is the whole circle at (x, z) flat open floor, clear of everything to avoid? */
export function clearAt(
  x: number,
  z: number,
  probe: Probe,
  avoid: readonly [number, number, number][] = CYPHER_AVOID,
): number | null {
  const r = CYPHER_R + 0.6;
  for (const [ax, az, ar] of avoid) if (Math.hypot(x - ax, z - az) < r + ar) return null;
  let y0: number | null = null;
  const pts: [number, number][] = [[0, 0]];
  for (const [rr, n] of [
    [r * 0.5, 8],
    [r, 16],
  ] as const)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
  for (const [dx, dz] of pts) {
    const h = probe(x + dx, z + dz);
    if (h === null || !h.flat) return null;
    if (y0 === null) y0 = h.y;
    else if (Math.abs(h.y - y0) > 0.15) return null;
  }
  return y0;
}

/** The first clear candidate (null when none is). */
export function pickCypher(
  probe: Probe,
  cands: readonly [number, number, number][] = CYPHER_CANDIDATES,
): CypherSpot | null {
  for (const [x, z, yaw] of cands) {
    const y = clearAt(x, z, probe);
    if (y !== null) return { x, y, z, yaw };
  }
  return null;
}

/** Local (circle) → world. */
export function cypherToWorld(c: CypherSpot, lx: number, lz: number) {
  const cs = Math.cos(c.yaw);
  const sn = Math.sin(c.yaw);
  return { x: c.x + lx * cs + lz * sn, z: c.z - lx * sn + lz * cs };
}

/**
 * Where dancer `index` of a crew waits on the edge of the circle, and the
 * yaw facing the middle. Crews face each other across it.
 */
export function ringSlot(c: CypherSpot, crew: CrewId, index: number, size: CrewSize) {
  const side = crew === 0 ? -1 : 1;
  const spread = size === 1 ? 0 : (index - (size - 1) / 2) * 1.5;
  const lx = side * (CYPHER_R - 1.1);
  const p = cypherToWorld(c, lx, spread);
  return { x: p.x, y: c.y, z: p.z, yaw: Math.atan2(c.x - p.x, c.z - p.z) };
}

export const dist2d = (c: CypherSpot, x: number, z: number) => Math.hypot(x - c.x, z - c.z);

// ── The marker: a painted circle, a centre mark and a sign ──

function labelTexture(lines: string[], w: number, h: number, bg: string, fg: string) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');
  if (g) {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach((l, i) => {
      g.font = `italic 900 ${i === 0 ? h * 0.36 : h * 0.2}px system-ui, sans-serif`;
      g.fillText(l, w / 2, h * (lines.length === 1 ? 0.5 : i === 0 ? 0.4 : 0.76));
    });
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The cypher marker (world space). Returns the group and a per-frame pulse. */
export function buildCypherMarker(c: CypherSpot) {
  const g = new THREE.Group();
  g.name = 'break-cypher';
  g.position.set(c.x, c.y, c.z);
  g.rotation.y = c.yaw;
  const yellow = new THREE.MeshBasicMaterial({ color: 0xffd400, side: THREE.DoubleSide });
  const red = new THREE.MeshBasicMaterial({ color: 0xd22209, side: THREE.DoubleSide });
  const flat = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.renderOrder = 1;
    g.add(m);
    return m;
  };
  // The painted circle (a thick ring + a thin red one inside it) and the centre
  flat(new THREE.RingGeometry(CYPHER_R - 0.25, CYPHER_R, 64), yellow, 0.03);
  const pulse = flat(new THREE.RingGeometry(CYPHER_R - 0.55, CYPHER_R - 0.4, 64), red, 0.032);
  const mid = new THREE.MeshBasicMaterial({
    map: labelTexture(['⌐◨-◨'], 256, 256, '#d22209', '#ffd400'),
    side: THREE.DoubleSide,
  });
  flat(new THREE.CircleGeometry(0.9, 40), mid, 0.034);
  // The sign: a post and a double-sided board at the back of the circle
  const back = cypherToWorld({ ...c, x: 0, z: 0, yaw: 0 }, 0, -(CYPHER_R + 0.6));
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 2.4, 8),
    new THREE.MeshBasicMaterial({ color: 0x222222 }),
  );
  post.position.set(back.x, 1.2, back.z);
  g.add(post);
  // Two boards back to back, so it reads the right way round from either side
  const signMat = new THREE.MeshBasicMaterial({
    map: labelTexture(['NOUN BREAKS', 'BREAK BATTLE · E'], 512, 200, '#ffd400', '#000'),
  });
  const signGeo = new THREE.PlaneGeometry(2.6, 1);
  for (const face of [0, Math.PI]) {
    const board = new THREE.Mesh(signGeo, signMat);
    board.position.set(back.x, 2.55, back.z);
    board.rotation.y = face;
    g.add(board);
  }
  let t = 0;
  return {
    group: g,
    update(dt: number) {
      t += dt;
      const k = 1 + Math.sin(t * Math.PI * (100 / 60)) * 0.015;
      pulse.scale.set(k, k, 1);
    },
    dispose() {
      g.removeFromParent();
      g.traverse(o => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const m = o.material as THREE.MeshBasicMaterial;
          m.map?.dispose();
          m.dispose();
        }
      });
    },
  };
}
