import { FC, memo } from 'react';

/**
 * Pixel art "LOL" logo — Nouns red, pure CSS animation (no React re-renders).
 */
const LolLogo: FC<{ className?: string }> = memo(({ className }) => {
  const color = '#111111'; // Black

  const pixels = [
    // L (cols 0-1)
    [0,0], [0,1], [0,2], [1,2],
    // O (cols 3-4)
    [3,0], [4,0], [3,1], [4,1], [3,2], [4,2],
    // L (cols 6-7)
    [6,0], [6,1], [6,2], [7,2],
  ];

  const pixelSize = 7;
  const width = 8 * pixelSize;
  const height = 3 * pixelSize;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      style={{ cursor: 'pointer' }}
      aria-label="LOL"
    >
      {pixels.map(([x, y], i) => (
        <rect
          key={i}
          x={x * pixelSize}
          y={y * pixelSize}
          width={pixelSize}
          height={pixelSize}
          fill={color}
        />
      ))}
    </svg>
  );
});

LolLogo.displayName = 'LolLogo';

export default LolLogo;
