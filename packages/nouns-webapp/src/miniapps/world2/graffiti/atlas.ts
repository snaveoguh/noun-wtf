// ── Far walls in shared atlas pages (pure: no three.js, no DOM) ─────────
//
// The plaza has ~2,500 painted cells. Drawn one mesh each, every far cell in
// view was its own draw call (~500 of a phone's ~840 at the plaza) and its
// own texture. On phones ('low') the far cells are tiles in a few big
// textures instead, one merged quad mesh per page: a handful of draws.
// Tiles are power-of-two sized and aligned, so a page's mip levels stay
// inside each tile until the tile is a pixel or two.

export interface AtlasLayout {
  /** Tile width in px (height is half: cells are 6 m × 3 m). */
  tileW: number;
  /** Page edge in px (square, power of two). */
  pageW: number;
}

export interface Slot {
  page: number;
  /** Index inside the page (its quad in the page's mesh). */
  index: number;
  /** Top-left corner in page pixels (canvas space: y down). */
  x: number;
  y: number;
}

export function tilesPerPage(l: AtlasLayout): number {
  const th = l.tileW / 2;
  return Math.floor(l.pageW / l.tileW) * Math.floor(l.pageW / th);
}

/** Where slot number `n` (0, 1, 2… in allocation order) lives. */
export function slotAt(n: number, l: AtlasLayout): Slot {
  const per = tilesPerPage(l);
  const page = Math.floor(n / per);
  const index = n - page * per;
  const cols = Math.floor(l.pageW / l.tileW);
  return { page, index, x: (index % cols) * l.tileW, y: Math.floor(index / cols) * (l.tileW / 2) };
}

/**
 * The tile's UVs for a texture uploaded with flipY (v = 1 is the canvas's
 * top row): [u0, v0, u1, v1], v0 the cell's bottom edge, v1 its top.
 */
export function slotUv(s: Slot, l: AtlasLayout): [number, number, number, number] {
  const th = l.tileW / 2;
  return [s.x / l.pageW, 1 - (s.y + th) / l.pageW, (s.x + l.tileW) / l.pageW, 1 - s.y / l.pageW];
}

/**
 * GL row (from the bottom) a tile's sub-upload starts at, for a flipY
 * texture: the canvas's top row lands on the texture's top row.
 */
export function slotGlY(s: Slot, l: AtlasLayout): number {
  return l.pageW - s.y - l.tileW / 2;
}

type V3 = { x: number; y: number; z: number };

/**
 * A cell's quad: corners origin, +u·w, +u·w+v·h, +v·h, lifted `lift` off the
 * wall along n (the same placement as a cell's own PlaneGeometry mesh).
 * Writes 12 floats at `pos[o..]`.
 */
export function writeQuad(
  pos: Float32Array,
  o: number,
  origin: V3,
  u: V3,
  v: V3,
  n: V3,
  w: number,
  h: number,
  lift: number,
) {
  const corners: [number, number][] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  for (let i = 0; i < 4; i++) {
    const [a, b] = corners[i];
    pos[o + i * 3] = origin.x + u.x * a + v.x * b + n.x * lift;
    pos[o + i * 3 + 1] = origin.y + u.y * a + v.y * b + n.y * lift;
    pos[o + i * 3 + 2] = origin.z + u.z * a + v.z * b + n.z * lift;
  }
}

/** Collapse a quad to one point (hidden: no fragments, bounds stay put). */
export function collapseQuad(pos: Float32Array, o: number, at: V3) {
  for (let i = 0; i < 4; i++) {
    pos[o + i * 3] = at.x;
    pos[o + i * 3 + 1] = at.y;
    pos[o + i * 3 + 2] = at.z;
  }
}
