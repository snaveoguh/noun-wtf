import { describe, expect, it } from 'vitest';

import { encodeDabs, encodeRemoval, encodeStrokes, hash48 } from '../graffiti/strokes';

import { canonical } from './canonical';
import { KIND } from './contract';
import { buildTree, contentHash, hashPair, leafHash, proofFor, verifyProof } from './merkle';
import {
  buildSnapshot,
  checkManifest,
  graffitiPieces,
  MANIFEST_FILE,
  parseWall,
  recordRows,
  tagHash,
  type Manifest,
} from './snapshot';

const WALL = 'plaza|0.00,0.00,1.00|-12.50|3|1';
const WALL2 = 'park|1.00,0.00,0.00|4.00|0|0';
const nonceA = '0123456789abcdef';
const nonceB = 'fedcba9876543210';
const stroke = (color: number, x = 100) => ({
  color,
  r: 20,
  hard: false,
  opacity: 16,
  pts: [x, 100, x + 200, 300, x + 400, 200],
});
const tagA = encodeStrokes({
  id: hash48(nonceA),
  strokes: [stroke(0xff0000), stroke(0x00ff00, 900)],
});
const tagB = encodeStrokes({ id: hash48(nonceB), strokes: [stroke(0x0000ff)] });
const dabs = encodeDabs([{ u: 0.5, v: 0.5, r: 0.1, c: 2 }]);

describe('canonical', () => {
  it('sorts keys and drops undefined', () => {
    expect(canonical({ b: 1, a: [true, null, 'x'], c: undefined, d: { z: 0, y: -0 } })).toBe(
      '{"a":[true,null,"x"],"b":1,"d":{"y":0,"z":0}}',
    );
  });
  it('refuses non-finite numbers', () => {
    expect(() => canonical({ a: NaN })).toThrow();
  });
});

describe('merkle', () => {
  const leaves = Array.from({ length: 7 }, (_, i) => leafHash(1, `k${i}`, contentHash({ i })));

  it('proves every leaf, for every tree size', () => {
    for (let n = 1; n <= leaves.length; n++) {
      const tree = buildTree(leaves.slice(0, n));
      for (const l of leaves.slice(0, n)) {
        const proof = proofFor(tree, l)!;
        expect(proof).not.toBeNull();
        expect(verifyProof(tree.root, l, proof)).toBe(true);
      }
    }
  });

  it('does not depend on leaf order', () => {
    expect(buildTree([...leaves].reverse()).root).toBe(buildTree(leaves).root);
  });

  it('refuses tampering', () => {
    const tree = buildTree(leaves);
    const proof = proofFor(tree, leaves[3])!;
    const forged = leafHash(1, 'k3', contentHash({ i: 99 }));
    expect(verifyProof(tree.root, forged, proof)).toBe(false);
    expect(verifyProof(tree.root, leaves[3], proof.slice(1))).toBe(false);
    expect(proofFor(tree, forged)).toBeNull();
  });

  it('a single leaf is its own root', () => {
    expect(buildTree([leaves[0]]).root).toBe(leaves[0]);
    expect(verifyProof(leaves[0], leaves[0], [])).toBe(true);
  });

  it('hashes pairs sorted (the contract does the same)', () => {
    expect(hashPair(leaves[0], leaves[1])).toBe(hashPair(leaves[1], leaves[0]));
  });

  it('binds the kind and the key', () => {
    const c = contentHash({ x: 1 });
    expect(leafHash(1, 'a', c)).not.toBe(leafHash(2, 'a', c));
    expect(leafHash(1, 'a', c)).not.toBe(leafHash(1, 'b', c));
  });

  it('refuses empty and duplicate leaf sets', () => {
    expect(() => buildTree([])).toThrow();
    expect(() => buildTree([leaves[0], leaves[0]])).toThrow();
  });
});

describe('graffiti pieces', () => {
  it('parses wall ids', () => {
    expect(parseWall(WALL)).toEqual({
      level: 'plaza',
      surface: { normal: [0, 0, 1], d: -12.5, cell: [3, 1] },
    });
    expect(parseWall('mars|0,0,0|0|0|0')).toBeNull();
  });

  it('keeps g3 and g2 tags, folds undo tags in, never publishes a nonce', () => {
    const pieces = graffitiPieces({
      [WALL]: [
        { d: tagA, at: 1000 },
        { d: tagB, at: 2000 },
        { d: encodeRemoval(nonceA, [1]), at: 3000 },
        { d: 'g3:garbage', at: 4000 },
      ],
      [WALL2]: [{ d: dabs, at: 5 }],
    });
    expect(pieces.map(p => p.format)).toEqual(['g2', 'g3', 'g3']);
    const a = pieces.find(p => p.tagId === hash48(nonceA))!;
    expect(a).toMatchObject({
      key: `${WALL}/${tagHash(tagA)}`,
      level: 'plaza',
      wallId: WALL,
      data: tagA,
      hidden: [1],
      strokes: 2,
      createdAt: 1000,
    });
    expect(pieces.find(p => p.tagId === hash48(nonceB))!.hidden).toBeUndefined();
    const all = JSON.stringify(pieces);
    expect(all).not.toContain(nonceA);
    expect(all).not.toContain('g3r:');
  });

  it("matches world-graffiti's own per-tag key hash", async () => {
    const { createHash } = await import('node:crypto');
    expect(tagHash(tagA)).toBe(createHash('sha256').update(tagA).digest('hex').slice(0, 24));
  });

  it('skips duplicate tags and unknown walls', () => {
    const pieces = graffitiPieces({
      [WALL]: [
        { d: tagA, at: 1 },
        { d: tagA, at: 2 },
      ],
      'nope|x': [{ d: tagB, at: 1 }],
    });
    expect(pieces).toHaveLength(1);
  });
});

describe('record rows', () => {
  it('keeps the public row, ranks it, drops last-seen, dedupes keys', () => {
    const rows = recordRows({
      riders: 10,
      boards: {
        kmh: [
          { name: 'zoom', value: 210.5, addr: '0xAbC0000000000000000000000000000000000001', at: 5 },
          { name: 'slow', value: 90, at: 6, title: 'drop-in' },
          { name: 'slow', value: 80, at: 7 },
        ],
        combo: [{ name: 'x', value: 5000, label: 'kickflip ×3' }],
        'bad metric!': [{ name: 'y', value: 1 }],
      },
    });
    expect(rows.map(r => r.key)).toEqual([
      'combo/name:x',
      'kmh/0xabc0000000000000000000000000000000000001',
      'kmh/name:slow',
      'kmh/name:slow#2',
    ]);
    expect(rows[1]).toEqual({
      v: 1,
      type: 'record',
      key: 'kmh/0xabc0000000000000000000000000000000000001',
      metric: 'kmh',
      rank: 1,
      name: 'zoom',
      value: 210.5,
      addr: '0xAbC0000000000000000000000000000000000001',
    });
    expect(rows[2].title).toBe('drop-in');
    expect(rows[0].label).toBe('kickflip ×3');
  });
});

describe('snapshot', () => {
  const pieces = graffitiPieces({
    [WALL]: [
      { d: tagA, at: 1 },
      { d: tagB, at: 2 },
    ],
    [WALL2]: [{ d: dabs }],
  });
  const at = new Date('2026-11-01T00:00:00Z');

  it('writes one file per leaf plus the manifest, and every leaf proves', () => {
    const snap = buildSnapshot('graffiti', pieces, at)!;
    expect(snap.files).toHaveLength(pieces.length + 1);
    expect(snap.files[snap.files.length - 1].path).toBe(MANIFEST_FILE);
    const man = JSON.parse(snap.files[snap.files.length - 1].body) as Manifest;
    expect(man).toMatchObject({
      kind: 'graffiti',
      kindId: KIND.graffiti,
      root: snap.root,
      count: 3,
    });
    for (const leaf of man.leaves) {
      const file = snap.files.find(f => f.path === leaf.file)!;
      // the published file hashes to the leaf's content hash
      expect(contentHash(JSON.parse(file.body))).toBe(leaf.content);
      const h = leafHash(KIND.graffiti, leaf.key, leaf.content);
      expect(verifyProof(snap.root, h, proofFor(snap.tree, h)!)).toBe(true);
    }
    expect(checkManifest(man, snap.root).ok).toBe(true);
    // searchable by tag id
    expect(
      man.leaves
        .map(l => l.label)
        .filter(Boolean)
        .sort(),
    ).toEqual([hash48(nonceA), hash48(nonceB)].sort());
  });

  it('is deterministic: same world, same root, whatever order it was read in', () => {
    const a = buildSnapshot('graffiti', pieces, at)!;
    const b = buildSnapshot('graffiti', [...pieces].reverse(), new Date('2027-01-01'))!;
    expect(b.root).toBe(a.root);
  });

  it('changes root when a piece changes (an undo counts)', () => {
    const a = buildSnapshot('graffiti', pieces, at)!;
    const later = graffitiPieces({
      [WALL]: [{ d: tagA, at: 1 }, { d: tagB, at: 2 }, { d: encodeRemoval(nonceB, [0]) }],
      [WALL2]: [{ d: dabs }],
    });
    expect(buildSnapshot('graffiti', later, at)!.root).not.toBe(a.root);
  });

  it('flags a manifest that does not match the chain', () => {
    const snap = buildSnapshot('graffiti', pieces, at)!;
    const man = structuredClone(snap.manifest);
    man.leaves[0].content = contentHash({ forged: true });
    expect(checkManifest(man, snap.root)).toMatchObject({ ok: false });
    expect(checkManifest({ nope: 1 }, snap.root).ok).toBe(false);
  });

  it('nothing to snapshot is null', () => {
    expect(buildSnapshot('records', [], at)).toBeNull();
  });

  it('records snapshot', () => {
    const rows = recordRows({ boards: { kmh: [{ name: 'a', value: 1 }] } });
    const snap = buildSnapshot('records', rows, at, { riders: 1 })!;
    expect(snap.manifest.meta).toEqual({ riders: 1 });
    expect(snap.root).toBe(leafHash(KIND.records, 'kmh/name:a', contentHash(rows[0])));
  });
});
