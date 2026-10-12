// ── Custom deck designs: the JSON schema, shared by the game and the
// `world-decks` Netlify function (no DOM, no imports) ──
//
// A design is a pixel grid the player paints plus Nouns trait stickers kept
// as references, so a full deck stays a few KB:
//
//   {
//     v: 1,
//     name: 'MY DECK',               ≤ 20 chars
//     bg: ['#rrggbb'] | ['#top', '#bottom'],   solid or nose→tail gradient
//     pal: ['#rrggbb', …],           ≤ 255 colours for the pixel layer
//     px: '<base64>',                RLE of DECK_W × DECK_H palette indices
//                                    (0 = clear, i = pal[i - 1]); '' = blank
//     decals: [{ k, i, x, y, s, r, f? }, …]   ≤ 32, bottom → top
//     grip: '#rrggbb',
//   }
//
// Row 0 is the nose, column 0 the rider's left looking at the underside.
// RLE: byte pairs [run − 1, index], runs of 1…256, rows concatenated.

export const DECK_W = 48;
/** 48 × 184 keeps the pixels square on the 0.21 m × 0.81 m deck. */
export const DECK_H = 184;
export const DECK_SLOTS = 3;
export const MAX_DECALS = 32;
export const MAX_PAL = 255;
/** Worst case RLE (every pixel its own run) is 2 bytes a pixel, base64'd. */
export const MAX_PX = Math.ceil((DECK_W * DECK_H * 2) / 3) * 4;
/** Serialised design cap (worst case pixel layer + full palette + decals). */
export const MAX_DESIGN_BYTES = 32_000;

export type DecalKind = 'head' | 'glasses' | 'body' | 'accessory';
export const DECAL_KINDS: DecalKind[] = ['head', 'glasses', 'body', 'accessory'];

export interface DeckDecal {
  /** Trait layer and index into nouns-assets ImageData. */
  k: DecalKind;
  i: number;
  /** Top-left of the (trimmed, rotated, scaled) sticker in deck pixels. */
  x: number;
  y: number;
  /** Integer pixel scale 1…4. */
  s: number;
  /** Quarter turns clockwise 0…3. */
  r: number;
  /** Mirror left/right (before rotating). */
  f?: number;
}

export interface DeckDesign {
  v: 1;
  name: string;
  bg: string[];
  pal: string[];
  px: string;
  decals: DeckDecal[];
  grip: string;
}

export interface DeckSlot {
  d: DeckDesign;
  /** Saved at (ms): newest copy wins between this browser and the server. */
  at: number;
}

const HEX = /^#[\da-f]{6}$/;
const isInt = (n: unknown, lo: number, hi: number): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi;

// ── base64 (same output in browsers and Node, no btoa/Buffer) ──

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INV: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) B64_INV[B64[i]] = i;

export function toB64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return out;
}

export function fromB64(s: string): Uint8Array | null {
  if (s.length % 4 !== 0 || !/^[\d+/A-Za-z]*={0,2}$/.test(s)) return null;
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((s.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const n =
      (B64_INV[s[i]] << 18) |
      (B64_INV[s[i + 1]] << 12) |
      ((B64_INV[s[i + 2]] ?? 0) << 6) |
      (B64_INV[s[i + 3]] ?? 0);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

// ── Pixel layer RLE ──

export function encodePixels(idx: Uint8Array): string {
  if (idx.every(v => v === 0)) return '';
  const bytes: number[] = [];
  let i = 0;
  while (i < idx.length) {
    const v = idx[i];
    let run = 1;
    while (run < 256 && i + run < idx.length && idx[i + run] === v) run++;
    bytes.push(run - 1, v);
    i += run;
  }
  return toB64(Uint8Array.from(bytes));
}

/** Palette indices, or null when the data is malformed / the wrong size. */
export function decodePixels(px: string, palSize = MAX_PAL): Uint8Array | null {
  const out = new Uint8Array(DECK_W * DECK_H);
  if (px === '') return out;
  const bytes = fromB64(px);
  if (bytes === null || bytes.length % 2 !== 0) return null;
  let o = 0;
  for (let i = 0; i < bytes.length; i += 2) {
    const run = bytes[i] + 1;
    const v = bytes[i + 1];
    if (v > palSize || o + run > out.length) return null;
    out.fill(v, o, o + run);
    o += run;
  }
  return o === out.length ? out : null;
}

// ── Validation ──

/** A clean copy of a design, or a reason it's rejected. */
export function validateDesign(
  x: unknown,
): { ok: true; design: DeckDesign } | { ok: false; error: string } {
  if (typeof x !== 'object' || x === null || Array.isArray(x))
    return { ok: false, error: 'not an object' };
  const d = x as Record<string, unknown>;
  if (d.v !== 1) return { ok: false, error: 'bad version' };
  if (
    typeof d.name !== 'string' ||
    d.name.length > 20 ||
    /[<>]/.test(d.name) ||
    [...d.name].some(ch => ch.charCodeAt(0) < 32)
  )
    return { ok: false, error: 'bad name' };
  const bg = d.bg;
  if (
    !Array.isArray(bg) ||
    bg.length < 1 ||
    bg.length > 2 ||
    !bg.every(c => typeof c === 'string' && HEX.test(c))
  )
    return { ok: false, error: 'bad bg' };
  const pal = d.pal;
  if (
    !Array.isArray(pal) ||
    pal.length > MAX_PAL ||
    !pal.every(c => typeof c === 'string' && HEX.test(c))
  )
    return { ok: false, error: 'bad palette' };
  if (typeof d.px !== 'string' || d.px.length > MAX_PX || decodePixels(d.px, pal.length) === null)
    return { ok: false, error: 'bad pixels' };
  if (typeof d.grip !== 'string' || !HEX.test(d.grip)) return { ok: false, error: 'bad grip' };
  const decals = d.decals;
  if (!Array.isArray(decals) || decals.length > MAX_DECALS)
    return { ok: false, error: 'bad decals' };
  const clean: DeckDecal[] = [];
  for (const raw of decals) {
    if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'bad decal' };
    const e = raw as Record<string, unknown>;
    if (
      !DECAL_KINDS.includes(e.k as DecalKind) ||
      !isInt(e.i, 0, 9999) ||
      !isInt(e.x, -160, DECK_W + 160) ||
      !isInt(e.y, -160, DECK_H + 160) ||
      !isInt(e.s, 1, 4) ||
      !isInt(e.r, 0, 3) ||
      (e.f !== undefined && !isInt(e.f, 0, 1))
    )
      return { ok: false, error: 'bad decal' };
    const c: DeckDecal = { k: e.k as DecalKind, i: e.i, x: e.x, y: e.y, s: e.s, r: e.r };
    if (e.f === 1) c.f = 1;
    clean.push(c);
  }
  const design: DeckDesign = {
    v: 1,
    name: d.name,
    bg: bg as string[],
    pal: pal as string[],
    px: d.px,
    decals: clean,
    grip: d.grip,
  };
  if (JSON.stringify(design).length > MAX_DESIGN_BYTES) return { ok: false, error: 'too big' };
  return { ok: true, design };
}

/** The exact text a wallet signs to save a design. */
export function deckMessage(address: string, designHash: string, timestamp: number) {
  return `Noun World deck · ${address.toLowerCase()} · ${designHash} · ${timestamp}`;
}

/** `address:slot:savedAt`, the deck a rider shares over the network. */
export const SHARE_RE = /^(0x[\da-f]{40}):([0-2]):(\d{1,15})$/;
