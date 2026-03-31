import { FC, useCallback, useEffect, useRef, useState } from 'react';

export type Tool = 'pencil' | 'eraser' | 'fill' | 'eyedropper';

interface PixelCanvasProps {
  width?: number;
  height?: number;
  pixels: string[][]; // 32x32 grid of hex colors ('' for transparent)
  onPixelChange: (x: number, y: number, color: string) => void;
  onPixelsFill: (pixels: [number, number, string][]) => void;
  onColorPick: (color: string) => void;
  activeColor: string;
  activeTool: Tool;
  zoom?: number;
  transparentBg?: boolean; // skip checkerboard — renders on transparent canvas
}

export const PixelCanvas: FC<PixelCanvasProps> = ({
  width = 32,
  height = 32,
  pixels,
  onPixelChange,
  onPixelsFill,
  onColorPick,
  activeColor,
  activeTool,
  zoom = 16,
  transparentBg = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  const pixelSize = zoom;
  const canvasWidth = width * pixelSize;
  const canvasHeight = height * pixelSize;

  // Draw the canvas
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    // Clear
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Draw checkerboard background (transparency indicator) — skip if transparent
    if (!transparentBg) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const isLight = (x + y) % 2 === 0;
          ctx.fillStyle = isLight ? '#f0f0f0' : '#d0d0d0';
          ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
        }
      }
    }

    // Draw pixels
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const color = pixels[y]?.[x];
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
        }
      }
    }

    // Draw grid lines
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= width; x++) {
      ctx.beginPath();
      ctx.moveTo(x * pixelSize, 0);
      ctx.lineTo(x * pixelSize, canvasHeight);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * pixelSize);
      ctx.lineTo(canvasWidth, y * pixelSize);
      ctx.stroke();
    }
  }, [pixels, width, height, pixelSize, canvasWidth, canvasHeight, transparentBg]);

  useEffect(() => {
    draw();
  }, [draw]);

  const getPixelCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvasWidth / rect.width;
    const scaleY = canvasHeight / rect.height;
    const x = Math.floor(((e.clientX - rect.left) * scaleX) / pixelSize);
    const y = Math.floor(((e.clientY - rect.top) * scaleY) / pixelSize);
    if (x < 0 || x >= width || y < 0 || y >= height) return null;
    return { x, y };
  };

  const floodFill = useCallback(
    (startX: number, startY: number, fillColor: string) => {
      const targetColor = pixels[startY]?.[startX] || '';
      if (targetColor === fillColor) return;

      const changes: [number, number, string][] = [];
      const visited = new Set<string>();
      const queue: [number, number][] = [[startX, startY]];

      while (queue.length > 0) {
        const [x, y] = queue.shift()!;
        const key = `${x},${y}`;
        if (visited.has(key)) continue;
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        const currentColor = pixels[y]?.[x] || '';
        if (currentColor !== targetColor) continue;

        visited.add(key);
        changes.push([x, y, fillColor]);
        queue.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
      }

      if (changes.length > 0) {
        onPixelsFill(changes);
      }
    },
    [pixels, width, height, onPixelsFill],
  );

  const handleAction = useCallback(
    (x: number, y: number) => {
      switch (activeTool) {
        case 'pencil':
          onPixelChange(x, y, activeColor);
          break;
        case 'eraser':
          onPixelChange(x, y, '');
          break;
        case 'fill':
          floodFill(x, y, activeColor);
          break;
        case 'eyedropper': {
          const color = pixels[y]?.[x];
          if (color) onColorPick(color);
          break;
        }
      }
    },
    [activeTool, activeColor, onPixelChange, floodFill, onColorPick, pixels],
  );

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getPixelCoords(e);
    if (!coords) return;
    setIsDrawing(true);
    handleAction(coords.x, coords.y);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    if (activeTool === 'fill' || activeTool === 'eyedropper') return;
    const coords = getPixelCoords(e);
    if (!coords) return;
    handleAction(coords.x, coords.y);
  };

  const handleMouseUp = () => setIsDrawing(false);
  const handleMouseLeave = () => setIsDrawing(false);

  return (
    <canvas
      ref={canvasRef}
      width={canvasWidth}
      height={canvasHeight}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      className="cursor-crosshair rounded-lg border-2 border-gray-300 shadow-inner"
      style={{
        width: canvasWidth,
        height: canvasHeight,
        imageRendering: 'pixelated',
      }}
    />
  );
};
