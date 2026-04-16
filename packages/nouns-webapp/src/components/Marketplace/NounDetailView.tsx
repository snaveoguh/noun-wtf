import type { NounDetailItem } from '@/lib/marketplace/nouns-marketplace';

import { useState, useEffect } from 'react';

import { Link } from 'react-router';
import { mainnet } from 'viem/chains';
import { useAccount, useReadContract } from 'wagmi';

import { NOUNS_CONTRACT, NOUNS_TOKEN_ABI } from '@/lib/marketplace/nouns-marketplace';
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
    abi: NOUNS_TOKEN_ABI,
    functionName: 'seeds',
    args: [BigInt(nounId)],
    chainId: mainnet.id,
  });

  // Fetch owner from the NounsToken contract
  const { data: ownerData } = useReadContract({
    address: NOUNS_CONTRACT,
    abi: NOUNS_TOKEN_ABI,
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
      <nav className="mb-4 font-mono text-[9px] uppercase tracking-wider text-[var(--ink-faint)]">
        <Link to="/marketplace" className="transition-colors hover:text-[var(--ink)]">
          Nouns Marketplace
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-[var(--ink)]">Noun {nounId}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Noun image */}
        <div className="flex items-start justify-center">
          <div
            className="w-full max-w-md overflow-hidden border border-[var(--rule-light)]"
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
          <h1 className="font-headline text-4xl text-[var(--ink)]">Noun {nounId}</h1>

          {/* Owner */}
          {owner && (
            <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-[var(--ink-light)]">
              Owner:{' '}
              <a
                href={`https://etherscan.io/address/${owner}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--ink-faint)] transition-colors hover:text-[var(--ink)]"
              >
                {owner.slice(0, 6)}...{owner.slice(-4)}
              </a>
            </div>
          )}

          {/* Traits */}
          {seed && (
            <div className="mt-4 space-y-1 font-mono text-[10px] uppercase tracking-wider text-[var(--ink-light)]">
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
              <div className="flex items-center gap-4">
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-wider text-[var(--ink-faint)]">
                    Listed Price
                  </p>
                  <p className="font-mono text-2xl font-bold text-[var(--ink)]">
                    {parseFloat(detail.listedPriceEth).toFixed(4)} ETH
                  </p>
                  <p className="mt-0.5 font-mono text-[8px] text-[var(--ink-faint)]">
                    0% marketplace fee
                  </p>
                </div>
                {detail.orderHash && (
                  <NounsBuyButton orderHash={detail.orderHash} priceEth={detail.listedPriceEth} />
                )}
              </div>
            ) : loading ? (
              <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--ink-faint)]">
                Loading marketplace data...
              </p>
            ) : (
              <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--ink-faint)]">
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
          <div className="mt-6 flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-wider text-[var(--ink-faint)]">
            <a
              href={`https://nouns.wtf/noun/${nounId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-[var(--ink)]"
            >
              nouns.wtf &rsaquo;
            </a>
            <a
              href={`https://opensea.io/assets/ethereum/${NOUNS_CONTRACT}/${nounId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-[var(--ink)]"
            >
              OpenSea &rsaquo;
            </a>
            <a
              href={`https://etherscan.io/nft/${NOUNS_CONTRACT}/${nounId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-[var(--ink)]"
            >
              Etherscan &rsaquo;
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
