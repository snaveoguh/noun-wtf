// Shared core for adding a Nouns art trait via a governance proposal — on
// EITHER the main Nouns DAO or NounV2.
//
// The NounV2 descriptor (0xAe0247…) is owned by the NounV2Treasury; the main
// Nouns descriptor (0x33A9c4…) is owned by the main DAO timelock. In both
// cases new traits can only be added by a passing proposal that calls
// addHeads/addBodies/etc — same function signatures, same 5-arg
// propose(targets,values,signatures,calldatas,description) shape on both
// governors. This module turns an RLE trait image into the exact propose(...)
// args for the chosen DAO.
//
// It powers three consumers: the nounirl agent tool, the standalone CLI, and the
// Claude Code skill. First shipped as NounV2 prop #1 ("joker" head #253) 2026-07-24.

import { deflateRawSync } from 'node:zlib';
import sharp from 'sharp';
import { encodeFunctionData, type Hex } from 'viem';

import { decodeRle } from './onchainArt.js';

export const V2_DESCRIPTOR = '0xAe0247Ca34B211a61b03A95F8008DCb8B3124B89' as const;
export const V2_TREASURY = '0x2cDeb0d251674710840d9fa990D1de138dfe7C00' as const;
/** Main Nouns descriptor — owned by the main DAO timelock; arePartsLocked()=false */
export const MAIN_DESCRIPTOR = '0x33A9c445fb4FB21f2c030A6b2d3e2F12D017BFAC' as const;
/** Main Nouns DAO governor proxy — propose() recipient for dao:'nouns' */
export const MAIN_DAO = '0x6f3E6272A167e8AcCb32072d08E0957F9c79223d' as const;

export type TraitCategory = 'head' | 'body' | 'accessory' | 'glasses';
export type TraitDao = 'nounv2' | 'nouns';

/** descriptor add-function per category (the RLE+deflate batch form) */
const ADD_FN: Record<TraitCategory, string> = {
  head: 'addHeads',
  body: 'addBodies',
  accessory: 'addAccessories',
  glasses: 'addGlasses',
};

/** image-data category key per trait category */
export const IMAGE_KEY: Record<TraitCategory, string> = {
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

// ── PNG → canonical Nouns RLE ──────────────────────────────────────────────────
//
// Canonical encoding (validated byte-for-byte against every stored on-chain
// trait): header [0x00 paletteIdx][top][right][bottom][left] where top = first
// content row, bottom = LAST content row (INCLUSIVE — official quirk), left =
// first content col, right = last content col + 1 (EXCLUSIVE); then
// (runLength ≤255, colourIndex) pairs over the bounded rectangle with runs
// MERGING ACROSS row boundaries. Colour index 0 = transparent.

/**
 * Convert a PNG (e.g. a saved Dream custom trait or an upload) into canonical
 * Nouns RLE against the given on-chain palette.
 *
 * - Requires a square image; larger squares are downscaled to 32×32 with
 *   nearest-neighbour, non-square images are rejected.
 * - Alpha 0 → transparent; every other pixel must EXACT-match a palette colour
 *   (case-insensitive, no tolerance). Missing colours throw, listing them —
 *   palette additions are a separate, bigger proposal.
 * - Round-trips the encoded bytes through the decoder before returning.
 */
export async function pngToRle(png: Buffer, palette: string[]): Promise<Hex> {
  let img = sharp(png, { limitInputPixels: 4096 * 4096 });
  const meta = await img.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w === 0 || h === 0) throw new Error('could not read image dimensions');
  if (w !== h) throw new Error(`trait image must be square — got ${w}×${h}`);
  if (w < 32) throw new Error(`trait image too small (${w}×${h}) — need at least 32×32`);
  if (w > 32) img = img.resize(32, 32, { kernel: 'nearest' });

  const data = await img.ensureAlpha().raw().toBuffer();

  const lookup = new Map<string, number>();
  palette.forEach((c, i) => {
    if (c) lookup.set(c.toLowerCase(), i);
  });

  const grid: number[][] = [];
  const missing = new Set<string>();
  for (let y = 0; y < 32; y++) {
    const row: number[] = [];
    for (let x = 0; x < 32; x++) {
      const o = (y * 32 + x) * 4;
      if (data[o + 3] === 0) {
        row.push(0);
        continue;
      }
      const hex = [data[o]!, data[o + 1]!, data[o + 2]!]
        .map(v => v.toString(16).padStart(2, '0'))
        .join('');
      const idx = lookup.get(hex);
      if (idx === undefined) {
        missing.add(hex);
        row.push(0);
      } else {
        row.push(idx);
      }
    }
    grid.push(row);
  }
  if (missing.size > 0) {
    throw new Error(
      `${missing.size} colour(s) in the image are not in the on-chain palette: ` +
        [...missing].map(c => '#' + c).join(', ') +
        '. Traits can only use colours the palette already contains — adding new palette colours is a separate (bigger) proposal.',
    );
  }

  // content bounds — bottom INCLUSIVE, right EXCLUSIVE
  let top = 32;
  let bottom = -1;
  let left = 32;
  let right = -1;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      if (grid[y]![x]! === 0) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x + 1 > right) right = x + 1;
    }
  }
  if (bottom < 0) throw new Error('trait image is fully transparent — nothing to encode');

  const bytes: number[] = [0x00, top, right, bottom, left];
  let runLen = 0;
  let runCol = -1;
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x < right; x++) {
      const col = grid[y]![x]!;
      if (col === runCol && runLen < 255) {
        runLen++;
      } else {
        if (runLen > 0) bytes.push(runLen, runCol);
        runCol = col;
        runLen = 1;
      }
    }
  }
  if (runLen > 0) bytes.push(runLen, runCol);

  const rleHex = ('0x' + Buffer.from(bytes).toString('hex')) as Hex;

  // round-trip self-check: decode and compare grids pixel-for-pixel
  const decoded = decodeRle(rleHex);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      if (decoded[y]![x]! !== grid[y]![x]!) {
        throw new Error(`RLE round-trip mismatch at (${x},${y}) — encoder bug, refusing to proceed`);
      }
    }
  }
  return rleHex;
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

/**
 * ⚠️ THE ENCODING THAT BROKE V2 PROP #1.
 *
 * `NounsArt.imageByIndex` does `abi.decode(inflate(page), (bytes[]))`. The
 * payload therefore has to be the DEFLATE of `abi.encode(bytes[] images)` —
 * NOT the DEFLATE of the bare RLE. This function shipped the bare form, so V2
 * head #253 (joker) is permanently unreadable: `heads(253)` reverts, and any
 * Noun that rolls it has a REVERTING tokenURI. It looked fine at every step —
 * the proposal simulated, passed and executed; only reading the art back fails.
 *
 * `decompressedLength` must be the length of the ABI-ENCODED buffer, not the RLE.
 *
 * Always verify after execution: `<art>.heads(newIndex)` must return bytes.
 * See verifyTraitReadable() below.
 */
function abiEncodeBytesArray(images: Buffer[]): Buffer {
  const n = images.length;
  const pad = (b: Buffer) => Buffer.concat([b, Buffer.alloc((32 - (b.length % 32)) % 32)]);
  const word = (v: number) => {
    const b = Buffer.alloc(32);
    b.writeUInt32BE(v, 28);
    return b;
  };
  // offsets are relative to the start of the array block (just after its length)
  const offsets: Buffer[] = [];
  let running = 32 * n;
  for (const img of images) {
    offsets.push(word(running));
    running += 32 + pad(img).length;
  }
  const bodies = images.map(img => Buffer.concat([word(img.length), pad(img)]));
  // outer: offset-to-array (0x20), array length, offsets…, bodies…
  return Buffer.concat([word(32), word(n), ...offsets, ...bodies]);
}

/** Encode a single-image add-<category> call. */
export function buildAddTraitCall(category: TraitCategory, rleHex: Hex): AddTraitCall {
  const raw = Buffer.from(rleHex.replace(/^0x/, ''), 'hex');
  const encoded = abiEncodeBytesArray([raw]);
  const compressed = deflateRawSync(encoded, { level: 9 });
  const compressedHex = ('0x' + compressed.toString('hex')) as Hex;
  const signature = `${ADD_FN[category]}(bytes,uint80,uint16)`;
  const fnAbi = descriptorAddAbi.filter(f => f.name === ADD_FN[category]);
  const fullCalldata = encodeFunctionData({
    abi: fnAbi,
    functionName: ADD_FN[category],
    args: [compressedHex, BigInt(encoded.length), 1],
  });
  // inner = full minus the 4-byte selector
  const innerCalldata = ('0x' + fullCalldata.slice(10)) as Hex;
  return {
    category,
    rleHex,
    compressedHex,
    decompressedLength: abiEncodeBytesArray([raw]).length,
    imageCount: 1,
    innerCalldata,
    fullCalldata,
    signature,
  };
}

export interface TraitProposal {
  add: AddTraitCall;
  /** which DAO this proposal targets ('nounv2' default) */
  dao: TraitDao;
  /** governor the propose() calldata must be sent to (V2_TREASURY or MAIN_DAO) */
  proposeTo: `0x${string}`;
  targets: `0x${string}`[];
  values: bigint[];
  signatures: string[];
  calldatas: Hex[];
  description: string;
  /** full propose() calldata for a raw send to the governor (`proposeTo`) */
  proposeCalldata: Hex;
}

/**
 * Build the complete propose(...) for adding one trait.
 * Provide EITHER `rleHex` directly, OR `deriveFrom` + a `derivation`.
 * `dao` defaults to 'nounv2' (existing behaviour); 'nouns' targets the main
 * Nouns descriptor and the propose() recipient becomes the main DAO proxy
 * (MAIN_DAO) — the 5-arg propose shape is identical on both governors.
 */
export function buildTraitProposal(opts: {
  category: TraitCategory;
  title: string;
  description: string;
  dao?: TraitDao;
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

  const dao: TraitDao = opts.dao ?? 'nounv2';
  const add = buildAddTraitCall(opts.category, rleHex);
  const description = `# ${opts.title}\n\n${opts.description}`;
  const targets = [dao === 'nouns' ? MAIN_DESCRIPTOR : V2_DESCRIPTOR] as `0x${string}`[];
  const proposeTo: `0x${string}` = dao === 'nouns' ? MAIN_DAO : V2_TREASURY;
  const values = [0n];
  const signatures = [add.signature];
  const calldatas = [add.innerCalldata];
  const proposeCalldata = encodeFunctionData({
    abi: treasuryProposeAbi,
    functionName: 'propose',
    args: [targets, values, signatures, calldatas, description],
  });
  return { add, dao, proposeTo, targets, values, signatures, calldatas, description, proposeCalldata };
}
