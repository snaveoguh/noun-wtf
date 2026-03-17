import { FC, useEffect, useMemo, useRef } from 'react';

import { ImageData } from '@noundry/nouns-assets';
import { buildSVG, EncodedImage } from '@nouns/sdk';

import { INounSeed } from '@/wrappers/nounToken';

export interface LayerVisibility {
  background: boolean;
  body: boolean;
  accessory: boolean;
  head: boolean;
  glasses: boolean;
}

interface TraitPreviewProps {
  seed: INounSeed;
  customPixels?: string[][]; // Optional custom overlay drawn on top
  className?: string;
  layerVisibility?: LayerVisibility;
}

const DEFAULT_VISIBILITY: LayerVisibility = {
  background: true,
  body: true,
  accessory: true,
  head: true,
  glasses: true,
};

export const TraitPreview: FC<TraitPreviewProps> = ({
  seed,
  customPixels,
  className = '',
  layerVisibility = DEFAULT_VISIBILITY,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Build SVG with selected layers only
  const svgMarkup = useMemo(() => {
    try {
      const { images } = ImageData;
      const parts: EncodedImage[] = [];

      // Build parts array with only visible layers
      if (layerVisibility.body) parts.push(images.bodies[seed.body]);
      if (layerVisibility.accessory) parts.push(images.accessories[seed.accessory]);
      if (layerVisibility.head) parts.push(images.heads[seed.head]);
      if (layerVisibility.glasses) parts.push(images.glasses[seed.glasses]);

      const bg = layerVisibility.background ? ImageData.bgcolors[seed.background] : '';
      return buildSVG(parts, ImageData.palette, bg);
    } catch {
      return '';
    }
  }, [seed, layerVisibility]);

  // Has any pixels been drawn?
  const hasCustomPixels = useMemo(() => {
    if (!customPixels) return false;
    return customPixels.some(row => row.some(c => c !== ''));
  }, [customPixels]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !svgMarkup) return;

    const ctx = canvas.getContext('2d')!;
    const size = 320; // render at 320x320 for crisp preview
    canvas.width = size;
    canvas.height = size;

    // Draw the base Noun SVG
    const img = new Image();
    img.onload = () => {
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, size, size);

      // If background hidden, draw checkerboard
      if (!layerVisibility.background) {
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) {
            const isLight = (x + y) % 2 === 0;
            ctx.fillStyle = isLight ? '#e8e8e8' : '#c8c8c8';
            ctx.fillRect(x * 10, y * 10, 10, 10);
          }
        }
      }

      ctx.drawImage(img, 0, 0, size, size);

      // Overlay custom pixels on top
      if (hasCustomPixels && customPixels) {
        const pixelSize = size / 32;
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) {
            const color = customPixels[y]?.[x];
            if (color) {
              ctx.fillStyle = color;
              ctx.fillRect(
                Math.floor(x * pixelSize),
                Math.floor(y * pixelSize),
                Math.ceil(pixelSize),
                Math.ceil(pixelSize),
              );
            }
          }
        }
      }
    };
    img.src = `data:image/svg+xml;base64,${btoa(svgMarkup)}`;
  }, [svgMarkup, customPixels, hasCustomPixels, layerVisibility]);

  if (!svgMarkup) return null;

  return (
    <canvas
      ref={canvasRef}
      className={`rounded-xl shadow-lg ${className}`}
      style={{ imageRendering: 'pixelated', width: '100%', height: 'auto', aspectRatio: '1' }}
    />
  );
};
