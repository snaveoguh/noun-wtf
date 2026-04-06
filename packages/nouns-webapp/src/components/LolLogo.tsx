import { FC, useEffect, useRef, useState } from 'react';

// Red → yellow gradient, 30 steps for ~30 second full cycle
const PALETTE = Array.from({ length: 30 }, (_, i) => {
  const t = i / 29; // 0 to 1
  const r = 213;
  const g = Math.round(60 + t * 179); // 60 → 239
  const b = Math.round(94 - t * 56);  // 94 → 38
  return `rgb(${r},${g},${b})`;
});

/**
 * Pixel art "LOL" logo — classic Nouns accessory proportions.
 * L = 2w x 3h, O = 2w x 3h, 1px gap between letters.
 * Colors drift very slowly through the Nouns palette.
 * On hover: reverses direction and slows further.
 */
const LolLogo: FC<{ className?: string }> = ({ className }) => {
  const [colorIndex, setColorIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const directionRef = useRef(1);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    const tick = () => {
      setColorIndex(prev => {
        const next = prev + directionRef.current;
        if (next >= PALETTE.length) {
          directionRef.current = -1;
          return PALETTE.length - 2;
        }
        if (next < 0) {
          directionRef.current = 1;
          return 1;
        }
        return next;
      });
    };

    // ~1s per step = ~30s full cycle, even slower on hover
    const speed = hovered ? 3000 : 1000;
    intervalRef.current = setInterval(tick, speed);
    return () => clearInterval(intervalRef.current);
  }, [hovered]);

  const handleMouseEnter = () => {
    directionRef.current = -directionRef.current;
    setHovered(true);
  };

  const handleMouseLeave = () => {
    setHovered(false);
  };

  const color = PALETTE[colorIndex] || PALETTE[0];

  // L = 2w x 3h, O = 2w x 3h, 1px gap between each letter
  // L: cols 0-1, O: cols 3-4, L: cols 6-7 → 8 wide, 3 tall
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
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
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
          style={{ transition: 'fill 1.5s ease' }}
        />
      ))}
    </svg>
  );
};

export default LolLogo;
