// ── Gas stations, truck stops, rest areas (looks for road/decorator.ts) ──
//
// Each sits on its forecourt (pads.ts StationFrame): u along the road (the
// forecourt follows its grade), v' out from the road, `a = v' − vmin` from
// the forecourt's road edge. Everything faces the road (−v').
//
//   gas        canopy over two pump islands, NOUN-MART (a shop you can go
//              into: snacks, drinks, drip), the price pylon, air + ice.
//   truckstop  a car canopy and a tall diesel canopy (lanes along the road),
//              the travel center (shop), a diner, a motor inn, parked rigs,
//              and a big Noun head on a pole you can see from the road.
//   rest       parking bays, picnic shelters, a snack shop + restrooms, the
//              area map, pines.

import type { PadFrame } from '../site';
import type { StationFrame } from './pads';
import type { StationKind, StationSite } from './places';

import { NOUN, sub } from '../../world/landmarks/parts';
import { BLOCK_FONT, boxAt, type SignSpec } from '../kit';

import { decalOn, on, onGraded, type PartCtx, type RoadLook, type RoadPart } from './look';
import { STATIONS } from './places';
import {
  ROAD_C,
  canopy,
  car,
  diner,
  lamp,
  motel,
  nounHead,
  pickup,
  pineGeometry,
  pumpIsland,
  pylon,
  semi,
  shelter,
  shop,
} from './props';

const C = ROAD_C;

/** Brand colours per station kind. */
const BRAND: Record<StationKind, { main: number; css: string; accent: string }> = {
  gas: { main: NOUN.red, css: '#e8352b', accent: '#ffc110' },
  truckstop: { main: NOUN.blue, css: '#2b83f6', accent: '#ffc110' },
  rest: { main: C.signGreen, css: '#1f6b3a', accent: '#ffffff' },
};

const CAB_COLOURS = [NOUN.red, NOUN.blue, NOUN.yellow, NOUN.green, 0xf1efe8, NOUN.purple];
const TRAILERS = [0xf1efe8, 0xd9d4c7, 0xb9b6ad, NOUN.orange, 0x2a2f36];

/** Pylon sign key for a station. */
const pylonKey = (id: string) => `pylon:${id}`;

/** Every station's signs, in one atlas (road/signs.ts). */
export function stationSigns(): SignSpec[] {
  const out: SignSpec[] = STATIONS.map(st => {
    const b = BRAND[st.kind];
    const prices =
      st.kind === 'rest'
        ? [{ text: 'REST AREA', size: 0.2, y: 0.62, color: '#ffffff' }]
        : [
            { text: 'REGULAR  4.20', size: 0.13, y: 0.6, color: '#111111' },
            { text: 'DIESEL   6.90', size: 0.13, y: 0.8, color: '#111111' },
          ];
    return {
      key: pylonKey(st.id),
      w: 4.4,
      h: 3.6,
      bg: st.kind === 'rest' ? b.css : '#f1efe8',
      fg: st.kind === 'rest' ? '#ffffff' : b.css,
      border: b.css,
      lines: [
        { text: st.name.toUpperCase(), size: st.name.length > 14 ? 0.12 : 0.16, y: 0.2 },
        { text: '⌐◨-◨', size: 0.16, y: 0.4, color: st.kind === 'rest' ? '#ffffff' : '#e8352b' },
        ...prices,
      ],
    } satisfies SignSpec;
  });
  const flat = (
    key: string,
    w: number,
    h: number,
    text: string,
    bg: string,
    fg: string,
  ): SignSpec => ({
    key,
    w,
    h,
    bg,
    fg,
    border: fg,
    lines: [{ text, size: 0.56, y: 0.55, font: BLOCK_FONT }],
  });
  out.push(
    flat('mart', 8, 1.2, 'NOUN-MART', '#e8352b', '#ffffff'),
    flat('travel', 12, 1.4, 'TRAVEL CENTER · SHOP', '#2b83f6', '#ffffff'),
    flat('diner', 7, 1.6, 'DINER', '#15181c', '#ff638d'),
    flat('motel', 8, 1.1, 'MOTOR INN', '#a8452f', '#ffe9b0'),
    flat('snack', 9, 1.1, 'SNACK SHOP', '#1f6b3a', '#ffffff'),
    flat('ice', 2.2, 0.9, 'ICE', '#dfe9ee', '#2c5e86'),
    flat('air', 2.2, 0.9, 'AIR', '#ffc110', '#111111'),
    flat('diesel', 10, 1.2, 'DIESEL · TRUCKS ONLY', '#2b83f6', '#ffffff'),
    {
      key: 'map',
      w: 3.4,
      h: 2.2,
      bg: '#f1efe8',
      fg: '#1f6b3a',
      border: '#1f6b3a',
      lines: [
        { text: 'YOU ARE HERE', size: 0.16, y: 0.22 },
        { text: '★', size: 0.4, y: 0.58, color: '#e8352b' },
        { text: 'NOUN WORLD ROAD MAP', size: 0.1, y: 0.88 },
      ],
    },
  );
  return out;
}

const V = (f: PadFrame, a: number) => f.vmin + a;

// ── Gas ──

function gasParts(f: PadFrame, st: StationSite): RoadPart[] {
  const L = f.Lf;
  const brand = BRAND.gas;
  const uc = L / 2;
  return [
    {
      // Forecourt, canopy and pumps
      vp: V(f, 9),
      u: uc - 6,
      build(b, ctx) {
        decalOn(b, ctx, V(f, 0), V(f, 34), 2, L - 2, C.asphalt);
        // Bay lines in front of the shop
        for (let u = uc - 10; u <= uc + 12; u += 3.2)
          decalOn(b, ctx, V(f, 24), V(f, 28.5), u - 0.07, u + 0.07, C.line, 0.03);
        const m = on(b, ctx, V(f, 9), uc - 6, 0, -1, 0);
        canopy(b, sub(m, 0, -3, 0), 26, 13, 6.4 + 3, brand.main, [-10, 0, 10]);
        for (const a of [6, 12]) {
          const im = on(b, ctx, V(f, a), uc - 6, 0, -1, 0);
          pumpIsland(b, im, 11, 2, brand.main);
        }
      },
    },
    {
      // NOUN-MART: shop you can enter
      vp: V(f, 29),
      u: uc + 2,
      build(b, ctx) {
        const m = on(b, ctx, V(f, 24), uc + 2, 0, -1, 0);
        b.add(boxAt(-9, 9, -3, 0, -11, 0), C.concrete, m, { collide: true });
        shop(b, m, 18, 10, 4.6, 0xf1efe8, brand.main, 'mart');
        // Ice chest + air stand by the door
        // (kept 3 m off the shop front: a sign that close would name the shop, interiors/townDoors.ts)
        const im = on(b, ctx, V(f, 21), uc + 9.8, 0, -1, 0);
        b.add(boxAt(-1, 1, 0, 1.3, -0.7, 0), 0xdfe9ee, im, { collide: true });
        b.sign('ice', im, 0, 1.0, 0.02, 0.6);
        const am = on(b, ctx, V(f, 21), uc - 9.5, 0, -1, 0);
        b.add(boxAt(-0.4, 0.4, 0, 1.5, -0.3, 0.3), C.yellow, am, { collide: true });
        b.sign('air', am, 0, 1.25, 0.31, 0.3);
        if (!ctx.low) {
          car(b, onGraded(b, ctx, V(f, 26.5), uc - 6.5, 0), NOUN.teal);
          pickup(b, onGraded(b, ctx, V(f, 26.5), uc + 12, 0, -1), NOUN.orange);
        }
      },
    },
    {
      // Pylon at the road edge, lamps
      vp: V(f, 1),
      u: L - 5,
      build(b, ctx) {
        pylon(b, on(b, ctx, V(f, 1), L - 5, 0, -1, 0), pylonKey(st.id), 10, 4.4, 3.6);
        for (const u of [6, L - 14]) lamp(b, on(b, ctx, V(f, 1.2), u, 0, -1, 0));
      },
    },
  ];
}

// ── Truck stop ──

function truckParts(f: PadFrame, st: StationSite): RoadPart[] {
  const L = f.Lf;
  const brand = BRAND.truckstop;
  return [
    {
      // Forecourt + the car canopy
      vp: V(f, 9),
      u: 20,
      build(b, ctx) {
        decalOn(b, ctx, V(f, 0), V(f, 54), 2, L - 2, C.asphalt);
        for (let u = 50; u <= 92; u += 7)
          decalOn(b, ctx, V(f, 38), V(f, 54), u - 0.08, u + 0.08, C.line, 0.03);
        const m = on(b, ctx, V(f, 9), 20, 0, -1, 0);
        canopy(b, sub(m, 0, -3, 0), 22, 13, 6.2 + 3, brand.main, [-9, 0, 9]);
        for (const a of [6, 12])
          pumpIsland(b, on(b, ctx, V(f, a), 20, 0, -1, 0), 10, 2, brand.main);
      },
    },
    {
      // The diesel canopy: three lanes along the road, tall enough for rigs
      vp: V(f, 11),
      u: 62,
      build(b, ctx) {
        const m = on(b, ctx, V(f, 11), 62, 0, -1, 0);
        canopy(b, sub(m, 0, -3, 0), 34, 17, 7.6 + 3, NOUN.yellow, [-15, 0, 15]);
        b.sign('diesel', m, 0, 8.3, 8.55);
        for (const a of [5.5, 11, 16.5])
          pumpIsland(b, on(b, ctx, V(f, a), 62, 0, -1, 0), 14, 2, NOUN.yellow);
        if (!ctx.low)
          semi(b, onGraded(b, ctx, V(f, 8.2), 70, 0), NOUN.red, 0xf1efe8, { stripe: NOUN.red });
      },
    },
    {
      // Travel center (the shop) + motor inn behind
      vp: V(f, 30),
      u: 22,
      build(b, ctx) {
        const m = on(b, ctx, V(f, 22), 22, 0, -1, 0);
        b.add(boxAt(-13, 13, -3, 0, -11, 0), C.concrete, m, { collide: true });
        shop(b, m, 26, 10, 5.2, 0xd9d4c7, brand.main, 'travel');
        const mm = on(b, ctx, V(f, 41), 22, 0, -1, 0);
        b.add(boxAt(-17.5, 17.5, -3, 0, -9.5, 2.4), C.concrete, mm, { collide: true });
        motel(b, mm, 8, 0xeedcb3, NOUN.teal, 'motel');
      },
    },
    {
      // Diner + parked rigs + the big head
      vp: V(f, 34),
      u: 68,
      build(b, ctx) {
        const m = on(b, ctx, V(f, 26), 62, 0, -1, 0);
        b.add(boxAt(-8, 8, -3, 0, -9.5, 0), C.concrete, m, { collide: true });
        diner(b, m, 16, NOUN.pink, 'diner');
        const n = ctx.low ? 2 : 4;
        for (let i = 0; i < n; i++) {
          const a = i % 2 === 0 ? 43 : 50;
          const u = 56 + Math.floor(i / 2) * 20 + 14;
          semi(
            b,
            onGraded(b, ctx, V(f, a), u, 0),
            CAB_COLOURS[(i + st.s) % CAB_COLOURS.length],
            TRAILERS[i % TRAILERS.length],
          );
        }
        nounHead(b, on(b, ctx, V(f, 2), L - 6, 0, -1, 0), NOUN.yellow, NOUN.red, 5);
        pylon(b, on(b, ctx, V(f, 1), 6, 0, -1, 0), pylonKey(st.id), 11, 4.4, 3.6);
        for (const u of [36, L - 18]) lamp(b, on(b, ctx, V(f, 1.2), u, 0, -1, 0));
      },
    },
  ];
}

// ── Rest area ──

function restParts(f: PadFrame, st: StationSite): RoadPart[] {
  const L = f.Lf;
  return [
    {
      vp: V(f, 7),
      u: L / 2,
      build(b, ctx) {
        decalOn(b, ctx, V(f, 0), V(f, 13), 3, L - 3, C.asphalt);
        for (let u = 8; u <= L - 8; u += 3.4)
          decalOn(b, ctx, V(f, 7), V(f, 13), u - 0.07, u + 0.07, C.line, 0.03);
        pylon(b, on(b, ctx, V(f, 1), 5, 0, -1, 0), pylonKey(st.id), 7, 4.4, 3.6);
        if (!ctx.low) {
          car(b, onGraded(b, ctx, V(f, 10), 18.7, 0), NOUN.purple);
          pickup(b, onGraded(b, ctx, V(f, 10), 32.3, 0, -1), NOUN.green);
        }
        lamp(b, on(b, ctx, V(f, 1.2), L - 10, 0, -1, 0));
      },
    },
    {
      vp: V(f, 25),
      u: L / 2,
      build(b, ctx) {
        // Snack shop + restrooms (enterable)
        const m = on(b, ctx, V(f, 19), L / 2 + 6, 0, -1, 0);
        b.add(boxAt(-7, 7, -3, 0, -9, 0), C.concrete, m, { collide: true });
        shop(b, m, 14, 8, 4.2, 0xeedcb3, C.signGreen, 'snack');
        for (const u of [10, 22]) shelter(b, on(b, ctx, V(f, 22), u, 0, -1, 0), C.roofRed);
        const mm = on(b, ctx, V(f, 16), L - 7, 0, -1, 0);
        for (const x of [-1.4, 1.4])
          b.add(boxAt(x - 0.1, x + 0.1, 0, 2.2, -0.1, 0.1), C.woodDark, mm);
        b.add(boxAt(-1.8, 1.8, 0.9, 3.2, -0.12, -0.02), C.woodDark, mm);
        b.sign('map', mm, 0, 2.05, 0.0, 1);
        for (let i = 0; i < 9; i++) {
          const u = 4 + i * ((L - 8) / 8);
          b.plant(V(f, 33 + (i % 3)), u, b.f.P + ctx.lift(u) - 0.2, i * 1.7, 0.9 + (i % 3) * 0.15);
        }
      },
    },
  ];
}

const LOOKS: Record<StationKind, (f: PadFrame, st: StationSite) => RoadPart[]> = {
  gas: gasParts,
  truckstop: truckParts,
  rest: restParts,
};

/** A station's look (its signs live in the shared road atlas). */
export function stationLook(st: StationSite): RoadLook {
  return {
    signs: stationSigns,
    parts: f => LOOKS[st.kind](f, st),
    plant: st.kind === 'rest' ? () => pineGeometry(false) : undefined,
  };
}

/** Context for a live station (its forecourt grade). */
export function stationCtx(f: StationFrame, low: boolean, ground: PartCtx['ground']): PartCtx {
  return { ground, lift: u => f.grade * u, grade: f.grade, low };
}
