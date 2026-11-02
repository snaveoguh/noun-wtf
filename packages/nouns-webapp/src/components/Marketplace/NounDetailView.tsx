import type { NounDetailItem } from '@/lib/marketplace/nouns-marketplace';

import { useState, useEffect } from 'react';

import { Link } from 'react-router';
import { mainnet } from 'viem/chains';
import { useAccount, useReadContract } from 'wagmi';

import { nounsTokenAbi } from '@/contracts';
import { NOUNS_CONTRACT } from '@/lib/marketplace/nouns-marketplace';
import {
  buildNounSvg,
  traitFilename,
  backgroundHex,
  type NounSeed,
} from '@/lib/marketplace/nouns-svg';

import { NounsBuyButton } from './NounsBuyButton';
import { NounsListButton } from './NounsListButton';

export function NounDetailView({ nounId }: { nounId: number }) {
  const { address } = useAccount();
  const [detail, setDetail] = useState<NounDetailItem | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch seed from the NounsToken contract
  const { data: seedData } = useReadContract({
    address: NOUNS_CONTRACT,
    abi: nounsTokenAbi,
    functionName: 'seeds',
    args: [BigInt(nounId)],
    chainId: mainnet.id,
  });

  // Fetch owner from the NounsToken contract
  const { data: ownerData } = useReadContract({
    address: NOUNS_CONTRACT,
    abi: nounsTokenAbi,
    functionName: 'ownerOf',
    args: [BigInt(nounId)],
    chainId: mainnet.id,
  });

  const seed: NounSeed | null = seedData
    ? {
        background: Number(seedData[0]),
        body: Number(seedData[1]),
        accessory: Number(seedData[2]),
        head: Number(seedData[3]),
        glasses: Number(seedData[4]),
      }
    : null;

  const owner = ownerData ? (ownerData as string) : null;
  const isOwner = owner && address && owner.toLowerCase() === address.toLowerCase();
  const svgHtml = seed ? buildNounSvg(seed) : null;
  const bgColor = seed ? backgroundHex(seed) : '#e1d7d5';

  // Fetch marketplace data
  useEffect(() => {
    fetch(`/api/nouns/${nounId}`)
      .then(r => r.json())
      .then(data => {
        if (data.error != null) setDetail(null);
        else setDetail(data);
      })
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [nounId]);

  // Get trait names from seed
  const headName = seed ? traitFilename('head', seed.head) : null;
  const bodyName = seed ? traitFilename('body', seed.body) : null;
  const accessoryName = seed ? traitFilename('accessory', seed.accessory) : null;
  const glassesName = seed ? traitFilename('glasses', seed.glasses) : null;

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="mb-4 flex flex-wrap items-center font-mono text-xs uppercase tracking-wider text-[var(--ink-faint)]">
        <Link
          to="/marketplace"
          className="inline-flex items-center transition-colors hover:text-[var(--ink)] [@media(pointer:coarse)]:min-h-10"
        >
          Nouns Marketplace
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-[var(--ink)]">Noun {nounId}</span>
      </nav>

      <div className="@lg:grid-cols-2 @lg:gap-8 grid gap-6">
        {/* Noun image */}
        <div className="flex items-start justify-center">
          <div
            className="@lg:max-w-md w-full max-w-sm overflow-hidden border border-[var(--rule-light)]"
            style={{ backgroundColor: bgColor }}
          >
            {svgHtml ? (
              <div
                className="w-full [image-rendering:pixelated] [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
                dangerouslySetInnerHTML={{ __html: svgHtml }}
              />
            ) : (
              <div className="font-headline flex aspect-square items-center justify-center text-6xl text-[var(--ink-faint)]">
                {nounId}
              </div>
            )}
          </div>
        </div>

        {/* Details */}
        <div>
          {/* Title */}
          <h1 className="font-headline text-[clamp(1.875rem,9cqi,2.25rem)] leading-tight text-[var(--ink)]">
            Noun {nounId}
          </h1>

          {/* Owner */}
          {owner && (
            <div className="mt-2 font-mono text-xs uppercase tracking-wider text-[var(--ink-light)]">
              Owner:{' '}
              <a
                href={`https://etherscan.io/address/${owner}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center text-[var(--ink-faint)] transition-colors hover:text-[var(--ink)] [@media(pointer:coarse)]:min-h-10"
              >
                {owner.slice(0, 6)}...{owner.slice(-4)}
              </a>
            </div>
          )}

          {/* Traits */}
          {seed && (
            <div className="mt-4 space-y-1 font-mono text-xs uppercase tracking-wider text-[var(--ink-light)]">
              {headName && (
                <p>
                  Head: <span className="text-[var(--ink)]">{headName}</span>
                </p>
              )}
              {bodyName && (
                <p>
                  Body: <span className="text-[var(--ink)]">{bodyName}</span>
                </p>
              )}
              {accessoryName && (
                <p>
                  Accessory: <span className="text-[var(--ink)]">{accessoryName}</span>
                </p>
              )}
              {glassesName && (
                <p>
                  Glasses: <span className="text-[var(--ink)]">{glassesName}</span>
                </p>
              )}
              <p>
                Background:{' '}
                <span className="text-[var(--ink)]">{seed.background === 0 ? 'Cool' : 'Warm'}</span>
              </p>
            </div>
          )}

          {/* Price / Buy */}
          <div className="mt-6 border-b border-t border-[var(--rule)] py-4">
            {detail?.listedPriceEth ? (
              <div className="@md:flex-row @md:items-center @md:gap-4 flex flex-col gap-3">
                <div>
                  <p className="font-mono text-xs uppercase tracking-wider text-[var(--ink-faint)]">
                    Listed Price
                  </p>
                  <p className="font-mono text-2xl font-bold text-[var(--ink)]">
                    {parseFloat(detail.listedPriceEth).toFixed(4)} ETH
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-[var(--ink-faint)]">
                    0% marketplace fee
                  </p>
                </div>
                {detail.orderHash && (
                  <NounsBuyButton
                    orderHash={detail.orderHash}
                    priceEth={detail.listedPriceEth}
                    className="@md:w-auto @md:[&>button]:py-0.5 w-full [&>button]:py-2"
                  />
                )}
              </div>
            ) : loading ? (
              <p className="font-mono text-xs uppercase tracking-wider text-[var(--ink-faint)]">
                Loading marketplace data...
              </p>
            ) : (
              <p className="font-mono text-xs uppercase tracking-wider text-[var(--ink-faint)]">
                No active listing
              </p>
            )}
          </div>

          {/* List for sale (if owner) */}
          {isOwner === true && (
            <div className="mt-3">
              <NounsListButton nounId={nounId} />
            </div>
          )}

          {/* Links */}
          <div className="mt-6 flex flex-wrap items-center gap-3 font-mono text-xs uppercase tracking-wider text-[var(--ink-faint)]">
            <a
              href={`/noun/${nounId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center transition-colors hover:text-[var(--ink)] [@media(pointer:coarse)]:min-h-10"
            >
              noun.wtf &rsaquo;
            </a>
            <a
              href={`https://opensea.io/assets/ethereum/${NOUNS_CONTRACT}/${nounId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center transition-colors hover:text-[var(--ink)] [@media(pointer:coarse)]:min-h-10"
            >
              OpenSea &rsaquo;
            </a>
            <a
              href={`https://etherscan.io/nft/${NOUNS_CONTRACT}/${nounId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center transition-colors hover:text-[var(--ink)] [@media(pointer:coarse)]:min-h-10"
            >
              Etherscan &rsaquo;
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
