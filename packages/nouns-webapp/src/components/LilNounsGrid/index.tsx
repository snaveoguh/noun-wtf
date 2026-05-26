/**
 * LilNounsGrid — VRGDA minting interface for Lil Nouns.
 *
 * Shows a pool of 256 possible Lil Nouns that can be minted RIGHT NOW.
 * Each cell = a different block hash → different appearance for the same nounId.
 * Click to see traits + "Buy Now" at the current VRGDA price.
 * "Refresh Pool" re-fetches latest blocks.
 * Final row is filled with greyscale extras beyond the 256 active pool.
 *
 * Contract: 0xA2587b1e2626904c8575640512b987Bd3d3B592D (mainnet)
 * Art data: https://assets.noundry.wtf/lil-nouns/image-data.json
 * Seed algo: keccak256(blockHash, nounId) → uint48 slices at [0,48,96,144,192]
 */
import { FC, useCallback, useEffect, useRef, useState } from 'react';

import { buildSVG } from '@nouns/sdk';
import { createPortal } from 'react-dom';
import {
  createPublicClient,
  formatEther,
  http,
  keccak256,
  encodePacked,
  type Hex,
  type PublicClient,
} from 'viem';
import { mainnet } from 'viem/chains';
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';

import { useAppSelector } from '@/hooks';

// ─── Config ──────────────────────────────────────────────────────────────────

const VRGDA_ADDRESS = '0xA2587b1e2626904c8575640512b987Bd3d3B592D' as const;
const LIL_NOUNS_TOKEN = '0x4b10701Bfd7BFEdc47d50562b76b436fbB5BdB3B' as const;
const POOL_SIZE = 256;
const MAX_EXTRA = 60; // extra blocks to fetch for grayscale row fill
const IMAGE_DATA_URL = 'https://assets.noundry.wtf/lil-nouns/image-data.json';
const MASK_48 = (1n << 48n) - 1n;

// Free no-key CORS-enabled public endpoints, tried in order on failure.
// Infura/Ankr/buidlguidl all dropped: Infura free tier 402s once cap hits,
// Ankr now requires a key, buidlguidl was unreachable. See wagmi.ts for the
// canonical list and why drpc/llamarpc/cloudflare are excluded.
const RPC_URLS = [
  'https://ethereum-rpc.publicnode.com',
  'https://1rpc.io/eth',
  'https://eth.merkle.io',
];

// ─── ABIs (minimal) ──────────────────────────────────────────────────────────

// Lightweight reads — avoid fetchNextNoun() which generates an SVG on-chain (expensive, can gas-out on free RPCs)
const NEXT_NOUN_ID_ABI = [
  {
    inputs: [],
    name: 'nextNounId',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const GET_VRGDA_PRICE_ABI = [
  {
    inputs: [],
    name: 'getCurrentVRGDAPrice',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const BUY_NOW_ABI = [
  {
    inputs: [
      { internalType: 'uint256', name: 'expectedBlockNumber', type: 'uint256' },
      { internalType: 'uint256', name: 'expectedNounId', type: 'uint256' },
    ],
    name: 'buyNow',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
] as const;

const TOTAL_SUPPLY_ABI = [
  {
    inputs: [],
    name: 'totalSupply',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

interface EncodedImage {
  filename: string;
  data: string;
}

interface LilNounsImageData {
  bgcolors: string[];
  palette: string[];
  images: {
    bodies: EncodedImage[];
    accessories: EncodedImage[];
    heads: EncodedImage[];
    glasses?: EncodedImage[];
  };
}

interface Seed {
  background: number;
  body: number;
  accessory: number;
  head: number;
  glasses: number;
}

interface PoolItem {
  blockNumber: bigint;
  blockHash: Hex;
  seed: Seed;
  svg: string;
  traits: {
    body: string;
    accessory: string;
    head: string;
    glasses: string | null;
    background: string;
  };
}

// Mirror LilVRGDA.buyNow: skip founder-reward IDs (every 10th = Lil Nounder reward,
// every 11th = Nouns DAO reward) up to the 175300/175301 cutoff.
function applyFounderRewardSkip(id: bigint): bigint {
  let next = id;
  if (next <= 175300n && next % 10n === 0n) next += 1n;
  if (next <= 175301n && next % 10n === 1n) next += 1n;
  return next;
}

async function readMintableNounId(client: PublicClient): Promise<bigint> {
  const raw = await client.readContract({
    address: VRGDA_ADDRESS,
    abi: NEXT_NOUN_ID_ABI,
    functionName: 'nextNounId',
  });
  return applyFounderRewardSkip(raw);
}

// ─── Seed from block hash (mirrors NounsSeeder.sol exactly) ─────────────────

function seedFromBlockHash(blockHash: Hex, nounId: bigint, imageData: LilNounsImageData): Seed {
  const hash = keccak256(encodePacked(['bytes32', 'uint256'], [blockHash, nounId]));
  const n = BigInt(hash);
  const imgs = imageData.images;
  const hasGlasses = imgs.glasses && imgs.glasses.length > 0;
  return {
    background: Number((n & MASK_48) % BigInt(imageData.bgcolors.length)),
    body: Number(((n >> 48n) & MASK_48) % BigInt(imgs.bodies.length)),
    accessory: Number(((n >> 96n) & MASK_48) % BigInt(imgs.accessories.length)),
    head: Number(((n >> 144n) & MASK_48) % BigInt(imgs.heads.length)),
    glasses:
      hasGlasses === true ? Number(((n >> 192n) & MASK_48) % BigInt(imgs.glasses!.length)) : 0,
  };
}

function traitName(filename: string): string {
  return filename
    .replace(/^(body|accessory|head|glasses)-/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function buildCellSvg(seed: Seed, imageData: LilNounsImageData): string {
  const parts: EncodedImage[] = [
    imageData.images.bodies[seed.body],
    imageData.images.accessories[seed.accessory],
    imageData.images.heads[seed.head],
  ];
  if (imageData.images.glasses && imageData.images.glasses.length > 0 && seed.glasses >= 0) {
    parts.push(imageData.images.glasses[seed.glasses]);
  }
  const bg = imageData.bgcolors[seed.background];
  return btoa(buildSVG(parts, imageData.palette, bg));
}

function buildPoolItem(
  blockNumber: bigint,
  blockHash: Hex,
  nounId: bigint,
  imageData: LilNounsImageData,
): PoolItem | null {
  try {
    const seed = seedFromBlockHash(blockHash, nounId, imageData);
    const svg = buildCellSvg(seed, imageData);
    const imgs = imageData.images;
    return {
      blockNumber,
      blockHash,
      seed,
      svg,
      traits: {
        body: traitName(imgs.bodies[seed.body]?.filename ?? ''),
        accessory: traitName(imgs.accessories[seed.accessory]?.filename ?? ''),
        head: traitName(imgs.heads[seed.head]?.filename ?? ''),
        glasses:
          imgs.glasses != null && imgs.glasses[seed.glasses] != null
            ? traitName(imgs.glasses[seed.glasses].filename)
            : null,
        background: imageData.bgcolors[seed.background],
      },
    };
  } catch {
    return null;
  }
}

// ─── Create a standalone viem client (no wallet required) ────────────────────

function createClient(rpcIndex = 0): PublicClient {
  return createPublicClient({
    chain: mainnet,
    transport: http(RPC_URLS[rpcIndex % RPC_URLS.length], { timeout: 15_000 }),
  });
}

// ─── Fetch blocks in batches ─────────────────────────────────────────────────

async function fetchBlockItems(
  client: PublicClient,
  blockNumbers: bigint[],
  nounId: bigint,
  imageData: LilNounsImageData,
  onProgress?: (pct: number, items: PoolItem[]) => void,
): Promise<PoolItem[]> {
  const allItems: PoolItem[] = [];
  const batchSize = 10;
  const delay = 200;

  for (let i = 0; i < blockNumbers.length; i += batchSize) {
    const batch = blockNumbers.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(n => client.getBlock({ blockNumber: n })));

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value?.hash) {
        const item = buildPoolItem(r.value.number, r.value.hash, nounId, imageData);
        if (item) allItems.push(item);
      }
    }

    if (onProgress) {
      const pct = Math.round(((i + batchSize) / blockNumbers.length) * 100);
      onProgress(Math.min(pct, 100), allItems);
    }

    if (i + batchSize < blockNumbers.length) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  return allItems;
}

// ─── Popover ─────────────────────────────────────────────────────────────────

const MintPopover: FC<{
  item: PoolItem;
  nounId: bigint;
  price: bigint | undefined;
  anchorRect: DOMRect;
  onClose: () => void;
  onMintConfirmed: (item: PoolItem, mintedNounId: bigint) => void;
}> = ({ item, nounId, price, anchorRect, onClose, onMintConfirmed }) => {
  const ref = useRef<HTMLDivElement>(null);
  const { isConnected } = useAccount();
  const { writeContract, isPending, data: txHash } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const firedRef = useRef(false);
  useEffect(() => {
    if (isConfirmed && !firedRef.current) {
      firedRef.current = true;
      onMintConfirmed(item, nounId);
    }
  }, [isConfirmed, item, nounId, onMintConfirmed]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  const popW = 260;
  let left = anchorRect.left + anchorRect.width / 2 - popW / 2;
  let top = anchorRect.top - 340;
  if (top < 8) top = anchorRect.bottom + 8;
  if (left < 8) left = 8;
  if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;

  const priceLabel = price != null ? `${parseFloat(formatEther(price)).toFixed(5)} ETH` : '—';

  const handleBuy = () => {
    if (price == null) return;
    writeContract({
      address: VRGDA_ADDRESS,
      abi: BUY_NOW_ABI,
      functionName: 'buyNow',
      args: [item.blockNumber, nounId],
      value: price,
    });
  };

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left,
        top,
        width: popW,
        zIndex: 1000,
        background: '#0f172a',
        border: '1px solid #334155',
        borderRadius: 12,
        boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
        fontFamily: "'PT Root UI', sans-serif",
        color: '#e2e8f0',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          background: `#${item.traits.background}`,
          padding: 8,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <img
          src={`data:image/svg+xml;base64,${item.svg}`}
          alt=""
          style={{ width: 120, height: 120, imageRendering: 'pixelated' }}
        />
      </div>

      <div style={{ padding: '10px 14px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 6,
          }}
        >
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#ec4899' }}>
            Lil Noun #{nounId.toString()}
          </span>
          <span style={{ fontSize: '0.65rem', color: '#475569', fontFamily: 'monospace' }}>
            Block {item.blockNumber.toString().slice(-6)}
          </span>
        </div>

        <div
          style={{
            padding: '6px 10px',
            borderRadius: 8,
            marginBottom: 8,
            background: '#1a1500',
            border: '1px solid #3b3011',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span
            style={{
              fontSize: '0.6rem',
              color: '#fbbf24',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            VRGDA Price
          </span>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#fbbf24' }}>
            {priceLabel}
          </span>
        </div>

        {[
          ['Head', item.traits.head],
          ['Body', item.traits.body],
          ['Accessory', item.traits.accessory],
          ...(item.traits.glasses ? [['Glasses', item.traits.glasses]] : []),
        ].map(([label, value]) => (
          <div
            key={label as string}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.6rem',
              padding: '2px 0',
            }}
          >
            <span style={{ color: '#64748b' }}>{label}</span>
            <span
              style={{
                color: '#94a3b8',
                maxWidth: 150,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                textAlign: 'right',
              }}
            >
              {value}
            </span>
          </div>
        ))}

        <button
          onClick={isConnected ? handleBuy : undefined}
          disabled={isPending || isConfirming || price == null}
          style={{
            marginTop: 10,
            width: '100%',
            padding: '8px 0',
            borderRadius: 8,
            border: 'none',
            cursor: isConnected ? 'pointer' : 'default',
            background: isConnected ? '#ec4899' : '#334155',
            color: isConnected ? '#fff' : '#64748b',
            fontSize: '0.7rem',
            fontWeight: 700,
            opacity: isPending || isConfirming ? 0.6 : 1,
          }}
        >
          {!isConnected
            ? 'Connect Wallet to Mint'
            : isPending
              ? 'Confirm in wallet...'
              : isConfirming
                ? 'Minting...'
                : `Mint for ${priceLabel}`}
        </button>
      </div>
    </div>
  );
};

// ─── Mint celebration ───────────────────────────────────────────────────────

const MintCelebration: FC<{
  item: PoolItem;
  nounId: bigint;
  onClose: () => void;
}> = ({ item, nounId, onClose }) => {
  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'lilNounsMintFadeIn 200ms ease-out',
      }}
    >
      <style>{`
        @keyframes lilNounsMintFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes lilNounsMintPop { 0% { transform: scale(0.7); opacity: 0 } 70% { transform: scale(1.05) } 100% { transform: scale(1); opacity: 1 } }
      `}</style>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 360,
          maxWidth: '90vw',
          background: '#0f172a',
          border: '1px solid #ec4899',
          borderRadius: 16,
          boxShadow: '0 24px 80px rgba(236, 72, 153, 0.4)',
          fontFamily: "'PT Root UI', sans-serif",
          color: '#e2e8f0',
          overflow: 'hidden',
          animation: 'lilNounsMintPop 300ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        <div
          style={{
            background: `#${item.traits.background}`,
            padding: 24,
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <img
            src={`data:image/svg+xml;base64,${item.svg}`}
            alt=""
            style={{ width: 240, height: 240, imageRendering: 'pixelated' }}
          />
        </div>
        <div style={{ padding: '20px 24px', textAlign: 'center' }}>
          <div
            style={{
              fontSize: '0.7rem',
              fontWeight: 700,
              color: '#22c55e',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            ✓ Minted
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#ec4899', marginBottom: 14 }}>
            Lil Noun #{nounId.toString()}
          </div>
          <div
            style={{
              fontSize: '0.7rem',
              color: '#94a3b8',
              display: 'grid',
              gap: 4,
              marginBottom: 18,
              textAlign: 'left',
            }}
          >
            <div>
              <span style={{ color: '#64748b' }}>Head: </span>
              {item.traits.head}
            </div>
            <div>
              <span style={{ color: '#64748b' }}>Body: </span>
              {item.traits.body}
            </div>
            <div>
              <span style={{ color: '#64748b' }}>Accessory: </span>
              {item.traits.accessory}
            </div>
            {item.traits.glasses != null && (
              <div>
                <span style={{ color: '#64748b' }}>Glasses: </span>
                {item.traits.glasses}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              width: '100%',
              padding: '10px 0',
              borderRadius: 8,
              border: 'none',
              background: '#ec4899',
              color: '#fff',
              fontWeight: 700,
              fontSize: '0.75rem',
              cursor: 'pointer',
            }}
          >
            Continue
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

// ─── Main Component ──────────────────────────────────────────────────────────

const LilNounsGrid: FC = () => {
  const stateBgColor = useAppSelector(state => state.application.stateBackgroundColor);
  const isCool = useAppSelector(state => state.application.isCoolBackground);

  // Adaptive text/border colors based on light background
  const textColor = isCool ? '#374151' : '#44403c';
  const textMuted = isCool ? '#6b7280' : '#78716c';
  const borderColor = isCool ? '#c4c7d0' : '#d1ccc8';
  const accentBg = isCool ? 'rgba(0,0,0,0.04)' : 'rgba(0,0,0,0.04)';

  const [imageData, setImageData] = useState<LilNounsImageData | null>(null);
  const [pool, setPool] = useState<PoolItem[]>([]); // all items (active + extras)
  const [nounId, setNounId] = useState<bigint | undefined>();
  const [price, setPrice] = useState<bigint | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contractPaused, setContractPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [popover, setPopover] = useState<{ index: number; rect: DOMRect } | null>(null);
  const [mintReceipt, setMintReceipt] = useState<{ item: PoolItem; nounId: bigint } | null>(null);
  const [colCount, setColCount] = useState(0);

  const initRef = useRef(false);
  const clientRef = useRef<PublicClient | null>(null);
  const nounIdRef = useRef<bigint>(0n);
  const gridRef = useRef<HTMLDivElement>(null);

  // Measure grid columns via ResizeObserver
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) {
        // minmax(42px, 1fr) → each cell is at least 42px
        const cols = Math.floor(w / 42);
        setColCount(cols > 0 ? cols : 1);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pool.length > 0]); // re-attach when grid first renders

  // Load Lil Nouns art data
  useEffect(() => {
    fetch(IMAGE_DATA_URL)
      .then(r => r.json())
      .then((data: LilNounsImageData) => setImageData(data))
      .catch(err => {
        console.error('[LilNounsGrid] Failed to load art data:', err);
        setError('Failed to load Lil Nouns art data');
        setLoading(false);
      });
  }, []);

  // Build pool using standalone viem client (no wallet needed)
  useEffect(() => {
    if (!imageData || initRef.current) return;
    initRef.current = true;

    (async () => {
      // Try each RPC until one works
      let client: PublicClient | null = null;

      for (let rpcIdx = 0; rpcIdx < RPC_URLS.length; rpcIdx++) {
        try {
          const c = createClient(rpcIdx);
          await c.getBlockNumber();
          client = c;
          break;
        } catch {
          console.warn(`[LilNounsGrid] RPC ${RPC_URLS[rpcIdx]} failed, trying next...`);
        }
      }

      if (!client) {
        setError('All RPCs failed. Try refreshing.');
        setLoading(false);
        return;
      }

      clientRef.current = client;

      // 1. Read nextNounId + current VRGDA price
      let nextNounId: bigint;
      try {
        setProgress(1);

        const [nounIdResult, priceResult] = await Promise.allSettled([
          client.readContract({
            address: VRGDA_ADDRESS,
            abi: NEXT_NOUN_ID_ABI,
            functionName: 'nextNounId',
          }),
          client.readContract({
            address: VRGDA_ADDRESS,
            abi: GET_VRGDA_PRICE_ABI,
            functionName: 'getCurrentVRGDAPrice',
          }),
        ]);

        if (nounIdResult.status === 'fulfilled') {
          nextNounId = applyFounderRewardSkip(nounIdResult.value);
        } else {
          console.warn(
            '[LilNounsGrid] nextNounId failed, trying totalSupply:',
            nounIdResult.reason,
          );
          const supply = await client.readContract({
            address: LIL_NOUNS_TOKEN,
            abi: TOTAL_SUPPLY_ABI,
            functionName: 'totalSupply',
          });
          nextNounId = applyFounderRewardSkip(supply);
        }

        setNounId(nextNounId);
        nounIdRef.current = nextNounId;

        if (priceResult.status === 'fulfilled') {
          setPrice(priceResult.value);
        } else {
          console.warn('[LilNounsGrid] getCurrentVRGDAPrice failed:', priceResult.reason);
          setContractPaused(true);
        }
      } catch (err) {
        console.error('[LilNounsGrid] All nounId reads failed:', err);
        setContractPaused(true);
        setLoading(false);
        return;
      }

      try {
        // 2. Get current block number
        const currentBlock = await client.getBlockNumber();
        setProgress(5);

        // 3. Fetch POOL_SIZE + MAX_EXTRA blocks
        const totalFetch = POOL_SIZE + MAX_EXTRA;
        const blockNumbers = Array.from(
          { length: totalFetch },
          (_, i) => currentBlock - BigInt(i) - 1n,
        ).filter(n => n > 0n);

        const allItems = await fetchBlockItems(
          client,
          blockNumbers,
          nextNounId,
          imageData,
          (pct, items) => {
            setProgress(pct);
            if (items.length > 0 && items.length % 30 < 10) {
              setPool([...items]);
              if (items.length >= 10) setLoading(false);
            }
          },
        );

        setPool(allItems);
        setLoading(false);
        setProgress(100);
      } catch (err) {
        console.error('[LilNounsGrid] Error building pool:', err);
        if (pool.length === 0) {
          setError(
            `Failed to load VRGDA pool: ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
        }
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageData]);

  // ── Refresh pool with latest blocks ──────────────────────────────────────
  const refreshPool = useCallback(async () => {
    const client = clientRef.current;
    if (!client || !imageData || refreshing) return;

    setRefreshing(true);
    try {
      // Re-read price + next mintable nounId (someone else may have minted, shifting the id).
      const [priceResult, nounIdResult] = await Promise.allSettled([
        client.readContract({
          address: VRGDA_ADDRESS,
          abi: GET_VRGDA_PRICE_ABI,
          functionName: 'getCurrentVRGDAPrice',
        }),
        readMintableNounId(client),
      ]);
      if (priceResult.status === 'fulfilled') {
        setPrice(priceResult.value);
        setContractPaused(false);
      }
      const prevNounId = nounIdRef.current;
      const nextId = nounIdResult.status === 'fulfilled' ? nounIdResult.value : prevNounId;
      const nounIdChanged = nextId !== prevNounId;
      if (nounIdChanged) {
        nounIdRef.current = nextId;
        setNounId(nextId);
      }

      const currentBlock = await client.getBlockNumber();
      const existingBlocks = new Set(pool.map(p => p.blockNumber));

      // Find new blocks we don't have yet
      const newBlockNumbers: bigint[] = [];
      for (let i = 0; i < POOL_SIZE + MAX_EXTRA; i++) {
        const bn = currentBlock - BigInt(i) - 1n;
        if (bn > 0n && !existingBlocks.has(bn)) {
          newBlockNumbers.push(bn);
        }
        if (newBlockNumbers.length >= 30) break; // fetch up to 30 new blocks
      }

      const newItems =
        newBlockNumbers.length > 0
          ? await fetchBlockItems(client, newBlockNumbers, nextId, imageData)
          : [];

      if (newItems.length === 0 && !nounIdChanged) {
        setRefreshing(false);
        return;
      }

      // If nounId shifted (someone minted), re-derive seeds/SVGs for every existing cell
      // against the new id — otherwise the grid shows previews of the wrong upcoming Noun.
      setPool(prev => {
        const reseeded = nounIdChanged
          ? prev
              .map(p => buildPoolItem(p.blockNumber, p.blockHash, nextId, imageData))
              .filter((p): p is PoolItem => p !== null)
          : prev;
        const merged = [...newItems, ...reseeded];
        // Deduplicate by blockNumber
        const seen = new Set<string>();
        const deduped = merged.filter(item => {
          const key = item.blockNumber.toString();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        // Sort by block number descending (newest first)
        deduped.sort((a, b) => (b.blockNumber > a.blockNumber ? 1 : -1));
        return deduped.slice(0, POOL_SIZE + MAX_EXTRA);
      });
    } catch (err) {
      console.error('[LilNounsGrid] Refresh failed:', err);
    }
    setRefreshing(false);
  }, [imageData, pool, refreshing]);

  const handleCellClick = useCallback((index: number, e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setPopover(prev => (prev?.index === index ? null : { index, rect }));
  }, []);

  const priceLabel = price != null ? `${parseFloat(formatEther(price)).toFixed(4)} ETH` : '—';

  // ── Compute active pool + grayscale fill ─────────────────────────────────
  const activePool = pool.slice(0, POOL_SIZE);
  const extraPool = pool.slice(POOL_SIZE);

  // How many extras needed to fill the last row?
  let fillCount = 0;
  if (colCount > 0 && activePool.length > 0) {
    const remainder = activePool.length % colCount;
    if (remainder > 0) {
      fillCount = colCount - remainder;
    }
  }
  const fillers = extraPool.slice(0, fillCount);

  // Loading / error states
  if (loading && pool.length === 0) {
    return (
      <section
        style={{
          width: '100%',
          background: stateBgColor,
          padding: '20px 16px',
          textAlign: 'center',
        }}
      >
        <div
          style={{ fontSize: '0.7rem', color: textMuted, fontFamily: "'PT Root UI', sans-serif" }}
        >
          {error ? (
            <span style={{ color: '#ef4444' }}>{error}</span>
          ) : (
            <span style={{ opacity: 0.6 }}>
              Loading Lil Nouns VRGDA pool...
              {progress > 0 && ` ${progress}%`}
            </span>
          )}
        </div>
      </section>
    );
  }

  if (error && pool.length === 0) {
    return (
      <section
        style={{
          width: '100%',
          background: stateBgColor,
          padding: '20px 16px',
          textAlign: 'center',
        }}
      >
        <div
          style={{ fontSize: '0.7rem', color: '#ef4444', fontFamily: "'PT Root UI', sans-serif" }}
        >
          {error}
        </div>
      </section>
    );
  }

  // VRGDA paused but no grid data — show minimal fallback
  if (contractPaused && pool.length === 0 && !loading) {
    return (
      <section style={{ width: '100%', background: stateBgColor, overflow: 'hidden' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 16px 6px',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                fontWeight: 900,
                fontSize: '0.6rem',
                letterSpacing: '0.15em',
                textTransform: 'uppercase' as const,
              }}
            >
              🧚
            </span>
            <span
              style={{
                fontWeight: 900,
                fontSize: '0.6rem',
                letterSpacing: '0.15em',
                textTransform: 'uppercase' as const,
                color: textMuted,
              }}
            >
              lil nouns are like nouns but little
            </span>
          </div>
          <button
            onClick={refreshPool}
            disabled={refreshing}
            style={{
              fontSize: '0.55rem',
              color: textMuted,
              textDecoration: 'none',
              fontFamily: "'PT Root UI', sans-serif",
              padding: '3px 10px',
              borderRadius: 8,
              border: `1px solid ${borderColor}`,
              background: 'transparent',
              cursor: refreshing ? 'wait' : 'pointer',
            }}
          >
            {refreshing ? 'REFRESHING...' : 'REFRESH POOL ↻'}
          </button>
        </div>
        <div
          style={{
            padding: '16px 16px 20px',
            textAlign: 'center',
            fontSize: '0.65rem',
            color: textMuted,
            fontFamily: "'PT Root UI', sans-serif",
          }}
        >
          Loading Lil Nouns pool...
        </div>
      </section>
    );
  }

  return (
    <section style={{ width: '100%', background: stateBgColor, overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px 6px',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              fontWeight: 900,
              fontSize: '0.6rem',
              letterSpacing: '0.15em',
              textTransform: 'uppercase' as const,
            }}
          >
            🧚
          </span>
          <span
            style={{
              fontWeight: 900,
              fontSize: '0.6rem',
              letterSpacing: '0.15em',
              textTransform: 'uppercase' as const,
              color: textColor,
            }}
          >
            lil nouns are like nouns but little
          </span>
          {nounId !== undefined && (
            <span
              style={{
                fontSize: '0.55rem',
                color: '#ec4899',
                fontFamily: "'PT Root UI', sans-serif",
                fontWeight: 700,
              }}
            >
              #{nounId.toString()}
            </span>
          )}
          <span
            style={{
              fontSize: '0.55rem',
              color: textMuted,
              fontFamily: "'PT Root UI', sans-serif",
            }}
          >
            {activePool.length} {contractPaused ? 'possible' : 'mintable'}
          </span>
          {contractPaused && (
            <span
              style={{
                fontSize: '0.5rem',
                color: '#d97706',
                fontFamily: "'PT Root UI', sans-serif",
                fontWeight: 600,
                background: accentBg,
                padding: '1px 6px',
                borderRadius: 4,
              }}
            >
              MINTING PAUSED
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {price !== undefined && (
            <span
              style={{
                fontSize: '0.6rem',
                fontWeight: 700,
                color: '#b45309',
                padding: '2px 8px',
                borderRadius: 6,
                background: accentBg,
                border: `1px solid ${borderColor}`,
                fontFamily: "'PT Root UI', sans-serif",
              }}
            >
              {priceLabel}
            </span>
          )}
          <button
            onClick={refreshPool}
            disabled={refreshing}
            style={{
              fontSize: '0.55rem',
              color: refreshing ? '#ec4899' : textMuted,
              textDecoration: 'none',
              fontFamily: "'PT Root UI', sans-serif",
              padding: '3px 10px',
              borderRadius: 8,
              border: `1px solid ${borderColor}`,
              background: 'transparent',
              cursor: refreshing ? 'wait' : 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {refreshing ? 'REFRESHING...' : 'REFRESH POOL ↻'}
          </button>
        </div>
      </div>

      {/* Grid */}
      <div
        ref={gridRef}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(42px, 1fr))',
          gap: 0,
          lineHeight: 0,
        }}
      >
        {/* Active pool — full colour */}
        {activePool.map((item, i) => (
          <div
            key={`${item.blockNumber}`}
            onClick={e => handleCellClick(i, e)}
            style={{
              aspectRatio: '1',
              cursor: 'pointer',
              overflow: 'hidden',
            }}
          >
            <img
              src={`data:image/svg+xml;base64,${item.svg}`}
              alt=""
              style={{
                display: 'block',
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                imageRendering: 'pixelated',
              }}
            />
          </div>
        ))}

        {/* Grayscale fillers — older blocks beyond the 256 active pool */}
        {fillers.map(item => (
          <div
            key={`filler-${item.blockNumber}`}
            style={{
              aspectRatio: '1',
              overflow: 'hidden',
              filter: 'grayscale(1)',
              opacity: 0.35,
            }}
          >
            <img
              src={`data:image/svg+xml;base64,${item.svg}`}
              alt=""
              style={{
                display: 'block',
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                imageRendering: 'pixelated',
              }}
            />
          </div>
        ))}
      </div>

      {/* Progress indicator while still loading more */}
      {progress < 100 && pool.length > 0 && (
        <div
          style={{
            width: '100%',
            height: 2,
            background: borderColor,
          }}
        >
          <div
            style={{
              width: `${progress}%`,
              height: '100%',
              background: '#ec4899',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      )}

      {/* Popover — rendered via portal to escape overflow:hidden */}
      {popover != null &&
        activePool[popover.index] != null &&
        nounId !== undefined &&
        createPortal(
          <MintPopover
            item={activePool[popover.index]}
            nounId={nounId}
            price={price}
            anchorRect={popover.rect}
            onClose={() => setPopover(null)}
            onMintConfirmed={(item, mintedNounId) => {
              setMintReceipt({ item, nounId: mintedNounId });
              setPopover(null);
            }}
          />,
          document.body,
        )}

      {mintReceipt != null && (
        <MintCelebration
          item={mintReceipt.item}
          nounId={mintReceipt.nounId}
          onClose={() => {
            setMintReceipt(null);
            refreshPool();
          }}
        />
      )}
    </section>
  );
};

export default LilNounsGrid;
