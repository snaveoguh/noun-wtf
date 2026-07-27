/**
 * LilNounsMintRow — a light single row of mintable Lil Nouns for the homepage.
 *
 * The full `LilNounsGrid` builds a 316-block pool (POOL_SIZE 256 + 60 extra) on
 * mount, which is a lot of RPC work for a homepage strip. This row fetches only
 * `ROW_SIZE` recent blocks, so it paints almost immediately and stays smooth.
 *
 * Everything mint-related is reused from `LilNounsGrid` (same VRGDA contract,
 * same buyNow args, same seed→SVG derivation) so behaviour can't drift:
 * `readMintableNounId`, `buildPoolItem`, `createClient`, `BUY_NOW_ABI`,
 * `GET_VRGDA_PRICE_ABI`. The full grid still lives on /probe?tab=lils.
 */
import { FC, useCallback, useEffect, useState } from 'react';

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

/** How many mintable lils to show. Deliberately small — this is a teaser row. */
const ROW_SIZE = 8;

const LilNounsMintRow: FC = () => {
  const [items, setItems] = useState<PoolItem[]>([]);
  const [price, setPrice] = useState<bigint | null>(null);
  const [nounId, setNounId] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const { isConnected } = useAccount();
  const { writeContract, isPending } = useWriteContract();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Walk the RPC list the same way the grid does, so one bad endpoint
      // doesn't kill the row.
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

          // Only ROW_SIZE blocks — the whole point of this component.
          const numbers = Array.from({ length: ROW_SIZE }, (_, i) => head - BigInt(i));
          const blocks = await Promise.all(
            numbers.map(n => client.getBlock({ blockNumber: n }).catch(() => null)),
          );

          const built = blocks
            .map(b => (b?.hash != null ? buildPoolItem(b.number, b.hash, mintableId, imageData) : null))
            .filter((x): x is PoolItem => x !== null);

          if (cancelled) return;
          setItems(built);
          setPrice(currentPrice);
          setNounId(mintableId);
          setLoading(false);
          return;
        } catch {
          // try the next RPC
        }
      }
      if (!cancelled) {
        setFailed(true);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

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

  // Nothing to show and nothing loading — render nothing rather than an empty band.
  if (failed || (!loading && items.length === 0)) return null;

  const priceLabel =
    price != null ? `${parseFloat(formatEther(price)).toFixed(4)} ETH` : '—';

  return (
    <div className="w-full border-y border-black/5 bg-white/40 px-3 py-3 sm:px-5">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-gray-700">
          Mint a Lil Noun
        </span>
        <span className="text-xs text-gray-400">{priceLabel}</span>
        <a href="/probe?tab=lils" className="ml-auto text-xs text-gray-400 hover:text-gray-700">
          see all →
        </a>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {loading
          ? Array.from({ length: ROW_SIZE }, (_, i) => (
              <div
                key={i}
                className="h-20 w-20 flex-shrink-0 animate-pulse rounded-lg bg-gray-200/70 sm:h-24 sm:w-24"
              />
            ))
          : items.map(item => (
              <button
                key={String(item.blockNumber)}
                type="button"
                disabled={isPending || !isConnected}
                onClick={() => mint(item)}
                title={
                  isConnected
                    ? `Mint for ${priceLabel} — ${item.traits.head}, ${item.traits.glasses ?? 'no glasses'}`
                    : 'Connect your wallet to mint'
                }
                className="group relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg border border-gray-100 transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-60 sm:h-24 sm:w-24"
              >
                <img
                  src={`data:image/svg+xml;base64,${item.svg}`}
                  alt={`Mintable lil noun — ${item.traits.head}`}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
                <span className="absolute inset-x-0 bottom-0 hidden bg-black/70 py-0.5 text-center text-[10px] font-bold text-white group-hover:block">
                  {isPending ? '…' : 'MINT'}
                </span>
              </button>
            ))}
      </div>
    </div>
  );
};

export default LilNounsMintRow;
