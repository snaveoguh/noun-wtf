// ── Arena geometry + collision (pure, three.js-free) ────────────────────
//
// Maps are authored as axis-aligned boxes plus ramps (wedges). The sim only
// ever needs three queries — "does this segment hit anything", "what can I
// stand on here", "is this volume free" — and boxes + wedges answer them
// exactly and deterministically with plain arithmetic. That keeps the sim
// portable to a PartyKit room (phase 2) with no WebGL / BVH dependency; the
// client builds its toon meshes from the very same data.

export type SolidTag =
  | 'floor'
  | 'wall'
  | 'building'
  | 'roof'
  | 'crate'
  | 'container'
  | 'tank'
  | 'catwalk'
  | 'parapet'
  | 'car'
  | 'planter'
  | 'statue'
  | 'kiosk'
  | 'pillar'
  | 'bench'
  | 'dumpster'
  | 'barrier'
  | 'bridge'
  | 'base';

export interface BoxDef {
  min: [number, number, number];
  max: [number, number, number];
  tag: SolidTag;
  /** Optional colour override for the renderer (0xRRGGBB). */
  color?: number;
}

export type RampDir = '+x' | '-x' | '+z' | '-z';

export interface RampDef {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Low and high surface heights. */
  y0: number;
  y1: number;
  /** Direction the surface rises toward. */
  dir: RampDir;
  look: 'ramp' | 'stairs';
}

export interface SpawnDef {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** 0 red, 1 blue, -1 neutral (FFA / fallback). */
  team: 0 | 1 | -1;
}

export interface ZoneDef {
  id: string;
  x: number;
  y: number;
  z: number;
  r: number;
}

export interface MapDef {
  id: 'nouncity' | 'warehouse';
  name: string;
  blurb: string;
  /** Playable half-extents (x, z). */
  half: [number, number];
  boxes: BoxDef[];
  ramps: RampDef[];
  spawns: SpawnDef[];
  zones: ZoneDef[];
  /** Below this you're out of the arena. */
  killY: number;
}

export interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  tag: SolidTag;
}

interface Plane {
  nx: number;
  ny: number;
  nz: number;
  d: number;
}

export interface Ramp extends RampDef {
  planes: Plane[];
  /** Rise per metre along `dir`. */
  k: number;
}

export interface Hit {
  /** Fraction along the segment (0..1). */
  t: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
}

export function newHit(): Hit {
  return { t: 1, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 };
}

function rampPlanes(r: RampDef): { planes: Plane[]; k: number } {
  const along = r.dir === '+x' || r.dir === '-x' ? r.x1 - r.x0 : r.z1 - r.z0;
  const k = (r.y1 - r.y0) / Math.max(1e-3, along);
  const planes: Plane[] = [
    { nx: 0, ny: -1, nz: 0, d: -r.y0 },
    { nx: -1, ny: 0, nz: 0, d: -r.x0 },
    { nx: 1, ny: 0, nz: 0, d: r.x1 },
    { nx: 0, ny: 0, nz: -1, d: -r.z0 },
    { nx: 0, ny: 0, nz: 1, d: r.z1 },
  ];
  switch (r.dir) {
    case '+x':
      planes.push({ nx: -k, ny: 1, nz: 0, d: r.y0 - k * r.x0 });
      break;
    case '-x':
      planes.push({ nx: k, ny: 1, nz: 0, d: r.y0 + k * r.x1 });
      break;
    case '+z':
      planes.push({ nx: 0, ny: 1, nz: -k, d: r.y0 - k * r.z0 });
      break;
    case '-z':
      planes.push({ nx: 0, ny: 1, nz: k, d: r.y0 + k * r.z1 });
      break;
  }
  return { planes, k };
}

export function rampHeight(r: RampDef & { k?: number }, x: number, z: number): number {
  const along = r.dir === '+x' || r.dir === '-x' ? r.x1 - r.x0 : r.z1 - r.z0;
  const k = r.k ?? (r.y1 - r.y0) / Math.max(1e-3, along);
  switch (r.dir) {
    case '+x':
      return r.y0 + k * (x - r.x0);
    case '-x':
      return r.y0 + k * (r.x1 - x);
    case '+z':
      return r.y0 + k * (z - r.z0);
    case '-z':
      return r.y0 + k * (r.z1 - z);
  }
}

export class World {
  readonly map: MapDef;
  readonly boxes: Box[];
  readonly ramps: Ramp[];
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;

  constructor(map: MapDef) {
    this.map = map;
    this.boxes = map.boxes.map(b => ({
      minX: Math.min(b.min[0], b.max[0]),
      minY: Math.min(b.min[1], b.max[1]),
      minZ: Math.min(b.min[2], b.max[2]),
      maxX: Math.max(b.min[0], b.max[0]),
      maxY: Math.max(b.min[1], b.max[1]),
      maxZ: Math.max(b.min[2], b.max[2]),
      tag: b.tag,
    }));
    this.ramps = map.ramps.map(r => ({ ...r, ...rampPlanes(r) }));
    this.minX = -map.half[0];
    this.maxX = map.half[0];
    this.minZ = -map.half[1];
    this.maxZ = map.half[1];
  }

  /**
   * Earliest solid hit along a → b. Fills `out` (t in 0..1, point, normal)
   * and returns true on a hit.
   */
  segment(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    out: Hit,
  ): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const sMinX = Math.min(ax, bx);
    const sMaxX = Math.max(ax, bx);
    const sMinY = Math.min(ay, by);
    const sMaxY = Math.max(ay, by);
    const sMinZ = Math.min(az, bz);
    const sMaxZ = Math.max(az, bz);
    let best = 2;
    let bnx = 0;
    let bny = 1;
    let bnz = 0;
    for (const b of this.boxes) {
      if (
        b.maxX < sMinX ||
        b.minX > sMaxX ||
        b.maxY < sMinY ||
        b.minY > sMaxY ||
        b.maxZ < sMinZ ||
        b.minZ > sMaxZ
      )
        continue;
      let tmin = 0;
      let tmax = 1;
      let axis = -1;
      let sign = 0;
      // X slab
      if (Math.abs(dx) < 1e-12) {
        if (ax < b.minX || ax > b.maxX) continue;
      } else {
        const inv = 1 / dx;
        let t1 = (b.minX - ax) * inv;
        let t2 = (b.maxX - ax) * inv;
        if (t1 > t2) {
          const s = t1;
          t1 = t2;
          t2 = s;
        }
        if (t1 > tmin) {
          tmin = t1;
          axis = 0;
          sign = dx > 0 ? -1 : 1;
        }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      if (Math.abs(dy) < 1e-12) {
        if (ay < b.minY || ay > b.maxY) continue;
      } else {
        const inv = 1 / dy;
        let t1 = (b.minY - ay) * inv;
        let t2 = (b.maxY - ay) * inv;
        if (t1 > t2) {
          const s = t1;
          t1 = t2;
          t2 = s;
        }
        if (t1 > tmin) {
          tmin = t1;
          axis = 1;
          sign = dy > 0 ? -1 : 1;
        }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      if (Math.abs(dz) < 1e-12) {
        if (az < b.minZ || az > b.maxZ) continue;
      } else {
        const inv = 1 / dz;
        let t1 = (b.minZ - az) * inv;
        let t2 = (b.maxZ - az) * inv;
        if (t1 > t2) {
          const s = t1;
          t1 = t2;
          t2 = s;
        }
        if (t1 > tmin) {
          tmin = t1;
          axis = 2;
          sign = dz > 0 ? -1 : 1;
        }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      if (tmin < best) {
        best = tmin;
        if (axis === -1) {
          // Started inside: push back along the ray
          const l = Math.hypot(dx, dy, dz) || 1;
          bnx = -dx / l;
          bny = -dy / l;
          bnz = -dz / l;
        } else {
          bnx = axis === 0 ? sign : 0;
          bny = axis === 1 ? sign : 0;
          bnz = axis === 2 ? sign : 0;
        }
      }
    }
    for (const r of this.ramps) {
      if (
        r.x1 < sMinX ||
        r.x0 > sMaxX ||
        r.y1 < sMinY ||
        r.y0 > sMaxY ||
        r.z1 < sMinZ ||
        r.z0 > sMaxZ
      )
        continue;
      let tE = 0;
      let tX = 1;
      let nx = 0;
      let ny = 1;
      let nz = 0;
      let entered = false;
      let miss = false;
      for (const p of r.planes) {
        const denom = p.nx * dx + p.ny * dy + p.nz * dz;
        const dist = p.nx * ax + p.ny * ay + p.nz * az - p.d;
        if (Math.abs(denom) < 1e-12) {
          if (dist > 0) {
            miss = true;
            break;
          }
          continue;
        }
        const t = -dist / denom;
        if (denom < 0) {
          if (t > tE) {
            tE = t;
            nx = p.nx;
            ny = p.ny;
            nz = p.nz;
            entered = true;
          }
        } else if (t < tX) tX = t;
        if (tE > tX) {
          miss = true;
          break;
        }
      }
      if (miss || tE >= best) continue;
      best = tE;
      if (!entered) {
        nx = 0;
        ny = 1;
        nz = 0;
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      bnx = nx / l;
      bny = ny / l;
      bnz = nz / l;
    }
    if (best > 1) return false;
    out.t = best;
    out.x = ax + dx * best;
    out.y = ay + dy * best;
    out.z = az + dz * best;
    out.nx = bnx;
    out.ny = bny;
    out.nz = bnz;
    return true;
  }

  /** True when nothing solid sits between a and b. */
  clear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    return !this.segment(ax, ay, az, bx, by, bz, _losHit);
  }

  /** Does an AABB overlap any box (ramps excluded)? */
  boxBlocked(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
  ): boolean {
    for (const b of this.boxes) {
      if (
        b.maxX > minX &&
        b.minX < maxX &&
        b.maxY > minY &&
        b.minY < maxY &&
        b.maxZ > minZ &&
        b.minZ < maxZ
      )
        return true;
    }
    return false;
  }

  /** Highest ramp surface over an xz rectangle (−Infinity when none overlaps). */
  rampTopIn(minX: number, maxX: number, minZ: number, maxZ: number): number {
    let best = -Infinity;
    for (const r of this.ramps) {
      if (r.x1 < minX || r.x0 > maxX || r.z1 < minZ || r.z0 > maxZ) continue;
      // Highest point of the overlap lies at its edge in the rise direction
      const x =
        r.dir === '+x' ? Math.min(maxX, r.x1) : r.dir === '-x' ? Math.max(minX, r.x0) : r.x0;
      const z =
        r.dir === '+z' ? Math.min(maxZ, r.z1) : r.dir === '-z' ? Math.max(minZ, r.z0) : r.z0;
      const h = rampHeight(r, x, z);
      if (h > best) best = h;
    }
    return best;
  }

  /**
   * Highest walkable surface at (x, z) no higher than `maxY` (box tops and
   * ramp surfaces), or -Infinity over a void.
   */
  groundAt(x: number, z: number, maxY: number): number {
    let best = -Infinity;
    for (const b of this.boxes) {
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      if (b.maxY <= maxY && b.maxY > best) best = b.maxY;
    }
    for (const r of this.ramps) {
      if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) continue;
      const h = rampHeight(r, x, z);
      if (h <= maxY && h > best) best = h;
    }
    return best;
  }

  /** Every distinct standable height at (x, z) (box tops + ramp surfaces). */
  surfacesAt(x: number, z: number): number[] {
    const out: number[] = [];
    for (const b of this.boxes) {
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      out.push(b.maxY);
    }
    for (const r of this.ramps) {
      if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) continue;
      out.push(rampHeight(r, x, z));
    }
    out.sort((a, b) => a - b);
    const dedup: number[] = [];
    for (const y of out)
      if (dedup.length === 0 || y - dedup[dedup.length - 1] > 0.05) dedup.push(y);
    return dedup;
  }

  inBounds(x: number, z: number, pad = 0): boolean {
    return x > this.minX + pad && x < this.maxX - pad && z > this.minZ + pad && z < this.maxZ - pad;
  }
}

const _losHit = newHit();
