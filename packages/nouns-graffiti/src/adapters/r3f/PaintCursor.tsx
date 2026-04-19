// Small 3D ring that follows the raycast hit point on the currently hovered paintable.
// Consumer drives it by passing the hit info (from their raycaster or pointer events).

import { useMemo } from 'react';

import * as THREE from 'three';

import { usePaintSession } from './usePaintSession.js';

export interface PaintCursorProps {
  /** World position of the cursor center. Null = hide. */
  position: [number, number, number] | null;
  /** Normal at the hit point (so the ring faces the wall). */
  normal?: [number, number, number];
  /** Scale factor if your world is scaled. */
  scale?: number;
}

export function PaintCursor({ position, normal = [0, 0, 1], scale = 1 }: PaintCursorProps) {
  const session = usePaintSession();
  const radius = useMemo(() => Math.max(0.05, session.size * 0.004) * scale, [session.size, scale]);

  const quat = useMemo(() => {
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 0, 1);
    const n = new THREE.Vector3(...normal).normalize();
    q.setFromUnitVectors(up, n);
    return q;
  }, [normal]);

  if (!position) return null;
  return (
    <group position={position} quaternion={quat}>
      <mesh>
        <ringGeometry args={[radius * 0.85, radius, 48]} />
        <meshBasicMaterial
          color={session.color}
          transparent
          opacity={0.85}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh position={[0, 0, 0.001]}>
        <circleGeometry args={[radius * 0.1, 16]} />
        <meshBasicMaterial color={session.color} transparent opacity={0.6} />
      </mesh>
    </group>
  );
}
