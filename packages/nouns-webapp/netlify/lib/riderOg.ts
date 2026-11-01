// ── A Noun World rider as a share card PNG (pure) ──────────────────────────
//
// /world?seed=<key> unfurls with this: the rider on a skateboard on its own
// background, "PLAY AS ME" big, and the link. Two sizes: 1200 × 630 (og /
// twitter) and 1200 × 800 (the Farcaster embed is 3:2). Same approach as
// nounOg.ts: the 32 × 32 Noun painted in whole pixels, text from a built-in
// 5 × 7 pixel font, encoded with node's zlib. No image libraries, no fonts.
//
// A missingnoun rider is only its head and noggles (V2 head 252), drawn with
// the in-game glitch frozen: red / cyan ghosts either side and one band of
// rows torn sideways (character/missingNoun.ts).

import { encodePng, type NounGrid } from './nounOg';

type RGB = [number, number, number];

export const INK: RGB = [0x0b, 0x0b, 0x12];
export const YELLOW: RGB = [0xff, 0xd4, 0x00];
const PINK: RGB = [0xff, 0x2f, 0x8e];
const CYAN: RGB = [0x20, 0xd6, 0xff];
const WHITE: RGB = [0xff, 0xff, 0xff];
const DECK: RGB = [0xff, 0x2f, 0x8e];
const WHEEL: RGB = [0xf4, 0xf1, 0xe6];

// 5 × 7 glyphs, one string per row, '#' = ink.
const GLYPHS: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  '-': ['.....', '.....', '.....', '.###.', '.....', '.....', '.....'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  "'": ['..#..', '..#..', '.#...', '.....', '.....', '.....', '.....'],
  _: ['.....', '.....', '.....', '.....', '.....', '.....', '#####'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  '>': ['#....', '##...', '###..', '####.', '###..', '##...', '#....'],
};

/** Text the pixel font can draw: upper case, unknown characters dropped. */
export function fontText(s: string): string {
  return [...s.toUpperCase()].filter(c => GLYPHS[c] !== undefined).join('');
}

/** Width in screen pixels of `s` at `scale` (5 wide + 1 gap per glyph, no trailing gap). */
export function textWidth(s: string, scale: number): number {
  const n = fontText(s).length;
  return n === 0 ? 0 : (n * 6 - 1) * scale;
}

class Canvas {
  readonly rgb: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
    bg: RGB,
  ) {
    this.rgb = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) this.rgb.set(bg, i * 3);
  }
  rect(x: number, y: number, w: number, h: number, c: RGB) {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w));
    const y1 = Math.min(this.h, Math.round(y + h));
    for (let j = y0; j < y1; j++)
      for (let i = x0; i < x1; i++) this.rgb.set(c, (j * this.w + i) * 3);
  }
  text(s: string, x: number, y: number, scale: number, c: RGB) {
    let cx = x;
    for (const ch of fontText(s)) {
      const g = GLYPHS[ch]!;
      for (let j = 0; j < 7; j++)
        for (let i = 0; i < 5; i++)
          if (g[j]![i] === '#') this.rect(cx + i * scale, y + j * scale, scale, scale, c);
      cx += 6 * scale;
    }
  }
}

export interface RiderCardOpts {
  width: number;
  height: number;
  /** The rider's name (drawn above the headline when it fits the font). */
  name?: string;
  missingnoun?: boolean;
  /** The two big lines (default PLAY / AS ME) and the small line above them (default the name, else NOUN WORLD). */
  headline?: [string, string];
  kicker?: string;
}

/** The two card sizes. */
export const CARD_SIZES = {
  og: { width: 1200, height: 630 },
  fc: { width: 1200, height: 800 },
} as const;

/** Where the Noun sits on a card of this size: scale and top-left, and the board's top. */
export function riderLayout(width: number, height: number) {
  // The Noun stands on a board 2 Noun pixels thick with wheels below it
  const scale = Math.floor((height - 110) / 34);
  const size = 32 * scale;
  const x = Math.round(width * 0.04);
  const boardTop = height - 70 - 3 * scale;
  const y = boardTop - size;
  return { scale, size, x, y, boardTop };
}

/** The share card for a rider: its Noun on a board, PLAY AS ME, the link. */
export function renderRiderCard(grid: NounGrid, opts: RiderCardOpts): Buffer {
  const { width: W, height: H } = opts;
  const cv = new Canvas(W, H, grid.bg);
  const L = riderLayout(W, H);
  const s = L.scale;

  // The board: a pink deck with kicked-up ends and two wheels
  const deckX = L.x + 3 * s;
  const deckW = 26 * s;
  // its shadow on the ground, the background a shade darker
  const shade = grid.bg.map(v => Math.round(v * 0.82)) as RGB;
  cv.rect(L.x + 4 * s, L.boardTop + 4 * s, deckW - 2 * s, s, shade);
  cv.rect(deckX, L.boardTop, deckW, s, INK);
  cv.rect(deckX + s, L.boardTop - s, deckW - 2 * s, s, DECK);
  cv.rect(deckX, L.boardTop - 2 * s, s, s, DECK);
  cv.rect(deckX + deckW - s, L.boardTop - 2 * s, s, s, DECK);
  for (const wx of [deckX + 4 * s, deckX + deckW - 7 * s]) {
    cv.rect(wx, L.boardTop + s, 3 * s, 2 * s, INK);
    cv.rect(wx + s * 0.5, L.boardTop + s * 1.25, 2 * s, 1.5 * s, WHEEL);
  }

  // The Noun (a missingnoun floats its head over the board)
  const lift = opts.missingnoun === true ? -2 * s : 0;
  const paint = (dx: number, c: RGB | null, rows?: [number, number], rowDx = 0) => {
    for (let j = 0; j < 32; j++) {
      const inBand = rows !== undefined && j >= rows[0] && j < rows[1];
      for (let i = 0; i < 32; i++) {
        const px = grid.px[j * 32 + i];
        if (px == null) continue;
        cv.rect(L.x + i * s + dx + (inBand ? rowDx : 0), L.y + lift + j * s, s, s, c ?? px);
      }
    }
  };
  if (opts.missingnoun === true) {
    paint(-Math.round(s * 0.8), CYAN);
    paint(Math.round(s * 0.8), PINK);
    paint(0, null, [9, 12], Math.round(s * 1.6));
  } else {
    paint(0, null);
  }

  // Right column: name, PLAY / AS ME, the link button
  const colX = L.x + L.size + Math.round(W * 0.03);
  const colW = W - colX - Math.round(W * 0.04);
  const [l1, l2] = opts.headline ?? ['PLAY', 'AS ME'];
  const longest = Math.max(fontText(l1).length, fontText(l2).length, 5);
  const big = Math.min(Math.floor(colW / (longest * 6 - 1)), Math.floor(H / 48));
  const small = Math.max(4, Math.floor(big / 2.6));
  const gapY = Math.round(H * 0.035);
  const name = fontText(opts.name ?? '').trim();
  const top = opts.kicker ?? (name.length > 0 ? name : 'NOUN WORLD');
  let topScale = small;
  while (topScale > 3 && textWidth(top, topScale) > colW) topScale--;
  const blockH = 7 * topScale + gapY + 7 * big * 2 + big * 3 + gapY * 2 + 7 * small + 4 * small;
  let y = Math.max(Math.round(H * 0.08), Math.round((H - blockH) / 2) - Math.round(H * 0.03));
  cv.text(top, colX, y, topScale, INK);
  y += 7 * topScale + gapY;
  cv.text(l1, colX + big * 0.5, y + big * 0.5, big, WHITE);
  cv.text(l1, colX, y, big, INK);
  y += 7 * big + big * 3;
  cv.text(l2, colX + big * 0.5, y + big * 0.5, big, WHITE);
  cv.text(l2, colX, y, big, INK);
  y += 7 * big + gapY * 2;

  // The button: yellow, ink outline, hard shadow
  const label = '> NOUN.WTF/WORLD';
  let ls = small;
  while (ls > 3 && textWidth(label, ls) + 8 * ls > colW) ls--;
  const bw = textWidth(label, ls) + 8 * ls;
  const bh = 7 * ls + 6 * ls;
  const o = Math.max(4, Math.round(ls * 0.9));
  cv.rect(colX + o, y + o, bw, bh, INK);
  cv.rect(colX, y, bw, bh, INK);
  cv.rect(colX + o * 0.6, y + o * 0.6, bw - o * 1.2, bh - o * 1.2, YELLOW);
  cv.text(label, colX + 4 * ls, y + 3 * ls, ls, INK);
  y += bh + gapY;
  const tag = 'NO DOWNLOAD. RUNS IN YOUR BROWSER.';
  let ts = Math.max(3, Math.floor(ls * 0.6));
  while (ts > 2 && textWidth(tag, ts) > colW) ts--;
  if (y + 7 * ts < H - 10) cv.text(tag, colX, y, ts, INK);

  return encodePng(cv.rgb, W, H);
}

/**
 * A square of the canonical noggles (the Noun's glasses rows only, cropped
 * to their bounding box) centred on `bg`: the mini app icon and splash.
 */
export function renderNogglesSquare(glasses: NounGrid, size: number, bg: RGB = YELLOW): Buffer {
  const cv = new Canvas(size, size, bg);
  let x0 = 32;
  let y0 = 32;
  let x1 = -1;
  let y1 = -1;
  for (let j = 0; j < 32; j++)
    for (let i = 0; i < 32; i++)
      if (glasses.px[j * 32 + i] != null) {
        x0 = Math.min(x0, i);
        y0 = Math.min(y0, j);
        x1 = Math.max(x1, i);
        y1 = Math.max(y1, j);
      }
  if (x1 < 0) return encodePng(cv.rgb, size, size);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const s = Math.floor((size * 0.8) / w);
  const ox = Math.round((size - w * s) / 2);
  const oy = Math.round((size - h * s) / 2);
  for (let j = y0; j <= y1; j++)
    for (let i = x0; i <= x1; i++) {
      const c = glasses.px[j * 32 + i];
      if (c != null) cv.rect(ox + (i - x0) * s, oy + (j - y0) * s, s, s, c);
    }
  return encodePng(cv.rgb, size, size);
}
