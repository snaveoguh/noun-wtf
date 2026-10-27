// ── The plaza as a height grid, and A* across it (pure) ──────────────────
//
// The host probes the arena once (straight down, every CELL metres) into a
// height grid: the plaza floor, the props on it, the ring's rooftops and
// the towers. CPU players move on it. Steps up to STEP between cells are a
// walk; a bigger rise is a climb (the way players climb walls: slower, so
// it costs 4× its height on top of the distance: a detour round a short
// wall wins); drops are free but cost a little. Diagonals only where both
// side cells are open, so nobody cuts a corner through a wall.

export const CELL = 2;
export const STEP = 0.6;
/** Climbs past this are left alone (the towers). */
export const MAX_CLIMB = 32;

export interface NavGrid {
  /** World x / z of cell (0, 0)'s centre. */
  x0: number;
  z0: number;
  nx: number;
  nz: number;
  cell: number;
  /** Ground height per cell (NaN: nothing there / outside). */
  h: Float32Array;
}

export function makeGrid(
  x0: number,
  z0: number,
  nx: number,
  nz: number,
  cell: number,
  probe: (x: number, z: number) => number | null,
): NavGrid {
  const h = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const y = probe(x0 + i * cell, z0 + j * cell);
      h[j * nx + i] = y === null ? NaN : y;
    }
  return { x0, z0, nx, nz, cell, h };
}

export const cellOf = (g: NavGrid, x: number, z: number): [number, number] => [
  Math.max(0, Math.min(g.nx - 1, Math.round((x - g.x0) / g.cell))),
  Math.max(0, Math.min(g.nz - 1, Math.round((z - g.z0) / g.cell))),
];

export const heightAt = (g: NavGrid, i: number, j: number): number =>
  i < 0 || j < 0 || i >= g.nx || j >= g.nz ? NaN : g.h[j * g.nx + i]!;

/** The ground under a world point (nearest cell). */
export function groundAt(g: NavGrid, x: number, z: number): number {
  const [i, j] = cellOf(g, x, z);
  return heightAt(g, i, j);
}

export const worldOf = (g: NavGrid, i: number, j: number) => ({
  x: g.x0 + i * g.cell,
  y: heightAt(g, i, j),
  z: g.z0 + j * g.cell,
});

/** Cost to go from height a to height b over `d` metres (Infinity: can't). */
export function edgeCost(a: number, b: number, d: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  const dy = b - a;
  if (dy <= STEP) return d + (dy < -STEP ? 0.5 : 0);
  if (dy > MAX_CLIMB) return Infinity;
  return d + dy * 4;
}

/** Ground-level ("plaza floor") cells: the ones a walker can reach without climbing. */
export function isFloor(g: NavGrid, i: number, j: number): boolean {
  const y = heightAt(g, i, j);
  return Number.isFinite(y) && y < 1.6;
}

const DIRS: readonly [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * A* from one world point to another. Returns world waypoints (cell
 * centres at their ground height, the start left out), or null.
 * `maxNodes` caps the work.
 */
export function findPath(
  g: NavGrid,
  from: { x: number; z: number },
  to: { x: number; z: number },
  maxNodes = 6000,
): { x: number; y: number; z: number }[] | null {
  const [si, sj] = cellOf(g, from.x, from.z);
  const [ti, tj] = cellOf(g, to.x, to.z);
  const N = g.nx * g.nz;
  const s = sj * g.nx + si;
  const t = tj * g.nx + ti;
  if (!Number.isFinite(g.h[s]!) || !Number.isFinite(g.h[t]!)) return null;
  if (s === t) return [worldOf(g, ti, tj)];
  const gs = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const hx = (k: number) => {
    const i = k % g.nx;
    const j = (k - i) / g.nx;
    return Math.hypot(i - ti, j - tj) * g.cell;
  };
  // Binary heap of [f, k]
  const heap: number[] = [];
  const push = (f: number, k: number) => {
    heap.push(f, k);
    let c = heap.length / 2 - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heap[p * 2]! <= heap[c * 2]!) break;
      [heap[p * 2], heap[c * 2]] = [heap[c * 2]!, heap[p * 2]!];
      [heap[p * 2 + 1], heap[c * 2 + 1]] = [heap[c * 2 + 1]!, heap[p * 2 + 1]!];
      c = p;
    }
  };
  const pop = (): number => {
    const k = heap[1]!;
    // Pairs are pushed f then k, so they come off k first
    const lk = heap.pop()!;
    const lf = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = lf;
      heap[1] = lk;
      let c = 0;
      const n = heap.length / 2;
      for (;;) {
        const l = c * 2 + 1;
        const r = l + 1;
        let m = c;
        if (l < n && heap[l * 2]! < heap[m * 2]!) m = l;
        if (r < n && heap[r * 2]! < heap[m * 2]!) m = r;
        if (m === c) break;
        [heap[m * 2], heap[c * 2]] = [heap[c * 2]!, heap[m * 2]!];
        [heap[m * 2 + 1], heap[c * 2 + 1]] = [heap[c * 2 + 1]!, heap[m * 2 + 1]!];
        c = m;
      }
    }
    return k;
  };
  gs[s] = 0;
  push(hx(s), s);
  let seen = 0;
  while (heap.length > 0) {
    const k = pop();
    if (closed[k]) continue;
    closed[k] = 1;
    if (k === t) break;
    if (++seen > maxNodes) return null;
    const i = k % g.nx;
    const j = (k - i) / g.nx;
    const hk = g.h[k]!;
    for (const [di, dj, w] of DIRS) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= g.nx || nj >= g.nz) continue;
      const nk = nj * g.nx + ni;
      if (closed[nk]) continue;
      if (di !== 0 && dj !== 0) {
        // No corner cutting: both side cells walkable from here
        const a = g.h[j * g.nx + ni]!;
        const b = g.h[nj * g.nx + i]!;
        if (Math.abs(a - hk) > STEP || Math.abs(b - hk) > STEP) continue;
      }
      const c = edgeCost(hk, g.h[nk]!, w * g.cell);
      if (!Number.isFinite(c)) continue;
      const ng = gs[k]! + c;
      if (ng < gs[nk]!) {
        gs[nk] = ng;
        came[nk] = k;
        push(ng + hx(nk), nk);
      }
    }
  }
  if (came[t] === -1) return null;
  const out: { x: number; y: number; z: number }[] = [];
  for (let k = t; k !== s && k !== -1; k = came[k]!) {
    const i = k % g.nx;
    out.push(worldOf(g, i, (k - i) / g.nx));
  }
  return out.reverse();
}

/**
 * Hiding spots: open cells right up against something taller (a wall, a
 * prop, a parapet) and rooftop cells, scored by how sheltered they are.
 */
export function hideSpots(g: NavGrid): { i: number; j: number; cover: number; roof: boolean }[] {
  const out: { i: number; j: number; cover: number; roof: boolean }[] = [];
  for (let j = 1; j < g.nz - 1; j++)
    for (let i = 1; i < g.nx - 1; i++) {
      const y = heightAt(g, i, j);
      if (!Number.isFinite(y)) continue;
      let cover = 0;
      let flat = 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          const n = heightAt(g, i + di, j + dj);
          if (!Number.isFinite(n)) continue;
          if (n - y > 1.2) cover++;
          else if (Math.abs(n - y) <= STEP) flat++;
        }
      const roof = y > 6;
      // Somewhere to stand, and either sheltered or up on a roof
      if (flat >= 3 && (cover >= 2 || roof)) out.push({ i, j, cover, roof });
    }
  return out;
}
