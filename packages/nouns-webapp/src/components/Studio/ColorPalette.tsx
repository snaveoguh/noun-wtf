import { FC, useState } from 'react';

import { ImageData } from '@noundry/nouns-assets';

interface ColorPaletteProps {
  activeColor: string;
  onColorSelect: (color: string) => void;
}

// Nouns official palette
const nounsPalette = ImageData.palette.map(hex => `#${hex}`);

// Additional common colors
const extraColors = [
  '#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff',
  '#ffff00', '#ff00ff', '#00ffff', '#ff8800', '#8800ff',
  '#ff0088', '#00ff88', '#0088ff', '#888888', '#444444',
  '#cccccc',
];

export const ColorPalette: FC<ColorPaletteProps> = ({ activeColor, onColorSelect }) => {
  const [customColor, setCustomColor] = useState(activeColor);
  const [showAll, setShowAll] = useState(false);

  // Combine unique colors
  const allColors = [...new Set([...extraColors, ...nounsPalette])];
  const displayColors = showAll ? allColors : allColors.slice(0, 32);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div
          className="h-8 w-8 rounded-lg border-2 border-black shadow-sm"
          style={{ backgroundColor: activeColor || 'transparent' }}
        />
        <span className="text-xs font-mono">{activeColor || 'transparent'}</span>
        <input
          type="color"
          value={customColor}
          onChange={e => {
            setCustomColor(e.target.value);
            onColorSelect(e.target.value);
          }}
          className="h-8 w-8 cursor-pointer rounded border-0"
          title="Custom color"
        />
      </div>

      <div className="flex flex-wrap gap-1">
        {/* Transparent "eraser" color */}
        <button
          onClick={() => onColorSelect('')}
          className={`h-6 w-6 rounded border bg-checkerboard ${
            activeColor === '' ? 'ring-2 ring-black ring-offset-1' : ''
          }`}
          title="Transparent"
        />
        {displayColors.map((color, i) => (
          <button
            key={`${color}-${i}`}
            onClick={() => onColorSelect(color)}
            className={`h-6 w-6 rounded border border-gray-300 ${
              activeColor === color ? 'ring-2 ring-black ring-offset-1' : ''
            }`}
            style={{ backgroundColor: color }}
            title={color}
          />
        ))}
      </div>

      {allColors.length > 32 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-xs text-blue-600 hover:underline"
        >
          {showAll ? 'Show less' : `Show all ${allColors.length} colors`}
        </button>
      )}
    </div>
  );
};
