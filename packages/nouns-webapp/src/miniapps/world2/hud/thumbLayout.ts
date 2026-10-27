// ── Touch layout: where the thumb buttons and the map cluster sit (pure) ──
//
// Phones keep the middle of the screen clear (coverage.playZone): every
// persistent touch control sits in the bottom band or in the side strips.
// Right thumb: an L round the bottom-right corner (OLLIE in the corner,
// PUSH and STOP along the bottom, FLIP and GRAB up the edge). Left thumb:
// the round minimap in the corner, the board / spray / respawn column above
// it. Landscape phones stack the right buttons up the right strip instead.
// Offsets are px from the screen's bottom-right (pad) or bottom-left (side)
// corner; the components add the safe-area insets on top.

import type { Rect } from './coverage';

export type PadId = 'ollie' | 'push' | 'stop' | 'flip' | 'grab';

export interface PadButton {
  id: PadId;
  /** Diameter, px. */
  size: number;
  /** From the right edge, px. */
  right: number;
  /** From the bottom edge, px. */
  bottom: number;
}

export interface SideSlot {
  /** From the left edge, px. */
  left: number;
  /** From the bottom edge, px. */
  bottom: number;
  size: number;
}

/** Short landscape screens (phones on their side) get the stacked layout. */
export function isLandscapePhone(W: number, H: number): boolean {
  return W > H && H <= 520;
}

const M = 10;

/** The right-thumb buttons for a W×H screen. */
export function thumbPad(W: number, H: number): PadButton[] {
  if (isLandscapePhone(W, H)) {
    return [
      { id: 'ollie', size: 70, right: M, bottom: 12 },
      { id: 'push', size: 56, right: M + 7, bottom: 12 + 70 + 10 },
      { id: 'flip', size: 50, right: M + 10, bottom: 12 + 70 + 10 + 56 + 10 },
      { id: 'stop', size: 46, right: M + 70 + 10, bottom: 8 },
      { id: 'grab', size: 46, right: M + 70 + 10 + 46 + 10, bottom: 8 },
    ];
  }
  const ollie = 74;
  return [
    { id: 'ollie', size: ollie, right: M, bottom: 12 },
    { id: 'push', size: 58, right: M + ollie + 10, bottom: 12 + (ollie - 58) / 2 },
    { id: 'stop', size: 46, right: M + ollie + 10 + 58 + 10, bottom: 12 + (ollie - 46) / 2 },
    // Up the right edge, clear of the play zone's side
    { id: 'flip', size: 48, right: 6, bottom: 12 + ollie + 10 },
    { id: 'grab', size: 46, right: 6, bottom: 12 + ollie + 10 + 48 + 10 },
  ];
}

/** The round minimap (with its speed ring) in the bottom-left corner. */
export function mapCluster(W: number, H: number): SideSlot {
  // As big as fits in the corner without reaching into the play zone
  const size = isLandscapePhone(W, H)
    ? Math.min(96, Math.floor(W * 0.15) - 8)
    : Math.min(108, Math.floor(H * 0.15) - 8);
  return { left: 8, bottom: 8, size };
}

/**
 * The left column (board, spray, respawn, spray colour) above the map, bottom
 * up. `n` slots, each `size` px.
 */
export function sideColumn(W: number, H: number, n = 4): SideSlot[] {
  const map = mapCluster(W, H);
  const size = 44;
  const gap = 8;
  if (isLandscapePhone(W, H)) {
    // A row right of the map, in the bottom band
    return Array.from({ length: n }, (_, i) => ({
      left: map.left + map.size + 10 + i * (size + gap),
      bottom: 8,
      size,
    }));
  }
  return Array.from({ length: n }, (_, i) => ({
    left: 8,
    bottom: map.bottom + map.size + 12 + i * (size + gap),
    size,
  }));
}

/** Screen rects of every persistent touch control (for the layout tests). */
export function touchRects(W: number, H: number): { id: string; r: Rect }[] {
  const out: { id: string; r: Rect }[] = [];
  for (const b of thumbPad(W, H))
    out.push({
      id: b.id,
      r: { x: W - b.right - b.size, y: H - b.bottom - b.size, w: b.size, h: b.size },
    });
  const map = mapCluster(W, H);
  out.push({
    id: 'map',
    r: { x: map.left, y: H - map.bottom - map.size, w: map.size, h: map.size },
  });
  sideColumn(W, H).forEach((s, i) =>
    out.push({ id: `side${i}`, r: { x: s.left, y: H - s.bottom - s.size, w: s.size, h: s.size } }),
  );
  return out;
}
