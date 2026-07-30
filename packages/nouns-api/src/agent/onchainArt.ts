// ─── On-chain Nouns Art Reader ─────────────────────────────────────────────
//
// Authoritative art source for trait proposals + previews. Reads the FULL
// palette + RLE trait images for either DAO straight from the NounsArt
// SSTORE2 pages, because the per-index getters (heads(uint256) etc.) REVERT
// for the older/large pages on the main NounsArt contract.
//
// Route: descriptor.art() → getBodiesTrait()/…/getGlassesTrait() →
// Trait{ storagePages[]{imageCount, decompressedLength, pointer}, … } →
// eth_getCode(pointer) → strip the leading 0x00 STOP byte → inflateRaw →
// ABI-decode bytes[] → concatenate pages.
//
// The bundled image-data JSON files are FALLBACK ONLY (the v1 copy is known
// to carry 4 stale traits) — on-chain wins whenever the RPC cooperates.

import { inflateRawSync } from 'node:zlib';
import {
  createPublicClient,
  decodeAbiParameters,
  http,
  type Abi,
  type Hex,
  type PublicClient,
} from 'viem';
import { mainnet } from 'viem/chains';

import { MAIN_DESCRIPTOR, V2_DESCRIPTOR } from './traitProposal.js';
import ImageDataV1 from './image-data-v1.json';
import ImageDataV2 from './image-data-v2.json';

export type ArtDao = 'nouns' | 'nounv2';

export interface OnchainArt {
  /** hex colours ("rrggbb", lowercase); index 0 is '' = transparent */
  palette: string[];
  /** background hex colours ("rrggbb") */
  bgcolors: string[];
  /** RLE trait images as bare hex strings (no 0x prefix) */
  images: {
    bodies: string[];
    accessories: string[];
    heads: string[];
    glasses: string[];
  };
}

const RPC_URL =
  process.env.NOUNIRL_RPC_URL ||
  process.env.PONDER_RPC_URL_1 ||
  'https://ethereum-rpc.publicnode.com';

let client: PublicClient | null = null;
function getClient(): PublicClient {
  if (!client) {
    client = createPublicClient({ chain: mainnet, transport: http(RPC_URL) });
  }
  return client;
}

// ── ABIs (typed loosely as Abi — results are cast at the call sites) ───────

const descriptorAbi: Abi = [
  { type: 'function', name: 'art', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  {
    type: 'function',
    name: 'backgroundCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'backgrounds',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [{ type: 'string' }],
  },
];

const traitOutput = {
  type: 'tuple',
  components: [
    {
      name: 'storagePages',
      type: 'tuple[]',
      components: [
        { name: 'imageCount', type: 'uint16' },
        { name: 'decompressedLength', type: 'uint80' },
        { name: 'pointer', type: 'address' },
      ],
    },
    { name: 'storedImagesCount', type: 'uint256' },
  ],
};

const artAbi: Abi = [
  ...(['getBodiesTrait', 'getAccessoriesTrait', 'getHeadsTrait', 'getGlassesTrait'] as const).map(
    name => ({
      type: 'function' as const,
      name,
      stateMutability: 'view' as const,
      inputs: [],
      outputs: [traitOutput],
    }),
  ),
  {
    type: 'function',
    name: 'palettes',
    stateMutability: 'view',
    inputs: [{ type: 'uint8' }],
    outputs: [{ type: 'bytes' }],
  },
] as Abi;

interface TraitStruct {
  storagePages: Array<{ imageCount: number; decompressedLength: bigint; pointer: `0x${string}` }>;
  storedImagesCount: bigint;
}

// ── Fetch ──────────────────────────────────────────────────────────────────

async function readTraitImages(art: `0x${string}`, getter: string): Promise<string[]> {
  const c = getClient();
  const trait = (await c.readContract({
    address: art,
    abi: artAbi,
    functionName: getter,
  })) as unknown as TraitStruct;

  const out: string[] = [];
  for (const page of trait.storagePages) {
    const code = await c.getCode({ address: page.pointer });
    if (!code || code === '0x') throw new Error(`empty SSTORE2 page ${page.pointer} for ${getter}`);
    // strip the leading STOP (0x00) byte SSTORE2 prepends to the data
    const blob = Buffer.from(code.slice(2), 'hex').subarray(1);
    const raw = inflateRawSync(blob);
    if (raw.length !== Number(page.decompressedLength)) {
      throw new Error(
        `${getter} page ${page.pointer}: inflated ${raw.length}B != declared ${page.decompressedLength}B`,
      );
    }
    let imgs: readonly Hex[];
    try {
      [imgs] = decodeAbiParameters(
        [{ type: 'bytes[]' }],
        ('0x' + raw.toString('hex')) as Hex,
      ) as [readonly Hex[]];
    } catch (err) {
      // Pages added via buildAddTraitCall (e.g. NounV2 prop #1's joker head)
      // deflate the raw RLE bytes WITHOUT abi.encode(bytes[]) wrapping. For a
      // single-image page the inflated blob IS the image.
      if (page.imageCount === 1) {
        imgs = [('0x' + raw.toString('hex')) as Hex];
      } else {
        throw err;
      }
    }
    if (imgs.length !== page.imageCount) {
      throw new Error(`${getter} page ${page.pointer}: ${imgs.length} images != declared ${page.imageCount}`);
    }
    for (const img of imgs) out.push(img.slice(2).toLowerCase());
  }
  if (out.length !== Number(trait.storedImagesCount)) {
    throw new Error(`${getter}: decoded ${out.length} images != storedImagesCount ${trait.storedImagesCount}`);
  }
  return out;
}

async function fetchOnchainArt(dao: ArtDao): Promise<OnchainArt> {
  const c = getClient();
  const descriptor = dao === 'nouns' ? MAIN_DESCRIPTOR : V2_DESCRIPTOR;
  const art = (await c.readContract({
    address: descriptor,
    abi: descriptorAbi,
    functionName: 'art',
  })) as `0x${string}`;

  const [bodies, accessories, heads, glasses, paletteBytes, bgCount] = await Promise.all([
    readTraitImages(art, 'getBodiesTrait'),
    readTraitImages(art, 'getAccessoriesTrait'),
    readTraitImages(art, 'getHeadsTrait'),
    readTraitImages(art, 'getGlassesTrait'),
    c.readContract({ address: art, abi: artAbi, functionName: 'palettes', args: [0] }) as Promise<Hex>,
    c.readContract({ address: descriptor, abi: descriptorAbi, functionName: 'backgroundCount' }) as Promise<bigint>,
  ]);

  // packed 3-byte colours; index 0 is the transparent slot → ''
  const pal = Buffer.from(paletteBytes.slice(2), 'hex');
  const palette: string[] = [''];
  for (let i = 1; i < Math.floor(pal.length / 3); i++) {
    palette.push(pal.subarray(i * 3, i * 3 + 3).toString('hex'));
  }

  const bgcolors: string[] = [];
  for (let i = 0n; i < bgCount; i++) {
    bgcolors.push(
      (await c.readContract({
        address: descriptor,
        abi: descriptorAbi,
        functionName: 'backgrounds',
        args: [i],
      })) as string,
    );
  }

  return { palette, bgcolors, images: { bodies, accessories, heads, glasses } };
}

// ── Bundled fallback ───────────────────────────────────────────────────────

interface BundledImageData {
  bgcolors: string[];
  palette: string[];
  images: Record<string, Array<{ filename: string; data: string }>>;
}

function bundledArt(dao: ArtDao): OnchainArt {
  const d = (dao === 'nouns' ? ImageDataV1 : ImageDataV2) as unknown as BundledImageData;
  const strip = (key: string): string[] =>
    (d.images[key] ?? []).map(t => t.data.replace(/^0x/, '').toLowerCase());
  return {
    palette: d.palette.map(c => c.toLowerCase()),
    bgcolors: d.bgcolors,
    images: {
      bodies: strip('bodies'),
      accessories: strip('accessories'),
      heads: strip('heads'),
      glasses: strip('glasses'),
    },
  };
}

// ── Cache (10-min TTL, in-flight dedupe, stale-if-error) ───────────────────

const ART_TTL = 10 * 60_000;
/** fallback results only stick around for a minute so the chain gets retried */
const FALLBACK_TTL = 60_000;

const artCache = new Map<ArtDao, { art: OnchainArt; fetchedAt: number }>();
const artInflight = new Map<ArtDao, Promise<OnchainArt>>();

export async function getOnchainArt(dao: ArtDao): Promise<OnchainArt> {
  const hit = artCache.get(dao);
  if (hit && Date.now() - hit.fetchedAt < ART_TTL) return hit.art;

  const pending = artInflight.get(dao);
  if (pending) return pending;

  const p = fetchOnchainArt(dao)
    .then(art => {
      artCache.set(dao, { art, fetchedAt: Date.now() });
      return art;
    })
    .catch(err => {
      console.warn(
        `[OnchainArt] chain fetch failed for ${dao} — falling back to ${hit ? 'stale cache' : 'bundled image data'}:`,
        err instanceof Error ? err.message : err,
      );
      if (hit) return hit.art; // stale beats bundled
      const fallback = bundledArt(dao);
      artCache.set(dao, { art: fallback, fetchedAt: Date.now() - (ART_TTL - FALLBACK_TTL) });
      return fallback;
    })
    .finally(() => artInflight.delete(dao));
  artInflight.set(dao, p);
  return p;
}

// ── RLE decode + pixel composition ─────────────────────────────────────────
//
// Canonical Nouns RLE: header [0x00 paletteIdx][top][right][bottom][left]
// where top = first content row, bottom = LAST content row (INCLUSIVE —
// official quirk), left = first content col, right = last content col + 1
// (EXCLUSIVE). Then (runLength ≤255, colourIndex) pairs over the bounded
// rectangle, with runs merging across row boundaries. Colour index 0 =
// transparent.

/** Decode an RLE image (with or without 0x) into a 32×32 palette-index grid (0 = transparent). */
export function decodeRle(rle: string): number[][] {
  const s = rle.replace(/^0x/, '').toLowerCase();
  if (s.length < 10 || s.length % 2 !== 0 || /[^0-9a-f]/.test(s)) {
    throw new Error('invalid RLE hex');
  }
  const bytes = Buffer.from(s, 'hex');
  const top = bytes[1]!;
  const right = bytes[2]!;
  const bottom = bytes[3]!;
  const left = bytes[4]!;
  if (right > 32 || bottom > 31 || left >= right || top > bottom) {
    throw new Error(`invalid RLE bounds top=${top} right=${right} bottom=${bottom} left=${left}`);
  }
  const grid: number[][] = Array.from({ length: 32 }, () => new Array<number>(32).fill(0));
  let x = left;
  let y = top;
  for (let i = 5; i + 1 < bytes.length; i += 2) {
    let len = bytes[i]!;
    const col = bytes[i + 1]!;
    while (len-- > 0) {
      if (y > bottom) throw new Error('RLE runs overflow the declared bounds');
      if (col !== 0) grid[y]![x] = col;
      x++;
      if (x === right) {
        x = left;
        y++;
      }
    }
  }
  return grid;
}

export interface NounSeedLike {
  background: number;
  body: number;
  accessory: number;
  head: number;
  glasses: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * Compose a noun into a raw 32×32×3 RGB buffer (sharp `raw` input).
 * Any layer can be swapped with an explicit RLE via override*; a seed index
 * of -1 (with no override) skips that layer entirely — handy for solo trait
 * renders.
 */
export function composeNoun(opts: {
  art: OnchainArt;
  seed: NounSeedLike;
  overrideBody?: string;
  overrideAccessory?: string;
  overrideHead?: string;
  overrideGlasses?: string;
}): Buffer {
  const { art, seed } = opts;
  const buf = Buffer.alloc(32 * 32 * 3);

  const bgHex = art.bgcolors[seed.background] ?? art.bgcolors[0] ?? 'd5d7e1';
  const [br, bgc, bb] = hexToRgb(bgHex);
  for (let i = 0; i < 32 * 32; i++) {
    buf[i * 3] = br;
    buf[i * 3 + 1] = bgc;
    buf[i * 3 + 2] = bb;
  }

  const layers: Array<string | undefined> = [
    opts.overrideBody ?? art.images.bodies[seed.body],
    opts.overrideAccessory ?? art.images.accessories[seed.accessory],
    opts.overrideHead ?? art.images.heads[seed.head],
    opts.overrideGlasses ?? art.images.glasses[seed.glasses],
  ];
  for (const rle of layers) {
    if (!rle) continue;
    const grid = decodeRle(rle);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const col = grid[y]![x]!;
        if (col === 0) continue;
        const hex = art.palette[col];
        if (!hex) continue; // out-of-palette index — leave pixel as-is
        const [r, g, b] = hexToRgb(hex);
        const o = (y * 32 + x) * 3;
        buf[o] = r;
        buf[o + 1] = g;
        buf[o + 2] = b;
      }
    }
  }
  return buf;
}
