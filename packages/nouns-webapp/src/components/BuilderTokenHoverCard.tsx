/**
 * BuilderTokenHoverCard — Radix HoverCard popover for Nouns Builder DAO tokens
 * (Yellow Collective, bitNouns, and any other nouns.build-derived DAO).
 *
 * Mirrors the UX of NounHoverCard: opens on hover (desktop) / tap (mobile),
 * shows token header + parsed traits (clickable to filter) + owner + external links.
 */
import { FC, ReactNode } from 'react';

import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import {
  BuilderTrait,
  orderTraitsForDisplay,
  parseBuilderTraitsFromImage,
} from '@/lib/builderTraits';

export interface BuilderTokenInfo {
  tokenId: number;
  name: string;
  /** Nouns Builder renderer URL — we parse trait filenames from the query params. */
  image: string;
  owner: string;
}

interface BuilderTokenHoverCardProps {
  token: BuilderTokenInfo;
  ownerDisplayName: string;
  /** e.g. "ethereum" / "base" — used for etherscan/opensea/nouns.build links */
  chainSlug: 'ethereum' | 'base';
  /** DAO token contract address for deep links */
  daoAddress: string;
  /** Called when a trait row is clicked so the parent tab can filter the grid. */
  onTraitClick?: (trait: BuilderTrait) => void;
  /** Currently applied trait filter (highlights the matching row). */
  activeTrait?: BuilderTrait | null;
  /** Optional accent color for the header (matches DAO palette) */
  accentColor?: string;
  /** Extra right-hand link — e.g. brobe.wtf for bitNouns */
  extraLink?: { href: string; label: string };
  children: ReactNode;
}

export const BuilderTokenHoverCard: FC<BuilderTokenHoverCardProps> = ({
  token,
  ownerDisplayName,
  chainSlug,
  daoAddress,
  onTraitClick,
  activeTrait,
  accentColor = '#14141f',
  extraLink,
  children,
}) => {
  const traits = orderTraitsForDisplay(parseBuilderTraitsFromImage(token.image));
  const explorerBase = chainSlug === 'ethereum' ? 'https://etherscan.io' : 'https://basescan.org';
  const nounsBuildUrl = `https://nouns.build/dao/${chainSlug}/${daoAddress}/${token.tokenId}`;
  const openSeaUrl = `https://opensea.io/assets/${chainSlug}/${daoAddress}/${token.tokenId}`;

  return (
    <HoverCard openDelay={350} closeDelay={200}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side="bottom" align="start" sideOffset={8} className="w-80 p-0">
        <div className="relative">
          {/* Header */}
          <div className="border-b-2 px-3 py-2" style={{ borderColor: accentColor }}>
            <div className="flex items-center justify-between gap-2">
              <h3
                className="truncate text-base font-bold tracking-tight"
                style={{ color: accentColor }}
              >
                {token.name}
              </h3>
              <a
                href={nounsBuildUrl}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-xs font-semibold text-blue-600 no-underline hover:underline"
              >
                nouns.build ↗
              </a>
            </div>
            <div className="mt-0.5 text-xs text-gray-500">
              Held by{' '}
              <a
                href={`${explorerBase}/address/${token.owner}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-blue-500 hover:underline"
              >
                {ownerDisplayName}
              </a>
            </div>
          </div>

          {/* Image */}
          <div className="flex items-center justify-center border-b border-gray-200 bg-gray-50 py-3">
            <img
              src={token.image}
              alt={token.name}
              className="h-32 w-32 rounded"
              loading="lazy"
              style={{ imageRendering: 'pixelated' }}
            />
          </div>

          {/* Traits */}
          {traits.length > 0 && (
            <div className="border-b border-gray-200 px-3 py-2">
              <p className="mb-1 font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-gray-400">
                Traits — click to filter
              </p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                {traits.map(t => {
                  const isActive =
                    activeTrait !== null &&
                    activeTrait !== undefined &&
                    activeTrait.layer === t.layer &&
                    activeTrait.slug === t.slug;
                  return (
                    <button
                      key={`${t.layer}-${t.slug}`}
                      type="button"
                      onClick={() => onTraitClick?.(t)}
                      className={`-mx-1 rounded px-1 text-left transition-colors ${
                        isActive ? 'bg-black text-white' : 'hover:bg-gray-100'
                      }`}
                    >
                      <span className="block font-mono text-[8px] uppercase text-gray-400">
                        {t.layer}
                      </span>
                      <span className="block font-semibold">{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 px-3 py-2">
            <a
              href={openSeaUrl}
              target="_blank"
              rel="noreferrer"
              className="flex-1 rounded border border-gray-200 px-2 py-1 text-center text-xs font-bold text-gray-700 no-underline hover:bg-gray-50"
            >
              OpenSea
            </a>
            {extraLink && (
              <a
                href={extraLink.href}
                target="_blank"
                rel="noreferrer"
                className="flex-1 rounded border border-gray-200 px-2 py-1 text-center text-xs font-bold text-gray-700 no-underline hover:bg-gray-50"
              >
                {extraLink.label}
              </a>
            )}
            <a
              href={`${explorerBase}/address/${daoAddress}?a=${token.tokenId}`}
              target="_blank"
              rel="noreferrer"
              className="flex-1 rounded border border-gray-200 px-2 py-1 text-center text-xs font-bold text-gray-700 no-underline hover:bg-gray-50"
            >
              Explorer
            </a>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
};
