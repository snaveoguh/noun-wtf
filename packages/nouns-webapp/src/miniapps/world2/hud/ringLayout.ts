// ── The ring HUD's layout (pure, tested) ────────────────────────────────
//
// One anchor: the round minimap in the top-right corner. Small badges sit
// on its left rim (coins, respect, score / best, cargo), the speed just
// under it, then the utility icons. Mode chips go in one row, toasts in one
// stack at the top centre, chat bottom-left.
//
//   desktop     icons in one row under the map, mode chips under them
//   portrait    the map and its badges fit in the band above the play zone
//               (coverage.playZone, the middle 70%); icons go in one column
//               down the right strip, above the thumb pad; mode chips sit
//               in the top-left corner
//   landscape   the map in the right strip's top, badges in a row left of
//               it under the site tray, icons down the left strip
//
// Every position is px. Ring-local positions are measured from the map
// box's top-left; the map box itself is placed from the screen's top-right.

import type { Rect } from './coverage';

import { playZone } from './coverage';
import { isLandscapePhone, sideColumn, thumbPad } from './thumbLayout';

export type HudKind = 'desk' | 'portrait' | 'landscape';

/** How many utility icons a phone shows (mic, radio, time, missions, replays, stats, chat, NOUN FM, settings). */
export const PHONE_ICONS = 9;

/** Desktop map diameter, px. */
export const DESK_RING = 168;

/** The site's game tray chip (brand + DESK) on a phone ends about here. */
export const TRAY_BOTTOM = 40;

/** Half the width of the site tray chip on a phone (it sits top-centre), px. */
const TRAY_HALF = 84;

export interface RimSlot {
  /** The badge's right edge, ring-local px (badges grow leftwards). */
  x: number;
  /** Its top, ring-local px. */
  y: number;
}

export interface HudLayout {
  kind: HudKind;
  /** The map's diameter (with its speed ring). */
  size: number;
  /** The map box, from the screen's right and top edges. */
  right: number;
  top: number;
  badgeH: number;
  /** The widest a badge gets (for the layout checks; longer text truncates). */
  badgeW: number;
  /** 'rim': each badge at its slot; 'row': one right-anchored row at slots[0]. */
  badgeMode: 'rim' | 'row';
  slots: RimSlot[];
  /** The speed line under the map (right-aligned, at most speedW wide). */
  speedH: number;
  speedW: number;
  icon: number;
  gap: number;
  /** The icon list: under the map (ring-local, right-aligned) or a screen column. */
  icons:
    | { at: 'ring'; dir: 'row' | 'column'; y: number }
    | { at: 'screen'; dir: 'column'; left: number; top: number };
  /** The mode chips row: under the icons (ring-local) or a screen corner. */
  modes: { at: 'ring'; y: number } | { at: 'screen'; left: number; top: number; maxW: number };
  /** The top of the toast stack (it's centred). */
  toastTop: number;
}

/** `n` badge slots down the circle's left rim between y0 and y1, `cols` columns if they don't fit. */
export function rimSlots(
  size: number,
  n: number,
  badgeH: number,
  y0: number,
  y1: number,
  badgeW: number,
  tuck = 8,
  gap = 2,
): RimSlot[] {
  if (n <= 0) return [];
  const r = size / 2;
  const rows = Math.max(1, Math.min(n, Math.floor((y1 - y0 + gap) / (badgeH + gap))));
  const out: RimSlot[] = [];
  for (let i = 0; i < n; i++) {
    const col = Math.floor(i / rows);
    const row = i % rows;
    const inCol = Math.min(rows, n - col * rows);
    // Spread the column's badges over the range (a lone one sits mid-range)
    const step = inCol === 1 ? 0 : (y1 - y0 - badgeH) / (inCol - 1);
    const y = inCol === 1 ? Math.max(y0, Math.min(y1 - badgeH, r - badgeH / 2)) : y0 + row * step;
    // Hug the circle: the nearer the badge's middle is to the circle's, the further left
    const dy = Math.min(r, Math.abs(y + badgeH / 2 - r));
    const x = r - Math.sqrt(r * r - dy * dy) + tuck - col * (badgeW + 4);
    out.push({ x: Math.round(x), y: Math.round(y) });
  }
  return out;
}

/** The whole HUD layout for a W×H screen with `nBadges` badges showing. */
export function hudLayout(W: number, H: number, touch: boolean, nBadges = 4): HudLayout {
  if (!touch) {
    const size = DESK_RING;
    const badgeH = 26;
    const speedH = 26;
    return {
      kind: 'desk',
      size,
      right: 16,
      top: 14,
      badgeH,
      badgeW: 190,
      badgeMode: 'rim',
      slots: rimSlots(size, nBadges, badgeH, 6, size - 6, 190),
      speedH,
      speedW: size,
      icon: 36,
      gap: 6,
      icons: { at: 'ring', dir: 'row', y: size + speedH + 4 },
      modes: { at: 'ring', y: size + speedH + 4 + 36 + 8 },
      toastTop: 44,
    };
  }
  const zone = playZone(W, H);
  if (isLandscapePhone(W, H)) {
    const strip = W - (zone.x + zone.w);
    const size = Math.min(104, Math.floor(strip) - 16);
    const top = 8;
    const badgeH = 16;
    const icon = 32;
    // The icons go down the left strip, above the board / spray row
    const side = sideColumn(W, H);
    const sideTop = Math.min(...side.map(s => H - s.bottom - s.size));
    const gap = Math.max(
      2,
      Math.min(6, Math.floor((sideTop - 8 - 8 - PHONE_ICONS * icon) / (PHONE_ICONS - 1))),
    );
    return {
      kind: 'landscape',
      size,
      right: 8,
      top,
      badgeH,
      badgeW: 96,
      badgeMode: 'row',
      // Under the tray's line, above the zone
      slots: [{ x: -4, y: Math.max(TRAY_BOTTOM - 2, Math.floor(zone.y) - badgeH - 2) - top }],
      speedH: 16,
      speedW: size,
      icon,
      gap,
      icons: { at: 'screen', dir: 'column', left: 8, top: 8 },
      modes: {
        at: 'screen',
        left: 8 + icon + 8,
        top: 8,
        maxW: W / 2 - TRAY_HALF - (8 + icon + 8) - 6,
      },
      toastTop: Math.round(zone.y) + 4,
    };
  }
  // Portrait: the band above the play zone (the site tray is a small chip
  // at the top centre, clear of the right corner)
  const top = 8;
  const size = Math.min(112, Math.floor(zone.y) - top - 6);
  const badgeH = 18;
  const badgeW = 124;
  const speedH = 16;
  const icon = 34;
  const iconsTop = top + size + speedH + 4;
  const padTop = Math.min(...thumbPad(W, H).map(b => H - b.bottom - b.size));
  // Fit every icon in the right strip: shrink the gaps first
  const gap = Math.max(
    2,
    Math.min(6, Math.floor((padTop - 10 - iconsTop - PHONE_ICONS * icon) / (PHONE_ICONS - 1))),
  );
  return {
    kind: 'portrait',
    size,
    right: 6,
    top,
    badgeH,
    badgeW,
    badgeMode: 'rim',
    slots: rimSlots(size, nBadges, badgeH, TRAY_BOTTOM - top, Math.floor(zone.y) - top - 2, badgeW),
    speedH,
    // In the right strip only: the map's bottom is the zone's top
    speedW: Math.floor(W - (zone.x + zone.w)) - 6 - 2,
    icon,
    gap,
    icons: { at: 'ring', dir: 'column', y: size + speedH + 4 },
    modes: { at: 'screen', left: 8, top: 8, maxW: W / 2 - TRAY_HALF - 8 - 6 },
    toastTop: Math.round(zone.y) + 6,
  };
}

/** Screen rects of the map, `nBadges` badges and `nIcons` utility icons, for the tests. */
export function hudRects(
  W: number,
  H: number,
  touch: boolean,
  nIcons: number,
  nBadges = 4,
): { id: string; r: Rect }[] {
  const L = hudLayout(W, H, touch, nBadges);
  const x0 = W - L.right - L.size;
  const out: { id: string; r: Rect }[] = [
    { id: 'map', r: { x: x0, y: L.top, w: L.size, h: L.size } },
    {
      id: 'speed',
      r: { x: W - L.right - L.speedW, y: L.top + L.size, w: L.speedW, h: L.speedH },
    },
  ];
  if (L.badgeMode === 'rim') {
    L.slots.forEach((s, i) =>
      out.push({
        id: `badge${i}`,
        r: { x: x0 + s.x - L.badgeW, y: L.top + s.y, w: L.badgeW, h: L.badgeH },
      }),
    );
  } else {
    const s = L.slots[0]!;
    for (let i = 0; i < nBadges; i++)
      out.push({
        id: `badge${i}`,
        r: {
          x: x0 + s.x - (i + 1) * L.badgeW - i * 4,
          y: L.top + s.y,
          w: L.badgeW,
          h: L.badgeH,
        },
      });
  }
  for (let i = 0; i < nIcons; i++) {
    const k = i * (L.icon + L.gap);
    let r: Rect;
    if (L.icons.at === 'screen') r = { x: L.icons.left, y: L.icons.top + k, w: L.icon, h: L.icon };
    else if (L.icons.dir === 'column')
      r = { x: W - L.right - L.icon, y: L.top + L.icons.y + k, w: L.icon, h: L.icon };
    else r = { x: W - L.right - L.icon - k, y: L.top + L.icons.y, w: L.icon, h: L.icon };
    out.push({ id: `icon${i}`, r });
  }
  return out;
}

/** 12,791,501 → "12.8M": big numbers in a badge stay short. */
export function compactNum(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  const fmt = (v: number, unit: string) => {
    const s = v >= 100 ? Math.round(v).toString() : v.toFixed(1).replace(/\.0$/, '');
    return sign + s + unit;
  };
  if (a >= 999_500_000) return fmt(a / 1e9, 'B');
  if (a >= 999_500) return fmt(a / 1e6, 'M');
  if (a >= 10_000) return fmt(a / 1e3, 'K');
  return sign + Math.round(a).toLocaleString('en-US');
}
