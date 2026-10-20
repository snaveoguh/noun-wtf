// ── Nounish landmarks: procedural models (original geometry, CC0 palette) ─
//
// Every model is built in its own frame: y = 0 at its base, +Z its front,
// centred on x = 0, and placed by the caller's matrix (a town's b.at(…) or
// the wild decorator's plinth). Low-poly boxes, cylinders and spheres in
// the Nouns trait colours, merged by material by whoever collects them, so
// each landmark costs one or two draw calls.
//
//   noggleArch      Noggle City's gate: ⌐◨-◨ 46 m wide, main street under the bridge
//   headStatue      The Big Noun: a 34 m Noun in noggles on a plinth
//   pizzaTower      Slice Tower: a pizza-slice skyscraper, pepperoni windows
//   meltingIceCream Meltdown: a 26 m cone melting into a puddle
//   crabLighthouse  Crabby Light: a striped lighthouse wearing a crab head
//   noggleWheel     The Noggle Wheel: a ferris wheel with noggles for cabins
//   landedUfo       Crater Lil's saucer, on legs, noggle portholes
//   boomboxTower    Boom Tower: Neon Nouns' boombox block, glowing speakers

import * as THREE from 'three';

import { box, boxAt, cyl, rod, v3 } from '../../towns/kit';

import { NOUN, sub, type Parts } from './parts';

// ── Noggles ⌐◨-◨ ──

/**
 * Noggles in the XY plane facing +Z, lens width L, centred on the bridge
 * (y = lens centre). Frame in `color`, lenses white | black, the temple
 * hooking off the left lens.
 */
export function noggles(
  k: Parts,
  m: THREE.Matrix4,
  L: number,
  color: number,
  opts: { depth?: number; collide?: boolean; temple?: boolean } = {},
) {
  const t = L * 0.18;
  const d = opts.depth ?? L * 0.16;
  const g = L * 0.42;
  const collide = opts.collide === true;
  for (const side of [-1, 1]) {
    const cx = side * (L / 2 + g / 2);
    const x0 = cx - L / 2;
    const x1 = cx + L / 2;
    const y0 = -L / 2;
    const y1 = L / 2;
    k.add(boxAt(x0, x1, y1 - t, y1, -d / 2, d / 2), color, m, { collide });
    k.add(boxAt(x0, x1, y0, y0 + t, -d / 2, d / 2), color, m, { collide });
    k.add(boxAt(x0, x0 + t, y0 + t, y1 - t, -d / 2, d / 2), color, m, { collide });
    k.add(boxAt(x1 - t, x1, y0 + t, y1 - t, -d / 2, d / 2), color, m, { collide });
    // Lens: white left half, black right half (both faces)
    const xm = (x0 + x1) / 2;
    k.add(boxAt(x0 + t, xm, y0 + t, y1 - t, -d * 0.3, d * 0.3), NOUN.white, m);
    k.add(boxAt(xm, x1 - t, y0 + t, y1 - t, -d * 0.3, d * 0.3), NOUN.black, m);
  }
  // Bridge (upper third)
  k.add(boxAt(-g / 2 - 0.01, g / 2 + 0.01, L * 0.08, L * 0.08 + t, -d / 2, d / 2), color, m, {
    collide,
  });
  if (opts.temple !== false) {
    // ⌐ : a bar out of the left lens, then a short drop
    const xl = -(L + g / 2);
    k.add(boxAt(xl - L * 0.55, xl, L * 0.08, L * 0.08 + t, -d / 2, d / 2), color, m, { collide });
    k.add(
      boxAt(xl - L * 0.55, xl - L * 0.55 + t, L * 0.08 - L * 0.32, L * 0.08 + t, -d / 2, d / 2),
      color,
      m,
      {
        collide,
      },
    );
  }
}

/** Total width of `noggles(L)` including the temple. */
export const nogglesWidth = (L: number) => 2 * L + L * 0.42 + L * 0.55;

// ── 1. The Noggle Arch ──

/** 46 m across, the street (x ∈ ±7) passes under the bridge at 22 m. */
export function noggleArch(k: Parts, m: THREE.Matrix4) {
  const L = 17;
  const yc = 27;
  noggles(k, sub(m, 0, yc, 0), L, NOUN.red, { depth: 3, collide: true });
  // Legs down from each lens to stepped plinths either side of the street
  const g = L * 0.42;
  for (const side of [-1, 1]) {
    const cx = side * (L / 2 + g / 2);
    k.add(box(3, yc - L / 2, 3, cx, (yc - L / 2) / 2, 0), NOUN.red, m, { collide: true });
    k.add(box(6, 1.6, 6, cx, 0.8, 0), NOUN.black, m, { collide: true });
    k.add(box(4.6, 0.6, 4.6, cx, 1.9, 0), NOUN.yellow, m);
  }
  // The temple's drop ends in a lamp post down to the ground
  const xl = -(L + g / 2) - L * 0.55;
  k.add(
    cyl(0.5, 0.6, yc + L * 0.08 - L * 0.32, 8, xl + L * 0.09, (yc + L * 0.08 - L * 0.32) / 2, 0),
    NOUN.black,
    m,
    {
      collide: true,
    },
  );
  k.add(
    new THREE.SphereGeometry(1.4, 10, 6).translate(xl + L * 0.09, yc + L * 0.08 - L * 0.32 - 1, 0),
    NOUN.yellow,
    m,
    {
      bucket: 'glow',
    },
  );
}

// ── 2. The Big Noun ──

export function headStatue(k: Parts, m: THREE.Matrix4) {
  // Stepped plinth
  k.add(box(22, 3, 22, 0, 1.5, 0), NOUN.grey, m, { collide: true });
  k.add(box(17, 2.5, 17, 0, 4.25, 0), NOUN.cool, m, { collide: true });
  // Legs, body (a Noun's T-shirt block), arms
  for (const x of [-2.6, 2.6])
    k.add(box(3.2, 7, 3.6, x, 5.5 + 3.5, 0), NOUN.blue, m, { collide: true });
  k.add(box(10, 9, 5.5, 0, 12.5 + 4.5, 0), NOUN.green, m, { collide: true });
  k.add(box(3.4, 3.4, 0.4, 0, 18, 2.85), NOUN.yellow, m); // the accessory square
  for (const x of [-6.2, 6.2])
    k.add(box(2.4, 7, 2.8, x, 15.5, 0.3), NOUN.green, m, { collide: true });
  // The head: a big square block in pink, then the noggles
  k.add(box(14, 12, 12, 0, 21.5 + 6, -0.5), NOUN.pink, m, { collide: true });
  k.add(box(14.2, 1.2, 12.2, 0, 33.6, -0.5), 0xd14f73, m);
  noggles(k, sub(m, 1.2, 28.6, 5.9), 4.6, NOUN.red, { depth: 1.1 });
  // Plaque
  k.add(box(6, 1.4, 0.4, 0, 3.6, 11.1), NOUN.black, m);
}

// ── 3. Slice Tower ──

export function pizzaTower(k: Parts, m: THREE.Matrix4) {
  const H = 64;
  // Triangular footprint: crust at the back (z = −12), point to the front
  const shape = new THREE.Shape();
  // (shape y is −z once stood up)
  shape.moveTo(-13, 12);
  shape.lineTo(13, 12);
  shape.lineTo(0, -14);
  shape.closePath();
  const body = new THREE.ExtrudeGeometry(shape, { depth: H, bevelEnabled: false });
  body.rotateX(-Math.PI / 2);
  k.add(body, 0xffcb4a, m, { collide: true });
  // Crust (a fat rounded wall up the back) and a cheese drip crown
  k.add(box(28, H + 2, 4, 0, (H + 2) / 2, -12.5), 0xc9772b, m, { collide: true });
  for (let i = 0; i < 9; i++) {
    const x = -11 + i * 2.75;
    const len = 3 + ((i * 7) % 5);
    k.add(box(1.6, len, 0.6, x, H - len / 2, -10.1 + Math.abs(x) * 0.02), 0xffe08a, m);
  }
  // Pepperoni windows on both slanted faces, every few floors
  const faceN = new THREE.Vector2(26, 13).normalize();
  for (const sx of [-1, 1]) {
    for (let fy = 6; fy < H - 6; fy += 9)
      for (let a = 0.2; a < 0.85; a += 0.3) {
        // along the edge from crust corner (±13, −12) to the tip (0, 14)
        const x = sx * 13 * (1 - a);
        const z = -12 + 26 * a;
        const g = new THREE.CylinderGeometry(2, 2, 0.5, 12).rotateX(Math.PI / 2);
        const yaw = Math.atan2(sx * faceN.x, faceN.y);
        const off = ((fy * 13 + a * 31) % 3) - 1;
        k.add(g, 0xc8322a, sub(m, x + sx * 0.25 * faceN.x, fy + off, z + 0.25 * faceN.y, yaw));
      }
  }
  // Antenna olive
  k.add(cyl(0.25, 0.25, 8, 6, 0, H + 6, -2), NOUN.black, m, { bucket: 'thin' });
  k.add(new THREE.TorusGeometry(1.1, 0.5, 6, 10).translate(0, H + 10.5, -2), 0x2c3a1e, m);
  k.add(new THREE.SphereGeometry(0.7, 8, 6).translate(0, H + 10.5, -2), NOUN.red, m, {
    bucket: 'glow',
  });
}

// ── 4. Meltdown ──

export function meltingIceCream(k: Parts, m: THREE.Matrix4) {
  // The puddle, then the cone upside down in it, scoops slumping off the top
  k.add(cyl(18, 19, 0.6, 18, 0, 0.3, 0), 0xffd1e0, m, { collide: true });
  k.add(cyl(9, 11, 0.8, 14, 4, 0.7, 3), 0xbfe9ff, m);
  // Cone: point down into the puddle, waffle bands
  const cone = new THREE.ConeGeometry(7, 18, 12).rotateX(Math.PI).translate(0, 9.5, 0);
  k.add(cone, 0xd8a25a, m, { collide: true });
  for (let y = 5; y < 18; y += 3.2) {
    const r = (y / 18.5) * 7 + 0.05;
    k.add(cyl(r, r, 0.35, 12, 0, y, 0), 0xa86f30, m);
  }
  // Scoops: pink on mint, sliding
  k.add(new THREE.SphereGeometry(7.5, 14, 10).scale(1, 0.85, 1).translate(0, 22, 0), 0xa5f2d0, m, {
    collide: true,
  });
  k.add(
    new THREE.SphereGeometry(6.2, 14, 10).scale(1, 0.85, 1).translate(1.5, 28.5, -0.5),
    0xff8fb8,
    m,
    {
      collide: true,
    },
  );
  // Drips down the cone into the puddle
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const len = 6 + ((i * 5) % 7);
    const r = 6.8;
    const col = i % 2 === 0 ? 0xa5f2d0 : 0xff8fb8;
    k.add(
      cyl(0.7, 0.9, len, 6, Math.cos(a) * r * 0.9, 18.5 - len / 2, Math.sin(a) * r * 0.9),
      col,
      m,
    );
    k.add(
      new THREE.SphereGeometry(1.0, 6, 4).translate(
        Math.cos(a) * r * 0.9,
        18.5 - len,
        Math.sin(a) * r * 0.9,
      ),
      col,
      m,
    );
  }
  // A cherry wearing noggles
  k.add(new THREE.SphereGeometry(1.8, 10, 8).translate(1.5, 35, -0.5), 0xd8202f, m);
  k.add(rod(v3(1.5, 36.5, -0.5), v3(2.6, 39, -1), 0.15), 0x3b6e2a, m, { bucket: 'thin' });
  noggles(k, sub(m, 1.7, 35.2, 1.4), 0.9, NOUN.red, { depth: 0.25 });
}

// ── 5. Crabby Light ──

export function crabLighthouse(k: Parts, m: THREE.Matrix4) {
  k.add(cyl(9, 10, 2, 12, 0, 1, 0), 0x8a8f96, m, { collide: true });
  // Striped tower
  const H = 30;
  const n = 6;
  for (let i = 0; i < n; i++) {
    const y0 = 2 + (i * H) / n;
    const r0 = 5 - (i / n) * 1.8;
    const r1 = 5 - ((i + 1) / n) * 1.8;
    k.add(cyl(r1, r0, H / n, 12, 0, y0 + H / n / 2, 0), i % 2 === 0 ? NOUN.white : NOUN.red, m, {
      collide: true,
    });
  }
  // Gallery + lamp room (glowing)
  const top = 2 + H;
  k.add(cyl(4.4, 4.4, 0.6, 12, 0, top + 0.3, 0), NOUN.black, m, { collide: true });
  k.add(cyl(2.4, 2.4, 3.2, 10, 0, top + 2.2, 0), 0xfff3b0, m, { bucket: 'glow' });
  // The crab head on top: a red block, eye stalks, claws up
  k.add(box(8, 4.4, 6.4, 0, top + 6, 0), 0xe1462f, m, { collide: true });
  k.add(box(8.4, 0.8, 6.8, 0, top + 3.9, 0), 0xb83420, m);
  for (const x of [-1.8, 1.8]) {
    k.add(cyl(0.3, 0.3, 2.6, 6, x, top + 9.4, 1.2), 0xe1462f, m, { bucket: 'thin' });
    k.add(new THREE.SphereGeometry(0.75, 8, 6).translate(x, top + 11, 1.2), NOUN.white, m);
    k.add(new THREE.SphereGeometry(0.35, 6, 4).translate(x, top + 11.1, 1.85), NOUN.black, m);
  }
  for (const sx of [-1, 1]) {
    k.add(rod(v3(sx * 4, top + 6, 0), v3(sx * 7, top + 9, 1), 0.7, 6), 0xe1462f, m);
    k.add(box(2.4, 3.2, 1.4, sx * 7.2, top + 10.6, 1), 0xe1462f, m);
    k.add(box(0.9, 2.2, 1.5, sx * 6.5, top + 11.4, 1), 0xb83420, m);
  }
  noggles(k, sub(m, 0.3, top + 6.6, 3.3), 1.9, NOUN.blue, { depth: 0.4 });
}

// ── 6. The Noggle Wheel ──

export function noggleWheel(k: Parts, m: THREE.Matrix4) {
  const R = 20;
  const hub = R + 4;
  // A-frame legs either side
  for (const z of [-3.2, 3.2]) {
    k.add(rod(v3(-12, 0, z), v3(0, hub, z), 0.9, 6), NOUN.black, m, { collide: true });
    k.add(rod(v3(12, 0, z), v3(0, hub, z), 0.9, 6), NOUN.black, m, { collide: true });
  }
  k.add(
    cyl(1.6, 1.6, 7.4, 10, 0, 0, 0)
      .rotateX(Math.PI / 2)
      .translate(0, hub, 0),
    NOUN.yellow,
    m,
  );
  // Rim (both faces) + spokes
  for (const z of [-2.2, 2.2]) {
    k.add(new THREE.TorusGeometry(R, 0.45, 6, 40).translate(0, hub, z), NOUN.red, m, {
      bucket: 'thin',
    });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      k.add(
        rod(v3(0, hub, z), v3(Math.cos(a) * R, hub + Math.sin(a) * R, z), 0.2, 4),
        NOUN.white,
        m,
        {
          bucket: 'thin',
        },
      );
    }
  }
  // Cabins: noggles hanging under the rim (always level)
  const cols = [NOUN.red, NOUN.blue, NOUN.yellow, NOUN.green, NOUN.pink, NOUN.orange];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x = Math.cos(a) * R;
    const y = hub + Math.sin(a) * R;
    k.add(rod(v3(x, y, 0), v3(x, y - 2, 0), 0.12, 4), NOUN.black, m, { bucket: 'thin' });
    noggles(k, sub(m, x + 0.55, y - 3.4, 0), 1.6, cols[i % cols.length], {
      depth: 1.6,
      temple: false,
    });
  }
  // Ticket booth
  k.add(box(4, 3, 3, 9, 1.5, 8), NOUN.pink, m, { collide: true });
  k.add(box(4.6, 0.4, 3.6, 9, 3.2, 8), NOUN.white, m);
}

// ── 7. The landed UFO ──

export function landedUfo(k: Parts, m: THREE.Matrix4) {
  const y = 6;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    k.add(
      rod(
        v3(Math.cos(a) * 6, y, Math.sin(a) * 6),
        v3(Math.cos(a) * 10, 0.3, Math.sin(a) * 10),
        0.45,
        6,
      ),
      0x7e8794,
      m,
      {
        collide: true,
      },
    );
    k.add(cyl(1.4, 1.6, 0.5, 8, Math.cos(a) * 10, 0.25, Math.sin(a) * 10), 0x5c6470, m);
  }
  // Saucer: two flattened spheres + a glowing rim
  k.add(new THREE.SphereGeometry(13, 20, 8).scale(1, 0.22, 1).translate(0, y + 2, 0), 0xc7ccd6, m, {
    collide: true,
  });
  k.add(
    new THREE.TorusGeometry(12.6, 0.5, 6, 32).rotateX(Math.PI / 2).translate(0, y + 2, 0),
    NOUN.green,
    m,
    {
      bucket: 'glow',
    },
  );
  k.add(
    new THREE.SphereGeometry(6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, y + 3.8, 0),
    0x9fe8ff,
    m,
    {
      collide: true,
    },
  );
  // Noggle portholes round the rim
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    noggles(k, sub(m, Math.sin(a) * 11.4, y + 2.6, Math.cos(a) * 11.4, a), 0.9, NOUN.black, {
      depth: 0.4,
      temple: false,
    });
  }
  // Beam ramp (the door is down)
  k.add(
    box(3, 0.3, 9, 0, 0, 0)
      .rotateX(-0.55)
      .translate(0, y / 2 - 0.4, 9),
    0x7e8794,
    m,
    {
      collide: true,
    },
  );
}

// ── 8. Boom Tower ──

export function boomboxTower(k: Parts, m: THREE.Matrix4) {
  const W = 30;
  const H = 24;
  const D = 10;
  const y0 = 10;
  // Stilts (a podium), the boombox body, handle, tape deck
  k.add(box(W - 6, y0, D - 2, 0, y0 / 2, 0), 0x22222a, m, { collide: true });
  k.add(box(W, H, D, 0, y0 + H / 2, 0), 0x3a3a46, m, { collide: true });
  k.add(box(W + 0.4, 1.2, D + 0.4, 0, y0 + H, 0), NOUN.pink, m);
  for (const x of [-W / 2 + 3, W / 2 - 3]) k.add(box(1.4, 6, 1.4, x, y0 + H + 3, 0), 0xb5b5c2, m);
  k.add(box(W - 4, 1.4, 1.4, 0, y0 + H + 6.3, 0), 0xb5b5c2, m);
  // Speakers (glowing cones, pulsing colours baked) either side, deck between
  for (const sx of [-1, 1]) {
    const cx = sx * 8.5;
    k.add(
      cyl(6.2, 6.2, 0.6, 18, 0, 0, 0)
        .rotateX(Math.PI / 2)
        .translate(cx, y0 + H / 2 - 1, D / 2 + 0.2),
      0x111118,
      m,
    );
    k.add(
      cyl(4.8, 4.8, 0.4, 18, 0, 0, 0)
        .rotateX(Math.PI / 2)
        .translate(cx, y0 + H / 2 - 1, D / 2 + 0.5),
      sx < 0 ? NOUN.pink : NOUN.teal,
      m,
      {
        bucket: 'glow',
      },
    );
    k.add(
      cyl(1.6, 1.6, 0.4, 12, 0, 0, 0)
        .rotateX(Math.PI / 2)
        .translate(cx, y0 + H / 2 - 1, D / 2 + 0.8),
      0x111118,
      m,
    );
  }
  k.add(box(6, 4, 0.5, 0, y0 + H / 2 + 1, D / 2 + 0.3), 0x15151b, m);
  k.add(box(4.6, 1.6, 0.3, 0, y0 + H / 2 + 1, D / 2 + 0.6), NOUN.yellow, m, { bucket: 'glow' });
  // Buttons
  for (let i = 0; i < 5; i++)
    k.add(
      box(1.4, 0.8, 1.4, -5.6 + i * 2.8, y0 + H + 1, 1.5),
      [NOUN.red, NOUN.yellow, NOUN.green, NOUN.blue, NOUN.pink][i],
      m,
    );
  noggles(k, sub(m, 0.6, y0 + H - 3.2, D / 2 + 0.4), 2.2, NOUN.red, { depth: 0.6 });
}

/** Rough footprint radius (m) of each model, for plinths, keep-outs and visits. */
export const LANDMARK_R = {
  noggleArch: 30,
  headStatue: 13,
  pizzaTower: 16,
  meltingIceCream: 19,
  crabLighthouse: 11,
  noggleWheel: 16,
  landedUfo: 14,
  boomboxTower: 17,
} as const;

export type LandmarkModel = keyof typeof LANDMARK_R;

export const MODELS: Record<LandmarkModel, (k: Parts, m: THREE.Matrix4) => void> = {
  noggleArch,
  headStatue,
  pizzaTower,
  meltingIceCream,
  crabLighthouse,
  noggleWheel,
  landedUfo,
  boomboxTower,
};
