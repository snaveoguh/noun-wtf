import { describe, expect, it } from 'vitest';

import { PEAK_LIPSCHITZ, peakHeight, peakNormal } from '../peakTerrain';

import { BRANCH, COURSE } from './courseSpec';
import { type Flight, flyKicker } from './kickerFlight';
import { surfaceAt } from './surface';
import { coneHeight } from './terrainPeak';
import {
  branchKicker,
  CARVE,
  centerX,
  featuresIn,
  kickerShape,
  loopBase,
  sectionAt,
  SECTIONS,
  widthAt,
} from './track';

const FAR = 160_000;
const kickers = featuresIn(0, FAR).filter(f => f.kind === 'kicker');
const loops = featuresIn(0, FAR).filter(f => f.kind === 'loop');
const berms = featuresIn(0, FAR).filter(f => f.kind === 'berm');

/** Unit lateral vector (+x side) of the line at s. */
function side(s: number) {
  const dx = (centerX(s + 0.5) - centerX(s - 0.5)) / 1;
  const l = Math.hypot(dx, 1);
  return { x: 1 / l, z: -dx / l, dirX: dx / l, dirZ: 1 / l };
}

function grad(x: number, z: number, e = 0.25) {
  const gx = (peakHeight(x + e, z) - peakHeight(x - e, z)) / (2 * e);
  const gz = (peakHeight(x, z + e) - peakHeight(x, z - e)) / (2 * e);
  return { gx, gz, m: Math.hypot(gx, gz) };
}

/** Fly a track kicker at `speed` (kickerFlight.ts). */
function fly(f: (typeof kickers)[number], speed: number): Flight {
  const k = kickerShape(f)!;
  return flyKicker(k, centerX(f.s + k.lip), speed);
}

describe('the carved track: kickers', () => {
  it('has a good few jump lines in the first 160 km', () => {
    expect(kickers.length).toBeGreaterThanOrEqual(8);
  });

  it('breaks over sharply enough at every lip for the board to launch', () => {
    for (const f of kickers) {
      const k = kickerShape(f)!;
      const x = centerX(f.s + k.lip);
      const a = peakNormal(x, f.s + k.lip - 0.6, { x: 0, y: 0, z: 0 });
      const b = peakNormal(x, f.s + k.lip + 0.6, { x: 0, y: 0, z: 0 });
      const cos = a.x * b.x + a.y * b.y + a.z * b.z;
      // Player.updateGround launches when the surface turns > 21.6° (cos 0.93)
      expect(cos).toBeLessThan(0.92);
      // ...and the lip throws you up off the fall line, not down it
      expect(k.alpha).toBeGreaterThan(0.025);
      expect(k.h).toBeGreaterThan(5);
    }
  });

  it('gives long airs that land on a downslope, at every speed you could arrive', () => {
    let longest = 0;
    for (const f of kickers) {
      const k = kickerShape(f)!;
      // The SSX course's are governed to their design speed (a little under
      // after a slow corner, 45% over on a boost) and built snappier
      const course = f.s < COURSE.end;
      const factors = course ? [0.75, 1, 1.15, 1.3, 1.45] : [0.5, 0.75, 1, 1.15, 1.3];
      for (const factor of factors) {
        const v = k.speed * factor;
        const fl = fly(f, v);
        longest = Math.max(longest, fl.hang);
        // Built for its arrival speed: 6–14 s of air (4–6 on the course)
        if (factor === 1) {
          expect(fl.hang).toBeGreaterThan(course ? 3 : 5);
          expect(fl.hang).toBeLessThan(22);
          // (the board reads the lip a little soft or hard: within a third)
          expect(Math.abs(fl.hang - k.hang) / k.hang).toBeLessThan(0.35);
        }
        // A downslope steeper than 37°, never the flat…
        expect(fl.ny).toBeLessThan(0.8);
        // …that a level board (the air auto-levels it) still counts as a
        // landing (Player.land: up · normal > 0.62)…
        expect(fl.ny).toBeGreaterThan(0.625);
        // …and comes in clean (Player.land on the mountain: impact along the
        // normal under max(18, 0.8 × the speed along the slope))
        expect(fl.impact).toBeLessThan(Math.max(18, 0.8 * fl.along));
        // Nothing's lost: you ride out faster than you took off
        if (factor >= 0.75) expect(fl.along).toBeGreaterThan(v * 0.95);
      }
    }
    expect(longest).toBeGreaterThan(10);
  });
});

describe('the carved track: lane, gully, berms, loop pads', () => {
  it('grooms a sunk lane with no moguls', () => {
    // (past the SSX course: its cruises carry whoops, berms and the split)
    for (const sec of SECTIONS.filter(c => c.kind === 'cruise' && c.s0 >= COURSE.end).slice(0, 6)) {
      const s = (sec.s0 + sec.s1) / 2 + 7;
      const x = centerX(s);
      expect(peakHeight(x, s) - coneHeight(x, s)).toBeCloseTo(-CARVE.sink, 1);
      expect(surfaceAt(x, s)).toBe('groomed');
      expect(surfaceAt(x + widthAt(s) / 2 + 40, s)).toBe('powder');
    }
  });

  it('cuts a halfpipe through the gullies', () => {
    const g = SECTIONS.find(s => s.kind === 'gully' && s.s0 >= COURSE.end)!;
    const s = (g.s0 + g.s1) / 2;
    const t = side(s);
    const x = centerX(s);
    const at = (lat: number) => {
      const px = x + t.x * lat;
      const pz = s + t.z * lat;
      return peakHeight(px, pz) - coneHeight(px, pz);
    };
    expect(at(0)).toBeCloseTo(-CARVE.gullyDepth - CARVE.sink, 1);
    for (const sgn of [-1, 1]) {
      const lip = sgn * CARVE.gullyHalf;
      expect(at(lip)).toBeCloseTo(-CARVE.sink, 1);
      // ~8–9 m walls, steep, but still ground (normal above 0.55)
      expect(at(lip) - at(sgn * 4)).toBeGreaterThan(8);
      let steepest = 0;
      for (let lat = 0; lat <= 26; lat += 0.5) {
        const px = x + t.x * lat * sgn;
        const pz = s + t.z * lat * sgn;
        steepest = Math.max(steepest, grad(px, pz).m);
      }
      expect(steepest).toBeGreaterThan(1.3);
      expect(1 / Math.hypot(1, steepest)).toBeGreaterThan(0.55);
    }
  });

  it('banks the outside of every slalom turn', () => {
    expect(berms.length).toBeGreaterThan(10);
    for (const f of berms) {
      const s = f.s + f.len / 2;
      const t = side(s);
      const x = centerX(s);
      const half = widthAt(s) / 2;
      const out = peakHeight(x + t.x * half * f.side, s + t.z * half * f.side);
      const inn = peakHeight(x - t.x * half * f.side, s - t.z * half * f.side);
      expect(out - inn).toBeGreaterThan(3);
      if (!f.id.endsWith('.split')) expect(sectionAt(s).kind).toBe('slalom');
    }
  });

  it('lays an exact plane under every loop', () => {
    expect(loops.length).toBeGreaterThan(1);
    for (const f of loops) {
      const b = loopBase(f);
      expect(b.dirY).toBeLessThan(0);
      expect(b.upY).toBeGreaterThan(0.6);
      expect(Math.abs(b.upX * b.dirX + b.upY * b.dirY + b.upZ * b.dirZ)).toBeLessThan(1e-9);
      for (let z = f.s; z <= f.s + f.len; z += 4) {
        // Straight: the line is the chord
        const cx = b.x0 + ((b.x1 - b.x0) * (z - b.z0)) / (b.z1 - b.z0);
        expect(Math.abs(centerX(z) - cx)).toBeLessThan(0.01);
        for (let lat = -b.half; lat <= b.half; lat += 4) {
          const y = b.y0 + (z - b.z0) * b.grade;
          expect(Math.abs(peakHeight(cx + lat, z) - y)).toBeLessThan(0.02);
        }
      }
    }
  });
});

describe('the carved track is safe ground', () => {
  it('stays rideable and under the ray marcher’s slope bound along the first 40 km', () => {
    let steepest = 0;
    let worstGround = 0;
    for (let z = 30; z < 40_000; z += 13) {
      const x0 = centerX(z);
      const reach = widthAt(z) / 2 + CARVE.reach + 10;
      // Kicker back faces are the one steep thing (nobody rides them: the lip
      // launches you), and the SPLIT's crevasse wall just past its gap kicker
      const bk = branchKicker();
      const gap = bk.s + bk.lip + BRANCH.gapFrom;
      const back =
        kickers.some(f => {
          const k = kickerShape(f)!;
          return z > f.s + k.lip - 0.5 && z < f.s + k.lip + k.lb1 + 0.5;
        }) ||
        (z > bk.s + bk.lip - 0.5 && z < bk.s + bk.lip + bk.lb1 + 0.5) ||
        (z > gap - 1 && z < gap + 16);
      for (let lat = -reach; lat <= reach; lat += 5) {
        const g = grad(x0 + lat, z);
        steepest = Math.max(steepest, g.m);
        if (!back) worstGround = Math.max(worstGround, g.m);
      }
    }
    expect(steepest).toBeLessThan(PEAK_LIPSCHITZ);
    // Ground everywhere else: a normal above 0.55 (gradient under 1.518)
    expect(worstGround).toBeLessThan(1.518);
  });

  it('ices the kicker lips', () => {
    const f = kickers[0]!;
    const k = kickerShape(f)!;
    const z = f.s + k.lip - 2;
    expect(surfaceAt(centerX(z), z)).toBe('ice');
  });
});
