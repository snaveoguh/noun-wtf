// Top-left site icon: one small Nouns accessory (≤ 8×8 px, fries first),
// swapping every 3 s; hovering reels through them all.

import { useEffect, useMemo, useState } from 'react';

import ICONS from './accessoryIcons.json';

interface Icon {
  n: string;
  p: string[];
  r: string[];
}

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

function Pixels({ icon }: { icon: Icon }) {
  const h = icon.r.length;
  const w = Math.max(...icon.r.map(r => r.length));
  const ox = Math.floor((8 - w) / 2);
  const oy = Math.floor((8 - h) / 2);
  const rects = useMemo(() => {
    const out: { x: number; y: number; c: string }[] = [];
    icon.r.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        if (ch === '.') return;
        out.push({ x: x + ox, y: y + oy, c: `#${icon.p[DIGITS.indexOf(ch)] ?? '000'}` });
      });
    });
    return out;
  }, [icon, ox, oy]);
  return (
    <svg viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden>
      {rects.map(r => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={1.02} height={1.02} fill={r.c} />
      ))}
    </svg>
  );
}

export default function AccessoryIcon({ onClick }: { onClick: () => void }) {
  const icons = ICONS as Icon[];
  const [i, setI] = useState(0);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    const t = window.setInterval(() => setI(x => (x + 1) % icons.length), hover ? 110 : 3000);
    return () => window.clearInterval(t);
  }, [hover, icons.length]);
  const icon = icons[i] ?? icons[0]!;
  return (
    <button
      type="button"
      className="nos-icon"
      title={icon.n}
      onClick={onClick}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <Pixels icon={icon} />
    </button>
  );
}
