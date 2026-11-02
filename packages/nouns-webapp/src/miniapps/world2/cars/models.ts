// ── The fleet's models: box-and-wedge cars in the house style ──────────────
//
// Six cars are built here from chunky flat-coloured parts (kit.ts); two
// more are converted Kenney Car Kit bodies (kenneyModel.ts, CC0) wearing
// these same wheels. Every model has the same rig, so driving, traffic and
// the network treat them alike:
//   group     origin on the ground between the axles' midpoint, +Z forward,
//             +X the driver's left (the van's convention);
//   wheels    FL, FR, RL, RR: a pivot (suspension + steer) and a spinner;
//   doors     hinged panels (cars/doors.ts sets the angle);
//   thrusters ROADSTAR's flames (shown in flight), else null;
//   driver    the AI driver, a little Noun in the seat (traffic only).
// Wheel and body geometry is cached per car + paint, so traffic of the same
// model shares buffers.

import type { CarId, CarSpec } from './specs';

import * as THREE from 'three';

import { inkExcluded } from '../render/Toon';

import { carMaterials, Kit } from './kit';

export interface WheelRig {
  pivot: THREE.Object3D;
  spinner: THREE.Object3D;
  restY: number;
  front: boolean;
  left: boolean;
}

export interface DoorRig {
  pivot: THREE.Object3D;
  left: boolean;
}

export interface CarModel {
  spec: CarSpec;
  paint: number;
  group: THREE.Group;
  wheels: WheelRig[];
  doors: DoorRig[];
  thrusters: THREE.Object3D | null;
  driver: THREE.Object3D;
}

// Palette shared by the trims (paint comes from the spec)
const DARK = 0x1d1f24;
const GLASS = 0x2c4656;
const CHROME = 0xd7dde2;
const WHITE = 0xf4f1ea;
const TYRE = 0x232624;
const LAMP = 0xfff3c4;
const TAIL = 0xff2d3a;
const FLAME = 0x7fe9ff;

type V3 = [number, number, number];

interface Built {
  body: THREE.BufferGeometry;
  doors: { geo: THREE.BufferGeometry; at: V3; left: boolean }[];
  flames: THREE.BufferGeometry | null;
}

const bodyCache = new Map<string, Built>();
const wheelCache = new Map<string, THREE.BufferGeometry>();
let driverGeo: THREE.BufferGeometry | null = null;

/** A car's paint (hex) for a paint index (wraps). */
export function paintHex(spec: CarSpec, i: number): number {
  return spec.paints[((i % spec.paints.length) + spec.paints.length) % spec.paints.length];
}

/** Build a procedural car (not the Kenney ones: see kenneyModel.ts). */
export function buildCar(spec: CarSpec, paint = 0): CarModel {
  const key = `${spec.id}:${paint}`;
  let b = bodyCache.get(key);
  if (b === undefined) {
    b = BUILDERS[spec.id](spec, paintHex(spec, paint));
    bodyCache.set(key, b);
  }
  const [pm, gm] = carMaterials();
  const group = new THREE.Group();
  group.name = `car-${spec.id}`;
  const body = new THREE.Mesh(b.body, [pm, gm]);
  body.name = 'car-body';
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  const doors: DoorRig[] = [];
  for (const d of b.doors) {
    const pivot = new THREE.Object3D();
    pivot.position.set(...d.at);
    const m = new THREE.Mesh(d.geo, [pm, gm]);
    m.castShadow = true;
    pivot.add(m);
    group.add(pivot);
    doors.push({ pivot, left: d.left });
  }
  let thrusters: THREE.Object3D | null = null;
  if (b.flames !== null) {
    const fl = new THREE.Mesh(b.flames, [gm, gm]);
    fl.visible = false;
    fl.name = 'car-flames';
    inkExcluded.add(fl);
    group.add(fl);
    thrusters = fl;
  }
  const model: CarModel = {
    spec,
    paint,
    group,
    wheels: addWheels(group, spec),
    doors,
    thrusters,
    driver: addDriver(group, spec),
  };
  return model;
}

/** FL, FR, RL, RR wheel rigs at the spec's axles (shared by the Kenney cars). */
export function addWheels(group: THREE.Object3D, spec: CarSpec): WheelRig[] {
  const g = spec.geo;
  const geo = wheelGeo(spec);
  const [pm, gm] = carMaterials();
  const out: WheelRig[] = [];
  for (const [front, z] of [
    [true, g.axleF],
    [false, g.axleR],
  ] as const) {
    for (const left of [true, false]) {
      const pivot = new THREE.Object3D();
      pivot.position.set(left ? g.halfTrack : -g.halfTrack, g.wheelR, z);
      const spinner = new THREE.Object3D();
      const m = new THREE.Mesh(geo, [pm, gm]);
      m.castShadow = true;
      // the hub face looks outward on both sides
      if (!left) m.rotation.y = Math.PI;
      spinner.add(m);
      pivot.add(spinner);
      group.add(pivot);
      out.push({ pivot, spinner, restY: g.wheelR, front, left });
    }
  }
  return out;
}

// ── Wheels ──

function wheelGeo(spec: CarSpec): THREE.BufferGeometry {
  const g = spec.geo;
  const key = `${spec.id}`;
  const hit = wheelCache.get(key);
  if (hit !== undefined) return hit;
  const k = new Kit();
  const r = g.wheelR;
  const w = g.wheelW;
  switch (spec.id) {
    case 'cavallino': {
      // Skinny tyre, wire wheel with a knock-off spinner
      k.cyl(TYRE, r, w, [0, 0, 0], 'x', 12);
      k.cyl(0xc9c3b0, r * 0.7, w * 1.04, [0, 0, 0], 'x', 10);
      k.cyl(CHROME, r * 0.2, w * 1.5, [0, 0, 0], 'x', 6);
      k.box(CHROME, [w * 0.4, r * 0.55, 0.05], [w * 0.75, 0, 0]);
      break;
    }
    case 'dip': {
      // Thin whitewall, gold wire rims
      k.cyl(TYRE, r, w, [0, 0, 0], 'x', 12);
      k.cyl(WHITE, r * 0.82, w * 1.02, [0, 0, 0], 'x', 12);
      k.cyl(0xf2c14e, r * 0.62, w * 1.06, [0, 0, 0], 'x', 10);
      k.cyl(CHROME, r * 0.22, w * 1.4, [0, 0, 0], 'x', 6);
      break;
    }
    case 'stompa': {
      // Fat tyre with chunky tread blocks, a dish rim
      k.cyl(TYRE, r * 0.93, w, [0, 0, 0], 'x', 12);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        k.box(
          0x2e322f,
          [w * 1.02, r * 0.16, r * 0.28],
          [0, Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92],
          { rot: [-a, 0, 0] },
        );
      }
      k.cyl(CHROME, r * 0.5, w * 1.04, [0, 0, 0], 'x', 10);
      k.cyl(DARK, r * 0.18, w * 1.2, [0, 0, 0], 'x', 6);
      break;
    }
    case 'roadstar': {
      // Turbine aero discs
      k.cyl(TYRE, r, w, [0, 0, 0], 'x', 12);
      k.cyl(0x8d949b, r * 0.74, w * 1.04, [0, 0, 0], 'x', 12);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        k.box(
          DARK,
          [0.03, r * 0.5, 0.06],
          [w * 0.53, Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4],
          {
            rot: [-a, 0, 0.4],
          },
        );
      }
      break;
    }
    default: {
      k.cyl(TYRE, r, w, [0, 0, 0], 'x', 12);
      k.cyl(spec.id === 'toro' ? 0x3a3d42 : CHROME, r * 0.66, w * 1.04, [0, 0, 0], 'x', 10);
      k.cyl(DARK, r * 0.2, w * 1.1, [0, 0, 0], 'x', 6);
    }
  }
  const geo = k.build();
  wheelCache.set(key, geo);
  return geo;
}

// ── The AI driver: a little Noun (box body, cube head, noggles) ──

export function addDriver(group: THREE.Object3D, spec: CarSpec): THREE.Object3D {
  if (driverGeo === null) {
    const k = new Kit();
    k.box(0x3a7bd5, [0.42, 0.5, 0.26], [0, 0.25, 0]); // torso
    k.box(0xe9b38a, [0.1, 0.36, 0.1], [0.27, 0.32, 0.12], { rot: [-1.1, 0, 0] }); // arms to the wheel
    k.box(0xe9b38a, [0.1, 0.36, 0.1], [-0.27, 0.32, 0.12], { rot: [-1.1, 0, 0] });
    k.box(0xf2c14e, [0.48, 0.42, 0.44], [0, 0.72, 0]); // the cube head
    // ⌐◨-◨
    k.box(0xe8352c, [0.56, 0.05, 0.04], [0, 0.78, 0.25]);
    for (const x of [-0.13, 0.13]) {
      k.box(0xe8352c, [0.2, 0.16, 0.05], [x, 0.75, 0.25]);
      k.box(WHITE, [0.08, 0.1, 0.02], [x + 0.04, 0.75, 0.28]);
      k.box(0x111111, [0.07, 0.1, 0.02], [x - 0.04, 0.75, 0.28]);
    }
    k.box(0xe8352c, [0.05, 0.05, 0.22], [0.29, 0.78, 0.15]); // arm of the frame
    driverGeo = k.build();
  }
  const [pm, gm] = carMaterials();
  const m = new THREE.Mesh(driverGeo, [pm, gm]);
  m.name = 'car-driver';
  m.castShadow = true;
  const s = spec.geo.seat;
  m.position.set(s[0], s[1], s[2]);
  // the monster truck's cab is tall; the bubble car's is tiny
  m.scale.setScalar(spec.id === 'bubble' ? 0.85 : 1);
  m.visible = false;
  group.add(m);
  return m;
}

// ── Bodies ──

type Builder = (s: CarSpec, paint: number) => Built;

function doorPanel(build: (k: Kit) => void): THREE.BufferGeometry {
  const k = new Kit();
  build(k);
  return k.build();
}

/** ROADSTAR: low electric roadster, targa bar, turbine wheels, rear + belly thrusters. */
function roadstar(s: CarSpec, P: number): Built {
  const k = new Kit();
  const L = s.geo.length / 2;
  k.box(P, [1.94, 0.36, 4.2], [0, 0.42, 0], { noseDrop: 0.16, chin: 0.1, tailLift: 0.06 });
  k.box(P, [1.86, 0.2, 1.5], [0, 0.68, 1.3], { noseDrop: 0.2, topX: 0.9 });
  k.box(P, [1.9, 0.26, 1.5], [0, 0.71, -1.32], { tailDrop: 0.08, topX: 0.88 });
  // haunches over the rear wheels
  for (const x of [-0.78, 0.78])
    k.box(P, [0.36, 0.16, 1.1], [x, 0.86, -1.25], { topX: 0.6, noseDrop: 0.1 });
  // open cockpit: dark tub, two buckets, raked screen, targa bar
  k.box(DARK, [1.56, 0.06, 1.35], [0, 0.82, -0.2]);
  for (const x of [-0.36, 0.36]) {
    k.box(DARK, [0.48, 0.12, 0.5], [x, 0.84, -0.4]);
    // low backs, so the chase camera sees the riders' shoulders over them
    k.box(DARK, [0.48, 0.32, 0.14], [x, 0.95, -0.66], { rot: [-0.18, 0, 0], topX: 0.8 });
  }
  k.box(GLASS, [1.56, 0.44, 0.06], [0, 1.0, 0.5], { rot: [-1.0, 0, 0], topX: 0.82 });
  k.box(DARK, [1.62, 0.3, 0.26], [0, 1.0, -0.92], { topX: 0.82 });
  // side intakes, mirrors
  for (const x of [-0.98, 0.98]) {
    k.box(DARK, [0.05, 0.18, 0.56], [x, 0.52, -0.6]);
    k.box(DARK, [0.16, 0.08, 0.12], [x * 0.92, 0.98, 0.42]);
  }
  // lamps: slim headlights, a full-width tail bar
  for (const x of [-0.6, 0.6])
    k.box(LAMP, [0.44, 0.06, 0.12], [x, 0.6, L - 0.16], { rot: [0.25, 0, 0] }, true);
  k.box(TAIL, [1.72, 0.06, 0.06], [0, 0.74, -L + 0.08], {}, true);
  // rear thruster nozzles + diffuser
  k.box(DARK, [1.6, 0.14, 0.3], [0, 0.3, -L + 0.2]);
  for (const x of [-0.5, 0.5]) {
    k.cyl(0x50565c, 0.16, 0.3, [x, 0.52, -L + 0.02], 'z', 8);
    k.cyl(0x111111, 0.1, 0.32, [x, 0.52, -L + 0.0], 'z', 8);
  }
  // flames: rear jets + four belly pads
  const f = new Kit();
  for (const x of [-0.5, 0.5]) f.cyl(FLAME, 0.13, 0.9, [x, 0.52, -L - 0.48], 'z', 8, 0.02, true);
  for (const [x, z] of [
    [0.84, s.geo.axleF],
    [-0.84, s.geo.axleF],
    [0.84, s.geo.axleR],
    [-0.84, s.geo.axleR],
  ])
    f.cyl(FLAME, 0.3, 0.5, [x, 0.12, z], 'y', 8, 0.05, true);
  const door = doorPanel(d => {
    d.box(P, [0.06, 0.34, 1.0], [0, 0, -0.5]);
    d.box(DARK, [0.02, 0.05, 0.3], [0, 0.08, -0.7]);
  });
  return {
    body: k.build(),
    flames: f.build(),
    doors: [
      { geo: door, at: [0.99, 0.5, 0.36], left: true },
      { geo: door, at: [-0.99, 0.5, 0.36], left: false },
    ],
  };
}

/** CAVALLINO '47: cigar body, cycle wings over skinny wire wheels, one aero screen. */
function cavallino(s: CarSpec, P: number): Built {
  const k = new Kit();
  const g = s.geo;
  k.box(P, [1.06, 0.5, 3.7], [0, 0.56, -0.05], {
    topX: 0.82,
    noseDrop: 0.14,
    tailDrop: 0.16,
    chin: 0.14,
    tailLift: 0.12,
  });
  k.box(P, [0.86, 0.18, 1.55], [0, 0.88, 0.78], { noseDrop: 0.15, topX: 0.85 });
  k.box(P, [0.92, 0.22, 1.25], [0, 0.88, -1.05], { tailDrop: 0.2, topX: 0.7 });
  // headrest fairing, cockpit
  k.box(P, [0.3, 0.22, 0.62], [0, 1.0, -0.95], { tailDrop: 0.2, topX: 0.7 });
  k.box(DARK, [0.62, 0.05, 0.72], [0, 0.98, -0.38]);
  k.box(0x7a4a2a, [0.5, 0.1, 0.3], [0, 0.96, -0.62]); // leather seat
  k.box(GLASS, [0.5, 0.2, 0.04], [0, 1.08, 0.06], { rot: [-0.5, 0, 0], topX: 0.8 });
  // oval grille with a chrome surround
  k.box(CHROME, [0.58, 0.32, 0.06], [0, 0.55, 1.83]);
  k.box(DARK, [0.48, 0.24, 0.06], [0, 0.55, 1.85]);
  for (let i = -2; i <= 2; i++) k.box(CHROME, [0.02, 0.22, 0.03], [i * 0.09, 0.55, 1.88]);
  // cycle wings over each wheel, on dark stays
  for (const z of [g.axleF, g.axleR])
    for (const x of [-g.halfTrack, g.halfTrack]) {
      k.box(P, [0.24, 0.05, 0.5], [x, g.wheelR + 0.45, z]);
      k.box(P, [0.24, 0.05, 0.34], [x, g.wheelR + 0.33, z + 0.36], { rot: [0.8, 0, 0] });
      k.box(P, [0.24, 0.05, 0.34], [x, g.wheelR + 0.33, z - 0.36], { rot: [-0.8, 0, 0] });
      k.box(DARK, [Math.abs(x) - 0.45, 0.04, 0.06], [x * 0.75, g.wheelR + 0.1, z]);
    }
  // headlamp pods on stalks, roundels, side exhaust
  for (const x of [-0.4, 0.4]) {
    k.ball(CHROME, 0.11, [x, 0.8, 1.55], [1, 1, 1.2]);
    k.cyl(LAMP, 0.08, 0.04, [x, 0.8, 1.68], 'z', 8, 0.08, true);
    k.cyl(WHITE, 0.2, 0.02, [x * 1.36, 0.6, 0.15], 'x', 10);
  }
  k.cyl(CHROME, 0.05, 1.4, [-0.57, 0.33, -0.4], 'z', 6);
  k.cyl(TAIL, 0.05, 0.04, [0.25, 0.68, -1.9], 'z', 6, 0.05, true);
  k.cyl(TAIL, 0.05, 0.04, [-0.25, 0.68, -1.9], 'z', 6, 0.05, true);
  return { body: k.build(), flames: null, doors: [] };
}

/** TORO: flat wedge, glass cockpit, louvred engine cover, scissor doors. */
function toro(s: CarSpec, P: number): Built {
  const k = new Kit();
  const L = s.geo.length / 2;
  k.box(P, [2.04, 0.42, 4.6], [0, 0.42, 0], { noseDrop: 0.24, chin: 0.12, tailLift: 0.06 });
  k.box(P, [1.9, 0.12, 1.55], [0, 0.69, 1.38], { noseDrop: 0.18, topX: 0.86 });
  // the wedge glasshouse + roof
  k.box(GLASS, [1.5, 0.42, 1.9], [0, 0.84, -0.18], { topX: 0.72, topZ: 0.5, topDz: -0.32 });
  k.box(P, [1.12, 0.06, 0.92], [0, 1.07, -0.48]);
  // engine cover: louvres; a rear wing on posts
  for (let i = 0; i < 5; i++) k.box(DARK, [1.3, 0.05, 0.12], [0, 0.66, -1.0 - i * 0.2]);
  k.box(P, [1.96, 0.06, 0.36], [0, 1.0, -L + 0.22]);
  for (const x of [-0.55, 0.55]) k.box(DARK, [0.06, 0.32, 0.12], [x, 0.82, -L + 0.25]);
  // big side intakes, mirrors
  for (const x of [-1.03, 1.03]) {
    k.box(DARK, [0.05, 0.3, 0.72], [x, 0.56, -0.95], { topZ: 0.4, topDz: -0.18 });
    k.box(DARK, [0.16, 0.08, 0.14], [x * 0.92, 0.88, 0.62]);
  }
  // slit headlights, Y tail strip, centre exhausts, diffuser
  for (const x of [-0.62, 0.62])
    k.box(LAMP, [0.5, 0.04, 0.24], [x, 0.5, L - 0.2], { rot: [0.35, 0, 0] }, true);
  k.box(TAIL, [1.76, 0.05, 0.05], [0, 0.6, -L + 0.02], {}, true);
  for (const x of [-0.6, 0.6]) k.box(TAIL, [0.05, 0.16, 0.05], [x, 0.53, -L + 0.02], {}, true);
  k.box(DARK, [1.7, 0.14, 0.3], [0, 0.28, -L + 0.18]);
  for (const x of [-0.13, 0.13]) k.cyl(CHROME, 0.07, 0.16, [x, 0.36, -L - 0.02], 'z', 6);
  // scissor doors: hinged at the A-pillar's foot, swinging straight up
  const door = doorPanel(d => {
    d.box(P, [0.05, 0.36, 1.25], [0, -0.02, -0.62], { topZ: 0.8, topDz: -0.12 });
    d.box(GLASS, [0.04, 0.24, 0.84], [0, 0.28, -0.52], { topZ: 0.55, topDz: -0.18 });
  });
  return {
    body: k.build(),
    flames: null,
    doors: [
      { geo: door, at: [1.03, 0.62, 0.56], left: true },
      { geo: door, at: [-1.03, 0.62, 0.56], left: false },
    ],
  };
}

/** DIP '64: long low slab, chrome everything, white tuck-'n'-roll, gold wires. */
function dip(s: CarSpec, P: number): Built {
  const k = new Kit();
  const L = s.geo.length / 2;
  k.box(P, [2.0, 0.48, 5.35], [0, 0.56, 0], { chin: 0.06, tailLift: 0.06 });
  k.box(P, [1.96, 0.08, 1.7], [0, 0.83, 1.75], { noseDrop: 0.04 });
  k.box(P, [1.96, 0.1, 1.45], [0, 0.84, -1.92]);
  // chrome: bumpers, side spear, grille bars
  k.box(CHROME, [2.06, 0.15, 0.14], [0, 0.4, L + 0.02]);
  k.box(CHROME, [2.06, 0.15, 0.14], [0, 0.4, -L - 0.02]);
  k.box(CHROME, [2.02, 0.04, 4.7], [0, 0.66, 0]);
  k.box(DARK, [1.5, 0.22, 0.05], [0, 0.6, L + 0.0]);
  for (let i = -3; i <= 3; i++) k.box(CHROME, [0.03, 0.2, 0.04], [i * 0.2, 0.6, L + 0.02]);
  // gold pinstripe along the shoulder
  k.box(0xf2c14e, [2.01, 0.02, 4.2], [0, 0.78, -0.1]);
  // quad headlights, tail lamps
  for (const x of [-0.78, -0.55, 0.55, 0.78])
    k.cyl(LAMP, 0.09, 0.04, [x, 0.62, L + 0.01], 'z', 8, 0.09, true);
  for (const x of [-0.75, 0.75]) k.box(TAIL, [0.36, 0.1, 0.04], [x, 0.66, -L - 0.01], {}, true);
  // convertible: dark tub, raked screen in a chrome frame, two white benches
  k.box(DARK, [1.8, 0.05, 2.4], [0, 0.82, -0.32]);
  k.box(GLASS, [1.8, 0.38, 0.05], [0, 1.0, 0.66], { rot: [-0.6, 0, 0], topX: 0.94 });
  k.box(CHROME, [1.86, 0.04, 0.08], [0, 1.16, 0.55], { rot: [-0.6, 0, 0] });
  for (const z of [-0.42, -1.25]) {
    k.box(0xf3ead6, [1.66, 0.14, 0.5], [0, 0.88, z]);
    k.box(0xf3ead6, [1.66, 0.36, 0.14], [0, 1.02, z - 0.24], { rot: [-0.15, 0, 0] });
  }
  // folded top behind the rear bench
  k.box(0x2b2b2b, [1.7, 0.16, 0.36], [0, 0.95, -1.75], { topX: 0.92 });
  return { body: k.build(), flames: null, doors: [] };
}

/** STOMPA: pickup body on a ladder frame, roof light bar, roll cage, tread tyres. */
function stompa(s: CarSpec, P: number): Built {
  const k = new Kit();
  const g = s.geo;
  // frame, axles, shocks
  k.box(DARK, [1.1, 0.28, 4.2], [0, 1.02, 0]);
  for (const z of [g.axleF, g.axleR]) {
    k.box(0x3a3d42, [2 * g.halfTrack - 0.4, 0.16, 0.18], [0, g.wheelR, z]);
    for (const x of [-0.75, 0.75])
      k.cyl(0xffd400, 0.07, 0.9, [x, g.wheelR + 0.45, z + 0.25], 'y', 6, 0.07);
  }
  // body: lower tub, cab, windows, bed
  k.box(P, [2.14, 0.62, 4.6], [0, 1.74, 0], { noseDrop: 0.12, chin: 0.1 });
  k.box(P, [2.0, 0.66, 1.5], [0, 2.38, 0.2], { topX: 0.92, topZ: 0.82 });
  k.box(GLASS, [1.72, 0.44, 0.05], [0, 2.4, 0.97], { rot: [-0.24, 0, 0] });
  for (const x of [-1.005, 1.005])
    k.box(GLASS, [0.02, 0.36, 1.05], [x * 0.97, 2.42, 0.22], { topZ: 0.85 });
  k.box(DARK, [1.9, 0.06, 1.7], [0, 2.07, -1.32]);
  for (const x of [-0.95, 0.95]) k.box(CHROME, [0.06, 0.6, 0.06], [x, 2.36, -0.66]);
  k.box(CHROME, [1.96, 0.06, 0.06], [0, 2.66, -0.66]);
  k.box(CHROME, [0.06, 0.06, 1.3], [0.95, 2.66, -1.3]);
  k.box(CHROME, [0.06, 0.06, 1.3], [-0.95, 2.66, -1.3]);
  // flame-yellow side stripe, bumpers, grille, light bar
  k.box(0xffd400, [2.16, 0.12, 3.4], [0, 1.72, 0.1]);
  k.box(DARK, [2.3, 0.26, 0.28], [0, 1.45, 2.36]);
  k.box(DARK, [2.3, 0.26, 0.28], [0, 1.45, -2.36]);
  k.box(CHROME, [1.4, 0.3, 0.05], [0, 1.82, 2.31]);
  for (const x of [-0.85, 0.85]) k.box(LAMP, [0.3, 0.16, 0.04], [x, 1.84, 2.31], {}, true);
  k.box(DARK, [1.6, 0.1, 0.16], [0, 2.78, 0.62]);
  for (const x of [-0.6, -0.2, 0.2, 0.6]) k.box(LAMP, [0.22, 0.12, 0.04], [x, 2.8, 0.71], {}, true);
  for (const x of [-0.85, 0.85]) k.box(TAIL, [0.26, 0.12, 0.04], [x, 1.82, -2.31], {}, true);
  return { body: k.build(), flames: null, doors: [] };
}

/** BUBBLE: an egg on four tiny wheels; the whole front is the door. */
function bubble(_s: CarSpec, P: number): Built {
  const k = new Kit();
  // egg: paint below the waist, glass dome above
  k.ball(P, 1, [0, 0.72, -0.05], [0.7, 0.5, 1.1]);
  k.ball(GLASS, 1, [0, 0.98, -0.12], [0.6, 0.42, 0.86]);
  k.box(P, [1.38, 0.24, 1.9], [0, 0.42, -0.05], { chin: 0.08, tailLift: 0.08 });
  // rear: a little engine grille and lamps; wheel pants
  k.box(DARK, [0.5, 0.14, 0.04], [0, 0.6, -1.13]);
  for (const x of [-0.45, 0.45]) k.box(TAIL, [0.12, 0.1, 0.04], [x, 0.66, -1.08], {}, true);
  for (const x of [-0.6, 0.6]) {
    k.ball(P, 0.16, [x, 0.75, 0.75], [1, 0.8, 1.3]);
    k.cyl(LAMP, 0.08, 0.04, [x, 0.76, 0.95], 'z', 8, 0.08, true);
  }
  // the front door: the whole nose, hinged on the right, opening like a fridge
  const door = doorPanel(d => {
    d.box(P, [1.08, 0.5, 0.1], [0.54, -0.12, 0], { topX: 0.86 });
    d.box(GLASS, [0.92, 0.42, 0.06], [0.54, 0.34, -0.04], { topX: 0.72, rot: [-0.35, 0, 0] });
    d.box(CHROME, [0.9, 0.06, 0.06], [0.54, -0.4, 0.06]);
    d.box(CHROME, [0.05, 0.12, 0.05], [0.95, 0.0, 0.07]);
  });
  return {
    body: k.build(),
    flames: null,
    doors: [{ geo: door, at: [-0.54, 0.75, 1.1], left: false }],
  };
}

/**
 * NOUN CAB: a tall four-door sedan, checker band, roof light (TAXI), a
 * push bar. Closed: fares ride hidden inside, like the Kenney cars.
 */
function cab(s: CarSpec, P: number): Built {
  const k = new Kit();
  const g = s.geo;
  const L = g.length / 2;
  // body: lower slab, bonnet + boot, the cabin glasshouse and its roof
  k.box(P, [1.98, 0.5, 4.6], [0, 0.6, 0], { noseDrop: 0.08, chin: 0.1, tailLift: 0.08 });
  k.box(P, [1.9, 0.12, 1.25], [0, 0.9, 1.6], { noseDrop: 0.06, topX: 0.95 });
  k.box(P, [1.9, 0.12, 0.95], [0, 0.9, -1.85], { topX: 0.95 });
  k.box(GLASS, [1.78, 0.5, 2.3], [0, 1.18, -0.3], { topX: 0.86, topZ: 0.82, topDz: -0.06 });
  k.box(P, [1.56, 0.08, 1.9], [0, 1.46, -0.34]);
  // pillars and the door shut lines
  for (const x of [-0.9, 0.9]) {
    k.box(P, [0.06, 0.48, 0.1], [x * 0.96, 1.18, 0.55], { rot: [-0.35, 0, 0] });
    k.box(P, [0.06, 0.48, 0.12], [x * 0.98, 1.18, -0.32]);
    k.box(P, [0.06, 0.46, 0.14], [x * 0.95, 1.18, -1.32], { rot: [0.3, 0, 0] });
    k.box(DARK, [0.02, 0.44, 0.03], [x * 1.1, 0.62, 0.62]);
    k.box(DARK, [0.02, 0.44, 0.03], [x * 1.1, 0.62, -0.32]);
    k.box(DARK, [0.02, 0.44, 0.03], [x * 1.1, 0.62, -1.3]);
    // handles, mirrors
    k.box(CHROME, [0.03, 0.04, 0.16], [x * 1.11, 0.78, 0.3]);
    k.box(CHROME, [0.03, 0.04, 0.16], [x * 1.11, 0.78, -0.62]);
    k.box(DARK, [0.16, 0.1, 0.14], [x * 1.06, 1.0, 0.75]);
  }
  // checker band along both sides
  for (const x of [-1, 1])
    for (let i = 0; i < 14; i++)
      for (let r = 0; r < 2; r++)
        if ((i + r) % 2 === 0)
          k.box(DARK, [0.02, 0.07, 0.24], [x * 1.0, 0.82 - r * 0.07, -1.55 + i * 0.24]);
  // bumpers, push bar, grille, lamps
  k.box(DARK, [2.02, 0.18, 0.16], [0, 0.42, L + 0.02]);
  k.box(DARK, [2.02, 0.18, 0.16], [0, 0.42, -L - 0.02]);
  k.box(0x2b2e33, [1.2, 0.08, 0.08], [0, 0.66, L + 0.14]);
  for (const x of [-0.45, 0.45]) k.box(0x2b2e33, [0.08, 0.4, 0.08], [x, 0.52, L + 0.12]);
  k.box(DARK, [1.0, 0.2, 0.05], [0, 0.66, L + 0.01]);
  for (const x of [-0.72, 0.72]) k.box(LAMP, [0.34, 0.14, 0.04], [x, 0.7, L + 0.01], {}, true);
  for (const x of [-0.75, 0.75]) k.box(TAIL, [0.3, 0.14, 0.04], [x, 0.72, -L - 0.01], {}, true);
  // the roof light: a lit sign on two feet, TAXI blocks across its faces
  for (const z of [-0.5, -0.1]) k.box(DARK, [0.5, 0.06, 0.06], [0, 1.52, z]);
  k.box(0xfff2a8, [0.8, 0.22, 0.34], [0, 1.65, -0.3], { topX: 0.86, topZ: 0.8 }, true);
  for (const z of [-0.48, -0.12])
    for (let i = 0; i < 4; i++)
      k.box(DARK, [0.1, 0.1, 0.02], [-0.24 + i * 0.16, 1.65, z + (z < -0.3 ? -0.005 : 0.005)]);
  return { body: k.build(), flames: null, doors: [] };
}

const BUILDERS: Record<CarId, Builder> = {
  cab,
  roadstar,
  cavallino,
  toro,
  dip,
  stompa,
  bubble,
  // Kenney bodies come from kenneyModel.ts; these are fallbacks if the GLB fails
  kaido: (s, p) => fallbackBody(s, p),
  bruiser: (s, p) => fallbackBody(s, p),
};

/** A plain hatch/coupe shape (only if a Kenney body can't load). */
function fallbackBody(s: CarSpec, P: number): Built {
  const k = new Kit();
  const g = s.geo;
  k.box(P, [g.width, 0.5, g.length], [0, 0.55, 0], { noseDrop: 0.1, chin: 0.06 });
  k.box(GLASS, [g.width * 0.86, 0.44, g.length * 0.48], [0, 1.02, -0.2], { topX: 0.85, topZ: 0.7 });
  k.box(P, [g.width * 0.8, 0.06, g.length * 0.3], [0, 1.26, -0.25]);
  for (const x of [-0.6, 0.6]) k.box(LAMP, [0.36, 0.1, 0.04], [x, 0.65, g.length / 2], {}, true);
  return { body: k.build(), flames: null, doors: [] };
}

/** Pose the door pivots for an angle (rad, from doors.ts). */
export function poseDoors(m: CarModel, angle: number) {
  const kind = m.spec.doors;
  for (const d of m.doors) {
    const p = d.pivot;
    if (kind === 'scissor') p.rotation.set(angle, 0, (d.left ? -1 : 1) * angle * 0.12);
    else if (kind === 'swing') p.rotation.set(0, d.left ? -angle : angle, 0);
    else if (kind === 'front') p.rotation.set(0, -angle, 0);
  }
}
