// Shared core for adding a NounV2 art trait via a governance proposal.
//
// The NounV2 descriptor (0xAe0247…) is owned by the NounV2Treasury, so new traits
// can only be added by a passing proposal that calls addHeads/addBodies/etc. This
// module turns an RLE trait image into the exact `NounV2Treasury.propose(...)` args.
//
// It powers three consumers: the nounirl agent tool, the standalone CLI, and the
// Claude Code skill. First shipped as NounV2 prop #1 ("joker" head #253) 2026-07-24.

import { deflateRawSync } from 'node:zlib';
import { encodeFunctionData, type Hex } from 'viem';

export const V2_DESCRIPTOR = '0xAe0247Ca34B211a61b03A95F8008DCb8B3124B89' as const;
export const V2_TREASURY = '0x2cDeb0d251674710840d9fa990D1de138dfe7C00' as const;

export type TraitCategory = 'head' | 'body' | 'accessory' | 'glasses';

/** descriptor add-function per category (the RLE+deflate batch form) */
const ADD_FN: Record<TraitCategory, string> = {
  head: 'addHeads',
  body: 'addBodies',
  accessory: 'addAccessories',
  glasses: 'addGlasses',
};

/** image-data-v2.json category key per trait category */
const IMAGE_KEY: Record<TraitCategory, string> = {
  head: 'heads',
  body: 'bodies',
  accessory: 'accessories',
  glasses: 'glasses',
};

// Minimal descriptor ABI — only the add-* functions we encode against.
const descriptorAddAbi = (['addHeads', 'addBodies', 'addAccessories', 'addGlasses'] as const).map(
  name => ({
    type: 'function',
    name,
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'encodedCompressed', type: 'bytes' },
      { name: 'decompressedLength', type: 'uint80' },
      { name: 'imageCount', type: 'uint16' },
    ],
    outputs: [],
  }),
);

const treasuryProposeAbi = [
  {
    type: 'function',
    name: 'propose',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'targets', type: 'address[]' },
      { name: 'values', type: 'uint256[]' },
      { name: 'signatures', type: 'string[]' },
      { name: 'calldatas', type: 'bytes[]' },
      { name: 'description', type: 'string' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const;

// ── RLE parsing/serialization (Nouns V2 art format) ────────────────────────────
// byte0 = palette index, bytes1-4 = bounds (top,right,bottom,left), then (len,color) runs.

export interface DecodedRle {
  paletteIndex: number;
  bounds: { top: number; right: number; bottom: number; left: number };
  runs: Array<[length: number, colorIndex: number]>;
}

export function parseRle(hex: string): DecodedRle {
  const s = hex.replace(/^0x/, '');
  const byte = (i: number) => parseInt(s.substring(i * 2, i * 2 + 2), 16);
  const runs: Array<[number, number]> = [];
  for (let i = 5; i < s.length / 2; i += 2) runs.push([byte(i), byte(i + 1)]);
  return {
    paletteIndex: byte(0),
    bounds: { top: byte(1), right: byte(2), bottom: byte(3), left: byte(4) },
    runs,
  };
}

export function serializeRle(img: DecodedRle): Hex {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  const { paletteIndex: p, bounds: b, runs } = img;
  let out = h(p) + h(b.top) + h(b.right) + h(b.bottom) + h(b.left);
  for (const [len, col] of runs) out += h(len) + h(col);
  return ('0x' + out) as Hex;
}

// ── Derivations from an existing trait ─────────────────────────────────────────
// A trait can be given as raw RLE, or derived from an existing on-chain trait by
// recoloring palette indices and/or swapping the colours of specific colour-runs.
// (The "joker" head = index-card with colour-runs 0 and 3 swapped.)

export interface Derivation {
  /** remap palette indices everywhere: [[fromIdx, toIdx], …] */
  recolor?: Array<[number, number]>;
  /** swap the colours of run i and run j, indexed over ALL runs (0-based, incl. background runs) */
  swapRunColors?: [number, number];
}

/** Apply a derivation to a decoded image, preserving byte structure (only colours change). */
export function applyDerivation(img: DecodedRle, d: Derivation): DecodedRle {
  const runs = img.runs.map(r => [...r] as [number, number]);
  if (d.recolor) {
    const map = new Map(d.recolor);
    for (const r of runs) if (map.has(r[1])) r[1] = map.get(r[1])!;
  }
  if (d.swapRunColors) {
    const [i, j] = d.swapRunColors;
    const ri = runs[i];
    const rj = runs[j];
    if (!ri || !rj)
      throw new Error(`swapRunColors out of range: image has ${runs.length} runs`);
    const tmp = ri[1];
    ri[1] = rj[1];
    rj[1] = tmp;
  }
  return { ...img, runs };
}

// ── Trait sourcing from vendored image-data-v2.json ───────────────────────────

interface ImageDataV2 {
  palette: string[];
  images: Record<string, Array<{ filename: string; data: string }>>;
}

export function findTrait(
  imageData: ImageDataV2,
  category: TraitCategory,
  nameOrIndex: string | number,
): { index: number; filename: string; data: string } {
  const list = imageData.images[IMAGE_KEY[category]];
  if (!list) throw new Error(`no such category: ${category}`);
  let idx: number;
  if (typeof nameOrIndex === 'number') idx = nameOrIndex;
  else {
    idx = list.findIndex(t => t.filename === nameOrIndex || t.filename === `${category}-${nameOrIndex}`);
    if (idx < 0) idx = list.findIndex(t => t.filename.includes(String(nameOrIndex)));
  }
  const hit = list[idx];
  if (idx < 0 || !hit) throw new Error(`trait not found: ${category} ${nameOrIndex}`);
  return { index: idx, filename: hit.filename, data: hit.data };
}

/** Assert every colour used by the RLE already exists in the on-chain palette. */
export function assertColorsInPalette(img: DecodedRle, paletteLen: number): void {
  for (const [, col] of img.runs)
    if (col >= paletteLen)
      throw new Error(`colour index ${col} not in palette (len ${paletteLen}) — palette must be extended first`);
}

// ── Calldata + proposal assembly ───────────────────────────────────────────────

export interface AddTraitCall {
  category: TraitCategory;
  rleHex: Hex;
  compressedHex: Hex;
  decompressedLength: number;
  imageCount: number;
  /** inner ABI-encoded args (no selector) — for propose()'s signature-field form */
  innerCalldata: Hex;
  /** full calldata incl selector — for a direct owner call / raw send */
  fullCalldata: Hex;
  signature: string;
}

/** Encode a single-image add-<category> call. */
export function buildAddTraitCall(category: TraitCategory, rleHex: Hex): AddTraitCall {
  const raw = Buffer.from(rleHex.replace(/^0x/, ''), 'hex');
  const compressed = deflateRawSync(raw, { level: 9 });
  const compressedHex = ('0x' + compressed.toString('hex')) as Hex;
  const signature = `${ADD_FN[category]}(bytes,uint80,uint16)`;
  const fnAbi = descriptorAddAbi.filter(f => f.name === ADD_FN[category]);
  const fullCalldata = encodeFunctionData({
    abi: fnAbi,
    functionName: ADD_FN[category],
    args: [compressedHex, BigInt(raw.length), 1],
  });
  // inner = full minus the 4-byte selector
  const innerCalldata = ('0x' + fullCalldata.slice(10)) as Hex;
  return {
    category,
    rleHex,
    compressedHex,
    decompressedLength: raw.length,
    imageCount: 1,
    innerCalldata,
    fullCalldata,
    signature,
  };
}

export interface TraitProposal {
  add: AddTraitCall;
  targets: `0x${string}`[];
  values: bigint[];
  signatures: string[];
  calldatas: Hex[];
  description: string;
  /** full propose() calldata for a raw send to the treasury */
  proposeCalldata: Hex;
}

/**
 * Build the complete NounV2Treasury.propose(...) for adding one trait.
 * Provide EITHER `rleHex` directly, OR `deriveFrom` + a `derivation`.
 */
export function buildTraitProposal(opts: {
  category: TraitCategory;
  title: string;
  description: string;
  rleHex?: string;
  deriveFrom?: { imageData: ImageDataV2; source: string | number; derivation: Derivation };
}): TraitProposal {
  let rleHex: Hex;
  if (opts.rleHex) {
    rleHex = (opts.rleHex.startsWith('0x') ? opts.rleHex : '0x' + opts.rleHex) as Hex;
  } else if (opts.deriveFrom) {
    const { imageData, source, derivation } = opts.deriveFrom;
    const src = findTrait(imageData, opts.category, source);
    const derived = applyDerivation(parseRle(src.data), derivation);
    assertColorsInPalette(derived, imageData.palette.length);
    rleHex = serializeRle(derived);
  } else {
    throw new Error('provide rleHex or deriveFrom');
  }

  const add = buildAddTraitCall(opts.category, rleHex);
  const description = `# ${opts.title}\n\n${opts.description}`;
  const targets = [V2_DESCRIPTOR] as `0x${string}`[];
  const values = [0n];
  const signatures = [add.signature];
  const calldatas = [add.innerCalldata];
  const proposeCalldata = encodeFunctionData({
    abi: treasuryProposeAbi,
    functionName: 'propose',
    args: [targets, values, signatures, calldatas, description],
  });
  return { add, targets, values, signatures, calldatas, description, proposeCalldata };
}
