import type { Placed } from './placement';

import { describe, expect, it } from 'vitest';

import { centerX, featuresIn, nearestTrack, SECTIONS, TRACK, widthAt } from '../track';

import {
  chunkWindow,
  clearAt,
  featureClear,
  FOREST,
  Kind,
  placeChunk,
  placeFarChunk,
  rng,
} from './placement';

const near = { s: 0, lateral: 0, dist: 0 };

/** Chunks covering the opening sections, a jump line, a loop, and somewhere far down. */
function sampleChunks(): number[] {
  const out = [0, 1, 2, 3];
  for (const k of ['jumps', 'loop', 'slalom', 'gully'] as const) {
    const sec = SECTIONS.find(s => s.kind === k && s.s0 > 3000)!;
    out.push(Math.floor(sec.s0 / FOREST.chunk), Math.floor((sec.s0 + sec.s1) / 2 / FOREST.chunk));
  }
  out.push(Math.floor(250_000 / FOREST.chunk), Math.floor(800_000 / FOREST.chunk));
  return out;
}

describe('Big Drop forest placement', () => {
  it('is deterministic per chunk', () => {
    for (const i of sampleChunks()) {
      const a = placeChunk(i, 'high', []);
      const b = placeChunk(i, 'high', []);
      expect(b).toEqual(a);
      expect(placeFarChunk(i % 50, 'high', [])).toEqual(placeFarChunk(i % 50, 'high', []));
    }
  });

  it('never puts a tree or rock on the groomed lane (plus the margin)', () => {
    let total = 0;
    for (const i of sampleChunks())
      for (const q of ['low', 'high'] as const)
        for (const t of placeChunk(i, q, [])) {
          total++;
          const n = nearestTrack(t.x, t.z, near);
          expect(n.dist).toBeGreaterThan(widthAt(n.s) / 2 + FOREST.margin);
        }
    expect(total).toBeGreaterThan(1000);
  });

  it('keeps every feature clear: gates, kickers and their landings, loops, berms, markers', () => {
    for (const i of sampleChunks()) {
      const s0 = i * FOREST.chunk;
      const feats = featuresIn(s0 - 700, s0 + FOREST.chunk + 100);
      for (const t of placeChunk(i, 'high', [])) {
        const n = nearestTrack(t.x, t.z, near);
        for (const f of feats) {
          const c = featureClear(f, widthAt(n.s) / 2);
          const inside = n.s >= c.s0 && n.s <= c.s1 && n.dist < c.lat;
          expect(inside, `${f.id} at s=${n.s.toFixed(0)} lat=${n.dist.toFixed(1)}`).toBe(false);
        }
      }
    }
  });

  it('clears a kicker landing well downhill of the lip', () => {
    const k = featuresIn(0, 200_000).find(f => f.kind === 'kicker')!;
    const z = k.s + 300;
    const feats = featuresIn(k.s - 700, k.s + 900);
    // 20 m outside the lane, 300 m past the lip: inside the landing zone
    expect(clearAt(centerX(z) + widthAt(z) / 2 + 20, z, 0.5, feats)).toBe(false);
    // …but fine far out to the side
    expect(clearAt(centerX(z) + widthAt(z) / 2 + 120, z, 0.5, feats)).toBe(true);
  });

  it('keeps the summit pad bare and plants something on every stretch', () => {
    for (const t of placeChunk(0, 'high', [])) expect(Math.hypot(t.x, t.z)).toBeGreaterThan(70);
    for (const i of [5, 40, 600, 2000])
      expect(placeChunk(i, 'high', []).length).toBeGreaterThan(80);
  });

  it('scales with quality', () => {
    let lo = 0;
    let hi = 0;
    for (const i of sampleChunks()) {
      lo += placeChunk(i, 'low', []).length;
      hi += placeChunk(i, 'high', []).length;
    }
    expect(lo).toBeLessThan(hi * 0.6);
    expect(lo).toBeGreaterThan(hi * 0.2);
  });

  it('marks only trees near the line as solid (colliders stay modest)', () => {
    let solid = 0;
    let all = 0;
    for (const i of sampleChunks()) {
      const list: Placed[] = placeChunk(i, 'high', []);
      for (const t of list) {
        all++;
        if (!t.solid) continue;
        solid++;
        const n = nearestTrack(t.x, t.z, near);
        expect(n.dist).toBeLessThan(widthAt(n.s) / 2 + FOREST.colliderReach + 0.001);
      }
    }
    expect(solid).toBeGreaterThan(0);
    expect(solid / all).toBeLessThan(0.4);
  });

  it('far stands stay out of the near forest band and off the lane', () => {
    for (let i = 0; i < 40; i += 3)
      for (const t of placeFarChunk(i, 'high', [])) {
        const n = nearestTrack(t.x, t.z, near);
        expect(n.dist).toBeGreaterThan(FOREST.reach.high * 0.6);
        expect(t.kind === Kind.Pine || t.kind === Kind.SnowyPine).toBe(true);
      }
  });

  it('places a chunk fast enough to stream at 600 m/s', () => {
    placeChunk(100, 'high', []);
    const t0 = performance.now();
    const N = 20;
    for (let i = 0; i < N; i++) placeChunk(200 + i, 'high', []);
    const ms = (performance.now() - t0) / N;
    // A 400 m chunk lasts 0.67 s at 600 m/s; one build must fit in a frame's slack
    expect(ms).toBeLessThan(6);
  });
});

describe('Big Drop streaming window', () => {
  it('covers behind..ahead of the rider, clamped to the track', () => {
    const w = chunkWindow(10_000, 400, 300, 2800, { first: 0, last: 0 });
    expect(w.first).toBe(Math.floor(9700 / 400));
    expect(w.last).toBe(Math.floor(12_800 / 400));
    expect(chunkWindow(0, 400, 300, 2800, { first: 0, last: 0 }).first).toBe(0);
    const end = chunkWindow(TRACK.end + 5000, 400, 300, 2800, { first: 0, last: 0 });
    expect(end.last).toBe(Math.floor(TRACK.end / 400));
  });

  it('keeps up at 600 m/s: a chunk ahead is always ready a second out', () => {
    // Moving 10 m per frame (600 m/s at 60 fps), building one chunk a frame,
    // the chunk under the rider + 600 m is always built in time
    const built = new Set<number>();
    const w = { first: 0, last: 0 };
    for (let s = 0; s < 60_000; s += 10) {
      chunkWindow(s, FOREST.chunk, FOREST.behind, FOREST.ahead.low, w);
      for (const i of built) if (i < w.first || i > w.last) built.delete(i);
      for (let i = Math.floor(s / FOREST.chunk); i <= w.last; i++)
        if (!built.has(i)) {
          built.add(i);
          break;
        }
      if (s > 3000) expect(built.has(Math.floor((s + 600) / FOREST.chunk))).toBe(true);
    }
  });

  it('rng is a stable stream in [0, 1)', () => {
    const a = rng(42);
    const b = rng(42);
    for (let i = 0; i < 1000; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
