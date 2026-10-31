// ── The fleet: every car's shape numbers, handling and character (pure) ──
//
// One record per car. `geo` is the single source for where the wheels and
// the seat are: the model builders (models.ts, kenneyModel.ts) draw to it
// and `simParams()` turns it into the ice cream van's raycast-vehicle
// numbers (van/physics.ts VanSim takes them), so wheels in the picture and
// wheels in the physics always agree.
//
// Names are the house's own: shapes are inspired by real cars, never their
// badges or trademarks (see public/world2/cars/CREDITS.md).

import { VAN, type VanParams } from '../van/physics';

export type CarId =
  | 'roadstar'
  | 'cavallino'
  | 'toro'
  | 'dip'
  | 'stompa'
  | 'bubble'
  | 'kaido'
  | 'bruiser';

/** What X (or the SPECIAL button) does in this car. */
export type CarSpecial = 'fly' | 'hop' | 'stomp' | null;

/** Doors: scissor (swing up), swing (out on a front hinge), front (the whole nose), none. */
export type DoorKind = 'scissor' | 'swing' | 'front' | 'none';

export interface CarGeo {
  /** Bumper to bumper, side to side, ground to roof (m). */
  length: number;
  width: number;
  height: number;
  /** Axles along the car from the model origin (+ = forward). */
  axleF: number;
  axleR: number;
  /** Wheel centre off the middle (m), radius, tyre width. */
  halfTrack: number;
  wheelR: number;
  wheelW: number;
  /** Where the driver's hips sit (model space, +X = left). */
  seat: [number, number, number];
}

export interface FlightParams {
  /** Ground speed (m/s) the thrusters need before X lifts off. */
  liftSpeed: number;
  /** Cruise / top / boosted air speed (m/s). */
  cruise: number;
  maxSpeed: number;
  boostSpeed: number;
  /** Forward thrust (m/s²) and the air brake. */
  thrust: number;
  airBrake: number;
  /** Climb / sink rates (m/s), yaw rate (rad/s). */
  climb: number;
  sink: number;
  yawRate: number;
  /** Highest it flies above the ground under it (m). */
  ceiling: number;
}

export interface CarSpec {
  id: CarId;
  /** On the HUD, the GET IN prompt and the garage list. */
  name: string;
  /** One line: what makes it fun. */
  tagline: string;
  /** What the shape nods to (credits / docs only; never shown as a badge). */
  inspiration: string;
  /** Procedural geometry, or a converted Kenney Car Kit body (CC0). */
  source: 'procedural' | { kit: 'kenney'; file: string };
  geo: CarGeo;
  doors: DoorKind;
  /** Open top: the rider shows in the seat (closed cars hide them, like the van). */
  open: boolean;
  special: CarSpecial;
  /** Paint jobs for traffic (the first is the hero colour). */
  paints: number[];
  /** Engine voice: pitch multiplier for the shared synth (van/VanAudio.ts). */
  engine: number;
  horn: 'beep' | 'deep' | 'toot' | 'tune' | 'air';
  /** Handling: everything VanSim reads, worked out by simParams(). */
  mass: number;
  topKmh: number;
  boostKmh: number;
  /** Launch acceleration cap (m/s²). */
  accel: number;
  /** Tyre grip (μ) and how much of it a sliding tyre keeps. */
  mu: number;
  slide: number;
  /** Static suspension sag (m) and damping ratio. */
  sag: number;
  zeta: number;
  /** Spring travel to the bump stop (m) and rest length. */
  travel: number;
  restLen: number;
  /** Front share of the drive (0 = rear-wheel drive). */
  frontDrive: number;
  steerMax: number;
  steerFade: number;
  /** Handbrake: rear side-grip multiplier and the yaw kick. */
  hbGrip: number;
  hbYaw: number;
  downforce: number;
  /** Centre of mass height above the ground at rest. */
  comH: number;
  flight?: FlightParams;
}

const KMH = 1 / 3.6;

export const CARS: Record<CarId, CarSpec> = {
  roadstar: {
    id: 'roadstar',
    name: 'ROADSTAR',
    tagline: 'Electric roadster with thrusters. Get it up to speed, hit X and fly.',
    inspiration: 'the next-gen electric roadster with cold-gas thrusters',
    source: 'procedural',
    geo: {
      length: 4.3,
      width: 1.96,
      height: 1.18,
      axleF: 1.38,
      axleR: -1.32,
      halfTrack: 0.84,
      wheelR: 0.36,
      wheelW: 0.3,
      seat: [0.36, 0.42, -0.35],
    },
    doors: 'swing',
    open: true,
    special: 'fly',
    paints: [0xd8232a, 0xf4f1ea, 0x1d1f24, 0x2f6fde],
    engine: 1.6,
    horn: 'beep',
    mass: 1650,
    topKmh: 500,
    boostKmh: 580,
    accel: 16,
    mu: 1.3,
    slide: 0.85,
    sag: 0.09,
    zeta: 0.5,
    travel: 0.2,
    restLen: 0.32,
    frontDrive: 0.45,
    steerMax: 0.58,
    steerFade: 11,
    hbGrip: 0.42,
    hbYaw: 1.5,
    downforce: 0.0016,
    comH: 0.5,
    flight: {
      liftSpeed: 50 * KMH,
      cruise: 26,
      // As fast in the air as on the road: 500 km/h, 580 boosting
      maxSpeed: 500 * KMH,
      boostSpeed: 580 * KMH,
      thrust: 26,
      airBrake: 14,
      climb: 9,
      sink: 11,
      yawRate: 1.5,
      ceiling: 160,
    },
  },
  cavallino: {
    id: 'cavallino',
    name: "CAVALLINO '47",
    tagline: 'Hand-built 1947 racer. Light, skinny tyres, twitchy as a pony.',
    inspiration: 'the first post-war Italian V12 sports racer (1947)',
    source: 'procedural',
    geo: {
      length: 3.95,
      width: 1.62,
      height: 1.02,
      axleF: 1.2,
      axleR: -1.15,
      halfTrack: 0.66,
      wheelR: 0.38,
      wheelW: 0.16,
      seat: [0.0, 0.32, -0.45],
    },
    doors: 'none',
    open: true,
    special: null,
    paints: [0xc8201e, 0xe9dcc0, 0x2a4b8d, 0x1e5b3a],
    engine: 1.25,
    horn: 'toot',
    mass: 760,
    topKmh: 175,
    boostKmh: 205,
    accel: 9,
    mu: 1.02,
    slide: 0.74,
    sag: 0.08,
    zeta: 0.38,
    travel: 0.2,
    restLen: 0.34,
    frontDrive: 0,
    steerMax: 0.72,
    steerFade: 15,
    hbGrip: 0.3,
    hbYaw: 1.9,
    downforce: 0.0008,
    comH: 0.48,
  },
  toro: {
    id: 'toro',
    name: 'TORO',
    tagline: 'V12 wedge. Doors go UP. Fast, flat, glued to the road.',
    inspiration: 'the Italian wedge supercar with scissor doors',
    source: 'procedural',
    geo: {
      length: 4.65,
      width: 2.06,
      height: 1.12,
      axleF: 1.42,
      axleR: -1.32,
      halfTrack: 0.88,
      wheelR: 0.37,
      wheelW: 0.36,
      seat: [0.38, 0.36, -0.15],
    },
    doors: 'scissor',
    open: false,
    special: null,
    paints: [0x9cd31c, 0xff9f0a, 0xf4f1ea, 0x6a2fd6],
    engine: 1.4,
    horn: 'deep',
    mass: 1550,
    topKmh: 260,
    boostKmh: 320,
    accel: 13,
    mu: 1.55,
    slide: 0.88,
    sag: 0.07,
    zeta: 0.6,
    travel: 0.16,
    restLen: 0.3,
    frontDrive: 0.35,
    steerMax: 0.56,
    steerFade: 12,
    hbGrip: 0.48,
    hbYaw: 1.3,
    downforce: 0.002,
    comH: 0.48,
  },
  dip: {
    id: 'dip',
    name: "DIP '64",
    tagline: 'Candy-paint lowrider on juice. X hits the hydraulics.',
    inspiration: 'the 1964 lowrider convertible',
    source: 'procedural',
    geo: {
      length: 5.4,
      width: 2.0,
      height: 1.25,
      axleF: 1.55,
      axleR: -1.5,
      halfTrack: 0.82,
      wheelR: 0.34,
      wheelW: 0.24,
      seat: [0.38, 0.38, -0.35],
    },
    doors: 'none',
    open: true,
    special: 'hop',
    paints: [0x8a2be2, 0x14a6a6, 0xd4145a, 0xf2b705],
    engine: 0.8,
    horn: 'tune',
    mass: 2000,
    topKmh: 150,
    boostKmh: 180,
    accel: 6.5,
    mu: 1.0,
    slide: 0.82,
    sag: 0.15,
    zeta: 0.32,
    travel: 0.32,
    restLen: 0.42,
    frontDrive: 0,
    steerMax: 0.55,
    steerFade: 9,
    hbGrip: 0.4,
    hbYaw: 1.3,
    downforce: 0.001,
    comH: 0.62,
  },
  stompa: {
    id: 'stompa',
    name: 'STOMPA',
    tagline: 'Monster truck. Drive over anything. X to stomp-jump.',
    inspiration: 'the monster trucks of the 80s arena shows',
    source: 'procedural',
    geo: {
      length: 4.8,
      width: 3.1,
      height: 3.05,
      axleF: 1.55,
      axleR: -1.55,
      halfTrack: 1.2,
      wheelR: 0.86,
      wheelW: 0.66,
      seat: [0.35, 1.95, 0.1],
    },
    doors: 'none',
    open: false,
    special: 'stomp',
    paints: [0x1f9e4a, 0xff6a13, 0x2e6fba, 0xffd400],
    engine: 0.6,
    horn: 'air',
    mass: 3200,
    topKmh: 135,
    boostKmh: 165,
    accel: 7.5,
    mu: 1.25,
    slide: 0.85,
    sag: 0.22,
    zeta: 0.42,
    travel: 0.55,
    restLen: 0.75,
    frontDrive: 0.5,
    steerMax: 0.62,
    steerFade: 10,
    hbGrip: 0.45,
    hbYaw: 1.2,
    downforce: 0.001,
    comH: 1.55,
  },
  bubble: {
    id: 'bubble',
    name: 'BUBBLE',
    tagline: 'One-door city egg. The whole nose opens. 90 km/h of pure joy.',
    inspiration: 'the 1950s bubble cars with a front-opening door',
    source: 'procedural',
    geo: {
      length: 2.35,
      width: 1.42,
      height: 1.42,
      axleF: 0.62,
      axleR: -0.62,
      halfTrack: 0.58,
      wheelR: 0.25,
      wheelW: 0.16,
      seat: [0.0, 0.4, -0.15],
    },
    doors: 'front',
    open: false,
    special: null,
    paints: [0x8fd3c7, 0xf7c6d9, 0xf4d35e, 0xe9e4d4],
    engine: 2.1,
    horn: 'toot',
    mass: 420,
    topKmh: 95,
    boostKmh: 125,
    accel: 6,
    mu: 1.05,
    slide: 0.8,
    sag: 0.08,
    zeta: 0.4,
    travel: 0.18,
    restLen: 0.28,
    frontDrive: 0,
    steerMax: 0.7,
    steerFade: 10,
    hbGrip: 0.35,
    hbYaw: 1.6,
    downforce: 0.0006,
    comH: 0.45,
  },
  kaido: {
    id: 'kaido',
    name: 'KAIDO',
    tagline: 'Touge hatch, rear-drive, loose tail. Hold SPACE and slide it.',
    inspiration: '80s Japanese hatchbacks of the mountain-pass drift scene',
    source: { kit: 'kenney', file: 'kaido.glb' },
    // Kenney's hatchback-sports at ×1.45 (its wheel nodes sit at ±0.81 × 1.45)
    geo: {
      length: 4.13,
      width: 1.9,
      height: 1.6,
      axleF: 1.17,
      axleR: -1.17,
      halfTrack: 0.62,
      wheelR: 0.43,
      wheelW: 0.3,
      seat: [0.35, 0.48, -0.25],
    },
    doors: 'none',
    open: false,
    special: null,
    paints: [0xf4f1ea, 0x2b2b2b, 0xd8232a, 0x3a7bd5],
    engine: 1.5,
    horn: 'beep',
    mass: 1080,
    topKmh: 195,
    boostKmh: 245,
    accel: 9.5,
    mu: 1.06,
    slide: 0.86,
    sag: 0.08,
    zeta: 0.5,
    travel: 0.2,
    restLen: 0.32,
    frontDrive: 0,
    steerMax: 0.66,
    steerFade: 12,
    hbGrip: 0.28,
    hbYaw: 1.8,
    downforce: 0.0015,
    comH: 0.52,
  },
  bruiser: {
    id: 'bruiser',
    name: "BRUISER '70",
    tagline: 'Big-block muscle. All torque, smokes the tyres off the line.',
    inspiration: 'American muscle cars of 1970',
    source: { kit: 'kenney', file: 'bruiser.glb' },
    // Kenney's sedan-sports at ×1.7 (wheel nodes at ±0.66 × 1.7)
    geo: {
      length: 4.33,
      width: 2.2,
      height: 1.87,
      axleF: 1.12,
      axleR: -1.12,
      halfTrack: 0.7,
      wheelR: 0.5,
      wheelW: 0.38,
      seat: [0.4, 0.55, -0.2],
    },
    doors: 'none',
    open: false,
    special: null,
    paints: [0xff6a13, 0x1d1f24, 0x2f6fde, 0xf2b705],
    engine: 0.9,
    horn: 'deep',
    mass: 1750,
    topKmh: 215,
    boostKmh: 265,
    accel: 12.5,
    mu: 1.0,
    slide: 0.8,
    sag: 0.1,
    zeta: 0.42,
    travel: 0.22,
    restLen: 0.36,
    frontDrive: 0,
    steerMax: 0.6,
    steerFade: 10,
    hbGrip: 0.36,
    hbYaw: 1.5,
    downforce: 0.0012,
    comH: 0.56,
  },
};

export const CAR_IDS = Object.keys(CARS) as CarId[];

export function isCarId(v: unknown): v is CarId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(CARS, v);
}

/**
 * VanSim's numbers for a car. The CoM sits midway between the axles, so the
 * model origin is `comZ` behind it; the drag is chosen so the engine's power
 * tops out at `topKmh` (and the boost at `boostKmh`), like the van's.
 */
export function simParams(s: CarSpec): VanParams {
  const g = s.geo;
  const comZ = (g.axleF + g.axleR) / 2;
  const top = s.topKmh * KMH;
  const boost = s.boostKmh * KMH;
  const rolling = 0.012;
  // At top speed the drive (power / v) just covers the drag (+ rolling), and
  // must sit under the launch cap (accel), so fast cars get slipperier bodies
  const drag = Math.min(0.0032, (0.75 * s.accel - rolling * 14) / (top * top));
  // (downforce loads the tyres: more rolling resistance at speed)
  const resist = (v: number) => drag * v ** 3 + rolling * (14 + s.downforce * v * v) * v;
  const power = resist(top);
  const boostPower = resist(boost);
  const quarter = (s.mass * 14) / 4;
  const spring = quarter / s.sag;
  const damper = 2 * s.zeta * Math.sqrt(spring * (s.mass / 4));
  const L = g.length;
  const W = g.width;
  const H = g.height;
  const bodyR = Math.min(0.75, W * 0.32, H * 0.42);
  return {
    ...VAN,
    mass: s.mass,
    comH: s.comH,
    comZ,
    wheelR: g.wheelR,
    restLen: s.restLen,
    travel: s.travel,
    spring,
    damper,
    antiRoll: spring * 0.4,
    frontZ: g.axleF - comZ,
    rearZ: g.axleR - comZ,
    halfTrack: g.halfTrack,
    inertia: {
      x: (s.mass / 12) * (H * H + L * L),
      y: (s.mass / 12) * (W * W + L * L),
      z: (s.mass / 12) * (W * W + H * H),
    },
    mu: s.mu,
    slide: s.slide,
    accel: s.accel,
    power,
    boostAccel: s.accel * 1.25,
    boostPower,
    frontDrive: s.frontDrive,
    drag,
    rolling,
    reverseSpeed: Math.min(14, top * 0.3),
    steerMax: s.steerMax,
    steerFade: s.steerFade,
    hbGrip: s.hbGrip,
    hbYaw: s.hbYaw,
    downforce: s.downforce,
    bodyR,
    bodyX: Math.max(0.05, W / 2 - bodyR - 0.08),
    bodyY: Math.max(0.1, H * 0.55 - s.comH),
    bodyZ0: -L / 2 - comZ + bodyR + 0.05,
    bodyZ1: L / 2 - comZ - bodyR - 0.05,
    gears: gearsFor(boost),
    floorClear: Math.max(0.25, s.comH * 0.75),
    maxSpeed: boost * 1.05 + 4,
    // Self-righting in the air scales with the body (the van's numbers at its inertia)
    airLevel: (60000 * ((s.mass / 12) * (H * H + L * L))) / 8970,
    airDamp: (14000 * ((s.mass / 12) * (H * H + L * L))) / 8970,
  };
}

/** Six cosmetic gears spread up to the boosted top speed. */
function gearsFor(top: number): number[] {
  return [0.14, 0.27, 0.41, 0.56, 0.74, 1.05].map(k => Math.round(top * k));
}
