import type { Cc0Asset } from './assets';

import { useState } from 'react';

import {
  BoxIcon as Box,
  FileQuestionIcon as FileQuestion,
  MusicIcon as Music,
  VideoIcon as Video,
} from 'lucide-react';

import { TYPE_LABEL } from './assets';

const TILE_ICON = { audio: Music, '3d': Box, video: Video } as const;
const TILE_TINT: Record<string, string> = {
  audio: 'text-[#d4ff3a]',
  '3d': 'text-[#ff2f8e]',
  video: 'text-[#20d6ff]',
};

/** The stand-in for files an <img> can't show (audio, 3D) or that failed to load. */
export function FileTile({ asset, big = false }: { asset: Cc0Asset; big?: boolean }) {
  const Icon = TILE_ICON[asset.type as keyof typeof TILE_ICON] ?? FileQuestion;
  return (
    <div
      className={`cc0-check flex aspect-square w-full flex-col items-center justify-center gap-2 ${TILE_TINT[asset.type] ?? 'text-[#9b998f]'}`}
    >
      <Icon className={big ? 'h-20 w-20' : 'h-10 w-10'} strokeWidth={1.6} aria-hidden />
      <span className={`cc0-mono font-bold ${big ? 'text-base' : 'text-[11px]'}`}>
        {asset.ext !== undefined ? `.${asset.ext.toUpperCase()}` : TYPE_LABEL[asset.type]}
      </span>
    </div>
  );
}

export function AssetImage({
  asset,
  className = '',
  eager = false,
}: {
  asset: Cc0Asset;
  className?: string;
  eager?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  if (asset.thumb === undefined || broken) return <FileTile asset={asset} />;
  return (
    <img
      src={asset.thumb}
      alt={asset.title}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      className={`block w-full ${asset.isPixel ? 'cc0-pixel' : ''} ${className}`}
    />
  );
}

export function AssetCard({
  asset,
  square,
  onOpen,
}: {
  asset: Cc0Asset;
  square: boolean;
  onOpen: (a: Cc0Asset) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(asset)}
      className="group relative block w-full overflow-hidden rounded-xl bg-[#111116] text-left shadow-[0_0_0_1px_rgba(255,255,255,.07)] transition hover:-translate-y-0.5 hover:shadow-[0_0_0_2px_#d4ff3a,0_14px_30px_rgba(0,0,0,.5)] focus-visible:shadow-[0_0_0_2px_#d4ff3a]"
      aria-label={`${asset.title} by ${asset.creator}`}
    >
      <div className={`cc0-check ${square ? 'aspect-square' : ''} overflow-hidden`}>
        <AssetImage
          asset={asset}
          className={
            square ? 'h-full object-contain' : 'h-auto max-h-[300px] min-h-[80px] object-contain'
          }
        />
      </div>
      {asset.source === 'upload' && (
        <span className="cc0-mono absolute left-2 top-2 rounded-md bg-[#ff2f8e] px-1.5 py-0.5 text-[10px] font-bold text-white shadow-[2px_2px_0_#0b0b0f]">
          UPLOADED
        </span>
      )}
      {asset.type !== 'image' && asset.thumb !== undefined && (
        <span className="cc0-mono absolute right-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-[#f4f2ea]">
          {TYPE_LABEL[asset.type]}
        </span>
      )}
      <div className="px-2.5 pb-2.5 pt-2">
        <div className="truncate text-[13px] font-semibold text-[#f4f2ea]">{asset.title}</div>
        <div className="truncate text-[11.5px] text-[#9b998f]">
          {asset.creator}
          {asset.inMemoriam === true && ' · in memoriam'}
        </div>
      </div>
    </button>
  );
}
