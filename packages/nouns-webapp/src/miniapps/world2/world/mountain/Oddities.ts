// ── Wild things: hill houses + oddities (static set dressing) ───────────
//
// Builders for the sites wildSites.ts plans, all writing into the chunk's
// one GeoBuilder (chunk-local coordinates), so every house and oddity in a
// chunk is a single merged draw. The few moving bits — windmill sails, the
// bobbing rubber duck — come back as separate small "spinner" geometries.
//
//   • Hill houses: grassy domes sunk into the hillside (the uphill side
//     buried), a round door at the end of a short tunnel facing downhill,
//     porthole windows, and a periscope / chimney / aerial / skylight on top.
//     Domes collide (a smooth mound you can ride over); the rest doesn't.
//   • Oddities: giant noggles ⌐◨-◨, phone booth, telly stack, lone traffic
//     light, sofa, mushroom ring, windmill, standing stones, crashed UFO,
//     vending machine, giant Noun head, a door to nowhere, a huge cone.
//     Solid bits get box colliders; nothing sits within ~18 m of a line.
//
// Local frames face +Z (toward the nearest line for oddities).

import type { WildSite } from './wildSites';

import * as THREE from 'three';

import { mountainTerrainQuery } from './DressingDecorator';
import { Rand, hash3i } from './dressingUtil';
import { MOUNTAIN, terrainHeight } from './terrain';
import { GeoBuilder, hex, hsl, type ColorFn } from './wildGeo';

export interface Spinner {
  geo: THREE.BufferGeometry;
  /** Chunk-local pivot + facing. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** 'spin' turns about the local Z axis; 'bob' floats up and down. */
  kind: 'spin' | 'bob';
  speed: number;
}

// Turf a notch brighter + yellower than the hillside, so the domes read
const GRASS_LO = hex(0x4fae3e);
const GRASS_HI = hex(0x9be36a);
const WHITE = hex(0xffffff);
const INK = hex(0x14121c);
const STEEL = hex(0x8d93a3);
const STEEL_DARK = hex(0x4a4e5c);
const GLASS = hex(0x9fe3ff);
const GLASS_WARM = hex(0xffe9a8);
const DOORS = [0xe0302f, 0xf2d22e, 0x8a4fd1, 0x2d7fe0, 0xff7aa8, 0xff8a1f, 0xffffff].map(hex);
const NOUN = [0xd32a2a, 0x2a6bd3, 0x25a24a, 0xf2a20c, 0xe04fb4, 0x7a3ad8].map(hex);
const pick = <T>(r: Rand, list: T[]): T => list[Math.floor(r.next() * list.length) % list.length];
const _c = new THREE.Color();

/** Build site `s` into `b` (chunk origin ox, oz). */
export function buildSite(b: GeoBuilder, s: WildSite, ox: number, oz: number, spin: Spinner[]) {
  const r = new Rand(s.seed);
  if (s.kind === 'houses') {
    buildHouses(b, s, r, ox, oz);
    return;
  }
  const lx = s.x - ox;
  const lz = s.z - oz;
  if (s.kind === 'duck') {
    spin.push({ geo: duck(r), x: lx, y: s.y, z: lz, yaw: s.yaw, kind: 'bob', speed: 1.3 });
    return;
  }
  const ODD: Record<string, (b: GeoBuilder, r: Rand) => void> = {
    noggles,
    phonebooth,
    tellies,
    trafficlight,
    sofa,
    mushrooms,
    stones,
    ufo,
    vending,
    nounhead,
    door,
    cone,
  };
  b.at(lx, s.y, lz, s.yaw, 0, 0, () => {
    if (s.kind === 'windmill') {
      const hub = windmill(b, r);
      const sails = new GeoBuilder();
      windmillSails(sails, r);
      const c = Math.cos(s.yaw);
      const sn = Math.sin(s.yaw);
      spin.push({
        geo: sails.build(),
        x: lx + sn * hub.z,
        y: s.y + hub.y,
        z: lz + c * hub.z,
        yaw: s.yaw,
        kind: 'spin',
        speed: r.range(0.5, 1.1),
      });
    } else {
      ODD[s.kind](b, r);
    }
  });
}

// ── Hill houses ─────────────────────────────────────────────────────────

function buildHouses(b: GeoBuilder, s: WildSite, r: Rand, ox: number, oz: number) {
  const T = mountainTerrainQuery;
  const n = 1 + Math.floor(r.next() * 4);
  const domes: { x: number; z: number; R: number }[] = [{ x: s.x, z: s.z, R: r.range(4.5, 7) }];
  for (let i = 1; i < n; i++) {
    for (let t = 0; t < 10; t++) {
      const R = r.range(2.6, 4.6);
      const a = r.next() * Math.PI * 2;
      const from = domes[Math.floor(r.next() * domes.length) % domes.length];
      const d = from.R + R + r.range(1.5, 5);
      const x = from.x + Math.sin(a) * d;
      const z = from.z + Math.cos(a) * d;
      if (Math.hypot(x - s.x, z - s.z) + R > s.r) continue;
      if (domes.some(o => Math.hypot(o.x - x, o.z - z) < o.R + R + 1.2)) continue;
      if (T.trackDist(x, z) < MOUNTAIN.trackHalf + 14 + R || T.blocked?.(x, z) === true) continue;
      domes.push({ x, z, R });
      break;
    }
  }
  for (const d of domes) dome(b, r, d.x, d.z, d.R, s.yaw, ox, oz);
}

function dome(
  b: GeoBuilder,
  r: Rand,
  x: number,
  z: number,
  R: number,
  face: number,
  ox: number,
  oz: number,
) {
  const H = R * r.range(0.5, 0.75);
  // Sit on the lowest ground under the rim: the uphill side is dug in
  let base = Infinity;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    base = Math.min(base, terrainHeight(x + Math.cos(a) * R * 0.9, z + Math.sin(a) * R * 0.9));
  }
  base -= 0.25;
  // Door faces the line (± a bit), or downhill where that side is dug in
  const gx = terrainHeight(x + 2, z) - terrainHeight(x - 2, z);
  const gz = terrainHeight(x, z + 2) - terrainHeight(x, z - 2);
  const jitter = r.range(-0.5, 0.5);
  let yaw = face + jitter;
  if (terrainHeight(x + Math.sin(yaw) * R, z + Math.cos(yaw) * R) - base > H * 0.3)
    yaw = Math.atan2(-gx, -gz) + jitter;
  const tint = r.range(-0.08, 0.08);
  const paint: ColorFn = (_px, py) => {
    const t = Math.min(1, Math.max(0, py / H));
    return _c.copy(GRASS_LO).lerp(GRASS_HI, 0.2 + t * 0.7 + tint);
  };
  // Radius of the dome at height y
  const rr = (y: number) => R * Math.cos(Math.asin(Math.min(1, Math.max(-1, y / H))));
  b.at(x - ox, base, z - oz, 0, 0, 0, () => {
    const prof: [number, number][] = [];
    const rows = 9;
    for (let i = 0; i <= rows; i++) {
      const p = -0.45 + (i / rows) * (Math.PI / 2 + 0.45);
      prof.push([R * Math.cos(p), H * Math.sin(p)]);
    }
    b.lathe(prof, 20, paint);
    // Collider: coarse twin, a smooth mound
    const cp: [number, number][] = [];
    for (let i = 0; i <= 4; i++) {
      const p = -0.3 + (i / 4) * (Math.PI / 2 + 0.3);
      cp.push([R * 0.97 * Math.cos(p), H * 0.97 * Math.sin(p)]);
    }
    cp.push([0, H * 0.97]);
    b.lathe(cp, 10, null, false, true);

    const doorCol = pick(r, DOORS);
    const frameCol = pick(r, DOORS);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    // Door: at the end of a short grassy tunnel, standing on the ground
    const dr = Math.min(1.1, Math.max(0.7, R * 0.17));
    const gDoor = terrainHeight(x + fx * R, z + fz * R) - base;
    const dy = Math.max(0, gDoor) + dr + 0.05;
    if (dy < H * 0.75) {
      const rd = rr(dy);
      b.at(fx * rd, dy, fz * rd, yaw, Math.PI / 2, 0, () => {
        b.cyl(dr + 0.35, dr + 0.35, -1.4, 0.45, 16, paint);
        b.cyl(dr, dr, 0.45, 0.53, 16, doorCol);
        b.at(0, 0.53, 0, 0, 0, 0, () => b.ring(dr + 0.02, 0.1, 18, 6, frameCol));
        b.box(dr * 0.55, 0.62, 0, 0.14, 0.14, 0.14, frameCol);
        // Little round step
        b.box(0, 0.3, dr + 0.15, dr * 1.4, 0.8, 0.2, frameCol.clone().multiplyScalar(0.7));
      });
    }
    // Portholes
    const nw = 1 + Math.floor(r.next() * 3);
    const wcol = r.next() < 0.6 ? GLASS_WARM : GLASS;
    for (let k = 0; k < nw; k++) {
      const a = yaw + (k % 2 === 0 ? 1 : -1) * (0.9 + Math.floor(k / 2) * 0.9) + r.range(-0.2, 0.2);
      const yw = H * r.range(0.35, 0.55);
      const rw = rr(yw);
      const tilt = Math.atan2(yw / (H * H), rw / (R * R));
      const wr = R * r.range(0.09, 0.13);
      b.at(Math.sin(a) * rw, yw, Math.cos(a) * rw, a, Math.PI / 2 - tilt, 0, () => {
        b.cyl(wr, wr, -0.3, 0.06, 14, wcol);
        b.at(0, 0.06, 0, 0, 0, 0, () => b.ring(wr + 0.03, 0.07, 16, 6, frameCol));
      });
    }
    // Topper
    const top = pick(r, ['periscope', 'periscope', 'chimney', 'aerial', 'skylight']);
    if (top === 'periscope') {
      const ph = r.range(1.0, 2.6);
      const pr = Math.max(0.16, R * 0.035);
      const a = r.next() * Math.PI * 2;
      b.cyl(pr, pr, H - 0.4, H + ph, 10, STEEL);
      b.box(0, H + ph, 0, pr * 2.6, pr * 2.6, pr * 2.6, STEEL_DARK);
      b.at(0, H + ph, 0, a, Math.PI / 2, 0, () => {
        b.cyl(pr, pr * 1.3, 0, 0.9, 10, STEEL);
        b.cyl(pr * 1.15, pr * 1.15, 0.9, 0.95, 10, INK);
      });
    } else if (top === 'chimney') {
      const cx = R * 0.3;
      const cy = H * Math.sqrt(Math.max(0, 1 - (cx / R) ** 2));
      b.box(cx, cy + 0.4, 0, 0.7, 1.6, 0.7, hex(0xb5523a));
      b.box(cx, cy + 1.25, 0, 0.9, 0.18, 0.9, hex(0x6b2f22));
    } else if (top === 'aerial') {
      b.box(0, H + 1.2, 0, 0.08, 2.6, 0.08, STEEL);
      b.box(0, H + 2.0, 0, 1.4, 0.07, 0.07, STEEL);
      b.box(0, H + 2.5, 0, 0.9, 0.07, 0.07, STEEL);
      b.box(0, H + 2.6, 0, 0.3, 0.3, 0.3, pick(r, DOORS));
    } else {
      b.cyl(R * 0.22, R * 0.2, H - 0.2, H + 0.15, 14, wcol);
      b.at(0, H + 0.15, 0, 0, 0, 0, () => b.ring(R * 0.21, 0.09, 16, 6, frameCol));
    }
  });
}

// ── Oddities ────────────────────────────────────────────────────────────

/** Giant noggles ⌐◨-◨ on two posts. */
function noggles(b: GeoBuilder, r: Rand) {
  const s = r.range(1.4, 2.6);
  const L = 1.6 * s;
  const t = L * 0.16;
  const col = pick(r, NOUN);
  const y = L * 0.5 + r.range(1.2, 2.4);
  for (const k of [-1, 1]) {
    const x = k * L * 0.62;
    b.box(x, y / 2 - 0.5, -0.1, 0.3, y + 1, 0.3, STEEL_DARK, 0, true);
    // Frame (four bars) + the white | black lens halves
    b.box(x, y + L / 2 - t / 2, 0, L, t, t * 1.2, col, 0, true);
    b.box(x, y - L / 2 + t / 2, 0, L, t, t * 1.2, col, 0, true);
    b.box(x - L / 2 + t / 2, y, 0, t, L, t * 1.2, col, 0, true);
    b.box(x + L / 2 - t / 2, y, 0, t, L, t * 1.2, col, 0, true);
    b.box(x - (L - 2 * t) / 4, y, 0, (L - 2 * t) / 2, L - 2 * t, t * 0.6, WHITE);
    b.box(x + (L - 2 * t) / 4, y, 0, (L - 2 * t) / 2, L - 2 * t, t * 0.6, INK);
  }
  // Bridge + the ⌐ arm
  b.box(0, y + L * 0.15, 0, L * 0.28, t, t * 1.2, col);
  b.box(-L * 1.25, y + L * 0.15, 0, L * 0.3, t, t * 1.2, col);
  b.box(-L * 1.4 + t / 2, y + L * 0.15 - L * 0.2, 0, t, L * 0.4 + t, t * 1.2, col);
}

function phonebooth(b: GeoBuilder, r: Rand) {
  const red = r.next() < 0.75 ? hex(0xd61f1f) : pick(r, NOUN);
  const W = 1.15;
  const H = 2.6;
  const panes: ColorFn = (x, y, z) => {
    const side = Math.abs(x) > Math.abs(z) ? z : x;
    const u = (side / W + 0.5) * 3;
    const v = (y / H) * 9;
    const glass =
      v > 2.6 && v < 7.4 && Math.abs(u - Math.round(u)) > 0.12 && Math.abs(side) < W * 0.42;
    return glass ? GLASS : red;
  };
  b.box(0, H / 2 - 0.5, 0, W, H + 1, W, panes, 0.13, true);
  b.box(0, H + 0.05, 0, W * 0.94, 0.25, W * 0.94, hex(0xfff2d0));
  b.box(0, H + 0.24, 0, W * 1.08, 0.14, W * 1.08, red);
  b.box(0, H + 0.36, 0, W * 0.7, 0.12, W * 0.7, red);
  b.box(0, H + 0.48, 0, 0.18, 0.14, 0.18, hex(0xffd23f));
}

function tellies(b: GeoBuilder, r: Rand) {
  const n = 3 + Math.floor(r.next() * 5);
  const BARS = [0xffffff, 0xffe600, 0x00e5ff, 0x26d43c, 0xff2fd6, 0xff2a2a, 0x2a4bff].map(hex);
  const CASE = [0xd9cdb0, 0x26242c, 0x7a4b2a, 0x9a98a6, 0xc9302c, 0x2f8f9e].map(hex);
  let y = -0.3;
  let w0 = r.range(1.7, 2.3);
  for (let i = 0; i < n; i++) {
    const w = Math.max(0.6, w0 * r.range(0.65, 1.0));
    const h = w * r.range(0.7, 0.85);
    const d = w * r.range(0.8, 1.0);
    const yaw = r.range(-0.35, 0.35);
    const ox = r.range(-0.2, 0.2);
    const oz = r.range(-0.2, 0.2);
    const kind = r.next();
    const caseCol = pick(r, CASE);
    const screen: ColorFn = (x, yy) => {
      if (kind < 0.5) return BARS[Math.min(6, Math.max(0, Math.floor((x / w + 0.5) * 7)))];
      if (kind < 0.8)
        return hash3i(Math.floor(x * 10), Math.floor(yy * 10), i, 77) < 0.5 ? WHITE : INK;
      return hsl(0.55 + yy * 0.1, 0.9, 0.55);
    };
    b.at(ox, y, oz, yaw, 0, 0, () => {
      b.box(0, h / 2, 0, w, h, d, caseCol, 0, true);
      b.at(0, h / 2, d / 2, 0, 0, 0, () =>
        b.box(-w * 0.08, 0, 0.01, w * 0.68, h * 0.72, 0.04, screen, w * 0.1),
      );
      b.box(w * 0.38, h * 0.35, d / 2 + 0.02, w * 0.1, w * 0.1, 0.05, INK);
      b.box(w * 0.38, h * 0.6, d / 2 + 0.02, w * 0.1, w * 0.1, 0.05, INK);
      if (i === n - 1) {
        // Rabbit ears
        for (const s of [-1, 1])
          b.at(0, h, 0, 0, 0, s * -0.5, () => b.box(0, w * 0.4, 0, 0.04, w * 0.8, 0.04, STEEL));
      }
    });
    y += h;
    w0 = w;
  }
}

function trafficlight(b: GeoBuilder, r: Rand) {
  const H = r.range(3.2, 4.4);
  b.cyl(0.11, 0.09, -0.5, H, 10, STEEL_DARK);
  b.box(0, H + 0.6, 0, 0.55, 1.5, 0.45, hex(0x22242a), 0, true);
  const lit = Math.floor(r.next() * 3);
  const LAMPS = [0xff2a2a, 0xffb21c, 0x2bd65a];
  for (let i = 0; i < 3; i++) {
    const c = hex(LAMPS[i]);
    if (i !== lit) c.multiplyScalar(0.18);
    b.at(0, H + 1.05 - i * 0.45, 0.23, 0, Math.PI / 2, 0, () => b.cyl(0.16, 0.16, 0, 0.04, 12, c));
    b.box(0, H + 1.25 - i * 0.45, 0.32, 0.4, 0.04, 0.2, hex(0x22242a));
  }
  // Push-button box for the nobody crossing
  b.box(0, 1.1, 0.14, 0.2, 0.3, 0.16, hex(0xffd23f));
}

function sofa(b: GeoBuilder, r: Rand) {
  const col = pick(r, [0xd8a32a, 0x2f9e8f, 0xe56fa1, 0x7a4b2a, 0x5b6bd8, 0xc0392b].map(hex));
  const dark = col.clone().multiplyScalar(0.7);
  const W = r.range(2.2, 3.0);
  b.box(0, 0.15, 0, W, 0.9, 1.0, dark, 0, true);
  b.box(0, 1.0, -0.4, W, 1.0, 0.3, col, 0, true);
  for (const s of [-1, 1]) b.box(s * (W / 2 - 0.15), 0.8, 0, 0.3, 0.5, 1.0, col, 0, true);
  const n = W > 2.6 ? 3 : 2;
  const cw = (W - 0.6) / n;
  for (let i = 0; i < n; i++)
    b.box(-W / 2 + 0.3 + cw * (i + 0.5), 0.7, 0.07, cw - 0.04, 0.22, 0.82, col);
  if (r.next() < 0.6) {
    // Standard lamp
    b.at(W / 2 + 0.6, 0, -0.3, 0, 0, 0, () => {
      b.cyl(0.05, 0.05, 0, 1.8, 8, STEEL_DARK);
      b.cyl(0.4, 0.2, 1.7, 2.2, 12, GLASS_WARM);
    });
  }
  if (r.next() < 0.5) {
    // Coffee table + a mug
    b.box(0, 0.4, 1.4, 1.2, 0.08, 0.6, hex(0x8a5a32));
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        b.box(sx * 0.5, 0.15, 1.4 + sz * 0.22, 0.06, 0.5, 0.06, hex(0x8a5a32));
    b.cyl(0.07, 0.07, 0.44, 0.58, 8, pick(r, NOUN));
  }
}

function mushroom(b: GeoBuilder, r: Rand, x: number, z: number, s: number) {
  const cap = pick(r, [0xe02a2a, 0xe02a2a, 0xff8a1f, 0x8a4fd1, 0x2d7fe0].map(hex));
  b.at(x, 0, z, r.next() * 6, r.range(-0.12, 0.12), r.range(-0.12, 0.12), () => {
    b.cyl(0.18 * s, 0.14 * s, -0.3, 0.8 * s, 10, hex(0xf5ead2));
    const prof: [number, number][] = [
      [0, 0.7 * s],
      [0.62 * s, 0.68 * s],
      [0.6 * s, 0.82 * s],
      [0.48 * s, 1.0 * s],
      [0.26 * s, 1.12 * s],
      [0, 1.15 * s],
    ];
    b.lathe(prof, 14, cap);
    // White spots: little blocks pressed into the cap
    const n = 4 + Math.floor(r.next() * 4);
    for (let i = 0; i < n; i++) {
      const a = r.next() * Math.PI * 2;
      const up = r.range(0.15, 0.85);
      const rr = (0.6 - 0.45 * up) * s;
      const y = (0.82 + 0.3 * up) * s;
      const q = 0.13 * s;
      b.at(Math.cos(a) * rr, y, Math.sin(a) * rr, -a + Math.PI / 2, -0.9 * (1 - up) - 0.2, 0, () =>
        b.box(0, 0, 0, q, q, q * 0.5, WHITE),
      );
    }
  });
}

function mushrooms(b: GeoBuilder, r: Rand) {
  const n = 7 + Math.floor(r.next() * 7);
  const R = r.range(3, 5.5);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r.range(-0.15, 0.15);
    mushroom(b, r, Math.sin(a) * R, Math.cos(a) * R, r.range(0.5, 1.3));
  }
  if (r.next() < 0.5) mushroom(b, r, 0, 0, r.range(2.2, 3.5));
}

function windmill(b: GeoBuilder, r: Rand): { y: number; z: number } {
  const H = r.range(7, 10);
  const body = r.next() < 0.5 ? hex(0xf5ead2) : hex(0xffffff);
  b.cyl(2.1, 1.3, -0.6, H, 12, body, true);
  b.cyl(1.6, 0.05, H, H + 2.2, 12, hex(0xa83a2a));
  b.box(0, 1.0, 1.85, 0.9, 1.9, 0.4, hex(0x7a4b2a));
  const rAt = (y: number) => 2.1 - (0.8 * (y + 0.6)) / (H + 0.6);
  for (const y of [H * 0.45, H * 0.72]) b.box(0, y, rAt(y) - 0.05, 0.5, 0.6, 0.3, GLASS_WARM);
  b.box(0, H + 0.6, 1.5, 0.6, 0.6, 0.8, STEEL_DARK);
  return { y: H + 0.6, z: 1.95 };
}

function windmillSails(b: GeoBuilder, r: Rand) {
  const L = r.range(4.5, 6);
  const cloth = r.next() < 0.6 ? hex(0xfff4e0) : pick(r, DOORS);
  const lattice: ColorFn = (x, y) =>
    (Math.floor(Math.abs(x) * 3) + Math.floor(Math.abs(y) * 3)) % 2 === 0 ? cloth : hex(0x7a4b2a);
  b.box(0, 0, 0.1, 0.5, 0.5, 0.5, STEEL_DARK);
  for (let k = 0; k < 4; k++) {
    b.at(0, 0, 0.3, 0, 0, (k * Math.PI) / 2, () => {
      b.box(0, L / 2, 0, 0.16, L, 0.12, hex(0x7a4b2a));
      b.box(0.45, L * 0.58, 0, 0.75, L * 0.78, 0.05, lattice, 0.34);
    });
  }
}

function stones(b: GeoBuilder, r: Rand) {
  const n = 5 + Math.floor(r.next() * 5);
  const R = r.range(4.5, 7);
  const seed = Math.floor(r.next() * 1e9);
  const rock: ColorFn = (x, y, z) => {
    const h = hash3i(Math.floor(x * 2), Math.floor(y * 2), Math.floor(z * 2), seed);
    return _c.copy(h < 0.2 ? hex(0x6f8f4a) : hex(0x8e8a94)).multiplyScalar(0.85 + h * 0.3);
  };
  const tops: { x: number; z: number; h: number; a: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const h = r.range(2.6, 4.6);
    const x = Math.sin(a) * R;
    const z = Math.cos(a) * R;
    b.at(x, 0, z, a, r.range(-0.08, 0.08), r.range(-0.1, 0.1), () =>
      b.box(0, h / 2 - 0.6, 0, r.range(1.3, 2.0), h + 0.6, 0.9, rock, 0.5, true),
    );
    tops.push({ x, z, h, a });
  }
  // A lintel over one neighbouring pair
  const i = Math.floor(r.next() * n);
  const p = tops[i];
  const q = tops[(i + 1) % n];
  // (stone tops stand at h − 0.3)
  const h = Math.min(p.h, q.h) - 0.3;
  const len = Math.hypot(q.x - p.x, q.z - p.z) + 1.2;
  b.at((p.x + q.x) / 2, h + 0.25, (p.z + q.z) / 2, Math.atan2(q.x - p.x, q.z - p.z), 0, 0, () =>
    b.box(0, 0, 0, 0.7, 0.5, len, rock, 0.5),
  );
}

function ufo(b: GeoBuilder, r: Rand) {
  const R = r.range(3.2, 4.8);
  const hull = pick(r, [0xdfe4ee, 0xdccbf5, 0xc4efdf].map(hex));
  // Nose-dived: tilted, one rim buried
  b.at(0, R * 0.1, 0, 0, r.range(0.3, 0.5), r.range(-0.2, 0.2), () => {
    b.lathe(
      [
        [0, -R * 0.12],
        [R * 0.55, -R * 0.14],
        [R, 0],
        [R * 0.6, R * 0.14],
        [R * 0.35, R * 0.16],
      ],
      24,
      hull,
      false,
      true,
    );
    b.ball(R * 0.36, R * 0.3, R * 0.36, R * 0.15, 16, 6, GLASS);
    const lights = 10;
    for (let k = 0; k < lights; k++) {
      const a = (k / lights) * Math.PI * 2;
      b.box(Math.cos(a) * R * 0.8, R * 0.03, Math.sin(a) * R * 0.8, 0.3, 0.2, 0.3, pick(r, NOUN));
    }
  });
  // Scattered panels + a small green visitor
  for (let k = 0; k < 4; k++) {
    const a = r.next() * Math.PI * 2;
    const d = R + r.range(0.5, 2.5);
    b.at(Math.sin(a) * d, 0, Math.cos(a) * d, r.next() * 6, r.range(-0.3, 0.3), 0, () =>
      b.box(0, 0, 0, r.range(0.4, 0.9), 0.08, r.range(0.4, 1.0), hull),
    );
  }
  const g = hex(0x7ee05a);
  b.at(R + 1.2, 0, R * 0.4, -0.8, 0, 0, () => {
    b.box(0, 0.45, 0, 0.36, 0.6, 0.26, g);
    b.box(0, 1.0, 0, 0.6, 0.5, 0.45, g);
    for (const s of [-1, 1]) {
      b.box(s * 0.14, 1.03, 0.23, 0.18, 0.12, 0.04, INK);
      b.box(s * 0.12, 0.1, 0, 0.1, 0.4, 0.1, g);
    }
    b.box(0, 1.4, 0, 0.04, 0.35, 0.04, g);
    b.box(0, 1.6, 0, 0.12, 0.12, 0.12, hex(0xff2fd6));
  });
}

function vending(b: GeoBuilder, r: Rand) {
  const body = pick(r, [0xd61f1f, 0x2a6bd3, 0x26242c, 0xf2a20c].map(hex));
  const seed = Math.floor(r.next() * 1e9);
  // Glass front: rows of brightly wrapped snacks, steel button column
  const front: ColorFn = (x, y) => {
    if (x > 0.22) return STEEL_DARK;
    if (y < 0.6 || y > 1.7) return INK;
    return hsl(hash3i(Math.floor(x * 7), Math.floor(y * 6), 0, seed), 0.9, 0.55);
  };
  b.box(0, 0.7, 0, 1.0, 2.4, 0.8, body, 0, true);
  b.box(0, 0.75, 0.41, 0.9, 2.2, 0.03, front, 0.12);
  b.box(0.36, 1.2, 0.44, 0.1, 0.25, 0.03, hex(0xffd23f));
  b.box(-0.1, 0.3, 0.44, 0.6, 0.15, 0.04, INK);
}

/** A giant Noun head (with noggles) on a plinth. */
function nounhead(b: GeoBuilder, r: Rand) {
  const S = r.range(2.4, 3.6);
  const head = hsl(r.next(), r.range(0.4, 0.8), r.range(0.45, 0.65));
  b.box(0, 0.2, 0, S * 0.8, 1.4, S * 0.8, hex(0x9a95a6), 0, true);
  b.box(0, 0.9 + S / 2, 0, S, S, S * 0.9, head, S / 6, true);
  // Noggles on the front face
  const L = S * 0.34;
  const t = L * 0.17;
  const col = pick(r, NOUN);
  const y = 0.9 + S * 0.58;
  const z = S * 0.45 + 0.05;
  for (const k of [-1, 1]) {
    const x = k * L * 0.62 + S * 0.08;
    b.box(x, y, z, L, L, 0.12, col);
    b.box(x - (L - 2 * t) / 4, y, z + 0.05, (L - 2 * t) / 2, L - 2 * t, 0.06, WHITE);
    b.box(x + (L - 2 * t) / 4, y, z + 0.05, (L - 2 * t) / 2, L - 2 * t, 0.06, INK);
  }
  b.box(S * 0.08, y + L * 0.15, z, L * 0.3, t, 0.12, col);
  b.box(-S / 2 + 0.05, y + L * 0.15, z, S * 0.24, t, 0.12, col);
  b.box(-S / 2 - 0.02, y + L * 0.15, 0, 0.1, t, S * 0.85, col);
}

function door(b: GeoBuilder, r: Rand) {
  // A door to nowhere: chunky frame, the door swung half open, a doormat
  const col = pick(r, DOORS.slice(0, 6));
  const frame = hex(0xfff4e0);
  const S = r.range(1.2, 1.6);
  b.at(
    0,
    0,
    0,
    0,
    0,
    0,
    () => {
      b.box(-0.62, 0.9, 0, 0.24, 2.9, 0.3, frame, 0, true);
      b.box(0.62, 0.9, 0, 0.24, 2.9, 0.3, frame, 0, true);
      b.box(0, 2.42, 0, 1.48, 0.24, 0.3, frame);
      b.at(-0.5, 0, 0.1, r.range(-0.95, -0.45), 0, 0, () => {
        b.box(0.5, 1.15, 0, 1.0, 2.1, 0.1, col);
        b.box(0.5, 1.6, 0.06, 0.6, 0.6, 0.03, col.clone().multiplyScalar(0.8));
        b.box(0.5, 0.65, 0.06, 0.6, 0.6, 0.03, col.clone().multiplyScalar(0.8));
        b.box(0.86, 1.1, 0.08, 0.09, 0.09, 0.09, hex(0xffd23f));
      });
      b.box(0, 0.05, 0.75, 1.3, 0.12, 0.7, hex(0xc0392b));
    },
    S,
  );
}

function cone(b: GeoBuilder, r: Rand) {
  const H = r.range(3.5, 6);
  const orange = hex(0xff6a12);
  const R = (y: number) => H * (0.28 - 0.21 * (y / H));
  b.box(0, -0.2, 0, H * 0.72, 0.6, H * 0.72, hex(0x2a2630), 0, true);
  b.at(0, 0, 0, 0, r.range(-0.08, 0.08), r.range(-0.08, 0.08), () => {
    // Stacked frustums: crisp reflective bands (vertex colours can't do a hard edge)
    const bands: [number, number, THREE.Color][] = [
      [0.1, 0.33, orange],
      [0.33, 0.48, WHITE],
      [0.48, 0.6, orange],
      [0.6, 0.72, WHITE],
      [0.72, 1, orange],
    ];
    for (const [a, c, paint] of bands) {
      const y0 = Math.max(0.1, a * H);
      const y1 = c * H;
      b.cyl(R(y0), c === 1 ? H * 0.05 : R(y1), y0, y1, 16, paint, true);
    }
  });
}

function duck(r: Rand): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const S = r.range(1.4, 2.6);
  const yel = hex(0xffd31a);
  const orange = hex(0xff7a12);
  b.at(
    0,
    0,
    0,
    0,
    0,
    0,
    () => {
      b.box(0, 0.15, 0, 1.0, 0.7, 1.4, yel, 0.25);
      b.box(0, 0.55, -0.55, 0.6, 0.4, 0.4, yel);
      b.box(0, 0.9, 0.4, 0.75, 0.7, 0.7, yel, 0.25);
      b.box(0, 0.8, 0.9, 0.42, 0.16, 0.38, orange);
      for (const s of [-1, 1]) {
        b.box(s * 0.25, 1.05, 0.76, 0.14, 0.14, 0.04, INK);
        b.box(s * 0.52, 0.3, -0.05, 0.08, 0.35, 0.7, yel.clone().multiplyScalar(0.85));
      }
    },
    S,
  );
  return b.build();
}
