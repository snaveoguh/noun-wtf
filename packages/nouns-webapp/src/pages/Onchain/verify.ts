// /onchain page logic (pure, tested): search a manifest, check a leaf's
// file against it, build its proof, and lay a graffiti piece out to draw.

import type { Hex } from 'viem';

import {
  CELL_H_MM,
  CELL_W_MM,
  decodeTag,
  EDGE_MM,
  intToHex,
  LEGACY_COLORS,
} from '@/miniapps/world2/graffiti/strokes';
import {
  contentHash,
  leafHash,
  proofFor,
  verifyProof,
  type MerkleTree,
} from '@/miniapps/world2/onchain/merkle';
import { tagHash, type Manifest, type ManifestLeaf } from '@/miniapps/world2/onchain/snapshot';

export const MAX_RESULTS = 60;

/**
 * Leaves matching a query: a pasted tag (`g3:…` / `g2:…`) finds its piece by
 * the same hash the store files it under; otherwise the query is matched
 * against the key (wall id / metric / address) and the label (tag id / rider
 * name), case-insensitively.
 */
export function searchLeaves(man: Manifest, query: string, max = MAX_RESULTS): ManifestLeaf[] {
  const q = query.trim();
  if (q === '') return man.leaves.slice(0, max);
  if (/^g[23]:/.test(q)) {
    const h = `/${tagHash(q)}`;
    return man.leaves.filter(l => l.key.endsWith(h)).slice(0, max);
  }
  const lq = q.toLowerCase();
  const out: ManifestLeaf[] = [];
  for (const l of man.leaves) {
    if (l.key.toLowerCase().includes(lq) || (l.label ?? '').toLowerCase().includes(lq)) out.push(l);
    if (out.length >= max) break;
  }
  return out;
}

export interface LeafCheck {
  /** The fetched file hashes to the manifest's content hash. */
  contentOk: boolean;
  leaf: Hex;
  proof: Hex[] | null;
  /** The proof reaches the on-chain root (checked here, in the browser). */
  proofOk: boolean;
}

export function checkLeaf(
  man: Manifest,
  tree: MerkleTree,
  leaf: ManifestLeaf,
  file: unknown,
): LeafCheck {
  const got = contentHash(file);
  const contentOk = got === leaf.content;
  // The leaf commits to what the file actually says, so a swapped file fails the proof too
  const h = leafHash(man.kindId, leaf.key, got);
  const proof = proofFor(tree, h);
  return { contentOk, leaf: h, proof, proofOk: proof !== null && verifyProof(tree.root, h, proof) };
}

export interface DrawStroke {
  color: string;
  /** Radius and points in the drawing's units (mm, origin top-left of the cell + edge). */
  r: number;
  alpha: number;
  pts: number[];
}

/** A tag laid out for a canvas: the cell plus a metre of edge each side. */
export function layoutTag(
  data: string,
  hidden: number[] = [],
): { w: number; h: number; strokes: DrawStroke[] } | null {
  const dec = decodeTag(data);
  const w = CELL_W_MM + EDGE_MM * 2;
  const h = CELL_H_MM + EDGE_MM * 2;
  if (dec === null || dec.kind === 'remove') return null;
  if (dec.kind === 'dabs') {
    const strokes = dec.dabs.map(d => {
      const x = EDGE_MM + d.u * CELL_W_MM;
      const y = EDGE_MM + (1 - d.v) * CELL_H_MM;
      return {
        color: LEGACY_COLORS[d.c] ?? '#ffffff',
        r: d.r * CELL_H_MM,
        alpha: 1,
        pts: [x, y, x, y],
      };
    });
    return { w, h, strokes };
  }
  const hide = new Set(hidden);
  const strokes: DrawStroke[] = [];
  dec.tag.strokes.forEach((s, i) => {
    if (hide.has(i)) return;
    const pts: number[] = [];
    // stored as u across, v up from the bottom (mm, cell-local)
    for (let k = 0; k < s.pts.length; k += 2)
      pts.push(EDGE_MM + s.pts[k], EDGE_MM + CELL_H_MM - s.pts[k + 1]);
    strokes.push({ color: intToHex(s.color), r: s.r, alpha: s.opacity / 16, pts });
  });
  return { w, h, strokes };
}

/** The box round every stroke (radius included), or null with nothing to draw. */
export function paintBounds(
  strokes: DrawStroke[],
): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of strokes)
    for (let i = 0; i < s.pts.length; i += 2) {
      x0 = Math.min(x0, s.pts[i] - s.r);
      x1 = Math.max(x1, s.pts[i] + s.r);
      y0 = Math.min(y0, s.pts[i + 1] - s.r);
      y1 = Math.max(y1, s.pts[i + 1] + s.r);
    }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

export const short = (h: string, n = 6) =>
  h.length > n * 2 + 2 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h;
