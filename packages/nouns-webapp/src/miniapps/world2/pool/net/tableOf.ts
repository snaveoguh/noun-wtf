// ── playAt's arguments → one PoolTable ──────────────────────────────────

import type { PoolTable } from '../contract';

/** The bar prop (interiors/layout.ts `pool_table`: 2.3 × 1.3, 0.86 tall). */
export const BAR_TABLE = { length: 2.3, width: 1.3, height: 0.86 };

/** playAt's two forms → one PoolTable (copied: a THREE.Vector3 isn't kept). */
export function tableOf(
  at: PoolTable | { x: number; y: number; z: number },
  yaw?: number,
): PoolTable {
  // Numbers only: a THREE.Vector3 has a length() method
  const t = at as Record<string, unknown>;
  const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return {
    x: at.x,
    y: at.y,
    z: at.z,
    yaw: n(yaw, n(t.yaw, 0)),
    length: n(t.length, BAR_TABLE.length),
    width: n(t.width, BAR_TABLE.width),
    height: n(t.height, BAR_TABLE.height),
    ...(typeof t.id === 'string' ? { id: t.id } : {}),
  };
}
