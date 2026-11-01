// Merkle tree over snapshot leaves, checked on-chain by NounWorldLedger.verify.
//
//   contentHash = keccak256(utf8(canonical(file)))
//   leaf        = keccak256(bytes.concat(keccak256(abi.encode(uint8 kind, string key, bytes32 contentHash))))
//   parent      = keccak256(min(a, b) ‖ max(a, b))
//
// Double-hashed leaves and sorted pairs are OpenZeppelin's MerkleProof
// convention, so a proof is just the sibling list (no left/right flags) and a
// leaf can never pass as an inner node. Leaves are sorted before building, so
// the root depends only on the set of leaves, not on the order they were read.
// An odd node at the end of a layer moves up unchanged.

import { encodeAbiParameters, keccak256, stringToBytes, type Hex } from 'viem';

import { canonical } from './canonical';

export const contentHash = (file: unknown): Hex => keccak256(stringToBytes(canonical(file)));

export function leafHash(kind: number, key: string, content: Hex): Hex {
  const inner = keccak256(
    encodeAbiParameters(
      [{ type: 'uint8' }, { type: 'string' }, { type: 'bytes32' }],
      [kind, key, content],
    ),
  );
  return keccak256(inner);
}

const cmp = (a: Hex, b: Hex) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);

export function hashPair(a: Hex, b: Hex): Hex {
  const [lo, hi] = cmp(a, b) <= 0 ? [a, b] : [b, a];
  return keccak256(`0x${lo.slice(2)}${hi.slice(2)}`);
}

export interface MerkleTree {
  root: Hex;
  /** layers[0] = sorted leaves, last = [root]. */
  layers: Hex[][];
}

export function buildTree(leaves: Hex[]): MerkleTree {
  if (leaves.length === 0) throw new Error('merkle: no leaves');
  const first = [...new Set(leaves.map(l => l.toLowerCase() as Hex))].sort(cmp);
  if (first.length !== leaves.length) throw new Error('merkle: duplicate leaf');
  const layers: Hex[][] = [first];
  while (layers[layers.length - 1].length > 1) {
    const cur = layers[layers.length - 1];
    const next: Hex[] = [];
    for (let i = 0; i < cur.length; i += 2)
      next.push(i + 1 < cur.length ? hashPair(cur[i], cur[i + 1]) : cur[i]);
    layers.push(next);
  }
  return { root: layers[layers.length - 1][0], layers };
}

/** Sibling hashes from a leaf up to the root (null if the leaf isn't in the tree). */
export function proofFor(tree: MerkleTree, leaf: Hex): Hex[] | null {
  let i = tree.layers[0].indexOf(leaf.toLowerCase() as Hex);
  if (i < 0) return null;
  const proof: Hex[] = [];
  for (let d = 0; d < tree.layers.length - 1; d++) {
    const layer = tree.layers[d];
    const sib = i ^ 1;
    if (sib < layer.length) proof.push(layer[sib]);
    i >>= 1;
  }
  return proof;
}

export function verifyProof(root: Hex, leaf: Hex, proof: readonly Hex[]): boolean {
  let h = leaf.toLowerCase() as Hex;
  for (const p of proof) h = hashPair(h, p.toLowerCase() as Hex);
  return h === root.toLowerCase();
}
