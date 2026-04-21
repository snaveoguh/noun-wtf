import { FC, memo, useState } from 'react';

// Actual Nouns fries accessory pixel data (5x7) — exported so other
// components (e.g. 3D portal in /world) can render the same art.
export const FRIES_PIXELS: [number, number, string][] = [
  [0,0,"#ffc110"],[1,0,"#b87b11"],[2,0,"#ffc110"],[3,0,"#b87b11"],[4,0,"#ffc110"],
  [0,1,"#ffc110"],[1,1,"#b87b11"],[2,1,"#ffc110"],[3,1,"#b87b11"],[4,1,"#ffc110"],
  [0,2,"#e11833"],[1,2,"#e11833"],[2,2,"#e11833"],[3,2,"#e11833"],[4,2,"#e11833"],
  [0,3,"#e11833"],[1,3,"#ffc110"],[2,3,"#ffc110"],[3,3,"#ffc110"],[4,3,"#e11833"],
  [0,4,"#e11833"],[1,4,"#ffc110"],[2,4,"#ffc110"],[3,4,"#e11833"],[4,4,"#e11833"],
  [0,5,"#e11833"],[1,5,"#ffc110"],[2,5,"#e11833"],[3,5,"#e11833"],[4,5,"#e11833"],
  [0,6,"#e11833"],[1,6,"#e11833"],[2,6,"#e11833"],[3,6,"#e11833"],[4,6,"#e11833"],
];
export const FRIES_WIDTH = 5;
export const FRIES_HEIGHT = 7;

const FRIES: [number, number, string][] = [
  [0,0,"#ffc110"],[1,0,"#b87b11"],[2,0,"#ffc110"],[3,0,"#b87b11"],[4,0,"#ffc110"],
  [0,1,"#ffc110"],[1,1,"#b87b11"],[2,1,"#ffc110"],[3,1,"#b87b11"],[4,1,"#ffc110"],
  [0,2,"#e11833"],[1,2,"#e11833"],[2,2,"#e11833"],[3,2,"#e11833"],[4,2,"#e11833"],
  [0,3,"#e11833"],[1,3,"#ffc110"],[2,3,"#ffc110"],[3,3,"#ffc110"],[4,3,"#e11833"],
  [0,4,"#e11833"],[1,4,"#ffc110"],[2,4,"#ffc110"],[3,4,"#e11833"],[4,4,"#e11833"],
  [0,5,"#e11833"],[1,5,"#ffc110"],[2,5,"#e11833"],[3,5,"#e11833"],[4,5,"#e11833"],
  [0,6,"#e11833"],[1,6,"#e11833"],[2,6,"#e11833"],[3,6,"#e11833"],[4,6,"#e11833"],
];

// LOL pixel art (8x3)
const LOL: [number, number, string][] = [
  [0,0,"#111"],[0,1,"#111"],[0,2,"#111"],[1,2,"#111"],
  [3,0,"#111"],[4,0,"#111"],[3,1,"#111"],[4,1,"#111"],[3,2,"#111"],[4,2,"#111"],
  [6,0,"#111"],[6,1,"#111"],[6,2,"#111"],[7,2,"#111"],
];

const LolLogo: FC<{ className?: string }> = memo(({ className }) => {
  const [hovered, setHovered] = useState(false);

  const ps = 4; // pixel size
  const pixels = hovered ? LOL : FRIES;
  const w = hovered ? 8 : 5;
  const h = hovered ? 3 : 7;

  return (
    <svg
      viewBox={`0 0 ${w * ps} ${h * ps}`}
      width={w * ps}
      height={h * ps}
      className={className}
      style={{ cursor: 'pointer', transition: 'all 0.15s' }}
      aria-label="noun.wtf"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {pixels.map(([x, y, color], i) => (
        <rect key={i} x={x * ps} y={y * ps} width={ps} height={ps} fill={color} />
      ))}
    </svg>
  );
});

LolLogo.displayName = 'LolLogo';
export default LolLogo;
