import type { INounSeed } from '@/wrappers/nounToken';
import type { EncodedImage } from '@nouns/sdk';

import React, { useEffect, useState } from 'react';

import { Trans } from '@lingui/react/macro';
import { ImageData } from '@noundry/nouns-assets';
// V2 ImageData mirrors the on-chain NounV2 descriptor (32 bodies, 144
// accessories, 253 heads, 23 glasses, 253-color palette including 14
// founder colors at slots 239..252). Used here so V2-only founder traits
// (slobber, missingnoun, white/black bodies) render with the right palette
// — V1 npm only has 239 palette entries so attempting to build the slobber
// SVG against V1 palette would error on the V2-only color slots.
import { ImageDataV2 } from '@nouns/assets';
import { buildSVG, PNGCollectionEncoder } from '@nouns/sdk';
import JSZip from 'jszip';
import { CopyIcon, DownloadIcon, PackageIcon } from 'lucide-react';
import { toast } from 'sonner';

import CCZero from '@/assets/cczero-badge.svg?react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { traitCategory } from '@/lib/traitCategory';
import { traitName } from '@/lib/traitName';
import { svg2png } from '@/utils/svg2png';

/** Whether a trait is exclusive to one DAO branch.
 *  - 'both'    → present in mainnet V1 (npm `@noundry/nouns-assets` snapshot)
 *               AND our V2 fork (`ImageDataV2`). Renders with no badge.
 *  - 'v1-only' → in mainnet V1's current chain state but didn't fork over to
 *               our V2 (e.g. `glasses-lavender`, `body-lilac`, `accessory-gnars`,
 *               `head-shrimp-tempura`). Tagged with a red "V1" badge.
 *  - 'v2-only' → in our V2 fork only (founder additions: `body-white`,
 *               `body-black`, `accessory-slobber`, `accessory-multicolor`,
 *               `head-missingnoun`). Tagged with a purple "V2" badge. */
type TraitSource = 'both' | 'v1-only' | 'v2-only';

interface TraitItem {
  name: string;
  filename: string;
  svg: string;
  category: string;
  type: string;
  index: number;
  hexColor?: string;
  source: TraitSource;
}

const encoder = new PNGCollectionEncoder(ImageData.palette);

const capitalizeFirstLetter = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const traitKeyToTitle: Record<string, string> = {
  glasses: 'Noggles',
  heads: 'Heads',
  accessories: 'Accessories',
  bodies: 'Bodies',
};

const backgroundColors = {
  cool: '#d5d7e1',
  warm: '#e1d7d5',
};

const downloadSVG = (svg: string, filename: string) => {
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const downloadEl = document.createElement('a');
  downloadEl.href = url;
  downloadEl.download = `${filename}.svg`;
  downloadEl.click();
  URL.revokeObjectURL(url);
};

const downloadPNG = async (svg: string, filename: string) => {
  try {
    const png = await svg2png(svg, 512, 512);
    if (png) {
      const downloadEl = document.createElement('a');
      downloadEl.href = png;
      downloadEl.download = `${filename}.png`;
      downloadEl.click();
    }
  } catch (error) {
    console.error('Error converting SVG to PNG:', error);
  }
};

const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`Copied ${text} to clipboard`, { duration: 5000 });
  } catch (error) {
    console.error('Failed to copy:', error);
    toast.error('Failed to copy to clipboard');
  }
};

/**
 * Resolve the human-readable display name for a trait given its raw filename.
 *
 * We can't reuse `traitName(type, seed)` from `@/lib/traitName` because that
 * helper is locked to the V1 `ImageData` import — calling it for a V2 index
 * would give the wrong filename (e.g. V2 index 30 = `body-white`, but V1
 * index 30 doesn't exist). Doing the parse from the filename string is
 * deterministic and matches the rules `traitName` already applies.
 *
 * Rules (mirroring `@/lib/traitName`):
 *  - 'glasses' filenames have a leading `square-` prefix → strip it.
 *  - 'accessory' filenames sometimes have a leading `body-` prefix
 *    (renaming carryover from earlier descriptor versions) → strip it.
 *  - Drop everything up to the first `-` (the category prefix), then
 *    replace remaining `-` with spaces and capitalise.
 *
 * Important: this is the canonical key we use to dedupe between V1 and V2,
 * because the same logical trait sometimes has slightly different filename
 * spellings between the two descriptors (`accessory-body-bege` on V1 npm vs
 * `body-bege` on V2). Both resolve to display name `Bege` here.
 */
const filenameToDisplayName = (filename: string, type: string): string => {
  let f = filename;
  if (type === 'glasses') f = f.replace('square-', '');
  if (type === 'accessory') f = f.replace('body-', '');
  const dashIdx = f.indexOf('-');
  const stripped = dashIdx === -1 ? f : f.substring(dashIdx + 1);
  return capitalizeFirstLetter(stripped.replace(/-/g, ' '));
};

const generateTraitItems = (): TraitItem[] => {
  const traitItems: TraitItem[] = [];

  // For each visual category we walk both V1 (npm `@noundry/nouns-assets`
  // current chain state) and V2 (`ImageDataV2`) and merge by display name.
  // Order:
  //   1. V1 traits first (preserves the existing tile order users expect),
  //      tagged 'both' if V2 also has it and 'v1-only' otherwise.
  //   2. V2-only traits appended at the end of the category in V2 index
  //      order, tagged 'v2-only'. These are the founder traits the user
  //      asked us to surface (slobber, missingnoun, white/black bodies, …).
  Object.entries(traitCategory).forEach(([traitType, imageKey]) => {
    const categoryTitle = traitKeyToTitle[imageKey] || capitalizeFirstLetter(imageKey);
    const v1Images = ImageData.images[imageKey] ?? [];
    const v2Images = ImageDataV2.images[imageKey] ?? [];

    // Map display-name → presence in each branch.
    const v2NamesByName = new Map<string, { item: EncodedImage; index: number }>();
    v2Images.forEach((img: EncodedImage, idx: number) => {
      const name = filenameToDisplayName(img.filename, traitType);
      v2NamesByName.set(name, { item: img, index: idx });
    });
    const v1Names = new Set<string>(
      v1Images.map((img: EncodedImage) => filenameToDisplayName(img.filename, traitType)),
    );

    // 1) V1 traits — keep existing index ordering.
    v1Images.forEach((imageData: EncodedImage, index: number) => {
      const name = traitName(traitType as keyof INounSeed, index);
      const inV2 = v2NamesByName.has(name);
      // Build SVG against V1 palette (npm `@noundry/nouns-assets`) — these
      // indices are guaranteed to be valid in V1's 239-color palette since
      // the trait is V1-native. V2 traits use a 253-color palette so we
      // build those separately below with `ImageDataV2.palette`.
      const svg = buildSVG([imageData], encoder.data.palette, undefined);
      traitItems.push({
        name,
        filename: imageData.filename,
        svg,
        category: categoryTitle,
        type: traitType === 'glasses' ? 'Noggles' : traitType,
        index,
        source: inV2 ? 'both' : 'v1-only',
      });
    });

    // 2) V2-only traits — append at the end in V2 index order. Built
    // against `ImageDataV2.palette` because founder traits like
    // accessory-slobber and head-missingnoun reference palette slots
    // 239..252 which only exist in V2's palette (V1 npm tops out at 239).
    v2Images.forEach((imageData: EncodedImage, v2Index: number) => {
      const name = filenameToDisplayName(imageData.filename, traitType);
      if (v1Names.has(name)) return; // already emitted as 'both'
      const svg = buildSVG([imageData], ImageDataV2.palette, undefined);
      traitItems.push({
        name,
        filename: imageData.filename,
        svg,
        category: categoryTitle,
        type: traitType === 'glasses' ? 'Noggles' : traitType,
        index: v2Index,
        source: 'v2-only',
      });
    });
  });

  // Backgrounds are identical across V1 and V2 (Cool / Warm), so we mark
  // them 'both' and skip the diff dance.
  Object.entries(backgroundColors).forEach(([bgName, hexColor], index) => {
    const svg = `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" fill="${hexColor}" />
      <text x="16" y="18" text-anchor="middle" font-family="monospace" font-size="3" fill="${hexColor === '#d5d7e1' ? '#333' : '#666'}">${hexColor}</text>
    </svg>`;

    traitItems.push({
      name: capitalizeFirstLetter(bgName),
      filename: `background-${bgName}`,
      svg,
      category: 'Backgrounds',
      type: 'background',
      index,
      hexColor,
      source: 'both',
    });
  });

  return traitItems;
};

const TraitsPage: React.FC = () => {
  const [traits, setTraits] = useState<TraitItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [zipLoading, setZipLoading] = useState(false);

  useEffect(() => {
    const loadTraits = () => {
      const traitItems = generateTraitItems();
      setTraits(traitItems);
      setLoading(false);
    };

    loadTraits();
  }, []);

  // eslint-disable-next-line sonarjs/cognitive-complexity
  const downloadAllTraitsAsZip = async () => {
    if (zipLoading) return;

    setZipLoading(true);
    try {
      const zip = new JSZip();

      // Group traits by category for organized folder structure
      const traitsByCategory = traits.reduce(
        (acc, trait) => {
          if (!acc[trait.category]) {
            acc[trait.category] = [];
          }
          acc[trait.category].push(trait);
          return acc;
        },
        {} as Record<string, TraitItem[]>,
      );

      // Collect background colors info for consolidated file
      const backgroundColors: string[] = [];

      // Process each category
      for (const [category, categoryTraits] of Object.entries(traitsByCategory)) {
        const categoryFolder = zip.folder(category);

        for (const trait of categoryTraits) {
          // Create filename with trait index prefix
          const indexedFilename = `${trait.index}-${trait.filename}`;

          // Add SVG file
          categoryFolder?.file(`${indexedFilename}.svg`, trait.svg);

          // For background colors, collect info for consolidated file
          if (trait.type === 'background' && trait.hexColor) {
            backgroundColors.push(`${trait.index}: ${trait.name} - ${trait.hexColor}`);
          } else {
            // For other traits, add PNG version
            try {
              const pngBlob = await svg2png(trait.svg, 512, 512);
              if (pngBlob) {
                // Convert data URL to blob
                const response = await fetch(pngBlob);
                const blob = await response.blob();
                categoryFolder?.file(`${indexedFilename}.png`, blob);
              }
            } catch (error) {
              console.warn(`Failed to convert ${trait.filename} to PNG:`, error);
            }
          }
        }
      }

      // Add consolidated backgrounds.txt file if there are background colors
      if (backgroundColors.length > 0) {
        const backgroundsFolder = zip.folder('Backgrounds');
        const backgroundsContent = backgroundColors.join('\n');
        backgroundsFolder?.file('backgrounds.txt', backgroundsContent);
      }

      // Generate and download the ZIP
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const downloadEl = document.createElement('a');
      downloadEl.href = URL.createObjectURL(zipBlob);
      downloadEl.download = 'nouns-traits.zip';
      downloadEl.click();
      URL.revokeObjectURL(downloadEl.href);

      toast.success('All traits downloaded as ZIP file!', { duration: 5000 });
    } catch (error) {
      console.error('Error creating ZIP file:', error);
      toast.error('Failed to create ZIP file');
    } finally {
      setZipLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">
          <Trans>Loading traits...</Trans>
        </div>
      </div>
    );
  }

  // Group traits by category
  const traitsByCategory = traits.reduce(
    (acc, trait) => {
      if (!acc[trait.category]) {
        acc[trait.category] = [];
      }
      acc[trait.category].push(trait);
      return acc;
    },
    {} as Record<string, TraitItem[]>,
  );

  // Define the order for categories
  const categoryOrder = ['Noggles', 'Heads', 'Accessories', 'Bodies', 'Backgrounds'];
  const orderedCategories = categoryOrder.filter(category => traitsByCategory[category]);

  return (
    <div className="container mx-auto px-4 pt-8">
      <div className="mb-8">
        <div>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <h1 className="mt-2 text-5xl font-bold text-gray-900">
              <Trans>Traits</Trans>
            </h1>
            <Button
              onClick={downloadAllTraitsAsZip}
              disabled={zipLoading}
              className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800"
            >
              <PackageIcon size={16} />
              {zipLoading ? <Trans>Creating ZIP...</Trans> : <Trans>Download All</Trans>}
            </Button>
          </div>
          <p className="mt-4 text-lg text-gray-600">
            <Trans>Browse and download all available Noun traits.</Trans>
          </p>

          {/* Legend — explains the V1/V2 badges that appear on the trait
              tiles. Both DAOs share the bulk of the trait set, so most tiles
              are unbadged; the small minority that diverged get a coloured
              corner pill. Counts are computed live so adding a new founder
              trait or hot-loading a fresh V1 npm snapshot just works. */}
          <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-gray-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block rounded-sm bg-purple-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                V2
              </span>
              <span>Only in our V2 fork (founder traits)</span>
            </span>
            <span className="text-gray-300">·</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block rounded-sm bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                V1
              </span>
              <span>Only in mainnet V1 (didn&apos;t fork to V2)</span>
            </span>
          </div>
        </div>
      </div>

      {orderedCategories.map(category => (
        <div key={category} className="mb-12">
          <h2 className="font-londrina mb-6 text-3xl font-bold text-gray-900">{category}</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-6">
            {traitsByCategory[category].map(trait => (
              <Dialog key={`${trait.source}-${trait.filename}`}>
                <DialogTrigger asChild>
                  <div
                    className={`relative flex h-full cursor-pointer flex-col rounded-lg border bg-white p-2 transition-shadow hover:shadow-md ${
                      trait.source === 'v2-only'
                        ? 'border-purple-300 ring-1 ring-purple-200'
                        : trait.source === 'v1-only'
                          ? 'border-rose-300 ring-1 ring-rose-200'
                          : 'border-gray-200'
                    }`}
                  >
                    {/* Corner badge — only rendered for the diverging traits.
                        Shared traits (the vast majority) stay clean. */}
                    {trait.source !== 'both' && (
                      <span
                        className={`absolute right-1.5 top-1.5 z-10 inline-block rounded-sm px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow ${
                          trait.source === 'v2-only' ? 'bg-purple-600' : 'bg-rose-600'
                        }`}
                        title={
                          trait.source === 'v2-only'
                            ? 'Only in our V2 fork — founder trait'
                            : "Only in mainnet V1 — didn't fork to V2"
                        }
                      >
                        {trait.source === 'v2-only' ? 'V2' : 'V1'}
                      </span>
                    )}
                    <div className="bg-checkerboard mb-2 flex aspect-square items-center justify-center overflow-hidden rounded-lg shadow-inner">
                      <img
                        src={`data:image/svg+xml;base64,${btoa(trait.svg)}`}
                        alt={trait.name}
                        className="h-full w-full object-contain drop-shadow"
                      />
                    </div>
                    <div className="flex flex-1 items-center justify-center">
                      <h3 className="text-center text-sm font-medium text-gray-900">
                        {trait.name}
                      </h3>
                    </div>
                  </div>
                </DialogTrigger>
                <DialogContent className="max-w-[min(calc(100vw-2rem),28rem)] rounded-xl">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <span>
                        {trait.name} {capitalizeFirstLetter(trait.type)}
                      </span>
                      {trait.source !== 'both' && (
                        <span
                          className={`inline-block rounded-sm px-1.5 py-0.5 text-[10px] font-bold leading-none text-white ${
                            trait.source === 'v2-only' ? 'bg-purple-600' : 'bg-rose-600'
                          }`}
                        >
                          {trait.source === 'v2-only' ? 'V2 ONLY' : 'V1 ONLY'}
                        </span>
                      )}
                    </DialogTitle>
                  </DialogHeader>
                  {trait.source !== 'both' && (
                    <p className="text-sm text-gray-600">
                      {trait.source === 'v2-only'
                        ? 'Founder trait added when our V2 descriptor was deployed. Not present on mainnet V1.'
                        : "Added to mainnet V1 after our V2 descriptor was forked, so it doesn't appear in V2 nouns."}
                    </p>
                  )}
                  <div className="flex flex-col items-center space-y-4">
                    <div className="bg-checkerboard flex aspect-square max-w-96 items-center justify-center overflow-hidden rounded-lg shadow-inner">
                      <img
                        src={`data:image/svg+xml;base64,${btoa(trait.svg)}`}
                        alt={trait.name}
                        className="h-full w-full object-contain"
                      />
                    </div>
                    {trait.type === 'background' ? (
                      <div className="flex flex-col items-center gap-3">
                        <Button
                          variant="outline"
                          onClick={() => copyToClipboard(trait.hexColor!)}
                          className="flex items-center gap-2"
                        >
                          <CopyIcon size={16} />
                          Copy Hex Code
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-3">
                        <Button
                          variant="outline"
                          onClick={() => downloadSVG(trait.svg, trait.filename)}
                          className="flex items-center gap-2"
                        >
                          <DownloadIcon size={16} />
                          SVG
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => downloadPNG(trait.svg, trait.filename)}
                          className="flex items-center gap-2"
                        >
                          <DownloadIcon size={16} />
                          PNG
                        </Button>
                      </div>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            ))}
          </div>
        </div>
      ))}

      <section className="mt-12 border-t border-gray-200 pt-12">
        <h2 className="font-londrina text-3xl font-bold text-gray-900">
          <Trans>License</Trans>
        </h2>
        <div className="mt-6 items-start gap-6">
          <p className="max-w-2xl text-lg text-gray-600">
            <Trans>
              All traits are{' '}
              <a
                href="https://creativecommons.org/public-domain/cc0/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline hover:text-blue-800"
              >
                CC0
              </a>{' '}
              (Creative Commons Zero), meaning they are in the public domain and free to use for any
              purpose without restriction.
            </Trans>
          </p>
          <CCZero className="mt-6 h-16" />
        </div>
      </section>
    </div>
  );
};

export default TraitsPage;
