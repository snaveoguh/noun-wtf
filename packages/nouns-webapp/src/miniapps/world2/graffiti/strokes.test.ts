import { describe, expect, it } from 'vitest';

import {
  decodeDabs,
  decodeRemoval,
  decodeStrokes,
  decodeTag,
  encodeDabs,
  encodeRemoval,
  encodeStrokes,
  hash48,
  MAX_POINTS,
  MAX_STROKES,
  MAX_TAG_CHARS,
  simplify,
  type Stroke,
  validTag,
} from './strokes';

const stroke = (over: Partial<Stroke> = {}): Stroke => ({
  color: 0xf3322c,
  r: 10,
  hard: false,
  opacity: 16,
  pts: [100, 200, 140, 260, 900, 1800],
  ...over,
});

// A tag written by the shipped game before this change (encodeDabs at HEAD)
const LEGACY = 'g2:' + btoa(String.fromCharCode(0x80, 0x08, 0x00, 0x40, 0x20));

describe('legacy g2 tags', () => {
  it('still decode exactly as before', () => {
    const d = decodeDabs(LEGACY)!;
    expect(d).toHaveLength(1);
    expect(d[0].u).toBeCloseTo(2048 / 4095, 6);
    expect(d[0].v).toBeCloseTo(2048 / 4095, 6);
    expect(d[0].r).toBeCloseTo((64 / 255) * 0.25, 6);
    expect(d[0].c).toBe(2);
    expect(decodeTag(LEGACY)?.kind).toBe('dabs');
    expect(validTag(LEGACY)).toBe(true);
  });

  it('round-trip through encodeDabs', () => {
    const dabs = [
      { u: 0.25, v: 0.75, r: 0.05, c: 3 },
      { u: 1, v: 0, r: 0.25, c: 15 },
    ];
    const back = decodeDabs(encodeDabs(dabs))!;
    back.forEach((b, i) => {
      expect(b.u).toBeCloseTo(dabs[i].u, 3);
      expect(b.v).toBeCloseTo(dabs[i].v, 3);
      expect(b.r).toBeCloseTo(dabs[i].r, 2);
      expect(b.c).toBe(dabs[i].c);
    });
  });

  it('are not mistaken for strokes (and vice versa)', () => {
    expect(decodeStrokes(LEGACY)).toBeNull();
    const g3 = encodeStrokes({ id: hash48('x'), strokes: [stroke()] });
    expect(decodeDabs(g3)).toBeNull();
  });
});

describe('g3 strokes', () => {
  it('round-trip colour, size, cap, opacity and points', () => {
    const s = [
      stroke(),
      stroke({ color: 0x00ff00, r: 160, hard: true, opacity: 5, pts: [-500, 3500] }),
      stroke({ color: 0, r: 4, pts: [6000, 3000, 5999, 2999, -1000, -1000] }),
    ];
    const id = hash48('nonce');
    const tag = decodeStrokes(encodeStrokes({ id, strokes: s }))!;
    expect(tag.id).toBe(id);
    expect(tag.strokes).toEqual(s);
  });

  it('quantise radius to 2 mm and clamp points to the cell margin', () => {
    const t = decodeStrokes(
      encodeStrokes({ id: hash48('q'), strokes: [stroke({ r: 7.4, pts: [99999, -99999] })] }),
    )!;
    expect(t.strokes[0].r).toBe(8);
    expect(t.strokes[0].pts).toEqual([7000, -1000]);
  });

  it('is small: a 100-point fine-tip curve is well under 400 bytes', () => {
    const pts: number[] = [];
    for (let i = 0; i < 100; i++) pts.push(1000 + i * 15, 1500 + Math.round(Math.sin(i / 6) * 300));
    const data = encodeStrokes({ id: hash48('s'), strokes: [stroke({ pts })] });
    expect(data.length).toBeLessThan(400 * (4 / 3));
  });

  it('caps points and strokes when encoding', () => {
    const pts: number[] = [];
    for (let i = 0; i < MAX_POINTS + 50; i++) pts.push(i, i);
    const many = Array.from({ length: MAX_STROKES + 5 }, () => stroke({ pts: [1, 1] }));
    const t1 = decodeStrokes(encodeStrokes({ id: hash48('a'), strokes: [stroke({ pts })] }))!;
    expect(t1.strokes[0].pts.length / 2).toBe(MAX_POINTS);
    const t2 = decodeStrokes(encodeStrokes({ id: hash48('b'), strokes: many }))!;
    expect(t2.strokes).toHaveLength(MAX_STROKES);
  });
});

describe('validation limits', () => {
  const bytes = (b: number[]) => 'g3:' + btoa(String.fromCharCode(...b));
  const header = [1, 0, 0, 0, 0, 0, 1];

  it('accepts a minimal stroke', () => {
    // rgb, r=5 (10 mm), flags=15, n=1, u=1000+0, v=1000+0
    expect(validTag(bytes([...header, 255, 0, 0, 5, 15, 1, 3, 232, 3, 232]))).toBe(true);
  });

  it('rejects out-of-range size, flags, point counts and coordinates', () => {
    expect(validTag(bytes([...header, 255, 0, 0, 0, 15, 1, 3, 232, 3, 232]))).toBe(false); // r 0
    expect(validTag(bytes([...header, 255, 0, 0, 250, 15, 1, 3, 232, 3, 232]))).toBe(false); // r 500mm
    expect(validTag(bytes([...header, 255, 0, 0, 5, 0x80, 1, 3, 232, 3, 232]))).toBe(false); // flags
    expect(validTag(bytes([...header, 255, 0, 0, 5, 15, 0, 3, 232, 3, 232]))).toBe(false); // n 0
    expect(validTag(bytes([...header, 255, 0, 0, 5, 15, 1, 255, 255, 3, 232]))).toBe(false); // u huge
    expect(validTag(bytes([...header, 255, 0, 0, 5, 15, 2, 3, 232, 3, 232]))).toBe(false); // truncated
    expect(validTag(bytes([2, 0, 0, 0, 0, 0, 1, 255, 0, 0, 5, 15, 1, 3, 232, 3, 232]))).toBe(false); // version
  });

  it('rejects junk, empty and oversized tags', () => {
    expect(validTag('hello')).toBe(false);
    expect(validTag('g3:')).toBe(false);
    expect(validTag('g2:')).toBe(false);
    expect(validTag('g3:!!!')).toBe(false);
    expect(validTag(42)).toBe(false);
    expect(validTag('g3:' + 'A'.repeat(MAX_TAG_CHARS))).toBe(false);
    expect(validTag('g2:' + 'A'.repeat(7000))).toBe(false);
  });

  it('validates removals', () => {
    expect(validTag(encodeRemoval('0123456789abcdef', [0, 3]))).toBe(true);
    expect(validTag('g3r:0123456789abcdef:')).toBe(false);
    expect(validTag('g3r:xyz:1')).toBe(false);
    expect(validTag('g3r:0123456789abcdef:99')).toBe(false);
  });
});

describe('removals', () => {
  it('name the tag by the hash of the private nonce', () => {
    const r = decodeRemoval(encodeRemoval('00112233aabbccdd', [4, 1, 4]))!;
    expect(r.id).toBe(hash48('00112233aabbccdd'));
    expect(r.indices).toEqual([1, 4]);
  });
});

describe('simplify (RDP)', () => {
  it('drops collinear points and keeps corners', () => {
    const pts = [0, 0, 10, 0, 20, 0, 30, 0, 30, 10, 30, 20];
    expect(simplify(pts, 1)).toEqual([0, 0, 30, 0, 30, 20]);
  });

  it('keeps detail above the tolerance', () => {
    const pts = [0, 0, 10, 3, 20, 0];
    expect(simplify(pts, 1)).toEqual(pts);
    expect(simplify(pts, 5)).toEqual([0, 0, 20, 0]);
  });

  it('stays within eps of the original curve', () => {
    const pts: number[] = [];
    for (let i = 0; i <= 300; i++) pts.push(i * 4, Math.round(Math.sin(i / 20) * 200));
    const eps = 2;
    const out = simplify(pts, eps);
    expect(out.length).toBeLessThan(pts.length / 3);
    // Every original point is within eps (+ rounding) of the simplified polyline
    for (let i = 0; i < pts.length; i += 2) {
      let best = Infinity;
      for (let k = 0; k + 3 < out.length; k += 2) {
        const [ax, ay, bx, by] = out.slice(k, k + 4);
        const dx = bx - ax;
        const dy = by - ay;
        const t = Math.max(
          0,
          Math.min(1, ((pts[i] - ax) * dx + (pts[i + 1] - ay) * dy) / (dx * dx + dy * dy)),
        );
        best = Math.min(best, Math.hypot(pts[i] - ax - t * dx, pts[i + 1] - ay - t * dy));
      }
      expect(best).toBeLessThanOrEqual(eps + 1e-9);
    }
  });

  it('leaves 1- and 2-point strokes alone', () => {
    expect(simplify([5, 5], 3)).toEqual([5, 5]);
    expect(simplify([5, 5, 6, 6], 3)).toEqual([5, 5, 6, 6]);
  });
});
