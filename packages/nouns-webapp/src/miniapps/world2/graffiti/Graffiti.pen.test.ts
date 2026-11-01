// Mural mode's pen path through the real Graffiti: pressure strokes, across
// a cell seam, out on the wire as joined runs every decoder reads.
import type { CollisionWorld } from '../physics/Collision';

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decodeStrokes as decodeV1 } from './__fixtures__/strokesV1';
import { Graffiti } from './Graffiti';
import { joinRuns } from './mural/runs';
import { decodeStrokes } from './strokes';

const noopCtx = new Proxy({}, { get: () => () => undefined });

/** A wall at x = -4.9 facing +x (its cells' u axis runs along −z). */
const world = {
  raycast(o: THREE.Vector3, d: THREE.Vector3) {
    if (d.x >= 0) return null;
    const t = (-4.9 - o.x) / d.x;
    if (t < 0) return null;
    return {
      point: o.clone().addScaledVector(d, t),
      normal: new THREE.Vector3(1, 0, 0),
      distance: t,
    };
  },
} as unknown as CollisionWorld;

function offlineTags(): string[] {
  const out: string[] = [];
  for (const k of Object.keys(localStorage))
    if (k.startsWith('w2-graffiti-offline'))
      for (const list of Object.values(
        JSON.parse(localStorage.getItem(k)!) as Record<string, string[]>,
      ))
        out.push(...list);
  return out;
}

describe('Graffiti pen strokes (mural mode)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(noopCtx as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it('a pressure wave across a cell seam goes out as valid joined runs on both cells', async () => {
    const g = new Graffiti(world, 'plaza', null);
    await Promise.resolve();
    const from = new THREE.Vector3(-0.1, 1.5, 79.3);
    const dir = new THREE.Vector3();
    g.penBegin();
    const N = 120;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      // z 80.8 → 76.8 crosses the cell seam at z = 78 (u = −78)
      const target = new THREE.Vector3(-4.9, 1.8 + Math.sin(t * Math.PI * 3) * 0.25, 80.8 - 4 * t);
      dir.subVectors(target, from).normalize();
      const r = 6 + 50 * Math.sin(t * Math.PI);
      expect(g.penSample(from, dir, r)).toBe(true);
    }
    g.penEnd();
    g.flush();
    const tags = offlineTags();
    expect(tags.length).toBe(2); // one per cell
    let curvy = 0;
    for (const data of tags) {
      const now = decodeStrokes(data);
      const old = decodeV1(data);
      expect(now).not.toBeNull();
      expect(old).not.toBeNull();
      expect(old!.strokes.length).toBe(now!.strokes.length);
      for (const s of now!.strokes) {
        expect(s.pts.every(Number.isFinite)).toBe(true);
        expect(s.r).toBeGreaterThanOrEqual(2);
      }
      // Joined back up: the wave keeps its shape (not collapsed to a line)
      const items = joinRuns(
        now!.strokes.map(stroke => ({ kind: 'stroke' as const, stroke, seed: 0 })),
      );
      if (items.some(it => it.kind === 'stroke' && it.stroke.pts.length / 2 > 6)) curvy++;
    }
    // Both cells' parts keep the wave (the seam once collapsed one to a line)
    expect(curvy).toBe(2);
    const joined = tags.flatMap(d => decodeStrokes(d)!.strokes).filter(s => s.join === true).length;
    expect(joined).toBeGreaterThan(2);
    g.dispose();
  });

  it('penCancel takes the whole stroke back, and it is not redoable', async () => {
    const g = new Graffiti(world, 'plaza', null);
    await Promise.resolve();
    const from = new THREE.Vector3(-0.1, 1.5, 79.3);
    g.penBegin();
    for (let i = 0; i < 20; i++)
      g.penSample(from, new THREE.Vector3(-4.8, 0.1, -0.05 * i).normalize(), 20);
    g.penCancel();
    g.flush();
    expect(offlineTags()).toEqual([]);
    expect(g.tools.canRedo).toBe(false);
    g.dispose();
  });
});
