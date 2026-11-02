import { beforeEach, describe, expect, it } from 'vitest';

import {
  CANCEL_MS,
  GestureClassifier,
  type GestureOut,
  type GestureSample,
  PALM_MS,
  TAP_MS,
} from './gestures';

let log: string[];
let pans: [number, number][];
let zooms: number[];
const out: GestureOut = {
  paintStart: s => log.push(`start:${s.type}:${s.id}`),
  paintMove: s => log.push(`move:${s.id}`),
  paintEnd: s => log.push(`end:${s.id}`),
  paintCancel: () => log.push('cancel'),
  pan: (dx, dy) => pans.push([dx, dy]),
  zoom: f => zooms.push(f),
  undo: () => log.push('undo'),
  redo: () => log.push('redo'),
};

const S = (o: Partial<GestureSample>): GestureSample => ({
  id: 1,
  type: 'touch',
  x: 100,
  y: 100,
  t: 0,
  pressure: 0.5,
  w: 20,
  h: 20,
  button: 0,
  ...o,
});

let g: GestureClassifier;
beforeEach(() => {
  log = [];
  pans = [];
  zooms = [];
  g = new GestureClassifier(out);
});

describe('pen paints, fingers navigate', () => {
  it('a pen stroke paints', () => {
    g.down(S({ id: 9, type: 'pen' }));
    g.move(S({ id: 9, type: 'pen', x: 120 }));
    g.up(S({ id: 9, type: 'pen', x: 120, t: 50 }));
    expect(log).toEqual(['start:pen:9', 'move:9', 'end:9']);
  });

  it('after a pen, one finger pans instead of painting', () => {
    g.down(S({ id: 9, type: 'pen' }));
    g.up(S({ id: 9, type: 'pen', t: 10 }));
    g.down(S({ id: 1, t: 2000 }));
    g.move(S({ id: 1, x: 140, t: 2010 }));
    g.up(S({ id: 1, x: 140, t: 2400 }));
    expect(log).toEqual(['start:pen:9', 'end:9']);
    expect(pans).toEqual([[40, 0]]);
  });

  it('palm: touches during or just after a pen stroke are ignored until lifted', () => {
    g.down(S({ id: 9, type: 'pen' }));
    g.down(S({ id: 2, t: 5 })); // the hand lands
    g.move(S({ id: 2, x: 300, t: 10 }));
    g.up(S({ id: 9, type: 'pen', t: 20 }));
    g.move(S({ id: 2, x: 400, t: 30 }));
    g.down(S({ id: 3, t: 20 + PALM_MS - 1 })); // right after the lift
    g.move(S({ id: 3, x: 200, t: 20 + PALM_MS + 10 }));
    g.up(S({ id: 2, t: 900 }));
    g.up(S({ id: 3, t: 900 }));
    expect(pans).toEqual([]);
    expect(log).toEqual(['start:pen:9', 'end:9']);
  });

  it('palm: with a pen around, a big contact patch never counts', () => {
    g.down(S({ id: 9, type: 'pen' }));
    g.up(S({ id: 9, type: 'pen', t: 10 }));
    g.down(S({ id: 2, w: 130, h: 110, t: 2000 }));
    g.move(S({ id: 2, x: 300, t: 2010 }));
    expect(log).toEqual(['start:pen:9', 'end:9']);
    expect(pans).toEqual([]);
  });

  // iPadOS reports a finger's PointerEvent width as 2 × its contact radius:
  // 40–70 px is an ordinary fingertip there (the owner's "didn't paint anything")
  it('iPad fingers (52–70 px contacts) paint with no pen', () => {
    g.down(S({ id: 1, w: 52, h: 52 }));
    g.move(S({ id: 1, x: 150, w: 58, h: 58, t: 20 }));
    g.up(S({ id: 1, x: 150, w: 58, h: 58, t: 400 }));
    g.down(S({ id: 2, w: 70, h: 64, t: 1000 }));
    g.up(S({ id: 2, w: 70, h: 64, t: 1300 }));
    expect(log).toEqual(['start:touch:1', 'move:1', 'end:1', 'start:touch:2', 'end:2']);
  });

  it('iPad fingers still pan and pinch once a pen has been used', () => {
    g.down(S({ id: 9, type: 'pen' }));
    g.up(S({ id: 9, type: 'pen', t: 10 }));
    g.down(S({ id: 1, x: 100, w: 60, h: 60, t: 2000 }));
    g.down(S({ id: 2, x: 200, w: 60, h: 60, t: 2010 }));
    g.move(S({ id: 2, x: 300, w: 60, h: 60, t: 2040 }));
    expect(zooms[0]).toBeCloseTo(2);
  });

  it('without a pen, size never rejects a touch (fingers are the brush)', () => {
    g.down(S({ id: 1, w: 120, h: 120 }));
    expect(log).toEqual(['start:touch:1']);
  });

  it('a hand already resting when the pen lands is ignored', () => {
    g.fingerMode = 'move';
    g.down(S({ id: 2 }));
    g.down(S({ id: 9, type: 'pen', t: 10 }));
    g.move(S({ id: 2, x: 200, t: 20 }));
    expect(pans).toEqual([]);
  });

  it('the pen landing ends a finger stroke cleanly (cancelled)', () => {
    g.down(S({ id: 1 }));
    g.down(S({ id: 9, type: 'pen', t: 500 }));
    expect(log).toEqual(['start:touch:1', 'cancel', 'start:pen:9']);
  });
});

describe('fingers without a pen', () => {
  it('paint mode: one finger paints', () => {
    g.down(S({ id: 1 }));
    g.move(S({ id: 1, x: 150, t: 20 }));
    g.up(S({ id: 1, x: 150, t: 400 }));
    expect(log).toEqual(['start:touch:1', 'move:1', 'end:1']);
  });

  it('move mode: one finger pans', () => {
    g.fingerMode = 'move';
    g.down(S({ id: 1 }));
    g.move(S({ id: 1, x: 130, y: 90 }));
    expect(pans).toEqual([[30, -10]]);
    expect(log).toEqual([]);
  });

  it('a second finger soon after cancels the first finger’s stroke (it was a pinch)', () => {
    g.down(S({ id: 1 }));
    g.move(S({ id: 1, x: 104, t: 30 }));
    g.down(S({ id: 2, x: 300, t: CANCEL_MS - 50 }));
    expect(log).toEqual(['start:touch:1', 'move:1', 'cancel']);
  });

  it('a second finger after a real stroke keeps the stroke', () => {
    g.down(S({ id: 1 }));
    g.move(S({ id: 1, x: 300, t: 400 }));
    g.down(S({ id: 2, x: 500, t: 600 }));
    expect(log).toEqual(['start:touch:1', 'move:1', 'end:2']);
  });

  it('two fingers pinch-zoom and pan about their middle', () => {
    g.fingerMode = 'move';
    g.down(S({ id: 1, x: 100, y: 100 }));
    g.down(S({ id: 2, x: 200, y: 100, t: 10 }));
    g.move(S({ id: 2, x: 300, y: 100, t: 40 }));
    expect(zooms[0]).toBeCloseTo(2);
    expect(pans[pans.length - 1]).toEqual([50, 0]);
  });
});

describe('taps', () => {
  const tap = (n: number, dt = 120, moved = 0) => {
    for (let i = 0; i < n; i++) g.down(S({ id: i + 1, x: 100 + i * 80, t: i * 10 }));
    if (moved > 0) g.move(S({ id: 1, x: 100 + moved, t: 50 }));
    for (let i = 0; i < n; i++)
      g.up(S({ id: i + 1, x: 100 + i * 80 + (i === 0 ? moved : 0), t: dt + i }));
  };
  it('two-finger tap = undo (and the stroke the first finger began is cancelled)', () => {
    tap(2);
    expect(log).toEqual(['start:touch:1', 'cancel', 'undo']);
  });
  it('three-finger tap = redo', () => {
    g.fingerMode = 'move';
    tap(3);
    expect(log).toEqual(['redo']);
  });
  it('too slow, or moved, is not a tap', () => {
    g.fingerMode = 'move';
    tap(2, TAP_MS + 50);
    tap(2, 100, 40);
    expect(log).toEqual([]);
  });
  it('works with a pen around (fingers only navigate then)', () => {
    g.down(S({ id: 9, type: 'pen' }));
    g.up(S({ id: 9, type: 'pen', t: 10 }));
    for (let i = 0; i < 2; i++) g.down(S({ id: i + 1, x: 100 + i * 80, t: 2000 + i * 10 }));
    for (let i = 0; i < 2; i++) g.up(S({ id: i + 1, x: 100 + i * 80, t: 2100 + i }));
    expect(log).toEqual(['start:pen:9', 'end:9', 'undo']);
  });
});

describe('mouse', () => {
  it('left paints, right pans', () => {
    g.down(S({ id: 1, type: 'mouse', button: 0 }));
    g.move(S({ id: 1, type: 'mouse', x: 130 }));
    g.up(S({ id: 1, type: 'mouse', x: 130 }));
    g.down(S({ id: 1, type: 'mouse', button: 2 }));
    g.move(S({ id: 1, type: 'mouse', x: 150 }));
    g.up(S({ id: 1, type: 'mouse' }));
    expect(log).toEqual(['start:mouse:1', 'move:1', 'end:1']);
    expect(pans).toEqual([[50, 0]]);
  });
});
