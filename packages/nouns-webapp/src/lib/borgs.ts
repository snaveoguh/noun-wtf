/**
 * Borgs — fully on-chain 24x24 pixel NFTs on Polygon (borgs.app, launched 2022-01-01).
 *
 * Every borg is a stack of layer attributes; every attribute is a sparse set of
 * AARRGGBB pixels stored on-chain. Breeding burns both parents and mints a child
 * that inherits the rarest attribute per layer (rarity = on-chain usage counts).
 *
 * Static snapshot lives in public/borgs/ (see scripts/snapshot-borgs.mjs);
 * anything minted/bred after the snapshot is fetched live over RPC here.
 */
import { createPublicClient, fallback, http } from 'viem';
import { polygon } from 'viem/chains';

export const BORGS_ADDRESS = '0xa88E5cfA0257460490Ce54052B4faeE1b3d7f410' as const;
export const BORGS_SUPPLY_LIMIT = 50_000;
export const BORG_GRID = 24; // 576 pixels

export const generatedBorgEvent = {
  type: 'event',
  name: 'GeneratedBorg',
  inputs: [
    { name: 'borgId', type: 'uint256', indexed: true },
    { name: 'creator', type: 'address', indexed: true },
    { name: 'timestamp', type: 'uint256', indexed: false },
  ],
} as const;

export const bredBorgEvent = {
  type: 'event',
  name: 'BredBorg',
  inputs: [
    { name: 'childId', type: 'uint256', indexed: true },
    { name: 'parentId1', type: 'uint256', indexed: true },
    { name: 'parentId2', type: 'uint256', indexed: true },
    { name: 'breeder', type: 'address', indexed: false },
    { name: 'timestamp', type: 'uint256', indexed: false },
  ],
} as const;

export const borgsAbi = [
  generatedBorgEvent,
  bredBorgEvent,
  {
    type: 'function',
    name: 'generateBorg',
    stateMutability: 'payable',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'breedBorgs',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'borgId1', type: 'uint256' },
      { name: 'borgId2', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'previewBreedBorgs',
    stateMutability: 'view',
    inputs: [
      { name: 'borgId1', type: 'uint256' },
      { name: 'borgId2', type: 'uint256' },
    ],
    outputs: [
      { name: 'image', type: 'bytes8[]' },
      { name: 'attributes', type: 'string[]' },
    ],
  },
  {
    type: 'function',
    name: 'getBorg',
    stateMutability: 'view',
    inputs: [{ name: 'borgId', type: 'uint256' }],
    outputs: [
      { name: 'name', type: 'string' },
      { name: 'image', type: 'bytes8[]' },
      { name: 'attributes', type: 'string[]' },
      { name: 'parentId1', type: 'uint256' },
      { name: 'parentId2', type: 'uint256' },
      { name: 'childId', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'getGenerationPrice',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getCurrentGenerationCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getCurrentBredCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getClaimedFreeBorgCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'combineBorgAttributes',
    stateMutability: 'view',
    inputs: [{ name: 'borgAttributeNames', type: 'string[]' }],
    outputs: [{ name: 'hexPixals', type: 'bytes8[]' }],
  },
  {
    type: 'function',
    name: 'nameBorg',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'borgId', type: 'uint256' },
      { name: 'newName', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'tokenOfOwnerByIndex',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'index', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export const polygonClient = createPublicClient({
  chain: polygon,
  transport: fallback([
    http('https://polygon-bor-rpc.publicnode.com', { timeout: 10_000 }),
    http('https://polygon-rpc.com', { timeout: 10_000 }),
    http('https://1rpc.io/matic', { timeout: 10_000 }),
  ]),
});

// Historical reads need their own client: publicnode gates archival requests
// behind a personal token, and no free polygon RPC serves usable eth_getLogs
// ranges. drpc's free tier DOES serve archival eth_call + old block headers,
// which is enough to binary-search mint blocks off the monotonic counters.
const polygonArchiveClient = createPublicClient({
  chain: polygon,
  transport: http('https://polygon.drpc.org', { timeout: 10_000 }),
});

export interface BorgAttribute {
  /** attribute name as stored on-chain, e.g. "gold chain" or "blank7" */
  n: string;
  /** layer index (0 = bottom) */
  l: number;
  /** on-chain usage count at snapshot time (rarity: lower = rarer) */
  u: number;
  /** sparse pixels: AARRGGBB hex string -> flat positions in the 24x24 grid */
  px: Record<string, number[]>;
}

export interface Borg {
  id: number;
  /** indexes into the attributes array, ordered by layer */
  attrs: number[];
  parent1: number;
  parent2: number;
  child: number;
  /** null = burned (bred away) */
  owner: string | null;
  name: string;
  /** unix seconds of the GeneratedBorg/BredBorg event; 0 = unknown */
  born: number;
}

export interface BorgsMeta {
  contract: string;
  chainId: number;
  snapshotBlock: number;
  generated: number;
  bred: number;
  freeClaimed: number;
  maxId: number;
  updatedAt: string;
}

export interface BorgsData {
  meta: BorgsMeta;
  attributes: BorgAttribute[];
  borgs: Map<number, Borg>;
}

export const isBlankAttribute = (name: string) => /^blank\d+$/i.test(name);

/* ---------------------------------- data --------------------------------- */

type CompactBorg = [number, number[], number, number, number, number, string, number?];

let dataPromise: Promise<BorgsData> | null = null;

async function loadSnapshot(): Promise<BorgsData> {
  const [meta, attrsRes, borgsRes] = await Promise.all([
    fetch('/borgs/meta.json').then(r => r.json()) as Promise<BorgsMeta>,
    fetch('/borgs/attributes.json').then(r => r.json()) as Promise<{ attributes: BorgAttribute[] }>,
    fetch('/borgs/borgs.json').then(r => r.json()) as Promise<{
      owners: string[];
      borgs: CompactBorg[];
    }>,
  ]);
  const borgs = new Map<number, Borg>();
  for (const [id, attrs, parent1, parent2, child, ownerIdx, name, born] of borgsRes.borgs) {
    borgs.set(id, {
      id,
      attrs,
      parent1,
      parent2,
      child,
      owner: ownerIdx >= 0 ? borgsRes.owners[ownerIdx] : null,
      name,
      born: born ?? 0,
    });
  }
  const data: BorgsData = { meta, attributes: attrsRes.attributes, borgs };
  await fetchNewBorgs(data).catch(() => undefined); // best effort live top-up
  return data;
}

export function loadBorgsData(): Promise<BorgsData> {
  dataPromise ??= loadSnapshot().catch(err => {
    dataPromise = null; // allow retry on next call
    throw err;
  });
  return dataPromise;
}

/**
 * Pull anything minted/bred after the snapshot, mutating `data` in place.
 * Also marks snapshot borgs burned when they became parents of a new child.
 */
export async function fetchNewBorgs(data: BorgsData): Promise<number> {
  const contract = { address: BORGS_ADDRESS, abi: borgsAbi } as const;
  const [generated, bred] = await polygonClient.multicall({
    contracts: [
      { ...contract, functionName: 'getCurrentGenerationCount' },
      { ...contract, functionName: 'getCurrentBredCount' },
    ],
    allowFailure: false,
  });
  const liveMaxId = Number(generated) + Number(bred);
  const knownMaxId = data.meta.maxId;
  if (liveMaxId <= knownMaxId) return 0;

  // Cap the per-visit top-up; the shipped snapshot should stay close to live.
  const newIds = [];
  for (let id = knownMaxId + 1; id <= liveMaxId && newIds.length < 300; id++) newIds.push(id);

  // Birth timestamps: binary-search each new borg's mint block using the
  // monotonic generated+bred counters (borg id X exists from the first block
  // where the combined count >= X), then read that block's timestamp. Ids are
  // ascending, so the search floor walks forward — ~20 probes for the first
  // id, a handful for each after. Budget-capped: leftovers keep born=0 until
  // the next snapshot refresh fills them from event logs.
  const births = new Map<number, number>();
  try {
    const latest = await polygonClient.getBlockNumber();
    const countAt = async (block: bigint) => {
      const [gen, bred] = await polygonArchiveClient.multicall({
        contracts: [
          { ...contract, functionName: 'getCurrentGenerationCount' },
          { ...contract, functionName: 'getCurrentBredCount' },
        ],
        allowFailure: false,
        blockNumber: block,
      });
      return Number(gen) + Number(bred);
    };
    let probes = 0;
    let lo = BigInt(data.meta.snapshotBlock);
    for (const id of newIds) {
      let hi = latest;
      while (lo < hi && probes < 120) {
        const mid = (lo + hi) / 2n;
        probes += 1;
        if ((await countAt(mid)) >= id) hi = mid;
        else lo = mid + 1n;
      }
      if (lo < hi) break; // probe budget exhausted mid-search
      const block = await polygonArchiveClient.getBlock({ blockNumber: lo });
      births.set(id, Number(block.timestamp));
    }
  } catch {
    /* born stays 0 for this visit */
  }

  // getBorg rebuilds the 576-pixel image in-contract — too gas-heavy to batch
  // via multicall (inner calls hit the RPC eth_call gas cap). Read one by one.
  const attrIndex = new Map(data.attributes.map((a, i) => [a.n, i]));
  let added = 0;
  for (const id of newIds) {
    let borgRes;
    try {
      borgRes = await polygonClient.readContract({
        ...contract,
        functionName: 'getBorg',
        args: [BigInt(id)],
      });
    } catch {
      continue;
    }
    const [name, , attributes, parentId1, parentId2, childId] = borgRes;
    // Attribute set is fixed on-chain post-lock, so every name should resolve.
    const attrs = attributes.map(n => attrIndex.get(n) ?? -1);
    if (attrs.includes(-1)) continue;
    const owner = await polygonClient
      .readContract({ ...contract, functionName: 'ownerOf', args: [BigInt(id)] })
      .then(a => a.toLowerCase())
      .catch(() => null);
    const borg: Borg = {
      id,
      attrs,
      parent1: Number(parentId1),
      parent2: Number(parentId2),
      child: Number(childId),
      owner,
      name,
      born: births.get(id) ?? 0,
    };
    data.borgs.set(borg.id, borg);
    // Bred child ⇒ parents were burned
    for (const pid of [borg.parent1, borg.parent2]) {
      const parent = data.borgs.get(pid);
      if (parent) {
        parent.owner = null;
        parent.child = borg.id;
      }
    }
    added++;
  }
  data.meta.maxId = liveMaxId;
  data.meta.generated = Number(generated);
  data.meta.bred = Number(bred);
  return added;
}

/* -------------------------------- rendering ------------------------------- */

const imageCache = new Map<string, string>();

function parsePixelHex(hex: string): { r: number; g: number; b: number; a: number } | null {
  // On-chain pixels are ascii hex parsed as a 32-bit ARGB int (see borgs.sol +
  // their renderer): pad to 8 chars, high byte is alpha. Alpha 0 = transparent.
  const v = parseInt(hex, 16);
  if (Number.isNaN(v)) return null;
  const a = (v >>> 24) & 0xff;
  if (a === 0) return null;
  return { a, r: (v >>> 16) & 0xff, g: (v >>> 8) & 0xff, b: v & 0xff };
}

/** Composite attribute layers into a 24x24 PNG data URI (cached). */
export function renderBorgImage(attrs: number[], attributes: BorgAttribute[]): string | null {
  const key = attrs.join(',');
  const cached = imageCache.get(key);
  if (cached) return cached;
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = BORG_GRID;
  canvas.height = BORG_GRID;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(BORG_GRID, BORG_GRID);

  for (const attrIdx of attrs) {
    const attr = attributes[attrIdx];
    if (!attr) continue;
    for (const [hex, positions] of Object.entries(attr.px)) {
      const c = parsePixelHex(hex);
      if (!c) continue;
      for (const pos of positions) {
        const o = pos * 4;
        img.data[o] = c.r;
        img.data[o + 1] = c.g;
        img.data[o + 2] = c.b;
        img.data[o + 3] = c.a;
      }
    }
  }

  ctx.putImageData(img, 0, 0);
  const uri = canvas.toDataURL('image/png');
  imageCache.set(key, uri);
  return uri;
}

/** Render a raw on-chain bytes8[] image (e.g. previewBreedBorgs output). */
export function renderRawBorgImage(pixels: readonly `0x${string}`[]): string | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = BORG_GRID;
  canvas.height = BORG_GRID;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(BORG_GRID, BORG_GRID);

  pixels.forEach((bytes8, pos) => {
    // bytes8 -> ascii hex string (null-terminated), then ARGB int
    const raw = bytes8.slice(2);
    let ascii = '';
    for (let i = 0; i < raw.length; i += 2) {
      const code = parseInt(raw.slice(i, i + 2), 16);
      if (code === 0) break;
      ascii += String.fromCharCode(code);
    }
    ascii = ascii.trim();
    if (!ascii) return;
    const c = parsePixelHex(ascii);
    if (!c) return;
    const o = pos * 4;
    img.data[o] = c.r;
    img.data[o + 1] = c.g;
    img.data[o + 2] = c.b;
    img.data[o + 3] = c.a;
  });

  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

/** Live list of borg ids owned by an address (ERC721Enumerable). */
export async function fetchOwnedBorgIds(owner: `0x${string}`): Promise<number[]> {
  const contract = { address: BORGS_ADDRESS, abi: borgsAbi } as const;
  const balance = await polygonClient.readContract({
    ...contract,
    functionName: 'balanceOf',
    args: [owner],
  });
  const n = Number(balance);
  if (n === 0) return [];
  const results = await polygonClient.multicall({
    contracts: Array.from({ length: n }, (_, i) => ({
      ...contract,
      functionName: 'tokenOfOwnerByIndex' as const,
      args: [owner, BigInt(i)] as const,
    })),
    allowFailure: true,
  });
  return results
    .filter(r => r.status === 'success')
    .map(r => Number(r.result))
    .sort((a, b) => a - b);
}
