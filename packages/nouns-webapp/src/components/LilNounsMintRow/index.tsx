/**
 * LilNounsMintRow — auto-scrolling banner of mintable Lil Nouns.
 *
 * Visually and behaviourally matches the other homepage bands (Dreams, Noundry,
 * Props, Propdates): left label chip, right fade, rAF auto-scroll with a
 * duplicated item list for a seamless loop, pause on hover, and
 * `useDraggableScroll` so dragging pans without swallowing the click-to-mint.
 *
 * The full `LilNounsGrid` builds a 316-block pool (POOL_SIZE 256 + 60 extra) on
 * mount — far too heavy for a homepage strip. This row fetches only ROW_SIZE
 * blocks, so it paints fast and stays smooth. All mint behaviour is reused from
 * `LilNounsGrid` (same VRGDA contract, same buyNow args, same seed→SVG
 * derivation) so the two can't drift. Full grid lives at /probe?tab=lils.
 */
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { formatEther, type PublicClient } from 'viem';
import { useAccount, useWriteContract } from 'wagmi';

import {
  BUY_NOW_ABI,
  GET_VRGDA_PRICE_ABI,
  IMAGE_DATA_URL,
  VRGDA_ADDRESS,
  buildPoolItem,
  createClient,
  readMintableNounId,
  type LilNounsImageData,
  type PoolItem,
} from '@/components/LilNounsGrid';
import { useDraggableScroll } from '@/hooks/useDraggableScroll';

/** How many mintable lils to fetch. Small on purpose — this is a teaser band. */
const ROW_SIZE = 14;

const LilNounsMintRow: FC = () => {
  const [items, setItems] = useState<PoolItem[]>([]);
  const [price, setPrice] = useState<bigint | null>(null);
  const [nounId, setNounId] = useState<bigint | null>(null);
  const [failed, setFailed] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const pausedRef = useRef(false);
  const { onPointerDown, onClickCapture } = useDraggableScroll(scrollRef, pausedRef);

  const { isConnected } = useAccount();
  const { writeContract, isPending } = useWriteContract();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Walk the RPC list like the grid does, so one bad endpoint doesn't kill the row.
      for (let rpcIdx = 0; rpcIdx < 3; rpcIdx++) {
        try {
          const client: PublicClient = createClient(rpcIdx);
          const [imageData, currentPrice, mintableId, head] = await Promise.all([
            fetch(IMAGE_DATA_URL).then(r => r.json() as Promise<LilNounsImageData>),
            client.readContract({
              address: VRGDA_ADDRESS,
              abi: GET_VRGDA_PRICE_ABI,
              functionName: 'getCurrentVRGDAPrice',
            }) as Promise<bigint>,
            readMintableNounId(client),
            client.getBlockNumber(),
          ]);

          const numbers = Array.from({ length: ROW_SIZE }, (_, i) => head - BigInt(i));
          const blocks = await Promise.all(
            numbers.map(n => client.getBlock({ blockNumber: n }).catch(() => null)),
          );

          const built = blocks
            .map(b =>
              b?.hash != null ? buildPoolItem(b.number, b.hash, mintableId, imageData) : null,
            )
            .filter((x): x is PoolItem => x !== null);

          if (cancelled) return;
          setItems(built);
          setPrice(currentPrice);
          setNounId(mintableId);
          return;
        } catch {
          // try the next RPC
        }
      }
      if (!cancelled) setFailed(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Duplicate for a seamless loop (same trick as DreamsBanner/NoundryBanner).
  const displayItems = useMemo(() => (items.length > 0 ? [...items, ...items] : []), [items]);

  // Auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || displayItems.length === 0) return;

    const speed = 0.6;
    let pos = el.scrollLeft;
    let wasPaused = false;

    const tick = () => {
      if (pausedRef.current) {
        wasPaused = true;
      } else {
        if (wasPaused) {
          pos = el.scrollLeft;
          wasPaused = false;
        }
        pos += speed;
        const halfWidth = el.scrollWidth / 2;
        if (halfWidth > 0 && pos >= halfWidth) pos -= halfWidth;
        el.scrollLeft = pos;
      }
      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [displayItems]);

  const mint = useCallback(
    (item: PoolItem) => {
      if (price == null || nounId == null) return;
      writeContract({
        address: VRGDA_ADDRESS,
        abi: BUY_NOW_ABI,
        functionName: 'buyNow',
        args: [item.blockNumber, nounId],
        value: price,
      });
    },
    [price, nounId, writeContract],
  );

  // Render nothing rather than an empty band.
  if (failed || items.length === 0) return null;

  const priceLabel = price != null ? `${parseFloat(formatEther(price)).toFixed(4)} Ξ` : '—';

  return (
    <div
      style={{
        width: '100%',
        overflow: 'hidden',
        background: 'linear-gradient(90deg, #eef6f0 0%, #e4f1e9 50%, #eef6f0 100%)',
        padding: '10px 0',
        position: 'relative',
        borderBottom: '1px solid rgba(22, 163, 74, 0.15)',
      }}
    >
      {/* Left label */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: '12px',
          paddingRight: '24px',
          background: 'linear-gradient(90deg, #eef6f0 70%, rgba(238,246,240,0) 100%)',
          fontWeight: 900,
          fontSize: '0.55rem',
          letterSpacing: '0.15em',
          textTransform: 'uppercase' as const,
          whiteSpace: 'nowrap' as const,
        }}
      >
        <span>🌱</span>
        <span style={{ color: '#15803d', marginLeft: '6px' }}>
          MINT LIL <span style={{ color: '#4b8f6a' }}>{priceLabel}</span>
        </span>
      </div>

      {/* Right fade */}
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          zIndex: 2,
          width: '50px',
          background: 'linear-gradient(270deg, #eef6f0 0%, rgba(238,246,240,0) 100%)',
          pointerEvents: 'none',
        }}
      />

      <div
        ref={scrollRef}
        onPointerDown={onPointerDown}
        onClickCapture={onClickCapture}
        onMouseEnter={() => {
          pausedRef.current = true;
        }}
        onMouseLeave={() => {
          pausedRef.current = false;
        }}
        style={{
          display: 'flex',
          gap: '10px',
          overflow: 'hidden',
          scrollbarWidth: 'none' as const,
          paddingLeft: '150px',
          cursor: 'grab',
        }}
      >
        {displayItems.map((item, i) => (
          <button
            key={`${String(item.blockNumber)}-${i}`}
            type="button"
            disabled={isPending || !isConnected}
            onClick={() => mint(item)}
            title={
              isConnected
                ? `Mint for ${priceLabel} — ${item.traits.head}, ${item.traits.glasses ?? 'no glasses'}`
                : 'Connect your wallet to mint'
            }
            style={{
              position: 'relative',
              flexShrink: 0,
              width: '72px',
              height: '72px',
              padding: 0,
              border: '1px solid rgba(0,0,0,0.06)',
              borderRadius: '10px',
              overflow: 'hidden',
              background: 'transparent',
              cursor: isConnected ? 'pointer' : 'not-allowed',
              transition: 'transform 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = 'scale(1.05)';
              e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,0.16)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <img
              src={`data:image/svg+xml;base64,${item.svg}`}
              alt={`Mintable lil noun — ${item.traits.head}`}
              loading="lazy"
              draggable={false}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          </button>
        ))}
      </div>
    </div>
  );
};

export default LilNounsMintRow;
