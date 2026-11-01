import { describe, expect, it } from 'vitest';

import {
  encodeDabs,
  encodeRemoval,
  encodeStrokes,
  hash48,
} from '@/miniapps/world2/graffiti/strokes';
import { buildTree, leafHash } from '@/miniapps/world2/onchain/merkle';
import { buildSnapshot, graffitiPieces, recordRows } from '@/miniapps/world2/onchain/snapshot';

import { checkLeaf, layoutTag, paintBounds, searchLeaves, short } from './verify';

const WALL = 'plaza|0.00,0.00,1.00|-12.50|3|1';
const tag = (n: string, color = 0xff0000) =>
  encodeStrokes({
    id: hash48(n),
    strokes: [
      { color, r: 20, hard: false, opacity: 8, pts: [0, 0, 6000, 3000] },
      { color: 0x00ff00, r: 40, hard: true, opacity: 16, pts: [100, 100, 200, 200] },
    ],
  });
const t1 = tag('0123456789abcdef');
const t2 = tag('fedcba9876543210', 0x0000ff);
const pieces = graffitiPieces({
  [WALL]: [{ d: t1, at: 1 }, { d: t2, at: 2 }, { d: encodeRemoval('fedcba9876543210', [1]) }],
});
const snap = buildSnapshot('graffiti', pieces, new Date())!;
const file = (key: string) => pieces.find(p => p.key === key)!;

describe('searchLeaves', () => {
  it('finds a piece from its pasted tag, its tag id or its wall', () => {
    expect(searchLeaves(snap.manifest, t2).map(l => l.label)).toEqual([hash48('fedcba9876543210')]);
    expect(searchLeaves(snap.manifest, hash48('0123456789abcdef').toUpperCase())).toHaveLength(1);
    expect(searchLeaves(snap.manifest, 'plaza|0.00,0.00,1.00')).toHaveLength(2);
    expect(searchLeaves(snap.manifest, 'nothing-here')).toHaveLength(0);
    expect(searchLeaves(snap.manifest, '', 1)).toHaveLength(1);
  });
  it('finds a record by rider name', () => {
    const rows = recordRows({
      boards: {
        kmh: [
          { name: 'Zoomer', value: 1 },
          { name: 'b', value: 0.5 },
        ],
      },
    });
    const r = buildSnapshot('records', rows, new Date())!;
    expect(searchLeaves(r.manifest, 'zoom').map(l => l.key)).toEqual(['kmh/name:Zoomer']);
  });
});

describe('checkLeaf', () => {
  it('proves the real file', () => {
    const leaf = snap.manifest.leaves[0];
    const c = checkLeaf(snap.manifest, snap.tree, leaf, file(leaf.key));
    expect(c).toMatchObject({ contentOk: true, proofOk: true });
    expect(c.leaf).toBe(leafHash(1, leaf.key, leaf.content));
  });
  it('fails an edited file', () => {
    const leaf = snap.manifest.leaves[0];
    const c = checkLeaf(snap.manifest, snap.tree, leaf, { ...file(leaf.key), data: t2 });
    expect(c).toMatchObject({ contentOk: false, proofOk: false, proof: null });
  });
  it('fails against another root', () => {
    const leaf = snap.manifest.leaves[0];
    const other = buildTree([leafHash(1, 'x', snap.manifest.leaves[1].content)]);
    expect(checkLeaf(snap.manifest, other, leaf, file(leaf.key)).proofOk).toBe(false);
  });
});

describe('layoutTag', () => {
  it('lays strokes out top-down with the edge margin and skips hidden ones', () => {
    const l = layoutTag(t1)!;
    expect(l.w).toBe(8000);
    expect(l.h).toBe(5000);
    expect(l.strokes).toHaveLength(2);
    expect(l.strokes[0]).toMatchObject({
      color: '#ff0000',
      alpha: 0.5,
      pts: [1000, 4000, 7000, 1000],
    });
    expect(layoutTag(t1, [0])!.strokes).toHaveLength(1);
  });
  it('draws legacy dabs and refuses junk', () => {
    expect(layoutTag(encodeDabs([{ u: 0.5, v: 0.5, r: 0.1, c: 2 }]))!.strokes[0].color).toBe(
      '#d22209',
    );
    expect(layoutTag('g3:nope')).toBeNull();
  });
});

it('short', () => {
  expect(short('0x' + 'a'.repeat(64))).toBe('0xaaaaaa…aaaaaa');
  expect(short('abc')).toBe('abc');
});

it('paintBounds', () => {
  expect(paintBounds([])).toBeNull();
  expect(paintBounds([{ color: '#fff', r: 10, alpha: 1, pts: [100, 200, 300, 50] }])).toEqual({
    x0: 90,
    y0: 40,
    x1: 310,
    y1: 210,
  });
});
