import { FC, useEffect, useMemo, useRef } from 'react';

import { getNounData, ImageData } from '@noundry/nouns-assets';
import { buildSVG } from '@nouns/sdk';

import { INounSeed } from '@/wrappers/nounToken';

interface TraitPreviewProps {
  seed: INounSeed;
  customPixels?: string[][]; // Optional custom overlay drawn on top
  className?: string;
}

export const TraitPreview: FC<TraitPreviewProps> = ({ seed, customPixels, className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const svgMarkup = useMemo(() => {
    try {
      const { parts, background } = getNounData(seed);
      return buildSVG(parts, ImageData.palette, background);
    } catch {
      return '';
    }
  }, [seed]);

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
  }, [svgMarkup, customPixels, hasCustomPixels]);

  if (!svgMarkup) return null;

  return (
    <canvas
      ref={canvasRef}
      className={`rounded-xl shadow-lg ${className}`}
      style={{ imageRendering: 'pixelated', width: '100%', height: 'auto', aspectRatio: '1' }}
    />
  );
};
