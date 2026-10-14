import { describe, expect, it } from 'vitest';

import { SprayHistory, WallLog } from './history';
import { encodeDabs, encodeRemoval, encodeStrokes, hash48, type Stroke } from './strokes';

const stroke = (color: number, r = 10): Stroke => ({
  color,
  r,
  hard: true,
  opacity: 16,
  pts: [0, 0, 500, 500],
});
const colours = (log: WallLog) =>
  log.items().map(i => (i.kind === 'stroke' ? i.stroke.color : 'dabs'));

describe('WallLog', () => {
  it('draws old dab tags and new stroke tags in order, skipping repeats', () => {
    const log = new WallLog();
    const g2 = encodeDabs([{ u: 0.5, v: 0.5, r: 0.05, c: 2 }]);
    const g3 = encodeStrokes({ id: hash48('n'), strokes: [stroke(1), stroke(2)] });
    expect(log.add(g2).action).toBe('draw');
    const r = log.add(g3);
    expect(r.action).toBe('draw');
    expect(r.action === 'draw' && r.items).toHaveLength(2);
    expect(log.add(g3).action).toBe('skip');
    expect(log.add('garbage').action).toBe('skip');
    expect(colours(log)).toEqual(['dabs', 1, 2]);
  });

  it('a removal hides only the named strokes of the matching tag', () => {
    const log = new WallLog();
    log.add(encodeStrokes({ id: hash48('aaaaaaaaaaaaaaaa'), strokes: [stroke(1), stroke(2)] }));
    log.add(encodeStrokes({ id: hash48('bbbbbbbbbbbbbbbb'), strokes: [stroke(3)] }));
    expect(log.add(encodeRemoval('aaaaaaaaaaaaaaaa', [1])).action).toBe('redraw');
    expect(colours(log)).toEqual([1, 3]);
    // Without the nonce there's no way to name tag b: a wrong nonce hides nothing
    expect(log.add(encodeRemoval('cccccccccccccccc', [0])).action).toBe('skip');
    expect(colours(log)).toEqual([1, 3]);
  });

  it('a removal that arrives before its tag still applies', () => {
    const log = new WallLog();
    expect(log.add(encodeRemoval('dddddddddddddddd', [0])).action).toBe('skip');
    const r = log.add(
      encodeStrokes({ id: hash48('dddddddddddddddd'), strokes: [stroke(7), stroke(8)] }),
    );
    expect(r.action === 'draw' && r.items.map(i => i.kind === 'stroke' && i.stroke.color)).toEqual([
      8,
    ]);
    expect(colours(log)).toEqual([8]);
  });

  it('reports the finest nozzle on the wall', () => {
    const log = new WallLog();
    expect(log.finest()).toBe(Infinity);
    log.add(encodeStrokes({ id: hash48('e'), strokes: [stroke(1, 40), stroke(2, 4)] }));
    expect(log.finest()).toBe(4);
  });
});

describe('SprayHistory undo', () => {
  it('drops unsent strokes without sending anything', () => {
    const h = new SprayHistory();
    h.beginGesture();
    h.addStroke('w', stroke(1));
    h.endGesture();
    h.beginGesture();
    h.addStroke('w', stroke(2));
    h.endGesture();
    const u = h.undo();
    expect(u.out).toEqual([]);
    expect([...u.walls]).toEqual(['w']);
    expect(h.pendingOn('w').map(s => s.stroke.color)).toEqual([1]);
    const out = h.flush();
    expect(out).toHaveLength(1);
  });

  it('sends a removal for sent strokes that every client applies', () => {
    const h = new SprayHistory();
    const peer = new WallLog();
    h.beginGesture();
    h.addStroke('w', stroke(1));
    h.endGesture();
    h.beginGesture();
    h.addStroke('w', stroke(2));
    h.addStroke('w', stroke(3));
    h.endGesture();
    for (const o of h.flush()) peer.add(o.data);
    expect(colours(peer)).toEqual([1, 2, 3]);
    const u = h.undo();
    expect(u.out).toHaveLength(1);
    expect(u.out[0].data.startsWith('g3r:')).toBe(true);
    for (const o of u.out) expect(peer.add(o.data).action).toBe('redraw');
    expect(colours(peer)).toEqual([1]);
    // Next undo takes the first stroke too, then there's nothing left
    for (const o of h.undo().out) peer.add(o.data);
    expect(colours(peer)).toEqual([]);
    expect(h.canUndo).toBe(false);
    expect(h.undo().walls.size).toBe(0);
  });

  it('one gesture across two walls undoes on both', () => {
    const h = new SprayHistory();
    h.beginGesture();
    h.addStroke('a', stroke(1));
    h.addStroke('b', stroke(1));
    h.endGesture();
    h.flush();
    const u = h.undo();
    expect([...u.walls].sort()).toEqual(['a', 'b']);
    expect(u.out.map(o => o.wallId).sort()).toEqual(['a', 'b']);
  });

  it('undo mid-gesture takes back what is down so far', () => {
    const h = new SprayHistory();
    h.beginGesture();
    h.addStroke('w', stroke(1));
    expect(h.canUndo).toBe(true);
    expect(h.undo().walls.has('w')).toBe(true);
    h.endGesture();
    expect(h.pendingOn('w')).toEqual([]);
  });

  it('flushes a wall early once its tag gets big', () => {
    const h = new SprayHistory();
    const pts: number[] = [];
    for (let i = 0; i < 300; i++) pts.push(i * 10, (i % 7) * 40);
    let sent = 0;
    for (let i = 0; i < 20; i++) sent += h.addStroke('w', { ...stroke(i), pts }).out.length;
    expect(sent).toBeGreaterThan(0);
    for (const o of h.flush()) expect(o.data.length).toBeLessThan(8200);
  });
});
