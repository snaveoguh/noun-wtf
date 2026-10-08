// ── Procedural fallback skatepark ────────────────────────────────────────
//
// Built entirely in code so the game is always playable even if the
// Blender-baked level (public/world2/level/*) fails to load. Also doubles
// as a reference layout for obstacle dimensions the skate physics expects.

import type { LevelData } from './Level';
import type { RailDef } from '../physics/Rails';

import * as THREE from 'three';

import { SURFACES, applyBoxUVs } from './proceduralTextures';

interface Builder {
  root: THREE.Group;
  collision: THREE.Mesh[];
  rails: RailDef[];
  railId: number;
}

const mats = {
  plaza: () =>
    new THREE.MeshStandardMaterial({ map: SURFACES.plazaTile(), roughness: 0.82, metalness: 0 }),
  concrete: () =>
    new THREE.MeshStandardMaterial({ map: SURFACES.concrete(), roughness: 0.78, metalness: 0 }),
  asphalt: () =>
    new THREE.MeshStandardMaterial({ map: SURFACES.asphalt(), roughness: 0.92, metalness: 0 }),
  granite: () =>
    new THREE.MeshStandardMaterial({ map: SURFACES.granite(), roughness: 0.55, metalness: 0 }),
  stucco: (tint: number) =>
    new THREE.MeshStandardMaterial({ map: SURFACES.stucco(), color: tint, roughness: 0.9 }),
  grass: () => new THREE.MeshStandardMaterial({ map: SURFACES.grass(), roughness: 1 }),
  metal: (color = 0x9aa3ad) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.9 }),
  paint: (color: number) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1 }),
};

function addMesh(
  b: Builder,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  pos: [number, number, number],
  rotY = 0,
  opts: { collide?: boolean; uvScale?: number; castShadow?: boolean } = {},
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(pos[0], pos[1], pos[2]);
  m.rotation.y = rotY;
  m.updateMatrixWorld(true);
  if (opts.uvScale !== 0) applyBoxUVs(m.geometry, m.matrixWorld, opts.uvScale ?? 0.35);
  m.castShadow = opts.castShadow ?? true;
  m.receiveShadow = true;
  b.root.add(m);
  if (opts.collide !== false) b.collision.push(m);
  return m;
}

/** Rail from local points under a transform. */
function addRail(
  b: Builder,
  type: RailDef['type'],
  local: [number, number, number][],
  pos: THREE.Vector3,
  rotY: number,
) {
  const m = new THREE.Matrix4().compose(
    pos,
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
    new THREE.Vector3(1, 1, 1),
  );
  const pts = local.map(p => {
    const v = new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(m);
    return [v.x, v.y, v.z] as [number, number, number];
  });
  b.rails.push({ id: `rail_${b.railId++}`, type, points: pts });
}

/** Box ledge with both top edges grindable. Length runs along local Z. */
function ledge(
  b: Builder,
  x: number,
  z: number,
  rotY: number,
  w: number,
  h: number,
  len: number,
  mat = mats.granite(),
) {
  addMesh(b, new THREE.BoxGeometry(w, h, len), mat, [x, h / 2, z], rotY);
  // Metal edge caps
  const cap = mats.metal(0x6f7780);
  for (const sx of [-1, 1]) {
    const capMesh = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, len), cap);
    const off = new THREE.Vector3(sx * (w / 2 - 0.02), h - 0.02, 0).applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      rotY,
    );
    capMesh.position.set(x + off.x, off.y + 0.003, z + off.z);
    capMesh.rotation.y = rotY;
    b.root.add(capMesh);
    addRail(
      b,
      'ledge',
      [
        [sx * (w / 2 - 0.03), h, -len / 2],
        [sx * (w / 2 - 0.03), h, len / 2],
      ],
      new THREE.Vector3(x, 0, z),
      rotY,
    );
  }
}

/** Round flat bar / handrail between two local points (rail top at given heights). */
function rail(b: Builder, a: THREE.Vector3, c: THREE.Vector3, type: RailDef['type'] = 'rail') {
  const dir = new THREE.Vector3().subVectors(c, a);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(0.03, 0.03, len, 10);
  geo.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(geo, mats.metal(0xc23a2b));
  m.position.copy(a).add(c).multiplyScalar(0.5);
  m.lookAt(c);
  m.castShadow = true;
  b.root.add(m);
  // Posts
  const posts = Math.max(2, Math.round(len / 2.2) + 1);
  for (let i = 0; i < posts; i++) {
    const p = new THREE.Vector3().lerpVectors(a, c, i / (posts - 1));
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, p.y, 8),
      mats.metal(0x3b3f45),
    );
    post.position.set(p.x, p.y / 2, p.z);
    post.castShadow = true;
    b.root.add(post);
  }
  b.rails.push({
    id: `rail_${b.railId++}`,
    type,
    points: [
      [a.x, a.y + 0.03, a.z],
      [c.x, c.y + 0.03, c.z],
    ],
  });
}

/** Quarter pipe; riders approach along local +X. pos = ramp start on the floor. */
function quarterPipe(
  b: Builder,
  pos: THREE.Vector3,
  rotY: number,
  width: number,
  radius: number,
  height: number,
) {
  const deck = 1.6;
  const amax = Math.acos(1 - height / radius);
  const uEnd = radius * Math.sin(amax);
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(uEnd + deck, 0);
  shape.lineTo(uEnd + deck, height);
  shape.lineTo(uEnd, height);
  const segs = 24;
  for (let i = segs; i >= 0; i--) {
    const a = (i / segs) * amax;
    shape.lineTo(radius * Math.sin(a), radius - radius * Math.cos(a));
  }
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geo.translate(0, 0, -width / 2);
  addMesh(b, geo, mats.concrete(), [pos.x, pos.y, pos.z], rotY, { uvScale: 0.3 });
  // Coping pipe
  const cop = new THREE.CylinderGeometry(0.05, 0.05, width, 12);
  cop.rotateX(Math.PI / 2);
  const cm = new THREE.Mesh(cop, mats.metal(0xb7bec6));
  const off = new THREE.Vector3(uEnd + 0.02, height, 0).applyAxisAngle(
    new THREE.Vector3(0, 1, 0),
    rotY,
  );
  cm.position.set(pos.x + off.x, pos.y + off.y, pos.z + off.z);
  cm.rotation.y = rotY;
  cm.castShadow = true;
  b.root.add(cm);
  addRail(
    b,
    'coping',
    [
      [uEnd + 0.03, height + 0.03, -width / 2],
      [uEnd + 0.03, height + 0.03, width / 2],
    ],
    pos,
    rotY,
  );
}

/** Wedge bank / kicker. Riders approach along local +X; rises to height over length. */
function wedge(
  b: Builder,
  pos: THREE.Vector3,
  rotY: number,
  width: number,
  length: number,
  height: number,
  flat = 0,
  curved = false,
) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(length + flat, 0);
  shape.lineTo(length + flat, height);
  shape.lineTo(length, height);
  if (curved) {
    const segs = 10;
    for (let i = segs; i >= 0; i--) {
      const t = i / segs;
      shape.lineTo(length * t, height * t * t);
    }
  } else {
    shape.lineTo(0, 0);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geo.translate(0, 0, -width / 2);
  addMesh(b, geo, mats.concrete(), [pos.x, pos.y, pos.z], rotY, { uvScale: 0.3 });
}

/** Stair set going DOWN along local +X from a platform at `top` height. */
function stairs(
  b: Builder,
  pos: THREE.Vector3,
  rotY: number,
  width: number,
  steps: number,
  rise: number,
  run: number,
) {
  const top = steps * rise;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0, top);
  for (let i = 0; i < steps; i++) {
    shape.lineTo(i * run + run, top - i * rise);
    shape.lineTo(i * run + run, top - (i + 1) * rise);
  }
  shape.lineTo(0, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geo.translate(0, 0, -width / 2);
  addMesh(b, geo, mats.granite(), [pos.x, pos.y, pos.z], rotY, { uvScale: 0.5 });
  return { top, length: steps * run };
}

function noggles(b: Builder, pos: THREE.Vector3, scale: number) {
  const red = mats.paint(0xd22209);
  const white = mats.paint(0xffffff);
  const black = mats.paint(0x0b0b0b);
  const g = new THREE.Group();
  const px = (x: number, y: number, w: number, h: number, m: THREE.Material, d = 1) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x + w / 2, y + h / 2, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  };
  // Pixel noggles: two 6x6 frames, lens halves, bridge + left arm.
  for (const ox of [0, 8]) {
    px(ox, 0, 6, 1, red);
    px(ox, 5, 6, 1, red);
    px(ox, 1, 1, 4, red);
    px(ox + 5, 1, 1, 4, red);
    px(ox + 1, 1, 2, 4, white, 0.8);
    px(ox + 3, 1, 2, 4, black, 0.8);
  }
  px(6, 3, 2, 1, red);
  px(-3, 3, 3, 1, red);
  px(-3, 1, 1, 2, red);
  g.scale.setScalar(scale);
  g.position.copy(pos);
  b.root.add(g);
}

function building(
  b: Builder,
  x: number,
  z: number,
  w: number,
  d: number,
  h: number,
  tint: number,
  rotY = 0,
) {
  const m = addMesh(b, new THREE.BoxGeometry(w, h, d), mats.stucco(tint), [x, h / 2, z], rotY, {
    uvScale: 0.2,
  });
  // Window rows (emissive strips) on the face toward the park
  const winMat = new THREE.MeshStandardMaterial({
    color: 0x223344,
    roughness: 0.15,
    metalness: 0.6,
    emissive: 0x111822,
  });
  const rows = Math.floor((h - 2) / 3);
  for (let r = 0; r < rows; r++) {
    const wm = new THREE.Mesh(new THREE.BoxGeometry(w * 0.86, 1.2, d + 0.06), winMat);
    wm.position.set(0, -h / 2 + 2.6 + r * 3, 0);
    m.add(wm);
  }
}

function tree(b: Builder, x: number, z: number, s: number) {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12 * s, 0.2 * s, 3.2 * s, 7),
    new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 }),
  );
  trunk.position.set(x, 1.6 * s, z);
  trunk.castShadow = true;
  b.root.add(trunk);
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0x3f7a35,
    roughness: 0.9,
    flatShading: true,
  });
  for (let i = 0; i < 4; i++) {
    const blob = new THREE.Mesh(
      new THREE.IcosahedronGeometry((1.1 + Math.random() * 0.5) * s, 0),
      leafMat,
    );
    blob.position.set(
      x + (Math.random() - 0.5) * 1.4 * s,
      (3.4 + Math.random() * 1.2) * s,
      z + (Math.random() - 0.5) * 1.4 * s,
    );
    blob.castShadow = true;
    b.root.add(blob);
  }
  // Trunk collision (thin box)
  const col = new THREE.Mesh(new THREE.BoxGeometry(0.4 * s, 3 * s, 0.4 * s));
  col.position.set(x, 1.5 * s, z);
  col.updateMatrixWorld(true);
  b.collision.push(col);
}

function lamp(b: Builder, x: number, z: number) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 5, 8), mats.metal(0x2c3036));
  pole.position.set(x, 2.5, z);
  pole.castShadow = true;
  b.root.add(pole);
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.15, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffe2b0, emissiveIntensity: 0.6 }),
  );
  head.position.set(x + 0.25, 5, z);
  b.root.add(head);
  const col = new THREE.Mesh(new THREE.BoxGeometry(0.2, 5, 0.2));
  col.position.set(x, 2.5, z);
  col.updateMatrixWorld(true);
  b.collision.push(col);
}

export function buildFallbackPark(): LevelData {
  const b: Builder = { root: new THREE.Group(), collision: [], rails: [], railId: 0 };
  b.root.name = 'FallbackPark';
  const Y = 0;
  const up = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // ── Ground ───────────────────────────────────────────────
  const ground = new THREE.PlaneGeometry(90, 110);
  ground.rotateX(-Math.PI / 2);
  addMesh(b, ground, mats.plaza(), [0, Y, -5], 0, { castShadow: false, uvScale: 0.25 });
  const street = new THREE.PlaneGeometry(260, 260);
  street.rotateX(-Math.PI / 2);
  addMesh(b, street, mats.asphalt(), [0, Y - 0.02, 0], 0, { castShadow: false, uvScale: 0.15 });
  // Curb lip around the plaza (grindable)
  const curbH = 0.14;
  for (const [x, z, w, d] of [
    [0, 50, 90, 0.3],
    [0, -60, 90, 0.3],
    [45, -5, 0.3, 110],
    [-45, -5, 0.3, 110],
  ] as const) {
    addMesh(b, new THREE.BoxGeometry(w, curbH, d), mats.concrete(), [x, curbH / 2, z], 0);
  }
  b.rails.push({
    id: 'curb_s',
    type: 'curb',
    points: [
      [-45, curbH, 50.15],
      [45, curbH, 50.15],
    ],
  });
  b.rails.push({
    id: 'curb_w',
    type: 'curb',
    points: [
      [-45.15, curbH, -60],
      [-45.15, curbH, 50],
    ],
  });
  b.rails.push({
    id: 'curb_e',
    type: 'curb',
    points: [
      [45.15, curbH, -60],
      [45.15, curbH, 50],
    ],
  });

  // ── Street section: ledges + manual pads + flat bar ──────
  ledge(b, -7, 4, 0, 0.55, 0.45, 9);
  ledge(b, -13, -2, 0.35, 0.5, 0.35, 7, mats.concrete());
  addMesh(b, new THREE.BoxGeometry(3.2, 0.2, 7), mats.granite(), [7, 0.1, 4], 0);
  b.rails.push({
    id: 'manual_l',
    type: 'ledge',
    points: [
      [5.42, 0.2, 0.5],
      [5.42, 0.2, 7.5],
    ],
  });
  b.rails.push({
    id: 'manual_r',
    type: 'ledge',
    points: [
      [8.58, 0.2, 0.5],
      [8.58, 0.2, 7.5],
    ],
  });
  rail(b, up(0, 0.38, 9), up(0, 0.38, -1));
  rail(b, up(14, 0.3, 10), up(14, 0.3, 2));
  // Kinked rail on a mellow drop is built with the stairs below.

  // ── Raised platform + 6-stair + handrail + hubba + bank ──
  const platTop = 6 * 0.2;
  addMesh(b, new THREE.BoxGeometry(30, platTop, 18), mats.plaza(), [0, platTop / 2, -33], 0, {
    uvScale: 0.25,
  });
  b.rails.push({
    id: 'plat_edge_w',
    type: 'ledge',
    points: [
      [-15, platTop, -24.02],
      [-4.95, platTop, -24.02],
    ],
  });
  // Stairs descend toward +Z (local +X → world +Z with rotY=-π/2)
  stairs(b, up(0, 0, -24), -Math.PI / 2, 8, 6, 0.2, 0.36);
  // Handrail down the centre, 0.85 m above the stair nosing line
  const nose = (x: number) => platTop - (x - 0.36) * (1.0 / 1.8) + 0.85;
  rail(b, up(0, nose(-0.3), -24.3), up(0, nose(2.76), -24 + 2.76));
  // Hubba (sloped ledge) on the left side of the stairs
  {
    const len = 6 * 0.36;
    const shape = new THREE.Shape();
    shape.moveTo(0, platTop + 0.45);
    shape.lineTo(len + 0.4, 0.45);
    shape.lineTo(len + 0.4, 0);
    shape.lineTo(0, 0);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: false });
    geo.translate(0, 0, -0.3);
    addMesh(b, geo, mats.granite(), [-4.6, 0, -24], -Math.PI / 2, { uvScale: 0.5 });
    b.rails.push({
      id: 'hubba',
      type: 'ledge',
      points: [
        [-4.33, platTop + 0.45, -24],
        [-4.33, 0.45, -24 + len + 0.4],
      ],
    });
  }
  // Bank up to the platform on the right
  wedge(b, up(7.5, 0, -15), Math.PI / 2, 6, 9, platTop);
  // Ledges + noggles sculpture on the platform
  ledge(b, -10, -33, Math.PI / 2, 0.6, 0.5, 8);
  noggles(b, up(2, platTop, -40), 0.55);
  addMesh(b, new THREE.BoxGeometry(9.5, 0.4, 2), mats.granite(), [4.5, platTop + 0.2, -40], 0);

  // ── Quarter pipe bay ─────────────────────────────────────
  quarterPipe(b, up(26, 0, 0), 0, 14, 3.2, 2.3);
  quarterPipe(b, up(-26, 0, 0), Math.PI, 14, 3.2, 2.3);
  // Mini kicker + funbox
  wedge(b, up(-16, 0, 20), Math.PI / 2, 2.4, 2.4, 0.55, 0, true);
  {
    // Funbox: up-bank, flat top with ledge edges, down-bank
    const fx = 18;
    const fz = 24;
    wedge(b, up(fx - 4.5, 0, fz), 0, 5, 2.8, 0.7);
    addMesh(b, new THREE.BoxGeometry(3.4, 0.7, 5), mats.concrete(), [fx, 0.35, fz], 0);
    wedge(b, up(fx + 4.5, 0, fz), Math.PI, 5, 2.8, 0.7);
    b.rails.push({
      id: 'fb_n',
      type: 'ledge',
      points: [
        [fx - 1.7, 0.7, fz - 2.48],
        [fx + 1.7, 0.7, fz - 2.48],
      ],
    });
    b.rails.push({
      id: 'fb_s',
      type: 'ledge',
      points: [
        [fx - 1.7, 0.7, fz + 2.48],
        [fx + 1.7, 0.7, fz + 2.48],
      ],
    });
  }

  // ── Mini bowl-ish double QP (mini ramp) ──────────────────
  quarterPipe(b, up(-30, 0, 34), Math.PI, 8, 2.2, 1.3);
  quarterPipe(b, up(-22, 0, 34), 0, 8, 2.2, 1.3);

  // ── Surroundings ─────────────────────────────────────────
  const tints = [0xf2c6a0, 0xc8e0e8, 0xf0e2b8, 0xe7b9b9, 0xcfd9b8, 0xe0d0f0];
  let ti = 0;
  for (let x = -80; x <= 80; x += 22) {
    building(b, x, -96, 18, 14, 10 + ((((x * 7) % 9) + 9) % 9), tints[ti++ % tints.length]);
    building(b, x, 86, 18, 14, 9 + ((((x * 5) % 7) + 7) % 7), tints[ti++ % tints.length]);
  }
  for (let z = -70; z <= 60; z += 22) {
    building(b, -92, z, 14, 18, 12, tints[ti++ % tints.length]);
    building(b, 92, z, 14, 18, 11, tints[ti++ % tints.length]);
  }
  for (const [x, z] of [
    [-40, 46],
    [-30, 46],
    [30, 46],
    [40, 46],
    [-40, -56],
    [40, -56],
    [-40, -10],
    [40, -10],
    [40, 20],
  ] as const) {
    tree(b, x, z, 1 + ((x + z) % 3) * 0.1);
  }
  for (const [x, z] of [
    [-20, 44],
    [20, 44],
    [-36, 0],
    [36, 18],
    [-20, -50],
    [20, -50],
  ] as const)
    lamp(b, x, z);

  // Invisible boundary walls
  for (const [x, z, w, d] of [
    [0, 75, 200, 1],
    [0, -85, 200, 1],
    [80, 0, 1, 200],
    [-80, 0, 1, 200],
  ] as const) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 8, d));
    wall.position.set(x, 4, z);
    wall.updateMatrixWorld(true);
    b.collision.push(wall);
  }

  return {
    root: b.root,
    collisionMeshes: b.collision,
    rails: b.rails,
    spawns: [{ position: new THREE.Vector3(0, 0, 30), yaw: Math.PI }],
    sun: {
      direction: new THREE.Vector3(-0.45, -0.75, 0.48).normalize(),
      color: new THREE.Color(0xfff1dc),
      intensity: 3.2,
    },
    sky: { zenith: new THREE.Color(0x3d7fd6), horizon: new THREE.Color(0xcfe3f5) },
    fog: { color: new THREE.Color(0xc9dcec), density: 0.0016 },
    landmarks: [
      { name: 'Noggles Plaza', position: new THREE.Vector3(4, platTop, -36) },
      { name: 'QP Bay', position: new THREE.Vector3(22, 0, 0) },
      { name: 'Mini Ramp', position: new THREE.Vector3(-26, 0, 34) },
    ],
    bounds: new THREE.Box3(new THREE.Vector3(-80, -5, -85), new THREE.Vector3(80, 40, 75)),
    baked: false,
  };
}
