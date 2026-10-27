import { describe, expect, it } from 'vitest';

import { peakHeight } from '../peakTerrain';

import {
  CAVE_SHELL,
  caveSection,
  insideCave,
  lineFrame,
  type LineFrame,
  railPoints,
} from './courseGeom';
import {
  ARCHES,
  BOOSTS,
  BRANCH,
  CAVE_KICKER,
  CAVES,
  CHECKPOINTS,
  COURSE,
  COURSE_SECTIONS,
  courseBulge,
  courseCap,
  courseClearLat,
  PAD,
  RAILS,
  ROLLERS,
} from './courseSpec';
import { flyKicker } from './kickerFlight';
import { branchLateral } from './terrainCarve';
import { coneHeight } from './terrainPeak';
import {
  branchKicker,
  centerX,
  featuresIn,
  kickerShape,
  lineAt,
  type LineSample,
  SECTIONS,
  sectionAt,
  TRACK,
  widthAt,
} from './track';
import { expectedSpeed } from './trackSpeed';

const f: LineFrame = { x: 0, z: 0, dirX: 0, dirZ: 1, sideX: 1, sideZ: 0, half: 0 };
const ln: LineSample = { cx: 0, dcx: 0, w: 0, gully: 0, cruise: 0, feats: [] };

/** Snow height relative to the bare cone `lat` m off a line at s. */
function carved(line: 'main' | 'branch', s: number, lat: number) {
  lineFrame(line, s, f);
  const x = f.x + f.sideX * lat;
  const z = f.z + f.sideZ * lat;
  return peakHeight(x, z) - coneHeight(x, z);
}

/** Every kicker on the course, main line and shortcut, with the x its lip is at. */
function courseKickers() {
  const out = featuresIn(TRACK.start, COURSE.end)
    .filter(k => k.kind === 'kicker')
    .map(k => {
      const sh = kickerShape(k)!;
      return { shape: sh, x: centerX(k.s + sh.lip), id: k.id };
    });
  const b = branchKicker();
  lineFrame('branch', b.s + b.lip, f);
  out.push({ shape: b, x: f.x, id: 'branch' });
  return out;
}

describe('the SSX course: layout', () => {
  it('lays its sections in order from the summit pad, then hands over to the random track', () => {
    expect(SECTIONS.slice(0, COURSE_SECTIONS.length).map(s => s.kind)).toEqual(
      COURSE_SECTIONS.map(c => c.kind),
    );
    let s0: number = TRACK.start;
    for (const c of COURSE_SECTIONS) {
      expect(c.s1).toBeGreaterThan(s0 + 300);
      s0 = c.s1;
    }
    expect(s0).toBe(COURSE.end);
    expect(COURSE.start).toBeGreaterThan(TRACK.start);
    expect(COURSE.finish).toBeLessThan(COURSE.end);
    // Checkpoints in order, between the start and the finish
    let last: number = COURSE.start;
    for (const c of CHECKPOINTS) {
      expect(c.s).toBeGreaterThan(last + 300);
      last = c.s;
    }
    expect(COURSE.finish).toBeGreaterThan(last + 300);
  });

  it('has every kind of SSX feature', () => {
    const kinds = new Set(featuresIn(TRACK.start, COURSE.end).map(k => k.kind));
    for (const k of ['kicker', 'berm'] as const) expect(kinds.has(k)).toBe(true);
    expect(
      featuresIn(TRACK.start, COURSE.end).filter(k => k.kind === 'berm').length,
    ).toBeGreaterThan(5);
    expect(
      featuresIn(TRACK.start, COURSE.end).filter(k => k.kind === 'kicker').length,
    ).toBeGreaterThan(3);
    expect(COURSE_SECTIONS.some(c => c.kind === 'gully')).toBe(true);
    expect(CAVES.length).toBeGreaterThanOrEqual(2);
    expect(RAILS.length).toBeGreaterThanOrEqual(4);
    expect(new Set(RAILS.map(r => r.look)).size).toBe(3);
    expect(BOOSTS.length).toBeGreaterThanOrEqual(6);
    expect(ARCHES.length).toBeGreaterThanOrEqual(1);
    expect(ROLLERS.length).toBeGreaterThanOrEqual(2);
  });

  it('is governed: a design speed that builds from ~95 to ~195 km/h, then no cap', () => {
    let prev = 0;
    for (let s = TRACK.start; s <= COURSE.end; s += 25) {
      const c = courseCap(s);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
    expect(courseCap(COURSE.start) * 3.6).toBeGreaterThan(90);
    expect(courseCap(COURSE.end) * 3.6).toBeLessThan(200);
    expect(courseCap(COURSE.end + 1)).toBe(Infinity);
    // The run takes 2–3½ minutes at the cap
    let t = 0;
    for (let s = COURSE.start; s < COURSE.finish; s += 1)
      t += Math.hypot(1, 1.15) / expectedSpeed(s);
    expect(t).toBeGreaterThan(120);
    expect(t).toBeLessThan(210);
  });
});

describe('the SSX course: the split', () => {
  it('forks into two lanes that leave and rejoin tangentially', () => {
    expect(courseBulge(BRANCH.s0)).toBe(0);
    expect(courseBulge(BRANCH.s1)).toBe(0);
    const mid = (BRANCH.s0 + BRANCH.s1) / 2;
    expect(Math.abs(courseBulge(mid))).toBeCloseTo(BRANCH.bulge, 6);
    // Apart by more than both lanes in the middle third
    const L = BRANCH.s1 - BRANCH.s0;
    for (let s = BRANCH.s0 + L / 3; s < BRANCH.s1 - L / 3; s += 10)
      expect(Math.abs(courseBulge(s))).toBeGreaterThan(widthAt(s) / 2 + BRANCH.half + 30);
    // The shortcut is shorter than the safe line
    let safe = 0;
    let short = 0;
    for (let s = BRANCH.s0; s < BRANCH.s1; s += 1) {
      safe += Math.hypot(1, centerX(s + 1) - centerX(s));
      lineFrame('branch', s, f);
      const x0 = f.x;
      lineFrame('branch', s + 1, f);
      short += Math.hypot(1, f.x - x0);
    }
    expect(short).toBeLessThan(safe - 20);
  });

  it('carves the shortcut a groomed lane, a trough under its bore and a crevasse after its gap kicker', () => {
    // Groomed and sunk where nothing else is
    expect(carved('branch', BRANCH.s0 + 120, 0)).toBeCloseTo(-0.6, 1);
    lineAt(BRANCH.s0 + 120, ln);
    lineFrame('branch', BRANCH.s0 + 120, f);
    expect(Math.abs(branchLateral(f.x, BRANCH.s0 + 120, ln))).toBeLessThan(0.05);
    // The bore's trough
    const bore = CAVES.find(c => c.line === 'branch')!;
    expect(carved('branch', (bore.s0 + bore.s1) / 2, 0)).toBeLessThan(-4);
    // The crevasse: deep, between the lip and where the air comes down
    const k = branchKicker();
    const g0 = k.s + k.lip + BRANCH.gapFrom;
    expect(carved('branch', g0 + BRANCH.gapLen / 2, 0)).toBeLessThan(-BRANCH.gapDepth * 0.8);
    expect(k.landAt).toBeGreaterThan(g0 + BRANCH.gapLen + 20);
  });

  it('clears the crevasse at speed and drops you in it if you come in slow', () => {
    const k = branchKicker();
    lineFrame('branch', k.s + k.lip, f);
    const g1 = k.s + k.lip + BRANCH.gapFrom + BRANCH.gapLen;
    for (const factor of [0.9, 1, 1.2, 1.45]) {
      const fl = flyKicker(k, f.x, k.speed * factor);
      expect(fl.z).toBeGreaterThan(g1);
      expect(fl.ny).toBeGreaterThan(0.625);
    }
    expect(flyKicker(k, f.x, k.speed * 0.45).z).toBeLessThan(g1);
  });

  it('keeps the trees off both lanes', () => {
    const mid = (BRANCH.s0 + BRANCH.s1) / 2;
    expect(courseClearLat(mid)).toBeGreaterThan(Math.abs(courseBulge(mid)) + BRANCH.half);
    for (const cv of CAVES)
      expect(courseClearLat((cv.s0 + cv.s1) / 2)).toBeGreaterThan(cv.R + cv.mound);
  });
});

describe('the SSX course: caves', () => {
  it('stands its walls outside the lane and its roof well over the snow', () => {
    for (const cv of CAVES) {
      const half = cv.line === 'branch' ? BRANCH.half : widthAt((cv.s0 + cv.s1) / 2) / 2;
      expect(cv.R).toBeGreaterThan(half + 1);
      for (let s = cv.s0; s <= cv.s1; s += 10) {
        const { inner, outer } = caveSection(cv, s, [], []);
        expect(inner.length).toBe(outer.length);
        // Apex (the middle point) over the floor at the line
        const m = (inner.length / 3 - 1) / 2;
        lineFrame(cv.line, s, f);
        const floor = peakHeight(f.x, f.z);
        expect(inner[m * 3 + 1]! - floor).toBeGreaterThan(cv.H);
        // The shell is outside the arch all the way over
        for (let k = 1; k < inner.length / 3 - 1; k++) {
          const di = Math.hypot(inner[k * 3]! - f.x, inner[k * 3 + 2]! - f.z);
          const dout = Math.hypot(outer[k * 3]! - f.x, outer[k * 3 + 2]! - f.z);
          expect(dout + 0.01).toBeGreaterThanOrEqual(di);
          expect(outer[k * 3 + 1]!).toBeGreaterThan(inner[k * 3 + 1]! + CAVE_SHELL * 0.4);
        }
      }
    }
  });

  it('knows when you are inside', () => {
    for (const cv of CAVES) {
      const s = (cv.s0 + cv.s1) / 2;
      lineFrame(cv.line, s, f);
      const y = peakHeight(f.x, f.z);
      expect(insideCave(cv, f.x, y + 1, s)).toBe(true);
      expect(insideCave(cv, f.x + f.sideX * (cv.R + 5), y + 1, s)).toBe(false);
      expect(insideCave(cv, f.x, y + 1, cv.s1 + 5)).toBe(false);
    }
  });

  it('sits the ice cave on the gully, with its exit kicker just past the mouth', () => {
    const ice = CAVES.find(c => c.look === 'ice')!;
    for (let s = ice.s0; s <= ice.s1; s += 10) {
      lineAt(s, ln);
      expect(ln.gully).toBeGreaterThan(0.99);
      expect(sectionAt(s).kind).toBe('gully');
    }
    expect(CAVE_KICKER.s).toBeGreaterThan(ice.s1);
    expect(CAVE_KICKER.s - ice.s1).toBeLessThan(20);
  });
});

describe('the SSX course: kickers land clear', () => {
  it('lands every air on clean downslope, short of the course’s caves, arches and rails', () => {
    // (in the middle of THE SPLIT the two lanes are far apart: the safe
    // line's things are no obstacle to the shortcut's air, nor the other way)
    const apart = (a: number, b: number) => a > BRANCH.s0 + 120 && b < BRANCH.s1 - 120;
    const blocked: [number, number, 'main' | 'branch'][] = [
      ...CAVES.map(c => [c.s0 - 15, c.s1 + 15, c.line] as [number, number, 'main' | 'branch']),
      ...ARCHES.map(a => [a.s - 20, a.s + 20, 'main'] as [number, number, 'main' | 'branch']),
      ...RAILS.map(r => [r.s0 - 5, r.s1 + 5, r.line] as [number, number, 'main' | 'branch']),
    ];
    for (const k of courseKickers())
      for (const factor of [0.75, 1, 1.2, 1.45]) {
        const fl = flyKicker(k.shape, k.x, k.shape.speed * factor);
        expect(fl.ny, `${k.id} ×${factor}`).toBeGreaterThan(0.625);
        expect(fl.impact).toBeLessThan(Math.max(18, 0.8 * fl.along));
        const z0 = k.shape.s + k.shape.lip;
        const line = k.id === 'branch' ? 'branch' : 'main';
        for (const [a, b, l] of blocked) {
          if (l !== line && apart(a, b)) continue;
          expect(fl.z < a || z0 > b, `${k.id} ×${factor} lands at ${fl.z.toFixed(0)}`).toBe(true);
        }
        // …and doesn't fly into a cave or an arch on the way
        for (const cv of CAVES) expect(z0 > cv.s1 || fl.z < cv.s0).toBe(true);
        for (const a of ARCHES) expect(z0 > a.s || fl.z < a.s).toBe(true);
      }
  });

  it('builds them for the speed you carry there (snappier than the open mountain’s)', () => {
    for (const k of courseKickers()) {
      expect(k.shape.speed).toBeLessThanOrEqual(courseCap(k.shape.s) + 0.5);
      expect(k.shape.hang).toBeGreaterThan(3);
      expect(k.shape.hang).toBeLessThan(7);
      expect(k.shape.h).toBeGreaterThan(4);
    }
  });
});

describe('the SSX course: rails, pads and whoops', () => {
  it('puts pads on the lanes, clear of kicker ramps', () => {
    const ks = courseKickers();
    for (const p of BOOSTS) {
      const half = p.line === 'branch' ? BRANCH.half : widthAt(p.s) / 2;
      expect(Math.abs(p.lat) + PAD.half).toBeLessThanOrEqual(half);
      for (const k of ks)
        expect(p.s < k.shape.s - PAD.len || p.s > k.shape.s + k.shape.end).toBe(true);
    }
  });

  it('runs rails over the lane at grind height, following the snow', () => {
    for (const r of RAILS) {
      const half = r.line === 'branch' ? BRANCH.half : widthAt((r.s0 + r.s1) / 2) / 2;
      expect(Math.abs(r.lat)).toBeLessThan(half);
      const pts = railPoints(r);
      expect(pts.length / 3).toBeGreaterThan(20);
      for (let i = 0; i < pts.length; i += 3) {
        const over = pts[i + 1]! - peakHeight(pts[i]!, pts[i + 2]!);
        expect(over).toBeCloseTo(r.h, 1);
      }
    }
  });

  it('raises whoops across the lane', () => {
    for (const r of ROLLERS) {
      const mid = r.s0 + r.wave * Math.max(1, Math.floor((r.s1 - r.s0) / r.wave / 2));
      const crest = carved('main', mid + r.wave / 2, 0);
      const trough = carved('main', mid, 0);
      expect(crest - trough).toBeGreaterThan(r.amp * 0.7);
    }
  });
});
