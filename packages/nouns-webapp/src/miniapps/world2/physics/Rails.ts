// ── Grindable edges — polylines with nearest-point queries ──────────────

import * as THREE from 'three';

export type RailType = 'ledge' | 'rail' | 'coping' | 'curb';

export interface RailDef {
  id: string;
  type: RailType;
  points: [number, number, number][];
}

export interface Rail {
  id: string;
  type: RailType;
  points: THREE.Vector3[];
  /** Cumulative arc length at each point. */
  lengths: number[];
  total: number;
  bounds: THREE.Box3;
}

export interface RailQuery {
  rail: Rail;
  /** Arc-length position along the rail. */
  s: number;
  point: THREE.Vector3;
  /** Unit tangent at s (direction of increasing s). */
  tangent: THREE.Vector3;
  distance: number;
}

const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();
const _p = new THREE.Vector3();

export class RailSet {
  rails: Rail[] = [];

  load(defs: RailDef[]) {
    this.rails = [];
    this.add(defs);
  }

  /** Register more rails (streamed set pieces); ids should be unique. */
  add(defs: RailDef[]) {
    for (const d of defs) {
      if (d.points.length < 2) continue;
      const points = d.points.map(p => new THREE.Vector3(p[0], p[1], p[2]));
      const lengths = [0];
      for (let i = 1; i < points.length; i++) {
        lengths.push(lengths[i - 1] + points[i].distanceTo(points[i - 1]));
      }
      const bounds = new THREE.Box3().setFromPoints(points);
      bounds.expandByScalar(0.6);
      this.rails.push({
        id: d.id,
        type: d.type,
        points,
        lengths,
        total: lengths[lengths.length - 1],
        bounds,
      });
    }
  }

  /** Drop the rails with these ids (a streamed set piece unloading). */
  remove(ids: Iterable<string>) {
    const drop = new Set(ids);
    if (drop.size > 0) this.rails = this.rails.filter(r => !drop.has(r.id));
  }

  /** Nearest rail point to p within maxDist (3D distance). */
  nearest(p: THREE.Vector3, maxDist: number): RailQuery | null {
    let best: RailQuery | null = null;
    let bestD = maxDist;
    for (const rail of this.rails) {
      if (!rail.bounds.containsPoint(p) && rail.bounds.distanceToPoint(p) > maxDist) continue;
      for (let i = 0; i < rail.points.length - 1; i++) {
        const a = rail.points[i];
        const b = rail.points[i + 1];
        _ab.subVectors(b, a);
        const segLen2 = _ab.lengthSq();
        if (segLen2 < 1e-8) continue;
        _ap.subVectors(p, a);
        const t = THREE.MathUtils.clamp(_ap.dot(_ab) / segLen2, 0, 1);
        _p.copy(a).addScaledVector(_ab, t);
        const d = _p.distanceTo(p);
        if (d < bestD) {
          bestD = d;
          const segLen = Math.sqrt(segLen2);
          best = {
            rail,
            s: rail.lengths[i] + t * segLen,
            point: _p.clone(),
            tangent: _ab.clone().divideScalar(segLen),
            distance: d,
          };
        }
      }
    }
    return best;
  }

  /** Point + tangent at arc length s (clamped). */
  sample(rail: Rail, s: number, outPoint: THREE.Vector3, outTangent: THREE.Vector3) {
    const ss = THREE.MathUtils.clamp(s, 0, rail.total);
    let i = 0;
    while (i < rail.lengths.length - 2 && rail.lengths[i + 1] < ss) i++;
    const a = rail.points[i];
    const b = rail.points[i + 1];
    const segLen = rail.lengths[i + 1] - rail.lengths[i];
    const t = segLen > 0 ? (ss - rail.lengths[i]) / segLen : 0;
    outPoint.copy(a).lerp(b, t);
    outTangent.subVectors(b, a).normalize();
  }
}
