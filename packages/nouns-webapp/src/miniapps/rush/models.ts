// ── Noun Rush models: racers, rides and the bits on the course ─────────
//
// Everything is built from primitives with lit PBR materials so the scene
// reads "3D realistic-ish" without shipping new assets. Heads are the real
// Noun heads from world2's builder. All models face -Z (down the course).

import type { Ride } from './course';

import * as THREE from 'three';

import {
  buildBodyTexture,
  buildNounHead,
  type NounSeed,
} from '@/miniapps/world2/character/NounAppearance';

const std = (color: THREE.ColorRepresentation, roughness = 0.6, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  return m;
}

// Shared bits (built once)
const GEO = {
  limb: new THREE.CapsuleGeometry(0.11, 0.42, 4, 8),
  torso: new THREE.CapsuleGeometry(0.27, 0.42, 6, 12),
  wheel: new THREE.CylinderGeometry(1, 1, 1, 18).rotateZ(Math.PI / 2),
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(1, 20, 14),
};
const MAT = {
  tyre: std(0x151515, 0.9),
  rim: std(0xc9ccd2, 0.3, 0.8),
  glass: new THREE.MeshStandardMaterial({
    color: 0x9fc6e8,
    roughness: 0.05,
    metalness: 0.2,
    transparent: true,
    opacity: 0.55,
  }),
  chrome: std(0xdadde2, 0.2, 0.9),
  dark: std(0x2a2c31, 0.7),
  skin: std(0xe0b48c, 0.7),
  shoe: std(0x222222, 0.8),
  pants: std(0x2f3e66, 0.85),
};

// ── Racers ──────────────────────────────────────────────────────────

export interface RacerRig {
  root: THREE.Group;
  /** Body pivot (lean, crouch, spin). */
  body: THREE.Group;
  hips: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  head: THREE.Group;
  rides: Partial<Record<Ride, THREE.Object3D>>;
  /** Spinning parts (rotors, wheels, propeller) per ride. */
  spinners: { obj: THREE.Object3D; axis: 'x' | 'y' | 'z'; rate: number }[];
  label: THREE.Sprite | null;
  stars: THREE.Group;
}

function limb(mat: THREE.Material, len = 1) {
  const g = new THREE.Group();
  const m = mesh(GEO.limb, mat);
  m.position.y = -0.32 * len;
  m.scale.y = len;
  g.add(m);
  return g;
}

function labelSprite(text: string, color: string) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(4, 8, 248, 48, 14);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.font = 'bold 30px "Londrina Solid", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }),
  );
  s.scale.set(2.4, 0.6, 1);
  s.renderOrder = 10;
  return s;
}

export function buildRacer(
  seed: NounSeed,
  name: string,
  color: string,
  showLabel: boolean,
): RacerRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  let shirt: THREE.Color;
  try {
    shirt = buildBodyTexture(seed, { size: 64 }).shirt;
  } catch {
    shirt = new THREE.Color(color);
  }
  const shirtMat = std(shirt, 0.75);

  const hips = new THREE.Group();
  hips.position.y = 0.92;
  body.add(hips);

  const torso = mesh(GEO.torso, shirtMat);
  torso.position.y = 0.42;
  torso.scale.set(1.15, 1, 0.8);
  hips.add(torso);

  const legL = limb(MAT.pants, 1.15);
  const legR = limb(MAT.pants, 1.15);
  legL.position.set(-0.15, 0, 0);
  legR.position.set(0.15, 0, 0);
  for (const l of [legL, legR]) {
    const shoe = mesh(GEO.box, MAT.shoe);
    shoe.scale.set(0.18, 0.12, 0.32);
    shoe.position.set(0, -0.86, -0.06);
    l.add(shoe);
    hips.add(l);
  }

  const armL = limb(shirtMat, 0.95);
  const armR = limb(shirtMat, 0.95);
  armL.position.set(-0.4, 0.72, 0);
  armR.position.set(0.4, 0.72, 0);
  for (const a of [armL, armR]) {
    const hand = mesh(GEO.sphere, MAT.skin);
    hand.scale.setScalar(0.12);
    hand.position.y = -0.62;
    a.add(hand);
    hips.add(a);
  }

  const head = new THREE.Group();
  head.position.y = 0.92;
  hips.add(head);
  try {
    const h = buildNounHead(seed, 0.95);
    h.group.rotation.y = Math.PI; // models face +Z; racers face -Z
    head.add(h.group);
  } catch {
    const fallback = mesh(GEO.box, std(color));
    fallback.scale.set(0.9, 0.7, 0.7);
    fallback.position.y = 0.35;
    head.add(fallback);
  }

  const stars = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const st = mesh(
      new THREE.OctahedronGeometry(0.12),
      new THREE.MeshBasicMaterial({ color: 0xffe14d }),
      false,
    );
    st.position.set(
      Math.cos((i / 4) * Math.PI * 2) * 0.55,
      0,
      Math.sin((i / 4) * Math.PI * 2) * 0.55,
    );
    stars.add(st);
  }
  stars.position.y = 2.75;
  stars.visible = false;
  root.add(stars);

  let label: THREE.Sprite | null = null;
  if (showLabel) {
    label = labelSprite(name, color);
    label.position.y = 3.2;
    root.add(label);
  }

  const rig: RacerRig = {
    root,
    body,
    hips,
    armL,
    armR,
    legL,
    legR,
    head,
    rides: {},
    spinners: [],
    label,
    stars,
  };
  addRides(rig, color);
  return rig;
}

// ── Rides ───────────────────────────────────────────────────────────

function wheel(r: number, w: number, rig: RacerRig, rate: number) {
  const g = new THREE.Group();
  const t = mesh(GEO.wheel, MAT.tyre);
  t.scale.set(w, r, r);
  const h = mesh(GEO.wheel, MAT.rim);
  h.scale.set(w * 1.05, r * 0.55, r * 0.55);
  g.add(t, h);
  rig.spinners.push({ obj: g, axis: 'x', rate: rate / r });
  return g;
}

function addRides(rig: RacerRig, color: string) {
  const paint = std(color, 0.25, 0.55);

  // Snowboard
  {
    const g = new THREE.Group();
    const deck = mesh(new THREE.BoxGeometry(0.42, 0.06, 1.7), paint);
    deck.position.y = 0.04;
    const nose = mesh(
      new THREE.CylinderGeometry(0.21, 0.21, 0.06, 16, 1, false, 0, Math.PI),
      paint,
    );
    nose.position.set(0, 0.04, -0.85);
    nose.rotation.y = Math.PI / 2;
    const tail = nose.clone();
    tail.position.z = 0.85;
    tail.rotation.y = -Math.PI / 2;
    g.add(deck, nose, tail);
    rig.rides.board = g;
  }

  // Car: a little hatchback
  {
    const g = new THREE.Group();
    const shell = mesh(GEO.box, paint);
    shell.scale.set(1.9, 0.7, 3.8);
    shell.position.y = 0.75;
    const cabin = mesh(GEO.box, paint);
    cabin.scale.set(1.7, 0.6, 2);
    cabin.position.set(0, 1.35, 0.35);
    const glass = mesh(GEO.box, MAT.glass, false);
    glass.scale.set(1.72, 0.48, 2.02);
    glass.position.set(0, 1.38, 0.35);
    const bumperF = mesh(GEO.box, MAT.chrome);
    bumperF.scale.set(1.95, 0.2, 0.15);
    bumperF.position.set(0, 0.5, -1.95);
    const bumperR = bumperF.clone();
    bumperR.position.z = 1.95;
    for (const [x, z] of [
      [-0.95, -1.25],
      [0.95, -1.25],
      [-0.95, 1.25],
      [0.95, 1.25],
    ] as const) {
      const w = wheel(0.38, 0.28, rig, 1);
      w.position.set(x, 0.38, z);
      g.add(w);
    }
    const lightMat = new THREE.MeshStandardMaterial({
      color: 0xfff6d0,
      emissive: 0xfff2b0,
      emissiveIntensity: 0.8,
    });
    for (const x of [-0.6, 0.6]) {
      const l = mesh(GEO.box, lightMat, false);
      l.scale.set(0.35, 0.15, 0.05);
      l.position.set(x, 0.85, -1.92);
      g.add(l);
    }
    g.add(shell, cabin, glass, bumperF, bumperR);
    rig.rides.car = g;
  }

  // Motorbike
  {
    const g = new THREE.Group();
    const frame = mesh(GEO.box, paint);
    frame.scale.set(0.35, 0.45, 1.5);
    frame.position.set(0, 0.85, 0);
    const tank = mesh(GEO.sphere, paint);
    tank.scale.set(0.3, 0.22, 0.45);
    tank.position.set(0, 1.12, -0.25);
    const seat = mesh(GEO.box, MAT.dark);
    seat.scale.set(0.32, 0.1, 0.7);
    seat.position.set(0, 1.12, 0.35);
    const fork = mesh(GEO.box, MAT.chrome);
    fork.scale.set(0.08, 0.9, 0.08);
    fork.position.set(0, 0.85, -0.85);
    fork.rotation.x = -0.35;
    const bars = mesh(GEO.box, MAT.chrome);
    bars.scale.set(0.8, 0.06, 0.06);
    bars.position.set(0, 1.35, -0.7);
    const exhaust = mesh(GEO.wheel, MAT.chrome);
    exhaust.scale.set(0.1, 0.1, 0.1);
    exhaust.rotation.y = Math.PI / 2;
    exhaust.position.set(0.25, 0.6, 0.6);
    const front = wheel(0.42, 0.14, rig, 1);
    front.position.set(0, 0.42, -1.05);
    const back = wheel(0.42, 0.2, rig, 1);
    back.position.set(0, 0.42, 0.85);
    g.add(frame, tank, seat, fork, bars, exhaust, front, back);
    rig.rides.moto = g;
  }

  // Tractor: big back wheels, a chimney, a cab
  {
    const g = new THREE.Group();
    const green = std(0x2e8b3a, 0.45, 0.3);
    const hood = mesh(GEO.box, green);
    hood.scale.set(1.1, 0.9, 2);
    hood.position.set(0, 1.2, -0.9);
    const cabBase = mesh(GEO.box, green);
    cabBase.scale.set(1.6, 0.5, 1.4);
    cabBase.position.set(0, 1.2, 0.8);
    const roof = mesh(GEO.box, std(0xf2f2f2, 0.5));
    roof.scale.set(1.7, 0.1, 1.6);
    roof.position.set(0, 3.05, 0.8);
    for (const [x, z] of [
      [-0.75, 0.15],
      [0.75, 0.15],
      [-0.75, 1.45],
      [0.75, 1.45],
    ] as const) {
      const post = mesh(GEO.box, MAT.dark);
      post.scale.set(0.07, 1.6, 0.07);
      post.position.set(x, 2.25, z);
      g.add(post);
    }
    const chimney = mesh(GEO.wheel, MAT.dark);
    chimney.scale.set(0.9, 0.09, 0.09);
    chimney.rotation.z = Math.PI / 2;
    chimney.position.set(0.35, 2.05, -1.4);
    const fw = [wheel(0.5, 0.35, rig, 1), wheel(0.5, 0.35, rig, 1)];
    fw[0]!.position.set(-0.8, 0.5, -1.4);
    fw[1]!.position.set(0.8, 0.5, -1.4);
    const bw = [wheel(1.0, 0.55, rig, 1), wheel(1.0, 0.55, rig, 1)];
    bw[0]!.position.set(-1.05, 1.0, 0.85);
    bw[1]!.position.set(1.05, 1.0, 0.85);
    g.add(hood, cabBase, roof, chimney, ...fw, ...bw);
    rig.rides.tractor = g;
  }

  // Helicopter
  {
    const g = new THREE.Group();
    const cab = mesh(GEO.sphere, paint);
    cab.scale.set(1.2, 1.15, 1.8);
    cab.position.set(0, 1.5, -0.2);
    const bubble = mesh(GEO.sphere, MAT.glass, false);
    bubble.scale.set(1.05, 0.95, 1.1);
    bubble.position.set(0, 1.75, -0.95);
    const boom = mesh(GEO.box, paint);
    boom.scale.set(0.3, 0.3, 3.4);
    boom.position.set(0, 1.75, 2.6);
    const fin = mesh(GEO.box, paint);
    fin.scale.set(0.08, 1, 0.6);
    fin.position.set(0, 2.2, 4.2);
    const mast = mesh(GEO.box, MAT.dark);
    mast.scale.set(0.15, 0.5, 0.15);
    mast.position.set(0, 2.85, 0);
    const rotor = new THREE.Group();
    for (let i = 0; i < 2; i++) {
      const blade = mesh(GEO.box, MAT.dark);
      blade.scale.set(0.25, 0.04, 7.5);
      blade.rotation.y = (i * Math.PI) / 2;
      rotor.add(blade);
    }
    rotor.position.set(0, 3.1, 0);
    const tailRotor = new THREE.Group();
    const tb = mesh(GEO.box, MAT.dark);
    tb.scale.set(0.04, 1.3, 0.15);
    tailRotor.add(tb);
    tailRotor.position.set(0.2, 2.2, 4.3);
    for (const x of [-0.7, 0.7]) {
      const skid = mesh(GEO.box, MAT.chrome);
      skid.scale.set(0.1, 0.1, 2.6);
      skid.position.set(x, 0.1, -0.1);
      const leg = mesh(GEO.box, MAT.chrome);
      leg.scale.set(0.07, 0.6, 0.07);
      leg.position.set(x, 0.4, -0.1);
      g.add(skid, leg);
    }
    g.add(cab, bubble, boom, fin, mast, rotor, tailRotor);
    rig.spinners.push({ obj: rotor, axis: 'y', rate: 28 }, { obj: tailRotor, axis: 'x', rate: 40 });
    rig.rides.heli = g;
  }

  // Plane: a little prop plane, low wing
  {
    const g = new THREE.Group();
    const white = std(0xf4f4f4, 0.35, 0.2);
    const fuse = mesh(new THREE.CylinderGeometry(0.75, 0.45, 6, 16).rotateX(Math.PI / 2), white);
    fuse.position.set(0, 1.4, 0.4);
    const stripe = mesh(
      new THREE.CylinderGeometry(0.77, 0.6, 3, 16, 1, true).rotateX(Math.PI / 2),
      paint,
    );
    stripe.position.set(0, 1.4, 0.2);
    const nose = mesh(GEO.sphere, paint);
    nose.scale.set(0.75, 0.75, 0.6);
    nose.position.set(0, 1.4, -2.6);
    const canopy = mesh(GEO.sphere, MAT.glass, false);
    canopy.scale.set(0.6, 0.55, 1.1);
    canopy.position.set(0, 2.0, -0.6);
    const wing = mesh(GEO.box, white);
    wing.scale.set(9, 0.14, 1.4);
    wing.position.set(0, 1.0, -0.6);
    for (const x of [-4.4, 4.4]) {
      const tip = mesh(GEO.box, paint);
      tip.scale.set(0.3, 0.16, 1.42);
      tip.position.set(x, 1.0, -0.6);
      g.add(tip);
    }
    const tailWing = mesh(GEO.box, white);
    tailWing.scale.set(3.2, 0.1, 0.8);
    tailWing.position.set(0, 1.6, 3.1);
    const fin = mesh(GEO.box, paint);
    fin.scale.set(0.1, 1.3, 1);
    fin.position.set(0, 2.2, 3.2);
    const prop = new THREE.Group();
    for (let i = 0; i < 2; i++) {
      const b = mesh(GEO.box, MAT.dark);
      b.scale.set(0.16, 2.1, 0.06);
      b.rotation.z = (i * Math.PI) / 2;
      prop.add(b);
    }
    prop.position.set(0, 1.4, -3.0);
    for (const x of [-1.1, 1.1]) {
      const w = wheel(0.3, 0.2, rig, 1);
      w.position.set(x, 0.3, -0.6);
      const strut = mesh(GEO.box, MAT.dark);
      strut.scale.set(0.06, 0.7, 0.06);
      strut.position.set(x, 0.65, -0.6);
      g.add(w, strut);
    }
    g.add(fuse, stripe, nose, canopy, wing, tailWing, fin, prop);
    rig.spinners.push({ obj: prop, axis: 'z', rate: 45 });
    rig.rides.plane = g;
  }

  for (const r of Object.values(rig.rides)) {
    r.visible = false;
    rig.root.add(r);
  }
}

/** Where the rider sits on each ride (hip height, forward offset). */
export const SEAT: Record<Ride, { y: number; z: number; sit: boolean }> = {
  foot: { y: 0, z: 0, sit: false },
  board: { y: 0.08, z: 0, sit: false },
  car: { y: 0.35, z: 0.35, sit: true },
  moto: { y: 0.42, z: 0.25, sit: true },
  tractor: { y: 0.95, z: 0.85, sit: true },
  heli: { y: 0.75, z: -0.4, sit: true },
  plane: { y: 0.95, z: -0.6, sit: true },
};

// ── Course props ────────────────────────────────────────────────────

export function fantaCan(): THREE.Group {
  const g = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#ff9a1a');
  grad.addColorStop(1, '#ff6a00');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#1d4fd6';
  ctx.beginPath();
  ctx.ellipse(128, 64, 90, 38, -0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 50px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('FANTA', 128, 66);
  ctx.fillStyle = '#2db34a';
  ctx.fillRect(0, 112, 256, 16);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const body = mesh(
    new THREE.CylinderGeometry(0.33, 0.33, 0.95, 24),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.25, metalness: 0.6 }),
  );
  const lid = mesh(new THREE.CylinderGeometry(0.29, 0.33, 0.08, 24), MAT.chrome);
  lid.position.y = 0.5;
  g.add(body, lid);
  return g;
}

const ORANGE_MAT = std(0xff8a00, 0.55);
const LEAF_MAT = std(0x2f9a3c, 0.6);
export function orange(): THREE.Group {
  const g = new THREE.Group();
  const o = mesh(GEO.sphere, ORANGE_MAT);
  o.scale.setScalar(0.32);
  const leaf = mesh(GEO.sphere, LEAF_MAT);
  leaf.scale.set(0.12, 0.03, 0.06);
  leaf.position.set(0.06, 0.32, 0);
  leaf.rotation.z = 0.4;
  g.add(o, leaf);
  return g;
}

export function signBoard(text: string, sub = '', bg = '#141414', fg = '#ffffff', w = 4, h = 1.6) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = Math.round((512 * h) / w);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, c.width - 16, c.height - 16);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(c.height * (sub ? 0.4 : 0.55))}px "Londrina Solid", system-ui, sans-serif`;
  ctx.fillText(text, c.width / 2, c.height * (sub ? 0.4 : 0.52));
  if (sub) {
    ctx.font = `${Math.round(c.height * 0.2)}px system-ui, sans-serif`;
    ctx.fillText(sub, c.width / 2, c.height * 0.76);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide }),
  );
  return m;
}
