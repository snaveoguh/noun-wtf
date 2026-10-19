import { describe, expect, it } from 'vitest';

import { SEEN_IDS } from '../missions/progress';

import { scene, SCENE_IDS, RACE_COUNT, sceneLength } from './scenes';
import {
  barsAt,
  cameraAt,
  crossed,
  duration,
  ease,
  evalAt,
  shakeOffset,
  skipCues,
  subtitleAt,
  timeScaleAt,
  toLocal,
  toWorld,
  validate,
  washAt,
  type CamPose,
  type Script,
} from './timeline';

const START: CamPose = { pos: [0, 2, 8], look: [0, 1, 0], fov: 70 };

const demo: Script = {
  id: 'demo',
  title: 'Demo',
  steps: [
    { k: 'bars', at: 0, on: true, dur: 0.5 },
    { k: 'shot', at: 0, dur: 2, from: 'start', to: { pos: [1, 1, 3], look: [0, 1, 0], fov: 40 } },
    { k: 'say', at: 0.5, dur: 2, speaker: 'X', text: 'Hello there.', voice: 'oracle' },
    { k: 'sfx', at: 1, id: 'whoosh' },
    { k: 'cue', at: 1.5, name: 'enterUD', must: true },
    { k: 'cue', at: 1.6, name: 'glow' },
    { k: 'time', at: 1, scale: 0, dur: 0.5 },
    { k: 'flash', at: 2, dur: 0.5, color: '#f00' },
    { k: 'title', at: 2, dur: 1, text: 'GO' },
    { k: 'bars', at: 2.5, on: false, dur: 0.5 },
    { k: 'blendOut', at: 3, dur: 1 },
  ],
};

describe('easing', () => {
  it('every curve runs 0 → 1, monotonic, clamped', () => {
    for (const e of ['linear', 'in', 'out', 'inOut', 'whip'] as const) {
      expect(ease(e, 0)).toBeCloseTo(0);
      expect(ease(e, 1)).toBeCloseTo(1);
      expect(ease(e, -1)).toBeCloseTo(0);
      expect(ease(e, 2)).toBeCloseTo(1);
      let prev = -1;
      for (let k = 0; k <= 1.0001; k += 0.05) {
        const v = ease(e, k);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = v;
      }
    }
  });

  it('a whip does most of its move in the middle', () => {
    expect(ease('whip', 0.25)).toBeLessThan(ease('inOut', 0.25));
    expect(ease('whip', 0.75)).toBeGreaterThan(ease('inOut', 0.75));
  });
});

describe('anchor frame', () => {
  it('world ↔ local round-trips at any yaw', () => {
    const a = { x: 10, y: 2, z: -5, yaw: 1.1 };
    const p = [3, 1.5, -2] as const;
    const back = toLocal(a, toWorld(a, p));
    for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(p[i]!);
  });

  it('local +z is the anchor facing (yaw 0 → world +Z, yaw π/2 → world +X)', () => {
    expect(toWorld({ x: 0, y: 0, z: 0, yaw: 0 }, [0, 0, 1])[2]).toBeCloseTo(1);
    expect(toWorld({ x: 0, y: 0, z: 0, yaw: Math.PI / 2 }, [0, 0, 1])[0]).toBeCloseTo(1);
  });
});

describe('timeline evaluation', () => {
  it('the first shot starts exactly at the gameplay camera (no cut in)', () => {
    const c = cameraAt(demo, 0, START);
    expect(c.pos).toEqual(START.pos);
    expect(c.fov).toBe(70);
    const mid = cameraAt(demo, 1, START);
    expect(mid.pos[2]).toBeLessThan(8);
    expect(mid.pos[2]).toBeGreaterThan(3);
    expect(cameraAt(demo, 2.5, START).pos).toEqual([1, 1, 3]); // holds the end
  });

  it('blends back to the live camera over the blendOut step', () => {
    expect(evalAt(demo, 2.9, START).blend).toBe(0);
    expect(evalAt(demo, 3.5, START).blend).toBeCloseTo(0.5);
    const end = evalAt(demo, 4, START);
    expect(end.blend).toBe(1);
    expect(end.done).toBe(true);
    expect(evalAt(demo, 3.99, START).done).toBe(false);
  });

  it('letterbox slides in, holds, slides out', () => {
    expect(barsAt(demo, 0)).toBe(0);
    expect(barsAt(demo, 0.25)).toBeCloseTo(0.5);
    expect(barsAt(demo, 1)).toBe(1);
    expect(barsAt(demo, 2.75)).toBeCloseTo(0.5);
    expect(barsAt(demo, 3.5)).toBe(0);
  });

  it('time scale eases to a freeze', () => {
    expect(timeScaleAt(demo, 0.5)).toBe(1);
    expect(timeScaleAt(demo, 1.25)).toBeCloseTo(0.5);
    expect(timeScaleAt(demo, 2)).toBe(0);
  });

  it('a flash peaks at once and fades', () => {
    expect(washAt(demo, 2)?.a).toBeCloseTo(1);
    expect(washAt(demo, 2.25)!.a).toBeLessThan(0.5);
    expect(washAt(demo, 2.6)).toBeNull();
    // gentler with reduce motion
    expect(washAt(demo, 2, 0.35)?.a).toBeCloseTo(0.35);
  });

  it('subtitles show while their line runs, typed by the reveal clock', () => {
    expect(subtitleAt(demo, 0.4)).toBeNull();
    const s = subtitleAt(demo, 0.65, (_st, e) => Math.floor(e * 10))!;
    expect(s.speaker).toBe('X');
    expect(s.shown).toBe(1);
    expect(subtitleAt(demo, 2.6)).toBeNull();
  });

  it('instant steps fire once as the clock passes them (including at 0)', () => {
    expect(crossed(demo, -1, 0).map(s => s.k)).toEqual([]);
    const all = [...crossed(demo, -1, 0.9), ...crossed(demo, 0.9, 1.55), ...crossed(demo, 1.55, 4)];
    expect(all.map(s => s.k)).toEqual(['say', 'sfx', 'cue', 'cue']);
    // the same window twice fires nothing new
    expect(crossed(demo, 1.55, 1.55)).toEqual([]);
  });

  it('skipping keeps only the must-run cues still ahead', () => {
    expect(skipCues(demo, 0.2).map(c => c.name)).toEqual(['enterUD']);
    expect(skipCues(demo, 1.5)).toEqual([]);
  });

  it('handheld shake is deterministic, small and zero at no amplitude', () => {
    expect(shakeOffset(1.234, 0.02)).toEqual(shakeOffset(1.234, 0.02));
    expect(Math.abs(shakeOffset(5, 0.02)[0])).toBeLessThanOrEqual(0.02);
    expect(shakeOffset(5, 0)).toEqual([0, 0, 0]);
  });
});

describe('the authored scenes', () => {
  it('are the persisted seen-flag ids', () => {
    expect([...SCENE_IDS]).toEqual([...SEEN_IDS]);
  });

  it.each([...SCENE_IDS])('%s is well formed and starts from the gameplay camera', id => {
    const s = scene(id);
    expect(validate(s)).toEqual([]);
    const first = s.steps.find(x => x.k === 'shot' || x.k === 'orbit')!;
    if (id !== 'one') expect(first).toMatchObject({ k: 'shot', at: 0, from: 'start' });
    // letterbox in at the start, gone by the end
    expect(barsAt(s, 1)).toBeGreaterThan(0.9);
    expect(barsAt(s, duration(s))).toBe(0);
    // ends handed back to the gameplay camera
    const end = evalAt(s, duration(s), START);
    expect(end.blend).toBe(1);
    expect(end.done).toBe(true);
    expect(sceneLength(id)).toBeLessThan(30);
  });

  it('every spoken line finishes typing before the scene hands back', () => {
    for (const id of SCENE_IDS)
      for (const st of scene(id).steps)
        if (st.k === 'say') expect(st.at + st.dur).toBeLessThanOrEqual(duration(scene(id)) + 1e-9);
  });

  it('the Twins scene lands GO on the race countdown', () => {
    const go = scene('twins').steps.find(x => x.k === 'title' && x.text === 'GO!')!;
    expect(Math.abs(go.at - RACE_COUNT)).toBeLessThan(0.1);
    expect(sceneLength('twins')).toBeLessThan(RACE_COUNT + 0.6);
  });

  it('the door enters the Upside Down even when skipped', () => {
    expect(skipCues(scene('door'), 0).map(c => c.name)).toEqual(['enterUD']);
  });

  it('The One freezes time, then lets it go', () => {
    const s = scene('one');
    expect(timeScaleAt(s, 0.1)).toBe(0);
    expect(timeScaleAt(s, duration(s))).toBe(1);
  });
});
