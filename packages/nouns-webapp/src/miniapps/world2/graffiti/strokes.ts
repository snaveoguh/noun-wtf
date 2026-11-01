// ── Graffiti wire format ────────────────────────────────────────────────
//
// Pure (no three.js, no DOM) so the Netlify function can validate with the
// exact code the game encodes with. Every tag is a string, stored and synced
// as-is through PartyKit (`world:graffiti:save`) and `world-graffiti`.
//
// Three kinds of tag, told apart by prefix:
//
//   g2:<base64>   legacy spray dabs, 5 bytes each (u12 v12 r8 c4 + 4 spare),
//                 `c` indexes LEGACY_COLORS. Still decoded and drawn; the
//                 game no longer writes it.
//   g3:<base64>   strokes. Byte 0 = format version (1), bytes 1–6 = tag id
//                 (48-bit hash of the author's private nonce), then strokes:
//                   rgb 3 bytes | radius byte (×2 mm) | flags byte
//                   (bits 0–3 opacity (n+1)/16, bit 4 hard cap) |
//                   varint point count | first point u16 u16 (mm + 1000) |
//                   then zigzag-varint deltas (mm)
//                 A point count written as an overlong varint (a
//                 redundant 0x00 continuation byte, which every decoder
//                 has always accepted) marks a stroke that CONTINUES the
//                 one before it: a pressure stroke goes out as runs of
//                 constant radius, one stroke each. Old clients draw the
//                 runs as they are (stepped width); new ones join them into
//                 one stroke whose width tapers smoothly (mural/runs.ts).
//                 Never on a tag's first stroke.
//                 Points are millimetres in the wall cell's own frame
//                 (u across, v up), allowed a metre past each edge so a
//                 stroke crossing into the next cell joins up seamlessly.
//   g3r:<nonce>:<i.j.k>
//                 undo: hides strokes i, j, k of the g3 tag whose id is
//                 hash48(nonce). Only the author knows the nonce, so only
//                 they can take their strokes down.

export const LEGACY_COLORS = [
  '#ffffff',
  '#0b0b0b',
  '#d22209',
  '#ffd400',
  '#3ddc84',
  '#2b83f6',
  '#ff5fa2',
  '#8f5bff',
  '#ff8a00',
  '#00e5ff',
  '#a3ff12',
  '#8b5a2b',
  '#c0c0c0',
  '#ff2d2d',
  '#1e3a8a',
  '#f5e6c8',
] as const;

/** Wall cell size in millimetres (6 m × 3 m). */
export const CELL_W_MM = 6000;
export const CELL_H_MM = 3000;
/** How far past a cell edge a point may sit (bridges strokes across cells). */
export const EDGE_MM = 1000;

export const MIN_RADIUS_MM = 2;
export const MAX_RADIUS_MM = 400;
export const MAX_POINTS = 400;
export const MAX_STROKES = 48;
export const MAX_REMOVALS = 64;
/** Encoded tag ceiling (≈ the old 900-dab tag), keeps PartyKit frames small. */
export const MAX_TAG_CHARS = 8200;
/** Client sends a wall's pending strokes early once their tag passes this. */
export const SOFT_TAG_CHARS = 6000;
const VERSION = 1;

export interface Dab {
  u: number; // 0..1 across the cell
  v: number; // 0..1 up the cell (0 = bottom)
  r: number; // radius as a fraction of cell height
  c: number; // LEGACY_COLORS index
}

export interface Stroke {
  /** 0xRRGGBB */
  color: number;
  /** Nozzle radius in mm (stored in 2 mm steps). */
  r: number;
  hard: boolean;
  /** 1..16 → opacity n/16. */
  opacity: number;
  /** Flat [u0, v0, u1, v1, …] in whole mm, cell-local. */
  pts: number[];
  /**
   * Continues the stroke before it in the same tag (a pressure stroke's
   * next run of radius). Wire: an overlong point-count varint. Optional:
   * absent = an ordinary stroke.
   */
  join?: boolean;
}

export interface StrokeTag {
  /** 12 hex chars = hash48(nonce). */
  id: string;
  strokes: Stroke[];
}

export interface Removal {
  nonce: string;
  id: string;
  indices: number[];
}

export type DecodedTag =
  | { kind: 'dabs'; dabs: Dab[] }
  | { kind: 'strokes'; tag: StrokeTag }
  | { kind: 'remove'; removal: Removal };

// ── base64 (btoa/atob exist in browsers and Node 16+) ───────────────────

function toB64(bytes: Uint8Array) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromB64(s: string): Uint8Array | null {
  if (!/^[\d+/A-Za-z]*=*$/.test(s)) return null;
  let bin: string;
  try {
    bin = atob(s);
  } catch {
    return null;
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// ── Legacy g2 dabs ───────────────────────────────────────────────────────

export function encodeDabs(dabs: Dab[]): string {
  const bytes = new Uint8Array(dabs.length * 5);
  dabs.forEach((d, i) => {
    const u = Math.round(clamp01(d.u) * 4095);
    const v = Math.round(clamp01(d.v) * 4095);
    const r = Math.round(clamp01(d.r / 0.25) * 255);
    const o = i * 5;
    bytes[o] = u >> 4;
    bytes[o + 1] = ((u & 15) << 4) | (v >> 8);
    bytes[o + 2] = v & 255;
    bytes[o + 3] = r;
    bytes[o + 4] = (d.c & 15) << 4;
  });
  return 'g2:' + toB64(bytes);
}

export function decodeDabs(s: string): Dab[] | null {
  if (!s.startsWith('g2:')) return null;
  const b = fromB64(s.slice(3));
  if (b === null) return null;
  const out: Dab[] = [];
  for (let o = 0; o + 4 < b.length; o += 5) {
    out.push({
      u: ((b[o] << 4) | (b[o + 1] >> 4)) / 4095,
      v: (((b[o + 1] & 15) << 8) | b[o + 2]) / 4095,
      r: (b[o + 3] / 255) * 0.25,
      c: b[o + 4] >> 4,
    });
  }
  return out;
}

// ── Hashing ──────────────────────────────────────────────────────────────

/** 48-bit string hash (cyrb53, low 48 bits) as 12 hex chars. */
export function hash48(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hi = (h2 >>> 0) & 0xffff;
  const lo = h1 >>> 0;
  return hi.toString(16).padStart(4, '0') + lo.toString(16).padStart(8, '0');
}

/** A fresh private nonce for a tag (16 hex chars). */
export function newNonce(): string {
  const b = new Uint8Array(8);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 8; i++) b[i] = Math.floor(Math.random() * 256);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

// ── g3 strokes ───────────────────────────────────────────────────────────

class Writer {
  buf = new Uint8Array(256);
  n = 0;
  byte(x: number) {
    if (this.n >= this.buf.length) {
      const nb = new Uint8Array(this.buf.length * 2);
      nb.set(this.buf);
      this.buf = nb;
    }
    this.buf[this.n++] = x & 255;
  }
  u16(x: number) {
    this.byte(x >> 8);
    this.byte(x);
  }
  varint(x: number) {
    while (x >= 0x80) {
      this.byte((x & 0x7f) | 0x80);
      x >>>= 7;
    }
    this.byte(x);
  }
  /** The same value with one redundant continuation byte (decodes identically). */
  varintLong(x: number) {
    while (x >= 0x80) {
      this.byte((x & 0x7f) | 0x80);
      x >>>= 7;
    }
    this.byte(x | 0x80);
    this.byte(0);
  }
  bytes() {
    return this.buf.slice(0, this.n);
  }
}

class Reader {
  o = 0;
  constructor(private b: Uint8Array) {}
  get left() {
    return this.b.length - this.o;
  }
  byte() {
    if (this.o >= this.b.length) throw new Error('eof');
    return this.b[this.o++];
  }
  u16() {
    return (this.byte() << 8) | this.byte();
  }
  /** Set by varint(): the last one carried a redundant trailing 0x00. */
  overlong = false;
  varint() {
    let x = 0;
    let shift = 0;
    for (let n = 1; ; n++) {
      const b = this.byte();
      x |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) {
        this.overlong = n > 1 && b === 0;
        return x >>> 0;
      }
      shift += 7;
      if (shift > 21) throw new Error('varint');
    }
  }
}

const zz = (d: number) => (d << 1) ^ (d >> 31);
const unzz = (x: number) => (x >>> 1) ^ -(x & 1);

const clampU = (x: number) => Math.max(-EDGE_MM, Math.min(CELL_W_MM + EDGE_MM, Math.round(x)));
const clampV = (x: number) => Math.max(-EDGE_MM, Math.min(CELL_H_MM + EDGE_MM, Math.round(x)));

/** Radius as stored: 2 mm steps, clamped to the allowed range. */
export function quantRadius(r: number) {
  const q = Math.round(r / 2) * 2;
  return Math.max(MIN_RADIUS_MM, Math.min(MAX_RADIUS_MM, q));
}

function writeStroke(w: Writer, s: Stroke, first: boolean) {
  const n = Math.min(MAX_POINTS, Math.floor(s.pts.length / 2));
  w.byte(s.color >> 16);
  w.byte(s.color >> 8);
  w.byte(s.color);
  w.byte(quantRadius(s.r) / 2);
  const op = Math.max(1, Math.min(16, Math.round(s.opacity))) - 1;
  w.byte(op | (s.hard ? 16 : 0));
  if (s.join === true && !first) w.varintLong(n);
  else w.varint(n);
  let pu = clampU(s.pts[0]);
  let pv = clampV(s.pts[1]);
  w.u16(pu + EDGE_MM);
  w.u16(pv + EDGE_MM);
  for (let i = 1; i < n; i++) {
    const u = clampU(s.pts[i * 2]);
    const v = clampV(s.pts[i * 2 + 1]);
    w.varint(zz(u - pu));
    w.varint(zz(v - pv));
    pu = u;
    pv = v;
  }
}

export function encodeStrokes(tag: StrokeTag): string {
  const w = new Writer();
  w.byte(VERSION);
  for (let i = 0; i < 6; i++) w.byte(parseInt(tag.id.slice(i * 2, i * 2 + 2), 16) || 0);
  let first = true;
  for (const s of tag.strokes.slice(0, MAX_STROKES))
    if (s.pts.length >= 2) {
      writeStroke(w, s, first);
      first = false;
    }
  return 'g3:' + toB64(w.bytes());
}

export function decodeStrokes(s: string): StrokeTag | null {
  if (!s.startsWith('g3:') || s.length > MAX_TAG_CHARS) return null;
  const b = fromB64(s.slice(3));
  if (b === null || b.length < 7) return null;
  const r = new Reader(b);
  try {
    if (r.byte() !== VERSION) return null;
    let id = '';
    for (let i = 0; i < 6; i++) id += r.byte().toString(16).padStart(2, '0');
    const strokes: Stroke[] = [];
    while (r.left > 0) {
      if (strokes.length >= MAX_STROKES) return null;
      const color = (r.byte() << 16) | (r.byte() << 8) | r.byte();
      const rad = r.byte() * 2;
      if (rad < MIN_RADIUS_MM || rad > MAX_RADIUS_MM) return null;
      const flags = r.byte();
      if (flags & 0xe0) return null;
      const n = r.varint();
      const join = r.overlong && strokes.length > 0;
      if (n < 1 || n > MAX_POINTS) return null;
      let u = r.u16() - EDGE_MM;
      let v = r.u16() - EDGE_MM;
      const pts = [u, v];
      for (let i = 1; i < n; i++) {
        u += unzz(r.varint());
        v += unzz(r.varint());
        pts.push(u, v);
      }
      for (let i = 0; i < pts.length; i += 2) {
        if (pts[i] < -EDGE_MM || pts[i] > CELL_W_MM + EDGE_MM) return null;
        if (pts[i + 1] < -EDGE_MM || pts[i + 1] > CELL_H_MM + EDGE_MM) return null;
      }
      const st: Stroke = {
        color,
        r: rad,
        hard: (flags & 16) !== 0,
        opacity: (flags & 15) + 1,
        pts,
      };
      if (join) st.join = true;
      strokes.push(st);
    }
    if (strokes.length === 0) return null;
    return { id, strokes };
  } catch {
    return null;
  }
}

// ── g3r removals ─────────────────────────────────────────────────────────

export function encodeRemoval(nonce: string, indices: number[]): string {
  const uniq = [...new Set(indices)].sort((a, b) => a - b).slice(0, MAX_REMOVALS);
  return `g3r:${nonce}:${uniq.join('.')}`;
}

const REMOVAL_RE = /^g3r:([\da-f]{16}):(\d{1,2}(?:\.\d{1,2}){0,63})$/;

export function decodeRemoval(s: string): Removal | null {
  const m = REMOVAL_RE.exec(s);
  if (m === null) return null;
  const indices = m[2].split('.').map(Number);
  if (indices.some(i => i >= MAX_STROKES)) return null;
  return { nonce: m[1], id: hash48(m[1]), indices };
}

export function decodeTag(s: unknown): DecodedTag | null {
  if (typeof s !== 'string') return null;
  if (s.startsWith('g3r:')) {
    const removal = decodeRemoval(s);
    return removal === null ? null : { kind: 'remove', removal };
  }
  if (s.startsWith('g3:')) {
    const tag = decodeStrokes(s);
    return tag === null ? null : { kind: 'strokes', tag };
  }
  if (s.startsWith('g2:')) {
    if (s.length > 6100) return null;
    const dabs = decodeDabs(s);
    return dabs === null || dabs.length === 0 ? null : { kind: 'dabs', dabs };
  }
  return null;
}

/** Server-side gate: is this a well-formed tag within every limit? */
export function validTag(s: unknown): boolean {
  return typeof s === 'string' && s.length <= MAX_TAG_CHARS && decodeTag(s) !== null;
}

// ── Simplification ───────────────────────────────────────────────────────

/**
 * Ramer–Douglas–Peucker on a flat [x0, y0, x1, y1, …] polyline: drop
 * points closer than `eps` to the line through their neighbours.
 */
export function simplify(pts: number[], eps: number): number[] {
  const n = pts.length / 2;
  if (n <= 2) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const eps2 = eps * eps;
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const ax = pts[a * 2];
    const ay = pts[a * 2 + 1];
    const dx = pts[b * 2] - ax;
    const dy = pts[b * 2 + 1] - ay;
    const len2 = dx * dx + dy * dy;
    let best = -1;
    let bestD = eps2;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i * 2] - ax;
      const py = pts[i * 2 + 1] - ay;
      let d2: number;
      if (len2 === 0) d2 = px * px + py * py;
      else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const ex = px - t * dx;
        const ey = py - t * dy;
        d2 = ex * ex + ey * ey;
      }
      if (d2 > bestD) {
        bestD = d2;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  return out;
}

/** Simplification tolerance for a nozzle: finer tips keep finer detail. */
export const simplifyEps = (r: number) => Math.max(1, r * 0.1);

// ── Colours ──────────────────────────────────────────────────────────────

export function hexToInt(hex: string): number | null {
  const m = /^#?([\da-f]{6})$/i.exec(hex.trim());
  return m === null ? null : parseInt(m[1], 16);
}

export const intToHex = (c: number) => '#' + (c & 0xffffff).toString(16).padStart(6, '0');
