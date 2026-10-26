// ── 3D Grand Exchange: the hall ──────────────────────────────────────────
//
// Floor, seven stepped pits with hanging boards, the central board tower
// with its ticker band and giant noggles, a balcony round the walls on
// columns, arched windows and an open truss roof (so the wide and aerial
// views see in). Static parts are merged per material, so the hall is a
// handful of draw calls, and a "lite" copy of it tiles out for VAST.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { getToonRamp } from '../../world2/render/Toon';
import {
  BALCONY_DEPTH,
  BALCONY_Y,
  HALL_D,
  HALL_W,
  PIT_R_IN,
  PIT_R_OUT,
  PIT_STEP_H,
  PIT_STEPS,
  PITS,
  TOWER_H,
  TOWER_HALF,
  WALL_H,
} from '../sim/layout';

import { drawGoodIcon, GOOD_COLOR, PitBoard, TickerBand, TowerBoard } from './boards';

const toon = (color: THREE.ColorRepresentation, extra: THREE.MeshToonMaterialParameters = {}) =>
  new THREE.MeshToonMaterial({ color, gradientMap: getToonRamp(), ...extra });

/** Geometry baked into world space, non-indexed (so anything merges with anything). */
function baked(g: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  const out = (g.index !== null ? g.toNonIndexed() : g.clone()).applyMatrix4(m);
  if (out.getAttribute('uv') === undefined) {
    out.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute(new Float32Array(out.getAttribute('position').count * 2), 2),
    );
  }
  for (const k of Object.keys(out.attributes))
    if (!['position', 'normal', 'uv'].includes(k)) out.deleteAttribute(k);
  return out;
}

const M = new THREE.Matrix4();
const box = (w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) =>
  baked(
    new THREE.BoxGeometry(w, h, d),
    M.compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry),
      new THREE.Vector3(1, 1, 1),
    ),
  );

/** A stepped octagonal pit: tiers rise from the floor to the rim. */
function pitGeometry(): THREE.BufferGeometry {
  const w = (PIT_R_OUT - PIT_R_IN) / PIT_STEPS;
  // Lathe radii are to the octagon's corners; the layout measures to its flats
  const k = 1 / Math.cos(Math.PI / 8);
  const pts: THREE.Vector2[] = [new THREE.Vector2(PIT_R_IN * k, 0)];
  for (let s = 1; s <= PIT_STEPS; s++) {
    const r = (PIT_R_IN + (s - 1) * w) * k;
    pts.push(new THREE.Vector2(r, (s - 1) * PIT_STEP_H), new THREE.Vector2(r, s * PIT_STEP_H));
  }
  pts.push(
    new THREE.Vector2(PIT_R_OUT * k, PIT_STEPS * PIT_STEP_H),
    new THREE.Vector2(PIT_R_OUT * k, 0),
  );
  // Lathe sweeps from +z; start at 22.5° so flats face the axes
  return new THREE.LatheGeometry(pts, 8, Math.PI / 8, Math.PI * 2);
}

function floorTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#2c3d35';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#35493f';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillRect(128, 128, 128, 128);
  ctx.strokeStyle = '#b8954a';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, 253, 253);
  ctx.strokeStyle = 'rgba(184,149,74,0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(128, 0);
  ctx.lineTo(128, 256);
  ctx.moveTo(0, 128);
  ctx.lineTo(256, 128);
  ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(HALL_W / 8, HALL_D / 8);
  t.anisotropy = 8;
  return t;
}

function wallTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#d9c7a0';
  ctx.fillRect(0, 0, 128, 256);
  // An arched window per bay, lit from outside
  ctx.fillStyle = '#ffeab0';
  ctx.beginPath();
  ctx.moveTo(34, 230);
  ctx.lineTo(34, 90);
  ctx.arc(64, 90, 30, Math.PI, 0);
  ctx.lineTo(94, 230);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#8c6d3a';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(64, 60);
  ctx.lineTo(64, 230);
  ctx.moveTo(34, 150);
  ctx.lineTo(94, 150);
  ctx.stroke();
  ctx.fillStyle = '#b39a6a';
  ctx.fillRect(0, 0, 128, 14);
  ctx.fillRect(0, 242, 128, 14);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function pitFloorTexture(good: (typeof PITS)[number]['good']): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1b1f24';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = GOOD_COLOR[good];
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1b1f24';
  ctx.beginPath();
  ctx.arc(64, 64, 48, 0, Math.PI * 2);
  ctx.fill();
  drawGoodIcon(ctx, good, 64, 64, 54);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface HallParts {
  /** The real hall (boards update). */
  group: THREE.Group;
  /** World-space parts and their flat colour, for the lite copies (VAST). */
  lite: { geo: THREE.BufferGeometry; color: THREE.ColorRepresentation }[];
  boards: PitBoard[];
  tower: TowerBoard;
  band: TickerBand;
  /** Board meshes (they bob a little). */
  boardMeshes: THREE.Mesh[];
}

export function buildHall(): HallParts {
  const group = new THREE.Group();
  group.name = 'gx3d-hall';
  const lite: HallParts['lite'] = [];
  const add = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    liteColor: THREE.ColorRepresentation | null = null,
  ) => {
    const m = new THREE.Mesh(geo, mat);
    m.matrixAutoUpdate = false;
    group.add(m);
    if (liteColor !== null) lite.push({ geo, color: liteColor });
    return m;
  };

  // ── Floor ──
  const floorGeo = new THREE.PlaneGeometry(HALL_W, HALL_D).rotateX(-Math.PI / 2);
  add(floorGeo, toon('#ffffff', { map: floorTexture() }), '#31443a');

  // ── Pits: tiers in each good's colour, an emblem on the pit floor ──
  const pitGeo = pitGeometry();
  for (const p of PITS) {
    const tint = new THREE.Color(GOOD_COLOR[p.good]).lerp(new THREE.Color('#e9dcc0'), 0.55);
    add(
      baked(pitGeo, M.makeTranslation(p.x, 0, p.z)),
      toon(tint, { side: THREE.DoubleSide }),
      tint,
    );
    const disc = new THREE.CircleGeometry(PIT_R_IN * 0.98, 8, Math.PI / 8).rotateX(-Math.PI / 2);
    add(
      baked(disc, M.makeTranslation(p.x, 0.02, p.z)),
      new THREE.MeshBasicMaterial({ map: pitFloorTexture(p.good) }),
      GOOD_COLOR[p.good],
    );
  }

  // ── Walls with arched windows (inside faces) ──
  const wallTex = wallTexture();
  const wallMat = (len: number) => {
    const t = wallTex.clone();
    t.repeat.set(len / 9, 1);
    t.needsUpdate = true;
    return toon('#ffffff', { map: t, side: THREE.DoubleSide });
  };
  const wall = (len: number, x: number, z: number, ry: number) => {
    const g = new THREE.PlaneGeometry(len, WALL_H);
    add(
      baked(
        g,
        M.compose(
          new THREE.Vector3(x, WALL_H / 2, z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry),
          new THREE.Vector3(1, 1, 1),
        ),
      ),
      wallMat(len),
    );
  };
  wall(HALL_W, 0, -HALL_D / 2, 0);
  wall(HALL_W, 0, HALL_D / 2, Math.PI);
  wall(HALL_D, -HALL_W / 2, 0, Math.PI / 2);
  wall(HALL_D, HALL_W / 2, 0, -Math.PI / 2);

  // ── Balcony, columns, railing (merged) ──
  const stone: THREE.BufferGeometry[] = [];
  const brass: THREE.BufferGeometry[] = [];
  const hw = HALL_W / 2;
  const hd = HALL_D / 2;
  const bd = BALCONY_DEPTH;
  stone.push(
    box(HALL_W, 0.6, bd, 0, BALCONY_Y - 0.3, hd - bd / 2),
    box(HALL_W, 0.6, bd, 0, BALCONY_Y - 0.3, -hd + bd / 2),
    box(bd, 0.6, HALL_D - 2 * bd, hw - bd / 2, BALCONY_Y - 0.3, 0),
    box(bd, 0.6, HALL_D - 2 * bd, -hw + bd / 2, BALCONY_Y - 0.3, 0),
  );
  for (let x = -hw + bd; x <= hw - bd + 0.1; x += 12) {
    for (const z of [hd - bd, -hd + bd]) {
      // Leave the door clear
      if (z < 0 && Math.abs(x) < 8) continue;
      stone.push(box(0.9, BALCONY_Y, 0.9, x, BALCONY_Y / 2, z));
    }
  }
  for (let z = -hd + bd + 12; z <= hd - bd - 0.1; z += 12)
    for (const x of [hw - bd, -hw + bd]) stone.push(box(0.9, BALCONY_Y, 0.9, x, BALCONY_Y / 2, z));
  const rail = (len: number, x: number, z: number, ry: number) =>
    brass.push(
      box(len, 0.12, 0.12, x, BALCONY_Y + 1.1, z, ry),
      box(len, 0.08, 0.08, x, BALCONY_Y + 0.55, z, ry),
    );
  rail(HALL_W - 2 * bd, 0, hd - bd, 0);
  rail(HALL_W - 2 * bd, 0, -hd + bd, 0);
  rail(HALL_D - 2 * bd, hw - bd, 0, Math.PI / 2);
  rail(HALL_D - 2 * bd, -hw + bd, 0, Math.PI / 2);
  for (let x = -hw + bd; x <= hw - bd; x += 2.5)
    for (const z of [hd - bd, -hd + bd]) brass.push(box(0.06, 1.1, 0.06, x, BALCONY_Y + 0.55, z));
  for (let z = -hd + bd; z <= hd - bd; z += 2.5)
    for (const x of [hw - bd, -hw + bd]) brass.push(box(0.06, 1.1, 0.06, x, BALCONY_Y + 0.55, z));
  // The door: a big brass frame on the −z wall
  brass.push(
    box(10, 0.8, 0.6, 0, 7, -hd + 0.3),
    box(0.8, 7, 0.6, -5, 3.5, -hd + 0.3),
    box(0.8, 7, 0.6, 5, 3.5, -hd + 0.3),
  );

  // ── Roof: open trusses (the aerial views look straight in) ──
  const steel: THREE.BufferGeometry[] = [];
  for (let x = -hw; x <= hw + 0.1; x += 10) steel.push(box(0.5, 1.2, HALL_D, x, WALL_H, 0));
  for (let z = -hd; z <= hd + 0.1; z += 13) steel.push(box(HALL_W, 0.4, 0.4, 0, WALL_H + 0.4, z));
  steel.push(
    box(HALL_W + 1, 1.6, 1, 0, WALL_H, hd),
    box(HALL_W + 1, 1.6, 1, 0, WALL_H, -hd),
    box(1, 1.6, HALL_D + 1, hw, WALL_H, 0),
    box(1, 1.6, HALL_D + 1, -hw, WALL_H, 0),
  );

  // ── Pit boards: hanging four-sided boards on cables ──
  const boards: PitBoard[] = [];
  const boardMeshes: THREE.Mesh[] = [];
  for (const p of PITS) {
    const b = new PitBoard(p.good);
    boards.push(b);
    const face = new THREE.MeshBasicMaterial({ map: b.tex });
    const frame = toon('#151a20');
    const geo = new THREE.BoxGeometry(7.2, 4, 7.2);
    const mesh = new THREE.Mesh(geo, [face, face, frame, frame, face, face]);
    mesh.position.set(p.x, 13.5, p.z);
    mesh.name = `board-${p.good}`;
    group.add(mesh);
    boardMeshes.push(mesh);
    for (const [dx, dz] of [
      [-3, -3],
      [3, 3],
      [-3, 3],
      [3, -3],
    ] as const)
      steel.push(box(0.06, WALL_H - 15.5, 0.06, p.x + dx, (WALL_H + 15.5) / 2, p.z + dz));
    // Lite copies get a block in the good's colour where the board hangs
    lite.push({ geo: baked(geo, M.makeTranslation(p.x, 13.5, p.z)), color: GOOD_COLOR[p.good] });
  }

  // ── The central tower: four screens, a ticker band, giant noggles ──
  const tower = new TowerBoard();
  const band = new TickerBand();
  const tw = TOWER_HALF * 2;
  const screen = new THREE.MeshBasicMaterial({ map: tower.tex });
  const towerFrame = toon('#20262e');
  const towerGeo = new THREE.BoxGeometry(tw, TOWER_H - 4, tw);
  const towerMesh = new THREE.Mesh(towerGeo, [
    screen,
    screen,
    towerFrame,
    towerFrame,
    screen,
    screen,
  ]);
  towerMesh.position.set(0, 4 + (TOWER_H - 4) / 2, 0);
  group.add(towerMesh);
  lite.push({
    geo: baked(towerGeo, M.makeTranslation(0, 4 + (TOWER_H - 4) / 2, 0)),
    color: '#2a3442',
  });
  stone.push(box(tw + 2, 4, tw + 2, 0, 2, 0));
  const bandGeo = new THREE.CylinderGeometry(TOWER_HALF * 1.5, TOWER_HALF * 1.5, 1.6, 32, 1, true);
  const bandMat = new THREE.MeshBasicMaterial({ map: band.tex, side: THREE.DoubleSide });
  band.tex.repeat.set(3, 1);
  const bandMesh = new THREE.Mesh(bandGeo, bandMat);
  bandMesh.position.set(0, 6.2, 0);
  group.add(bandMesh);
  // Giant noggles on top: two lenses and a bridge in the canonical red
  const red = toon('#f3322c', { emissive: new THREE.Color('#5a0d0a') });
  const nog: THREE.BufferGeometry[] = [];
  const ny = TOWER_H + 3.5;
  for (const sx of [-1, 1]) {
    const cx = sx * 4.2;
    nog.push(
      box(6, 1, 1, cx, ny + 2.5, 0),
      box(6, 1, 1, cx, ny - 2.5, 0),
      box(1, 6, 1, cx - 2.5, ny, 0),
      box(1, 6, 1, cx + 2.5, ny, 0),
    );
  }
  nog.push(
    box(2.4, 1, 1, 0, ny + 0.5, 0),
    box(4, 1, 1, -8.2, ny + 0.5, 0),
    box(1, 3, 1, -10.2, ny - 0.5, 0),
  );
  const lensW = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const lensB = new THREE.MeshBasicMaterial({ color: '#000000' });
  const lw: THREE.BufferGeometry[] = [];
  const lb: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    const cx = sx * 4.2;
    lw.push(box(2, 4, 0.8, cx - 1, ny, 0));
    lb.push(box(2, 4, 0.8, cx + 1, ny, 0));
  }
  add(mergeGeometries(nog)!, red, '#f3322c');
  add(mergeGeometries(lw)!, lensW);
  add(mergeGeometries(lb)!, lensB);

  add(mergeGeometries(stone)!, toon('#cdb88f'), '#cdb88f');
  add(mergeGeometries(brass)!, toon('#d6a84a'));
  add(mergeGeometries(steel)!, toon('#3a4048'), '#3a4048');

  // Lite copies need walls too: one merged low wall ring at balcony height
  const liteWalls = mergeGeometries([
    box(HALL_W, WALL_H, 0.5, 0, WALL_H / 2, hd),
    box(HALL_W, WALL_H, 0.5, 0, WALL_H / 2, -hd),
    box(0.5, WALL_H, HALL_D, hw, WALL_H / 2, 0),
    box(0.5, WALL_H, HALL_D, -hw, WALL_H / 2, 0),
  ])!;
  lite.push({ geo: liteWalls, color: '#d9c7a0' });

  for (const m of group.children) m.updateMatrix();
  return { group, lite, boards, tower, band, boardMeshes };
}

/**
 * The lite hall for VAST: every lite part merged into one geometry with
 * vertex colours, so a copy is a single draw call. Build once, share it.
 */
export function liteHallGeometry(parts: HallParts): THREE.BufferGeometry {
  const c = new THREE.Color();
  const geos = parts.lite.map(({ geo, color }) => {
    const g = geo.index !== null ? geo.toNonIndexed() : geo.clone();
    c.set(color);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  });
  return mergeGeometries(geos)!;
}

export const liteHallMaterial = () =>
  new THREE.MeshToonMaterial({
    vertexColors: true,
    gradientMap: getToonRamp(),
    side: THREE.DoubleSide,
  });

/** The city outside: a big ground with avenues between the halls. */
export function buildGround(): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#3b3f46';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#4a4f57';
  ctx.fillRect(0, 0, 64, 4);
  ctx.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(200, 200);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(8000, 8000).rotateX(-Math.PI / 2),
    toon('#ffffff', { map: t }),
  );
  m.position.y = -0.05;
  return m;
}
