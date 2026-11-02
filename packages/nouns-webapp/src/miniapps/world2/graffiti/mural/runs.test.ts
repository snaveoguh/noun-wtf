import { describe, expect, it } from 'vitest';

import { decodeStrokes as decodeV1, validTag as validV1 } from '../__fixtures__/strokesV1';
import { WallLog } from '../history';
import {
  decodeStrokes,
  encodeStrokes,
  hash48,
  MAX_POINTS,
  type Stroke,
  validTag,
} from '../strokes';

import { continues, joinRuns, MAX_RUNS, mergeRuns, rung, simplifyVar, splitRuns } from './runs';

const look = { color: 0xf3322c, hard: false, opacity: 16 };

/** A left-to-right line whose radius swells from `a` to `b` mm. */
function swell(n: number, a: number, b: number) {
  const pts: number[] = [];
  const rs: number[] = [];
  for (let i = 0; i < n; i++) {
    pts.push(200 + i * 20, 1500 + Math.round(Math.sin(i / 6) * 80));
    rs.push(a + ((b - a) * i) / (n - 1));
  }
  return { pts, rs };
}

describe('pressure runs', () => {
  it('a steady radius is one ordinary stroke (no join)', () => {
    const { pts, rs } = swell(30, 20, 20);
    const runs = splitRuns(look, pts, rs);
    expect(runs).toHaveLength(1);
    expect(runs[0].join).toBeUndefined();
    expect(runs[0].pts).toEqual(pts);
  });

  it('a swell becomes joined runs that share their end points', () => {
    const { pts, rs } = swell(120, 4, 60);
    const runs = splitRuns(look, pts, rs);
    expect(runs.length).toBeGreaterThan(3);
    expect(runs.length).toBeLessThanOrEqual(MAX_RUNS);
    expect(runs[0].join).toBeUndefined();
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i].join).toBe(true);
      expect(continues(runs[i - 1], runs[i])).toBe(true);
    }
    // Radii only ever step up along a swell, in even 2 mm steps
    for (let i = 1; i < runs.length; i++) expect(runs[i].r).toBeGreaterThan(runs[i - 1].r);
    for (const r of runs) expect(r.r % 2).toBe(0);
    expect(rung(3)).toBe(2);
    // Every point survives, once (junctions shared)
    expect(mergeRuns(runs).pts).toEqual(pts);
  });

  it('wild pressure is capped at MAX_RUNS by coarsening the ladder', () => {
    const pts: number[] = [];
    const rs: number[] = [];
    for (let i = 0; i < 300; i++) {
      pts.push(100 + i * 10, 1000);
      rs.push(i % 2 === 0 ? 4 : 160);
    }
    expect(splitRuns(look, pts, rs).length).toBeLessThanOrEqual(MAX_RUNS);
  });

  it('runs longer than MAX_POINTS are split (and still join)', () => {
    const { pts, rs } = swell(MAX_POINTS * 2 + 5, 30, 30);
    const runs = splitRuns(look, pts, rs);
    expect(runs.length).toBe(3);
    for (const r of runs) expect(r.pts.length / 2).toBeLessThanOrEqual(MAX_POINTS);
    expect(mergeRuns(runs).pts).toEqual(pts);
  });

  it('merged radii are smooth: no jump bigger than a rung between neighbours', () => {
    const { pts, rs } = swell(150, 4, 120);
    const { rs: m } = mergeRuns(splitRuns(look, pts, rs));
    for (let i = 1; i < m.length; i++) expect(Math.abs(m[i] - m[i - 1])).toBeLessThan(m[i] * 0.2);
    expect(m[0]).toBeLessThan(8);
    expect(m[m.length - 1]).toBeGreaterThan(90);
  });

  it('simplifyVar keeps a taper on a straight line', () => {
    const pts: number[] = [];
    const rs: number[] = [];
    for (let i = 0; i <= 100; i++) {
      pts.push(i * 10, 500);
      rs.push(i < 50 ? 10 : 10 + (i - 50) * 2);
    }
    const s = simplifyVar(pts, rs, 1);
    // The bend in radius at i = 50 is kept; the straight constant part isn't
    expect(s.pts.length / 2).toBeGreaterThanOrEqual(3);
    expect(s.pts.length / 2).toBeLessThan(10);
    expect(s.pts.slice(0, 2)).toEqual([0, 500]);
    expect(s.rs[s.rs.length - 1]).toBe(110);
  });
});

describe('wire format: joined runs', () => {
  const runs = splitRuns(look, ...(Object.values(swell(90, 6, 70)) as [number[], number[]]));
  const tag = { id: hash48('n'), strokes: [{ ...look, r: 20, pts: [10, 10, 400, 400] }, ...runs] };
  const data = encodeStrokes(tag);

  it('round-trips with join flags', () => {
    const back = decodeStrokes(data)!;
    expect(back.strokes).toHaveLength(tag.strokes.length);
    back.strokes.forEach((s, i) => {
      expect(s.pts).toEqual(tag.strokes[i].pts);
      expect(s.r).toBe(tag.strokes[i].r);
      expect(s.join === true).toBe(i > 1);
    });
  });

  it('the shipped (pre-change) decoder reads every run as a plain stroke', () => {
    const old = decodeV1(data)!;
    expect(old).not.toBeNull();
    expect(old.strokes).toHaveLength(tag.strokes.length);
    old.strokes.forEach((s, i) => {
      expect(s.pts).toEqual(tag.strokes[i].pts);
      expect(s.r).toBe(tag.strokes[i].r);
      expect((s as Stroke).join).toBeUndefined();
    });
  });

  it('passes the store’s gate, old and new (world-graffiti and the snapshot builder use it)', () => {
    expect(validTag(data)).toBe(true);
    expect(validV1(data)).toBe(true);
  });

  it('old tags decode exactly as before (no joins appear)', () => {
    const plain = encodeStrokes({
      id: hash48('x'),
      strokes: [{ ...look, r: 8, pts: [0, 0, 5000, 2000] }],
    });
    expect(decodeStrokes(plain)).toEqual(decodeV1(plain));
  });

  it('a join flag on a tag’s first stroke is never written', () => {
    const lone = encodeStrokes({ id: hash48('y'), strokes: [runs[2]] });
    expect(decodeStrokes(lone)!.strokes[0].join).toBeUndefined();
  });

  it('WallLog → joinRuns draws the runs as one variable-width stroke', () => {
    const log = new WallLog();
    log.add(data);
    const items = joinRuns(log.items());
    expect(items).toHaveLength(2);
    const v = items[1];
    expect(v.kind).toBe('stroke');
    if (v.kind !== 'stroke') return;
    expect(v.rs).toBeDefined();
    expect(v.rs!.length * 2).toBe(v.stroke.pts.length);
    expect(v.stroke.r).toBe(Math.max(...v.rs!));
  });

  it('joinRuns leaves lists without joins alone', () => {
    const log = new WallLog();
    log.add(encodeStrokes({ id: hash48('z'), strokes: [{ ...look, r: 8, pts: [0, 0, 50, 20] }] }));
    const items = log.items();
    expect(joinRuns(items)).toBe(items);
  });

  it('a join that does not line up (other colour / gap) is drawn on its own', () => {
    const a: Stroke = { ...look, r: 10, pts: [0, 0, 100, 0] };
    const b: Stroke = { ...look, r: 20, pts: [100, 0, 200, 0], join: true, color: 0x00ff00 };
    const c: Stroke = { ...look, r: 20, pts: [150, 0, 200, 0], join: true };
    expect(continues(a, b)).toBe(false);
    expect(continues(a, c)).toBe(false);
    const items = joinRuns([a, b, c].map(stroke => ({ kind: 'stroke' as const, stroke, seed: 1 })));
    expect(items).toHaveLength(3);
  });
});
