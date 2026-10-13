// ── Navigation grid for bots ────────────────────────────────────────────
//
// Built once per map straight from the collision data: sample a grid,
// keep every standable surface with head-room (floor, crate tops, roofs,
// catwalks, ramps), link neighbours that are a step apart (both ways) or a
// drop apart (down only), then keep the biggest connected island. A* over
// it gives bots routes up ramps and stairs and onto catwalks; a per-node
// cover score (how boxed-in it is at chest height) helps them pick cover.

import type { World } from './world';

import { BODY } from './types';

export interface NavNode {
  x: number;
  y: number;
  z: number;
  /** Neighbour node indices + costs. */
  links: number[];
  costs: number[];
  /** 0..1 — fraction of the 8 compass rays at chest height that hit cover within 2.2 m. */
  cover: number;
  /** Low cover (blocked at 0.7 m, open at 1.5 m): crouch-peek spot. */
  lowCover: boolean;
}

export class NavGraph {
  nodes: NavNode[] = [];
  cell: number;
  private ox: number;
  private oz: number;
  private nx: number;
  private nzc: number;
  /** Grid cell → node indices on that cell. */
  private buckets: number[][];

  constructor(world: World, cell = 0.8) {
    this.cell = cell;
    this.ox = world.minX;
    this.oz = world.minZ;
    this.nx = Math.ceil((world.maxX - world.minX) / cell);
    this.nzc = Math.ceil((world.maxZ - world.minZ) / cell);
    this.buckets = Array.from({ length: this.nx * this.nzc }, () => []);
    this.build(world);
  }

  private build(world: World) {
    const r = BODY.radius + 0.05;
    const raw: { x: number; y: number; z: number; i: number; j: number }[] = [];
    const rawBuckets: number[][] = Array.from({ length: this.nx * this.nzc }, () => []);
    for (let i = 0; i < this.nx; i++) {
      for (let j = 0; j < this.nzc; j++) {
        const x = this.ox + (i + 0.5) * this.cell;
        const z = this.oz + (j + 0.5) * this.cell;
        if (!world.inBounds(x, z, r)) continue;
        for (const y of world.surfacesAt(x, z)) {
          // Head-room and nothing to bump into at this spot
          if (world.boxBlocked(x - r, y + 0.06, z - r, x + r, y + BODY.height, z + r)) continue;
          // …and not tucked under (or beside the tall side of) a ramp
          if (world.rampTopIn(x - r, x + r, z - r, z + r) > y + BODY.step) continue;
          // Must stand on something across most of the footprint (no edge teetering)
          const support =
            Math.abs(world.groundAt(x, z, y + 0.05) - y) < 0.3 &&
            world.groundAt(x + r * 0.6, z, y + 0.6) > y - 0.6 &&
            world.groundAt(x - r * 0.6, z, y + 0.6) > y - 0.6 &&
            world.groundAt(x, z + r * 0.6, y + 0.6) > y - 0.6 &&
            world.groundAt(x, z - r * 0.6, y + 0.6) > y - 0.6;
          if (!support) continue;
          rawBuckets[i * this.nzc + j].push(raw.length);
          raw.push({ x, y, z, i, j });
        }
      }
    }
    // Links
    const links: number[][] = raw.map(() => []);
    const costs: number[][] = raw.map(() => []);
    const D = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];
    const step = BODY.step + 0.08;
    const findAt = (i: number, j: number, y: number, tol: number) => {
      if (i < 0 || j < 0 || i >= this.nx || j >= this.nzc) return -1;
      let best = -1;
      let bd = tol;
      for (const k of rawBuckets[i * this.nzc + j]) {
        const d = Math.abs(raw[k].y - y);
        if (d <= bd) {
          bd = d;
          best = k;
        }
      }
      return best;
    };
    for (let a = 0; a < raw.length; a++) {
      const n = raw[a];
      for (const [di, dj] of D) {
        const ni = n.i + di;
        const nj = n.j + dj;
        if (ni < 0 || nj < 0 || ni >= this.nx || nj >= this.nzc) continue;
        for (const b of rawBuckets[ni * this.nzc + nj]) {
          const m = raw[b];
          const dy = m.y - n.y;
          const diag = di !== 0 && dj !== 0;
          if (Math.abs(dy) <= step) {
            // No corner cutting on diagonals
            if (
              diag &&
              (findAt(n.i + di, n.j, n.y, step) < 0 || findAt(n.i, n.j + dj, n.y, step) < 0)
            )
              continue;
            // Mid-point must be standable too (no gaps between crates)
            const mx = (n.x + m.x) / 2;
            const mz = (n.z + m.z) / 2;
            const g = world.groundAt(mx, mz, Math.max(n.y, m.y) + 0.1);
            if (g < Math.min(n.y, m.y) - 0.6) continue;
            links[a].push(b);
            costs[a].push(Math.hypot(m.x - n.x, dy, m.z - n.z));
          } else if (dy < -step && dy > -5.5 && !diag) {
            // Drop down (one way): our ledge must actually end here
            const ex = n.x + di * this.cell * 0.5;
            const ez = n.z + dj * this.cell * 0.5;
            if (world.groundAt(ex, ez, n.y + 0.1) > n.y - 0.3) continue;
            if (world.boxBlocked(m.x - r, m.y + 0.06, m.z - r, m.x + r, n.y + BODY.height, m.z + r))
              continue;
            links[a].push(b);
            costs[a].push(Math.hypot(m.x - n.x, m.z - n.z) + 1.5 - dy * 0.3);
          }
        }
      }
    }
    // Keep the biggest strongly-useful island: nodes reachable from (and
    // reaching) the most-connected component.
    const comp = new Int32Array(raw.length).fill(-1);
    // Undirected components over two-way links only
    let best = -1;
    let bestSize = 0;
    let cid = 0;
    const twoWay = (a: number, b: number) => links[b].includes(a);
    for (let s = 0; s < raw.length; s++) {
      if (comp[s] >= 0) continue;
      const stack = [s];
      comp[s] = cid;
      let size = 0;
      while (stack.length > 0) {
        const a = stack.pop()!;
        size++;
        for (const b of links[a]) {
          if (comp[b] < 0 && twoWay(a, b)) {
            comp[b] = cid;
            stack.push(b);
          }
        }
      }
      if (size > bestSize) {
        bestSize = size;
        best = cid;
      }
      cid++;
    }
    // Also keep nodes that can reach the main island via drops (ledges)
    const keep = new Uint8Array(raw.length);
    for (let a = 0; a < raw.length; a++) if (comp[a] === best) keep[a] = 1;
    const rev: number[][] = raw.map(() => []);
    for (let a = 0; a < raw.length; a++) for (const b of links[a]) rev[b].push(a);
    let changed = true;
    while (changed) {
      changed = false;
      for (let a = 0; a < raw.length; a++) {
        if (keep[a] === 1) continue;
        // Reachable from the main island AND leads back to it
        if (links[a].some(b => keep[b] === 1) && rev[a].some(b => keep[b] === 1)) {
          keep[a] = 1;
          changed = true;
        }
      }
    }
    const remap = new Int32Array(raw.length).fill(-1);
    for (let a = 0; a < raw.length; a++) {
      if (keep[a] !== 1) continue;
      remap[a] = this.nodes.length;
      const n = raw[a];
      this.nodes.push({ x: n.x, y: n.y, z: n.z, links: [], costs: [], cover: 0, lowCover: false });
      this.buckets[n.i * this.nzc + n.j].push(remap[a]);
    }
    for (let a = 0; a < raw.length; a++) {
      const na = remap[a];
      if (na < 0) continue;
      for (let k = 0; k < links[a].length; k++) {
        const nb = remap[links[a][k]];
        if (nb < 0) continue;
        this.nodes[na].links.push(nb);
        this.nodes[na].costs.push(costs[a][k]);
      }
    }
    // Cover scores
    for (const n of this.nodes) {
      let hits = 0;
      let low = 0;
      let high = 0;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const dx = Math.cos(a) * 2.2;
        const dz = Math.sin(a) * 2.2;
        if (!world.clear(n.x, n.y + 1.1, n.z, n.x + dx, n.y + 1.1, n.z + dz)) hits++;
        const lowHit = !world.clear(n.x, n.y + 0.7, n.z, n.x + dx, n.y + 0.7, n.z + dz);
        const highHit = !world.clear(n.x, n.y + 1.55, n.z, n.x + dx, n.y + 1.55, n.z + dz);
        if (lowHit) low++;
        if (highHit) high++;
      }
      n.cover = hits / 8;
      n.lowCover = low > high;
    }
  }

  /** Nearest node to a point (prefers same level). */
  nearest(x: number, y: number, z: number, maxR = 6): number {
    const ci = Math.floor((x - this.ox) / this.cell);
    const cj = Math.floor((z - this.oz) / this.cell);
    let best = -1;
    let bd = Infinity;
    const rings = Math.ceil(maxR / this.cell);
    for (let ring = 0; ring <= rings; ring++) {
      for (let i = ci - ring; i <= ci + ring; i++) {
        for (let j = cj - ring; j <= cj + ring; j++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== ring) continue;
          if (i < 0 || j < 0 || i >= this.nx || j >= this.nzc) continue;
          for (const k of this.buckets[i * this.nzc + j]) {
            const n = this.nodes[k];
            const d = (n.x - x) ** 2 + (n.z - z) ** 2 + ((n.y - y) * 3) ** 2;
            if (d < bd) {
              bd = d;
              best = k;
            }
          }
        }
      }
      // Anything found within this ring is as good as it gets (± one ring)
      if (best >= 0 && ring >= 1) break;
    }
    return best;
  }

  /** Nodes within radius r of (x, z) (any level within ±dy). */
  within(x: number, y: number, z: number, r: number, dy = 2.5): number[] {
    const out: number[] = [];
    const i0 = Math.max(0, Math.floor((x - r - this.ox) / this.cell));
    const i1 = Math.min(this.nx - 1, Math.floor((x + r - this.ox) / this.cell));
    const j0 = Math.max(0, Math.floor((z - r - this.oz) / this.cell));
    const j1 = Math.min(this.nzc - 1, Math.floor((z + r - this.oz) / this.cell));
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++)
        for (const k of this.buckets[i * this.nzc + j]) {
          const n = this.nodes[k];
          if ((n.x - x) ** 2 + (n.z - z) ** 2 <= r * r && Math.abs(n.y - y) <= dy) out.push(k);
        }
    return out;
  }

  /** A* from node a to node b. Returns node indices (a excluded), or null. */
  path(a: number, b: number, maxExpand = 6000): number[] | null {
    if (a < 0 || b < 0) return null;
    if (a === b) return [b];
    const N = this.nodes.length;
    const g = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = new MinHeap();
    const tb = this.nodes[b];
    const h = (k: number) => {
      const n = this.nodes[k];
      return Math.hypot(n.x - tb.x, n.y - tb.y, n.z - tb.z);
    };
    g[a] = 0;
    heap.push(a, h(a));
    let expanded = 0;
    while (heap.size > 0) {
      const cur = heap.pop();
      if (cur === b) break;
      if (closed[cur] === 1) continue;
      closed[cur] = 1;
      if (++expanded > maxExpand) return null;
      const n = this.nodes[cur];
      for (let k = 0; k < n.links.length; k++) {
        const nb = n.links[k];
        if (closed[nb] === 1) continue;
        const ng = g[cur] + n.costs[k];
        if (ng < g[nb]) {
          g[nb] = ng;
          came[nb] = cur;
          heap.push(nb, ng + h(nb));
        }
      }
    }
    if (came[b] < 0) return null;
    const out: number[] = [];
    for (let k = b; k !== a; k = came[k]) out.push(k);
    out.reverse();
    return out;
  }
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];

  get size() {
    return this.ids.length;
  }

  push(id: number, key: number) {
    const ids = this.ids;
    const keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }

  pop(): number {
    const ids = this.ids;
    const keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop()!;
    const lastKey = keys.pop()!;
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= lastKey) break;
        ids[i] = ids[c];
        keys[i] = keys[c];
        i = c;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}
